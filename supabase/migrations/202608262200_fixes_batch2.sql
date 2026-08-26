-- ============================================================
-- 문제 3: 테스트 자동 제출이 실제(직접 신청한) 참가자에게도 적용된 버그
-- ============================================================
--
-- 원인 (2가지가 겹쳐서 발생):
--   1) 조건이 "행사 전체가 테스트(is_test_event)이면 무조건 전원 포함"
--      이었다 - is_test_participant는 실제 행사 안에 섞인 더미를 위한
--      "추가" 조건일 뿐, is_test_event=true인 행사(예: test3) 안에서는
--      직접 신청 흐름으로 만든 참가자까지 전부 포함됐다.
--   2) insert ... on conflict do update가 무조건 덮어썼다 - 이미 실제로
--      제출된(submitted_at not null) 카드가 있어도 무조건 랜덤 값으로
--      다시 채웠다. "테스트 참가자 생성" 버튼으로 만든 더미는 애초에
--      로그인이 불가능해(phone='') 스스로 제출한 적이 없으니 상관없지만,
--      직접 신청 흐름으로 로그인해 실제로 카드를 작성한 사람은 그 내용이
--      무작위 값으로 덮어써졌다.
--
-- 수정: (a) 조건을 is_test_participant 단독으로 좁히고(is_test_event는
-- 더 이상 자동 포함 사유가 아님), (b) 이미 제출된 카드는 절대 건드리지
-- 않도록 루프 자체에서 제외한다(방어 이중화 - is_test_participant가
-- 어떤 이유로든 잘못 켜져 있어도 실제 제출 내용은 안전).
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
      and a.is_test_participant
      and not exists (
        select 1 from public.event_profile_cards epc
        where epc.event_id = event_id_value and epc.application_id = a.id and epc.submitted_at is not null
      )
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
      hobby = excluded.hobby,
      mbti = excluded.mbti,
      ideal_type = excluded.ideal_type,
      contact_style = excluded.contact_style,
      date_style = excluded.date_style,
      smoking = excluded.smoking,
      drinking = excluded.drinking,
      keywords = excluded.keywords,
      submitted_at = coalesce(public.event_profile_cards.submitted_at, now()),
      updated_at = now()
    where public.event_profile_cards.submitted_at is null;

    simulated_count := simulated_count + 1;
  end loop;

  return simulated_count;
end;
$$;

-- "테스트 참가자 생성" 버튼으로 만드는 더미는 phone=''이라 로그인이
-- 불가능하므로 항상 is_test_participant=true로 태어나야 자동 제출 대상이
-- 된다. 직접 신청 흐름(submit-application)으로 만들어지는 실제 참가자는
-- 이 함수를 거치지 않으므로 영향 없음.
create or replace function public.create_test_participants_for_session(
  session_token text,
  event_id_value text,
  male_count integer,
  female_count integer
)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  created_count integer := 0;
  new_user_id uuid;
  i integer;
  seed_birth_date date;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if target_event.id is null then
    raise exception '행사를 찾을 수 없습니다.';
  end if;
  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 테스트 참가자를 생성할 수 있습니다.';
  end if;

  if coalesce(male_count, 0) < 0 or coalesce(female_count, 0) < 0 or coalesce(male_count, 0) + coalesce(female_count, 0) > 60 then
    raise exception '생성 인원이 올바르지 않습니다.';
  end if;

  seed_birth_date := (target_event.event_date - interval '28 years')::date;

  for i in 1..coalesce(male_count, 0) loop
    insert into public.app_users (account_type) values ('guest') returning user_id into new_user_id;
    insert into public.applications (
      event_id, user_id, name, birth_date, gender, residence, phone, relationship_status,
      nickname, height, job, access_route, interview_consent, status,
      applicant_kind, filming_consent, refund_agreement, review_notice_confirmed, is_test_participant
    ) values (
      event_id_value, new_user_id, '테스트 참가자', seed_birth_date, '남성', '서울', '', '미혼이며 교제하는 인원 없음',
      '테스트남' || i, '175', '테스트', '테스트 생성', '가능', '참가 확정',
      'guest', true, true, true, true
    );
    insert into public.application_tickets (application_id, user_id, event_id)
    select a.id, a.user_id, a.event_id from public.applications a
    where a.event_id = event_id_value and a.user_id = new_user_id;
    created_count := created_count + 1;
  end loop;

  for i in 1..coalesce(female_count, 0) loop
    insert into public.app_users (account_type) values ('guest') returning user_id into new_user_id;
    insert into public.applications (
      event_id, user_id, name, birth_date, gender, residence, phone, relationship_status,
      nickname, height, job, access_route, interview_consent, status,
      applicant_kind, filming_consent, refund_agreement, review_notice_confirmed, is_test_participant
    ) values (
      event_id_value, new_user_id, '테스트 참가자', seed_birth_date, '여성', '서울', '', '미혼이며 교제하는 인원 없음',
      '테스트여' || i, '162', '테스트', '테스트 생성', '가능', '참가 확정',
      'guest', true, true, true, true
    );
    insert into public.application_tickets (application_id, user_id, event_id)
    select a.id, a.user_id, a.event_id from public.applications a
    where a.event_id = event_id_value and a.user_id = new_user_id;
    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

-- ============================================================
-- 문제 2: 자리 유도 화면 - 참가자 리스트 순서(성별 정렬) + 체크인해야만
-- 닉네임 노출. event_table_assignments/라운드 스케줄은 전혀 참조하지
-- 않는, 이 화면 전용 새 RPC.
-- ============================================================
create or replace function public.get_event_table_seat_guide_by_roster(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns table (ok boolean, male_nickname text, female_nickname text, male_checked_in boolean, female_checked_in boolean)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_tablets%rowtype;
  male_app record;
  female_app record;
begin
  select et.* into target
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::text, null::text, null::boolean, null::boolean;
    return;
  end if;

  update public.event_tablets et
  set last_seen_at = now(), updated_at = now()
  where et.id = target.id;

  -- 참가자 리스트의 성별 정렬 순서(신청번호 기준 - 심사/승인 순서와
  -- 동일하게 안정적인 정렬)에서 N번째 남성/여성을 그대로 N번 테이블에
  -- 배정한다. 출석/체크인 여부, 라운드 스케줄과는 완전히 무관 - 오직
  -- "참가 확정" 상태인지만 본다.
  select a.nickname, a.checked_in_at is not null as checked_in
  into male_app
  from public.applications a
  where a.event_id = event_id_value and a.gender = '남성' and a.status = '참가 확정'
  order by a.application_no asc
  offset greatest(0, table_number_value - 1) limit 1;

  select a.nickname, a.checked_in_at is not null as checked_in
  into female_app
  from public.applications a
  where a.event_id = event_id_value and a.gender = '여성' and a.status = '참가 확정'
  order by a.application_no asc
  offset greatest(0, table_number_value - 1) limit 1;

  return query
  select
    true,
    case when male_app.checked_in then male_app.nickname else null end,
    case when female_app.checked_in then female_app.nickname else null end,
    coalesce(male_app.checked_in, false),
    coalesce(female_app.checked_in, false);
end;
$$;

grant execute on function public.get_event_table_seat_guide_by_roster(text, integer, text) to anon, authenticated;
