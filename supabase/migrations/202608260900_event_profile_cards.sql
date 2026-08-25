-- 행사 전용 프로필 카드: 체크인 후 소개영상이 끝날 때까지의 대기 시간에
-- 참가자가 오늘 행사에서 상대에게 보여줄 프로필(취미/MBTI/이상형/연락
-- 스타일/데이트스타일/키워드/흡연/주량 + 이번 행사 전용 사진)을 작성하는
-- 기능. 기존 기본 프로필(applications/participant_profiles)은 전혀
-- 건드리지 않고 event_id+application_id 단위의 완전히 별도 테이블로
-- 저장한다 - 닉네임/나이/직업은 기존 applications를 그대로 참조하고
-- 여기서는 중복 저장하지 않는다.

create table if not exists public.event_profile_cards (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  -- null이면 기본 프로필의 대표사진을 그대로 사용(fallback) - 이번 행사
  -- 전용으로 다른 사진을 고른 경우에만 값이 채워진다. photo_crop은 항상
  -- photo_path와 짝을 이루는 값이라 photo_path가 null이면 같이 null.
  photo_path text,
  photo_crop jsonb,
  hobby text not null default '',
  mbti text not null default '',
  ideal_type text not null default '',
  contact_style text not null default '',
  date_style text not null default '',
  smoking text not null default '',
  drinking text not null default '',
  keywords text[] not null default '{}',
  -- null = 아직 제출 전(초안). 값이 있으면 제출 완료 - 제출 후 라운드
  -- 시작 전까지 다시 저장해도 이 값은 유지된다(재제출로 취급하지 않음).
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, application_id)
);

create index if not exists event_profile_cards_event_id_idx on public.event_profile_cards (event_id);

alter table public.event_profile_cards enable row level security;

drop policy if exists "No direct event profile card access" on public.event_profile_cards;
create policy "No direct event profile card access"
on public.event_profile_cards
for all
using (false)
with check (false);

-- 참가자 본인의 초안 저장 + 제출. 라운드가 이미 시작된 뒤에는(round_active
-- 이후 어떤 stage든) 서버에서 막는다 - 대화 상대에게 보여지는 정보가 행사
-- 중간에 바뀌지 않도록 하기 위함.
create or replace function public.save_event_profile_card_for_session(
  session_token text,
  event_id_value text,
  hobby_value text,
  mbti_value text,
  ideal_type_value text,
  contact_style_value text,
  date_style_value text,
  smoking_value text,
  drinking_value text,
  keywords_value text[],
  photo_path_value text default null,
  photo_crop_value jsonb default null,
  submit_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
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
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '체크인된 참가자만 프로필 카드를 작성할 수 있습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if found and target_progress.stage not in ('seat_guide', 'intro_video', 'round_waiting') then
    raise exception '라운드가 시작된 이후에는 프로필 카드를 수정할 수 없습니다.';
  end if;

  -- 기존 등록 사진(profile_photo_paths)을 재사용하거나, 이 화면에서 새로
  -- 촬영/업로드한 사진(upload-event-profile-card-photo가 본인 user_id로
  -- 시작하는 경로로만 저장함)일 때만 허용한다 - 둘 다 아니면 남의 경로를
  -- 그대로 넣어보려는 시도로 본다.
  if photo_path_value is not null
    and not (photo_path_value = any(coalesce(target_application.profile_photo_paths, '{}')))
    and photo_path_value not like (session_user_id::text || '/%')
  then
    raise exception '본인이 등록한 사진만 사용할 수 있습니다.';
  end if;

  insert into public.event_profile_cards (
    event_id, application_id, photo_path, photo_crop, hobby, mbti, ideal_type,
    contact_style, date_style, smoking, drinking, keywords, submitted_at, updated_at
  )
  values (
    event_id_value, target_application.id, photo_path_value, photo_crop_value,
    coalesce(hobby_value, ''), coalesce(mbti_value, ''), coalesce(ideal_type_value, ''),
    coalesce(contact_style_value, ''), coalesce(date_style_value, ''),
    coalesce(smoking_value, ''), coalesce(drinking_value, ''), coalesce(keywords_value, '{}'),
    case when submit_value then now() else null end,
    now()
  )
  on conflict (event_id, application_id) do update set
    photo_path = excluded.photo_path,
    photo_crop = excluded.photo_crop,
    hobby = excluded.hobby,
    mbti = excluded.mbti,
    ideal_type = excluded.ideal_type,
    contact_style = excluded.contact_style,
    date_style = excluded.date_style,
    smoking = excluded.smoking,
    drinking = excluded.drinking,
    keywords = excluded.keywords,
    submitted_at = case when submit_value then now() else public.event_profile_cards.submitted_at end,
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at);
end;
$$;

grant execute on function public.save_event_profile_card_for_session(
  text, text, text, text, text, text, text, text, text, text[], text, jsonb, boolean
) to anon, authenticated;

-- 테스트 참가자(phone='')는 로그인할 수 없어 프로필 카드를 직접 제출할 수
-- 없다 - simulate_test_event_final_selections와 동일한 패턴으로 관리자가
-- active 참가자 전원에 플레이스홀더 값을 채워 제출 처리한다.
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
  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 사용할 수 있습니다.';
  end if;

  for rec in
    select a.id as application_id
    from public.applications a
    where a.event_id = event_id_value
      and a.status = '참가 확정'
      and a.checked_in_at is not null
      and a.attendance_status = 'active'
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

grant execute on function public.simulate_test_event_profile_cards(text, text) to anon, authenticated;

-- 라운드 시작 게이트: active 참가자 전원이 제출을 완료해야만 시작 가능.
-- total_rounds 계산과 무관한 완전히 새 체크라 다른 로직은 그대로 둔다.
create or replace function public.start_first_round_for_session(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  table_count integer;
  active_count integer;
  submitted_count integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_waiting' then
    raise exception '소개영상이 끝난 후에만 라운드를 시작할 수 있습니다.';
  end if;

  select count(*) into active_count
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active';

  select count(*) into submitted_count
  from public.applications a
  join public.event_profile_cards epc on epc.event_id = a.event_id and epc.application_id = a.id
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and epc.submitted_at is not null;

  if submitted_count < active_count then
    raise exception '프로필 카드를 아직 제출하지 않은 참가자가 있습니다 (%/%명 제출).', submitted_count, active_count;
  end if;

  delete from public.event_table_assignments where event_id = event_id_value;
  perform public.generate_round_schedule_if_missing(event_id_value);

  select count(distinct table_number) into table_count from public.event_table_assignments where event_id = event_id_value;

  update public.event_progress ep
  set stage = 'round_active', current_round = 1, round_phase = 'conversation',
      round_timer_status = 'running', round_timer_position_seconds = 0,
      round_timer_updated_at = now(), updated_at = now()
  where ep.event_id = event_id_value;

  return table_count;
end;
$$;

-- 운영자 화면이 "17/18명 제출" 진행 상황을 보여줄 수 있도록 카운트 2개를
-- 추가한다 - returns jsonb라 컬럼 목록 변경이 아니므로 단순 교체로 충분.
create or replace function public.get_admin_round_progress(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  plan record;
  total_rounds integer;
  total_participants integer;
  active_tables integer;
  completed_rounds integer;
  pending_pause_count integer;
  pending_report_count integer;
  matches jsonb;
  profile_cards_total integer;
  profile_cards_submitted integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if not found then
    raise exception '행사 진행 상태가 없습니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select count(*) into total_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active';

  profile_cards_total := total_participants;

  select count(*) into profile_cards_submitted
  from public.applications a
  join public.event_profile_cards epc on epc.event_id = a.event_id and epc.application_id = a.id
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and epc.submitted_at is not null;

  select count(distinct eta.table_number) into active_tables
  from public.event_table_assignments eta
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1)
    and eta.male_application_id is not null;

  completed_rounds := case
    when target_progress.stage = 'round_complete' then total_rounds
    when coalesce(target_progress.current_round, 1) > total_rounds then total_rounds
    else greatest(0, coalesce(target_progress.current_round, 1) - 1)
  end;

  select count(*) into pending_pause_count
  from public.event_pause_requests
  where event_id = event_id_value and status = 'pending';

  select count(*) into pending_report_count
  from public.participant_reports
  where event_id = event_id_value and status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'tableNumber', eta.table_number,
    'maleApplicationId', eta.male_application_id,
    'maleNickname', ma.nickname,
    'femaleApplicationId', eta.female_application_id,
    'femaleNickname', fa.nickname
  ) order by eta.table_number), '[]'::jsonb)
  into matches
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

  return jsonb_build_object(
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'totalParticipants', total_participants,
    'activeTables', active_tables,
    'completedRounds', completed_rounds,
    'pendingPauseCount', pending_pause_count,
    'pendingReportCount', pending_report_count,
    'matches', matches,
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds else null end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'profileCardsSubmitted', profile_cards_submitted,
    'profileCardsTotal', profile_cards_total,
    'serverNow', now()
  );
end;
$$;
