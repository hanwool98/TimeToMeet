-- 후기(event_reviews) 평점을 0.5점 단위(0.5~5.0)로 지원, 0점 선택 자체를
-- 제거한다.
--
-- 조사 결과 확인한 사실:
--   - event_reviews.rating은 현재 smallint, CHECK(rating between 1 and 5)
--     - 이미 0점은 저장 자체가 불가능했다(관리자용 set_review_rating_for_session,
--       참가자용 save_event_review_for_session 둘 다 동일하게 1~5만 허용).
--     - 실제 데이터도 확인 결과 rating=0인 행은 0건(전체 34건 중 4점 7건,
--       5점 27건뿐) - 변환/정리가 필요한 기존 데이터가 없다.
--   - round_ratings.score(참가자 간 호감도, 이 컬럼과는 별개 기능)는 이미
--     numeric(2,1) + CHECK(score>=0 and score<=5 and mod(score*10,5)=0)로
--     0.5 단위를 지원하고 있어 - 이번 event_reviews.rating 변경도 정확히
--     같은 패턴(numeric(2,1) + mod 기반 0.5 단위 체크)을 그대로 따른다.
--     단, round_ratings.score는 0을 허용하지만 이번 요청은 "0점 제거"이므로
--     하한을 0이 아닌 0.5로 둔다.
alter table public.event_reviews alter column rating drop default;
alter table public.event_reviews alter column rating type numeric(2,1) using rating::numeric(2,1);
alter table public.event_reviews alter column rating set default 5;
alter table public.event_reviews drop constraint if exists event_reviews_rating_check;
alter table public.event_reviews add constraint event_reviews_rating_check
  check (rating >= 0.5 and rating <= 5 and mod((rating * 10)::integer, 5) = 0);

-- 참가자 후기 저장 RPC: rating_value를 integer -> numeric으로(파라미터
-- 타입 변경이라 create or replace 불가 - drop 후 재생성). 본문은 검증
-- 조건 하나만 0.5 단위 허용으로 바꾸고 나머지는 그대로다.
drop function if exists public.save_event_review_for_session(text, text, text, text[], integer);

create function public.save_event_review_for_session(
  session_token text,
  event_id_value text,
  content_value text,
  image_paths_value text[] default '{}'::text[],
  rating_value numeric default null::numeric
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  clean_content text;
  clean_image_paths text[];
  expected_prefix text;
  path_value text;
  result_submitted_at timestamptz;
  review_exists boolean;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
    and a.checked_in_at is not null
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '체크인된 참가자만 후기를 작성할 수 있습니다.';
  end if;

  select exists(
    select 1 from public.event_reviews
    where event_id = event_id_value and application_id = target_application.id
  ) into review_exists;

  if review_exists then
    raise exception '이미 후기를 제출했습니다. 후기는 한 번만 작성할 수 있어요.';
  end if;

  clean_content := trim(coalesce(content_value, ''));
  if clean_content = '' then
    raise exception '후기 내용을 입력해주세요.';
  end if;
  if char_length(clean_content) > 2000 then
    raise exception '후기는 2000자 이내로 작성해주세요.';
  end if;

  if rating_value is null or rating_value < 0.5 or rating_value > 5
    or mod((rating_value * 10)::integer, 5) <> 0
  then
    raise exception '별점을 0.5점 단위로 선택해주세요.';
  end if;

  clean_image_paths := coalesce(image_paths_value, '{}');
  if array_length(clean_image_paths, 1) > 3 then
    raise exception '후기 이미지는 최대 3장까지 첨부할 수 있습니다.';
  end if;
  expected_prefix := 'event-reviews/' || public.sanitize_storage_id(event_id_value) || '/' || target_application.id::text || '/';
  foreach path_value in array clean_image_paths loop
    if left(path_value, char_length(expected_prefix)) <> expected_prefix then
      raise exception '본인이 업로드한 사진만 첨부할 수 있습니다.';
    end if;
  end loop;

  insert into public.event_reviews (event_id, application_id, content, image_paths, rating, submitted_at, updated_at)
  values (event_id_value, target_application.id, clean_content, clean_image_paths, rating_value, now(), now())
  on conflict (event_id, application_id) do nothing
  returning submitted_at into result_submitted_at;

  if result_submitted_at is null then
    raise exception '이미 후기를 제출했습니다. 후기는 한 번만 작성할 수 있어요.';
  end if;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at, 'removedImagePaths', '[]'::jsonb);
end;
$function$;

grant execute on function public.save_event_review_for_session(text, text, text, text[], numeric) to anon, authenticated;

-- 관리자 후기 별점 수정 RPC도 동일하게 numeric + 0.5 단위로.
drop function if exists public.set_review_rating_for_session(text, uuid, integer);

create function public.set_review_rating_for_session(
  session_token text,
  review_id_value uuid,
  rating_value numeric
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;
  if rating_value is null or rating_value < 0.5 or rating_value > 5
    or mod((rating_value * 10)::integer, 5) <> 0
  then
    raise exception '별점은 0.5~5 사이에서 0.5점 단위로만 입력할 수 있습니다.';
  end if;

  update public.event_reviews er
  set rating = rating_value, updated_at = now()
  where er.id = review_id_value;
end;
$function$;

grant execute on function public.set_review_rating_for_session(text, uuid, numeric) to anon, authenticated;

-- get_public_home_reviews/admin-list-event-reviews Edge Function은 rating을
-- 그대로 통과시킬 뿐 정수 변환을 하지 않으므로 서버 쪽은 수정할 필요가
-- 없다(프론트 fetchPublicHomeReviews의 클라이언트 측 반올림만 별도로
-- 0.5 단위로 수정 - 이 migration과 별개로 src/services/supabaseApplications.ts에서 처리).
