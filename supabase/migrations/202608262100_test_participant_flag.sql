-- 행사 운영 중 자리를 채우려고 넣어둔 "테스트(더미) 참여자"를 실제
-- 참가자와 구분하는 표시. 자동/추정 분류는 절대 하지 않는다(전화번호
-- 패턴 등으로 추측하면 실제 참가자가 실수로 분류될 위험이 있음) - 관리자가
-- 참가자 리스트에서 특정 인원을 직접 눌러야만 true가 된다. 기존 행은
-- 전부 자동으로 false.
alter table public.applications
  add column if not exists is_test_participant boolean not null default false;

-- 관리자 전용 수동 토글. 이벤트 전체가 테스트인지 여부와 무관하게(실제
-- 행사 안에서도) 개별 참가자 단위로 켜고 끌 수 있다.
create or replace function public.set_test_participant_flag_for_session(
  session_token text,
  application_id_value uuid,
  is_test_participant_value boolean
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

  update public.applications
  set is_test_participant = is_test_participant_value
  where id = application_id_value;

  if not found then
    raise exception '참가자를 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.set_test_participant_flag_for_session(text, uuid, boolean) to anon, authenticated;

-- 프로필 카드 자동 제출 대상을 "행사 전체가 테스트"뿐 아니라 "이 참가자가
-- is_test_participant로 표시됨"까지 포함하도록 확장 - 실제 행사 안에
-- 섞여 있는 더미 참여자도 같은 버튼으로 자동 채워 제출할 수 있다. 기존
-- "행사 전체 테스트" 동작은 완전히 그대로 유지된다(상위 호환).
create or replace function public.simulate_test_event_profile_cards(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  rec record;
  simulated_count integer := 0;
  sample_hobbies text[] := array['독서', '영화감상', '요가', '등산', '카페투어', '헬스'];
  sample_mbtis text[] := array['ENFP', 'INTJ', 'ISFJ', 'ESTP', 'INFP', 'ESFJ'];
  sample_ideal_types text[] := array['유머있는 사람', '배려심 많은 사람', '대화가 잘 통하는 사람'];
  sample_contact_styles text[] := array['바쁘면 가끔, 연락은 자주', '용건 있을 때만'];
  sample_date_styles text[] := array['맛집 탐방', '영화 데이트', '드라이브'];
  sample_smokings text[] := array['비흡연', '흡연'];
  sample_drinkings text[] := array['비음주', '가끔 마심', '주량 2잔'];
  sample_keywords text[] := array['lively', 'likes_movies', 'likes_travel', 'calm', 'likes_food'];
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if target_event.id is null then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  for rec in
    select a.id as application_id
    from public.applications a
    where a.event_id = event_id_value
      and a.status = '참가 확정'
      and a.checked_in_at is not null
      and a.attendance_status = 'active'
      and (target_event.is_test_event or a.is_test_participant)
  loop
    insert into public.event_profile_cards (
      event_id, application_id, hobby, mbti, ideal_type, contact_style, date_style,
      smoking, drinking, keywords, submitted_at, updated_at
    )
    values (
      event_id_value, rec.application_id,
      sample_hobbies[1 + (floor(random() * array_length(sample_hobbies, 1)))::integer],
      sample_mbtis[1 + (floor(random() * array_length(sample_mbtis, 1)))::integer],
      sample_ideal_types[1 + (floor(random() * array_length(sample_ideal_types, 1)))::integer],
      sample_contact_styles[1 + (floor(random() * array_length(sample_contact_styles, 1)))::integer],
      sample_date_styles[1 + (floor(random() * array_length(sample_date_styles, 1)))::integer],
      sample_smokings[1 + (floor(random() * array_length(sample_smokings, 1)))::integer],
      sample_drinkings[1 + (floor(random() * array_length(sample_drinkings, 1)))::integer],
      sample_keywords,
      now(),
      now()
    )
    on conflict (event_id, application_id) do update set
      submitted_at = coalesce(public.event_profile_cards.submitted_at, now()),
      updated_at = now();

    simulated_count := simulated_count + 1;
  end loop;

  return simulated_count;
end;
$$;

-- 참가자 리스트 화면이 is_test_participant를 알아야 배지/토글 버튼을
-- 보여줄 수 있다. RETURNS TABLE 컬럼 추가라 drop 후 재생성.
drop function if exists public.get_admin_applications_for_session(text);

create or replace function public.get_admin_applications_for_session(session_token text)
returns table (
  id uuid, application_no text, event_id text, user_id uuid, user_display_id text, account_type text,
  is_returning boolean, status application_status, is_new boolean, name text, birth_date date, gender text,
  residence text, phone text, relationship_status text, id_photo_path text, nickname text,
  profile_photo_paths text[], representative_photo_index integer, representative_crop jsonb, voice_intro_path text,
  height text, job text, employment_proof_path text, access_route text, filming_consent boolean,
  interview_consent text, refund_agreement boolean, inquiry text, review_notice_confirmed boolean,
  payment_deadline timestamptz, payment_notice_sent_at timestamptz, deposit_requested_at timestamptz,
  deposit_failed_at timestamptz, deposit_failure_reason text, depositor_name text, payment_method text,
  refund_policy_confirmed boolean, refund_policy_confirmed_at timestamptz, transfer_guide_confirmed_at timestamptz,
  transfer_intent_confirmed boolean, payment_completed_at timestamptz, checked_in_at timestamptz,
  reviewed_at timestamptz, submitted_at timestamptz, event_date date, short_name text, attendance_status text,
  is_emergency_walkin boolean, is_test_participant boolean
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
      else a.nickname
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
    a.id_photo_path,
    a.nickname,
    a.profile_photo_paths,
    a.representative_photo_index,
    a.representative_crop,
    a.voice_intro_path,
    a.height,
    a.job,
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
    a.is_test_participant
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id;
end;
$$;

grant execute on function public.get_admin_applications_for_session(text) to anon, authenticated;
