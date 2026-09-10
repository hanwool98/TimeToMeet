-- ============================================================
-- #2 카카오톡 ID를 "기본 프로필"(participant_profiles)에도 저장/조회
--    기존 기본 프로필에는 없어도 되도록 nullable 추가 전용 컬럼.
-- ============================================================
alter table public.participant_profiles add column if not exists kakao_id text;

-- get_my_participant_profile: RETURNS TABLE 마지막에 kakao_id 추가
-- (반환 타입 변경이라 drop 후 재생성). member 분기는 participant_profiles,
-- guest 분기는 applications에서 가져온다.
drop function if exists public.get_my_participant_profile(text);

create or replace function public.get_my_participant_profile(session_token text)
returns table (
  id uuid,
  account_type text,
  source text,
  can_reuse boolean,
  name text,
  birth_date date,
  gender text,
  residence text,
  phone_masked text,
  relationship_status text,
  nickname text,
  profile_photo_count integer,
  representative_photo_index integer,
  representative_crop jsonb,
  has_voice_intro boolean,
  height text,
  job text,
  has_id_photo boolean,
  has_employment_proof boolean,
  updated_at timestamptz,
  kakao_id text
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  session_row record;
begin
  select s.user_id, s.role
  into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_row.user_id is null then
    return;
  end if;

  if session_row.role = 'member' then
    return query
    select
      pp.id,
      'member'::text,
      'default_profile'::text,
      true,
      pp.name,
      pp.birth_date,
      pp.gender,
      pp.residence,
      left(regexp_replace(pp.phone, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(pp.phone, '\D', '', 'g'), 4),
      pp.relationship_status,
      pp.nickname,
      coalesce(array_length(pp.profile_photo_paths, 1), 0),
      pp.representative_photo_index,
      pp.representative_crop,
      pp.voice_intro_path is not null,
      pp.height,
      pp.job,
      pp.id_photo_path is not null,
      pp.employment_proof_path is not null,
      pp.updated_at,
      pp.kakao_id
    from public.participant_profiles pp
    where pp.user_id = session_row.user_id
      and pp.is_active
    order by pp.updated_at desc
    limit 1;
    return;
  end if;

  return query
  select
    a.id,
    'guest'::text,
    'application_profile'::text,
    false,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    left(regexp_replace(a.phone, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(a.phone, '\D', '', 'g'), 4),
    a.relationship_status,
    a.nickname,
    coalesce(array_length(a.profile_photo_paths, 1), 0),
    a.representative_photo_index,
    a.representative_crop,
    a.voice_intro_path is not null,
    a.height,
    a.job,
    a.id_photo_path is not null,
    a.employment_proof_path is not null,
    a.submitted_at,
    a.kakao_id
  from public.applications a
  where a.user_id = session_row.user_id
  order by a.submitted_at desc
  limit 1;
end;
$$;

grant execute on function public.get_my_participant_profile(text) to anon, authenticated;

-- ============================================================
-- #4 참가자 리스트는 행사 시작 7일 전부터만 공개(참가자용).
--    기준: 행사 시작 일시(event_date + start_time)를 Asia/Seoul 벽시계로
--    해석. 그 이전에는 행을 하나도 반환하지 않는다. 테스트 행사 미리보기
--    토큰이 유효하면(운영자 확인용) 게이트를 우회한다.
-- ============================================================
create or replace function public.get_public_participant_previews(target_event_id text, preview_token text default null)
returns table(id text, gender text, nickname text, age integer, job text, avatar_index integer)
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    a.id::text,
    a.gender,
    a.nickname,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer as age,
    a.job,
    (((row_number() over (partition by a.gender order by a.submitted_at asc, a.id asc)) - 1) % 6 + 1)::integer as avatar_index
  from public.applications a
  join public.events e on e.id = a.event_id
  where a.event_id = target_event_id
    and (e.is_test_event = false or public.is_test_event_preview_token_valid(target_event_id, preview_token))
    and a.status = '참가 확정'
    and (
      public.is_test_event_preview_token_valid(target_event_id, preview_token)
      or now() >= ((e.event_date + e.start_time) at time zone 'Asia/Seoul') - interval '7 days'
    )
  order by a.gender, a.submitted_at asc, a.id asc;
$$;

grant execute on function public.get_public_participant_previews(text, text) to anon, authenticated;

-- 참가자 리스트 공개 시점을 클라이언트가 서버와 동일하게 판단할 수 있도록
-- (그리고 다른 서버 함수에서도 재사용하도록) 헬퍼로 뺀다.
create or replace function public.event_participant_list_public_at(event_id_value text)
returns timestamptz
language sql
stable
security definer
set search_path = 'public'
as $$
  select ((e.event_date + e.start_time) at time zone 'Asia/Seoul') - interval '7 days'
  from public.events e
  where e.id = event_id_value;
$$;

grant execute on function public.event_participant_list_public_at(text) to anon, authenticated;

-- ============================================================
-- #1 보완: 신규 후기가 backend default(5)로 조용히 생성되지 않도록,
--    "새 후기인데 rating 미지정"이면 예외. (기존 후기 수정은 그대로)
-- ============================================================
create or replace function public.save_event_review_for_session(
  session_token text,
  event_id_value text,
  content_value text,
  image_paths_value text[] default '{}'::text[],
  rating_value integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  clean_content text;
  clean_image_paths text[];
  expected_prefix text;
  path_value text;
  existing_image_paths text[];
  removed_paths text[];
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

  clean_content := trim(coalesce(content_value, ''));
  if clean_content = '' then
    raise exception '후기 내용을 입력해주세요.';
  end if;
  if char_length(clean_content) > 2000 then
    raise exception '후기는 2000자 이내로 작성해주세요.';
  end if;

  if rating_value is not null and (rating_value < 1 or rating_value > 5) then
    raise exception '별점은 1~5 사이여야 합니다.';
  end if;

  select exists(
    select 1 from public.event_reviews
    where event_id = event_id_value and application_id = target_application.id
  ) into review_exists;

  if not review_exists and rating_value is null then
    raise exception '별점을 선택해주세요.';
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

  select image_paths into existing_image_paths
  from public.event_reviews
  where event_id = event_id_value and application_id = target_application.id;

  select coalesce(array_agg(p), '{}')
  into removed_paths
  from unnest(coalesce(existing_image_paths, '{}')) as p
  where p <> all (clean_image_paths);

  insert into public.event_reviews (event_id, application_id, content, image_paths, rating, submitted_at, updated_at)
  values (event_id_value, target_application.id, clean_content, clean_image_paths, coalesce(rating_value, 5), now(), now())
  on conflict (event_id, application_id) do update set
    content = excluded.content,
    image_paths = excluded.image_paths,
    rating = case when rating_value is not null then rating_value else public.event_reviews.rating end,
    submitted_at = coalesce(public.event_reviews.submitted_at, now()),
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at, 'removedImagePaths', to_jsonb(removed_paths));
end;
$$;

grant execute on function public.save_event_review_for_session(text, text, text, text[], integer) to anon, authenticated;
