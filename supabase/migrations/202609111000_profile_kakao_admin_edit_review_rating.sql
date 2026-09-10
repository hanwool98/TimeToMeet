-- ============================================================
-- #2 카카오톡 ID (프로필 작성 마지막 항목). 기존 신청서는 값이 없어도 되도록
--    nullable 추가 전용 컬럼.
-- ============================================================
alter table public.applications add column if not exists kakao_id text;

-- ============================================================
-- #4 후기 별점 (1~5). not null + default 5 → 기존 모든 후기는 자동으로 5점,
--    신규 후기는 저장 API 전달값(없으면 5)으로 저장된다.
-- ============================================================
alter table public.event_reviews add column if not exists rating smallint not null default 5;
alter table public.event_reviews drop constraint if exists event_reviews_rating_check;
alter table public.event_reviews add constraint event_reviews_rating_check check (rating between 1 and 5);

-- 관리자: 후기 별점 입력/수정
create or replace function public.set_review_rating_for_session(
  session_token text,
  review_id_value uuid,
  rating_value integer
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;
  if rating_value is null or rating_value < 1 or rating_value > 5 then
    raise exception '별점은 1~5 사이여야 합니다.';
  end if;

  update public.event_reviews er
  set rating = rating_value, updated_at = now()
  where er.id = review_id_value;
end;
$$;

grant execute on function public.set_review_rating_for_session(text, uuid, integer) to anon, authenticated;

-- 참가자 후기 저장 RPC에 rating 파라미터 추가(파라미터 추가라 drop 후 재생성).
-- 기존 본문 그대로 + rating만: 신규 insert 시 coalesce(rating_value, 5),
-- 재제출(upsert) 시엔 rating_value가 명시된 경우에만 갱신(관리자가 지정해둔
-- 별점을 참가자의 내용 수정으로 덮어쓰지 않도록).
drop function if exists public.save_event_review_for_session(text, text, text, text[]);

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

-- ============================================================
-- #2 + #3 get_admin_applications_for_session: RETURNS TABLE 마지막에 kakao_id
--    추가(위치 기반이라 뒤에 붙여 기존 매핑을 깨지 않음). 반환 타입이 바뀌어
--    create or replace로는 안 되고 drop 후 재생성해야 한다.
-- ============================================================
drop function if exists public.get_admin_applications_for_session(text);

create or replace function public.get_admin_applications_for_session(session_token text)
returns table(
  id uuid, application_no text, event_id text, user_id uuid, user_display_id text, account_type text,
  is_returning boolean, status application_status, is_new boolean, name text, birth_date date, gender text,
  residence text, phone text, relationship_status text, preferred_partner_description text, avoid_participant_note text,
  id_photo_path text, nickname text, profile_photo_paths text[], representative_photo_index integer,
  representative_crop jsonb, voice_intro_path text, height text, job text, employment_proof_path text,
  access_route text, filming_consent boolean, interview_consent text, refund_agreement boolean, inquiry text,
  review_notice_confirmed boolean, payment_deadline timestamptz, payment_notice_sent_at timestamptz,
  deposit_requested_at timestamptz, deposit_failed_at timestamptz, deposit_failure_reason text, depositor_name text,
  payment_method text, refund_policy_confirmed boolean, refund_policy_confirmed_at timestamptz,
  transfer_guide_confirmed_at timestamptz, transfer_intent_confirmed boolean, payment_completed_at timestamptz,
  checked_in_at timestamptz, reviewed_at timestamptz, submitted_at timestamptz, event_date date, short_name text,
  attendance_status text, is_emergency_walkin boolean, is_test_participant boolean, kakao_id text
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    a.id,
    a.application_no,
    a.event_id,
    a.user_id,
    case
      when coalesce(ua.account_type, au.account_type, 'member') = 'guest' and ga.phone_normalized is not null then
        '비회원 ' || substring(ga.phone_normalized from char_length(ga.phone_normalized) - 7 for 4)
        || '-' ||
        substring(ga.phone_normalized from char_length(ga.phone_normalized) - 3 for 4)
      when ma.login_id is not null then ma.login_id
      else coalesce(nullif(eps.nickname, ''), a.nickname)
    end,
    coalesce(ua.account_type, au.account_type, 'member'),
    a.is_returning,
    a.status,
    a.is_new,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    a.phone,
    a.relationship_status,
    a.preferred_partner_description,
    a.avoid_participant_note,
    a.id_photo_path,
    coalesce(nullif(eps.nickname, ''), a.nickname),
    case when eps.photo_path is not null then array[eps.photo_path] else a.profile_photo_paths end,
    case when eps.photo_path is not null then 0 else a.representative_photo_index end,
    coalesce(eps.photo_crop, a.representative_crop),
    a.voice_intro_path,
    a.height,
    coalesce(nullif(eps.job, ''), a.job),
    a.employment_proof_path,
    a.access_route,
    a.filming_consent,
    a.interview_consent,
    a.refund_agreement,
    a.inquiry,
    a.review_notice_confirmed,
    a.payment_deadline,
    a.payment_notice_sent_at,
    a.deposit_requested_at,
    a.deposit_failed_at,
    a.deposit_failure_reason,
    a.depositor_name,
    a.payment_method,
    a.refund_policy_confirmed,
    a.refund_policy_confirmed_at,
    a.transfer_guide_confirmed_at,
    a.transfer_intent_confirmed,
    a.payment_completed_at,
    a.checked_in_at,
    a.reviewed_at,
    a.submitted_at,
    e.event_date,
    e.short_name,
    a.attendance_status,
    a.is_emergency_walkin,
    a.is_test_participant,
    a.kakao_id
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id
  left join public.event_participant_snapshots eps on eps.event_id = a.event_id and eps.application_id = a.id;
end;
$$;

-- ============================================================
-- #3 관리자 신청서 프로필 수정. "첫 참여(is_returning)"는 여기에 포함하지 않아
--    관리자가 바꿀 수 없다. 빈 문자열은 기존값 유지(실수로 지우는 것 방지),
--    카카오톡 ID만 빈 값이면 null로 비운다.
-- ============================================================
create or replace function public.update_application_profile_for_session(
  session_token text,
  target_application_id uuid,
  name_value text,
  phone_value text,
  birth_date_value date,
  gender_value text,
  residence_value text,
  job_value text,
  height_value text,
  access_route_value text,
  interview_consent_value text,
  kakao_id_value text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if gender_value is not null and trim(gender_value) <> '' and trim(gender_value) not in ('남성', '여성') then
    raise exception '성별 값이 올바르지 않습니다.';
  end if;

  update public.applications a
  set
    name = coalesce(nullif(trim(name_value), ''), a.name),
    phone = coalesce(nullif(trim(phone_value), ''), a.phone),
    birth_date = coalesce(birth_date_value, a.birth_date),
    gender = coalesce(nullif(trim(gender_value), ''), a.gender),
    residence = coalesce(nullif(trim(residence_value), ''), a.residence),
    job = coalesce(nullif(trim(job_value), ''), a.job),
    height = coalesce(nullif(trim(height_value), ''), a.height),
    access_route = coalesce(nullif(trim(access_route_value), ''), a.access_route),
    interview_consent = coalesce(nullif(trim(interview_consent_value), ''), a.interview_consent),
    kakao_id = nullif(trim(coalesce(kakao_id_value, '')), ''),
    updated_at = now()
  where a.id = target_application_id;
end;
$$;

grant execute on function public.update_application_profile_for_session(text, uuid, text, text, date, text, text, text, text, text, text, text) to anon, authenticated;
