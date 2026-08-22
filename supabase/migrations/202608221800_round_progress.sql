-- 라운드 진행 화면을 위한 서버 상태 확장.
--
-- 1) event_progress에 라운드 타이머(대화 10분 / 이동+호감도작성 2분)를
--    소개영상과 동일한 (위치, 갱신시각, 상태) 스냅샷 방식으로 추가한다.
-- 2) event_table_assignments(기존, 비어있던 테이블)에 "라운드 시작" 시점에
--    전체 라운드의 테이블 매칭을 한 번에 생성해 넣는다(circle method
--    round-robin: 남/여 각 N명, N테이블, N라운드로 전원이 한 번씩 만남).
-- 3) 참가자가 (이후 화면에서) 보낼 일시정지 요청과 라운드별 호감도 기록을
--    저장할 최소 테이블을 추가한다. 참가자용 제출 화면은 이번 범위 밖이지만
--    제출 RPC까지는 만들어 이후 화면이 바로 연결될 수 있게 한다.
alter table public.event_progress add column if not exists round_phase text;
alter table public.event_progress add column if not exists round_timer_status text not null default 'paused';
alter table public.event_progress add column if not exists round_timer_position_seconds numeric not null default 0;
alter table public.event_progress add column if not exists round_timer_updated_at timestamptz;

create table if not exists public.event_pause_requests (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  table_number integer not null,
  requested_by_application_id uuid,
  requested_by_nickname text not null default '참가자',
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.event_pause_requests enable row level security;
drop policy if exists "Admins can manage pause requests" on public.event_pause_requests;
create policy "Admins can manage pause requests" on public.event_pause_requests
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.round_ratings (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  round_number integer not null,
  rater_application_id uuid not null,
  ratee_application_id uuid not null,
  score numeric(2,1) not null check (score >= 0 and score <= 5 and mod((score * 10)::integer, 5) = 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, round_number, rater_application_id)
);

alter table public.round_ratings enable row level security;
drop policy if exists "Admins can manage round ratings" on public.round_ratings;
create policy "Admins can manage round ratings" on public.round_ratings
  for all using (public.is_admin()) with check (public.is_admin());

-- Internal helper (not granted to anon/authenticated): both the admin and
-- tablet progress RPCs call this before reading, so the round/phase clock
-- keeps advancing no matter which device happens to poll first - and stays
-- perfectly still while round_timer_status = 'paused'.
create or replace function public.advance_round_state_if_needed(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
  conversation_seconds constant integer := 600;
  transition_seconds constant integer := 120;
  live_elapsed numeric;
  phase_duration integer;
  loop_guard integer := 0;
begin
  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_active' or target.round_timer_status <> 'running' then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  loop
    loop_guard := loop_guard + 1;
    exit when loop_guard > 200;

    phase_duration := case when target.round_phase = 'conversation' then conversation_seconds else transition_seconds end;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    exit when live_elapsed < phase_duration;

    if target.round_phase = 'conversation' then
      update public.event_progress ep
      set round_phase = 'transition',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
    elsif target.current_round >= total_rounds then
      update public.event_progress ep
      set stage = 'round_complete',
          round_timer_status = 'paused',
          round_timer_position_seconds = 0,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
      exit;
    else
      update public.event_progress ep
      set current_round = target.current_round + 1,
          round_phase = 'conversation',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
    end if;
  end loop;
end;
$$;

revoke all on function public.advance_round_state_if_needed(text) from public, anon, authenticated;

-- start_first_round_for_session: 소개영상 종료 후 "라운드 시작"을 누른 시점.
-- 기존 함수를 확장해 전체 라운드의 테이블 매칭을 한 번에 생성하고 타이머를
-- 시작한다(circle method round-robin).
create or replace function public.start_first_round_for_session(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  table_count integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_waiting' then
    raise exception '소개영상이 끝난 후에만 라운드를 시작할 수 있습니다.';
  end if;

  delete from public.event_table_assignments where event_id = event_id_value;

  with males as (
    select a.id, row_number() over (order by a.checked_in_at asc nulls last, a.id asc) as rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '남성' and a.checked_in_at is not null
  ),
  females as (
    select a.id, row_number() over (order by a.checked_in_at asc nulls last, a.id asc) as rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '여성' and a.checked_in_at is not null
  ),
  n as (
    select least((select count(*) from males), (select count(*) from females))::integer as n_count
  )
  insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
  select event_id_value, t, r, m.id, f.id
  from n, generate_series(1, n.n_count) as t, generate_series(1, n.n_count) as r, males m, females f
  where n.n_count > 0 and m.rn = t and f.rn = (((t - 1 + r - 1) % n.n_count) + 1);

  select count(distinct table_number) into table_count from public.event_table_assignments where event_id = event_id_value;

  update public.event_progress ep
  set stage = 'round_active',
      current_round = 1,
      round_phase = 'conversation',
      round_timer_status = 'running',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;

  return table_count;
end;
$$;

-- Both existing progress RPCs also need to advance the round clock, in case
-- a device polls them (not the round-specific ones below) while a round is
-- already running - e.g. right after a stage flips to round_active.
create or replace function public.get_admin_event_progress(session_token text, event_id_value text)
returns table (
  stage text,
  intro_video_status text,
  intro_video_position_seconds numeric,
  intro_video_updated_at timestamptz,
  intro_video_completed_at timestamptz,
  current_round integer,
  intro_video_url text,
  intro_video_title text,
  intro_video_description text
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  return query
  select
    coalesce(ep.stage, 'seat_guide'),
    coalesce(ep.intro_video_status, 'paused'),
    coalesce(ep.intro_video_position_seconds, 0),
    ep.intro_video_updated_at,
    ep.intro_video_completed_at,
    ep.current_round,
    e.intro_video_url,
    e.intro_video_title,
    e.intro_video_description
  from public.events e
  left join public.event_progress ep on ep.event_id = e.id
  where e.id = event_id_value;
end;
$$;

create or replace function public.get_event_progress_for_tablet(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns table (
  ok boolean,
  stage text,
  intro_video_status text,
  intro_video_position_seconds numeric,
  intro_video_updated_at timestamptz,
  intro_video_completed_at timestamptz,
  current_round integer,
  intro_video_url text,
  intro_video_title text,
  intro_video_description text
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_tablets%rowtype;
begin
  select et.* into target
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::text, null::text, null::numeric, null::timestamptz, null::timestamptz, null::integer, null::text, null::text, null::text;
    return;
  end if;

  update public.event_tablets et set last_seen_at = now(), updated_at = now() where et.id = target.id;

  perform public.advance_round_state_if_needed(event_id_value);

  return query
  select
    true,
    coalesce(ep.stage, 'seat_guide'),
    coalesce(ep.intro_video_status, 'paused'),
    coalesce(ep.intro_video_position_seconds, 0),
    ep.intro_video_updated_at,
    ep.intro_video_completed_at,
    ep.current_round,
    e.intro_video_url,
    e.intro_video_title,
    e.intro_video_description
  from public.events e
  left join public.event_progress ep on ep.event_id = e.id
  where e.id = event_id_value;
end;
$$;

-- Round progress payloads (operator + tablet). jsonb return keeps the
-- nested "current round's table matches" array in one round trip.
create or replace function public.get_admin_round_progress(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  total_rounds integer;
  total_participants integer;
  active_tables integer;
  completed_rounds integer;
  pending_pause_count integer;
  matches jsonb;
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

  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  select count(*) into total_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null;

  select count(distinct eta.table_number) into active_tables
  from public.event_table_assignments eta
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

  completed_rounds := case
    when target_progress.stage = 'round_complete' then total_rounds
    else greatest(0, coalesce(target_progress.current_round, 1) - 1)
  end;

  select count(*) into pending_pause_count
  from public.event_pause_requests
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
    'matches', matches
  );
end;
$$;

grant execute on function public.get_admin_round_progress(text, text) to anon, authenticated;

create or replace function public.get_round_progress_for_tablet(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  tablet public.event_tablets%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
  match_row record;
begin
  select et.* into tablet
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.event_tablets et set last_seen_at = now(), updated_at = now() where et.id = tablet.id;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  select ma.nickname as male_nickname, fa.nickname as female_nickname
  into match_row
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.table_number = table_number_value
    and eta.round_number = coalesce(target_progress.current_round, 1);

  return jsonb_build_object(
    'ok', true,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'maleNickname', match_row.male_nickname,
    'femaleNickname', match_row.female_nickname
  );
end;
$$;

grant execute on function public.get_round_progress_for_tablet(text, integer, text) to anon, authenticated;

create or replace function public.control_round_timer_for_session(session_token text, event_id_value text, action text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  live_elapsed numeric;
  phase_duration integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_active' then
    raise exception '라운드 진행 중이 아닙니다.';
  end if;

  phase_duration := case when target.round_phase = 'conversation' then 600 else 120 end;
  if target.round_timer_status = 'running' then
    live_elapsed := least(phase_duration::numeric, target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at)));
  else
    live_elapsed := target.round_timer_position_seconds;
  end if;

  if action = 'pause' then
    update public.event_progress ep
    set round_timer_status = 'paused', round_timer_position_seconds = live_elapsed, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
  elsif action = 'resume' then
    update public.event_progress ep
    set round_timer_status = 'running', round_timer_position_seconds = live_elapsed, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
  else
    raise exception '알 수 없는 동작입니다: %', action;
  end if;

  select * into target from public.event_progress where event_id = event_id_value;
  return jsonb_build_object(
    'roundPhase', target.round_phase,
    'timerStatus', target.round_timer_status,
    'timerPositionSeconds', target.round_timer_position_seconds,
    'timerUpdatedAt', target.round_timer_updated_at
  );
end;
$$;

grant execute on function public.control_round_timer_for_session(text, text, text) to anon, authenticated;

-- 일시정지 요청: 참가자(앱 세션)가 생성, 관리자가 조회/처리.
create or replace function public.create_event_pause_request(session_token text, event_id_value text, table_number_value integer)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  new_id uuid;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  insert into public.event_pause_requests (event_id, table_number, requested_by_application_id, requested_by_nickname)
  values (event_id_value, table_number_value, target_application.id, target_application.nickname)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_event_pause_request(text, text, integer) to anon, authenticated;

create or replace function public.get_admin_pause_requests(session_token text, event_id_value text)
returns table (id uuid, table_number integer, nickname text, requested_at timestamptz, status text)
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
  select epr.id, epr.table_number, epr.requested_by_nickname, epr.requested_at, epr.status
  from public.event_pause_requests epr
  where epr.event_id = event_id_value
  order by epr.requested_at desc
  limit 50;
end;
$$;

grant execute on function public.get_admin_pause_requests(text, text) to anon, authenticated;

create or replace function public.update_pause_request_status_for_session(session_token text, request_id_value uuid, status_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if status_value not in ('pending', 'acknowledged', 'resolved') then
    raise exception '알 수 없는 상태입니다: %', status_value;
  end if;

  update public.event_pause_requests epr
  set status = status_value, resolved_at = case when status_value = 'resolved' then now() else epr.resolved_at end
  where epr.id = request_id_value;
end;
$$;

grant execute on function public.update_pause_request_status_for_session(text, uuid, text) to anon, authenticated;

-- 호감도: 참가자가 자신이 방금 만난 상대에게 매기는 점수(0~5, 0.5단위).
-- 라운드+본인 신청ID로 상대를 event_table_assignments에서 자동으로 찾는다.
create or replace function public.submit_round_rating(session_token text, event_id_value text, round_number_value integer, score_value numeric)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  assignment public.event_table_assignments%rowtype;
  ratee_id uuid;
begin
  if score_value < 0 or score_value > 5 or mod((score_value * 10)::integer, 5) <> 0 then
    raise exception '호감도 점수는 0~5 사이 0.5 단위여야 합니다.';
  end if;

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  select * into assignment
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.round_number = round_number_value
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if not found then
    raise exception '해당 라운드의 매칭 정보를 찾을 수 없습니다.';
  end if;

  ratee_id := case when assignment.male_application_id = target_application.id then assignment.female_application_id else assignment.male_application_id end;

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score)
  values (event_id_value, round_number_value, target_application.id, ratee_id, score_value)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, updated_at = now();
end;
$$;

grant execute on function public.submit_round_rating(text, text, integer, numeric) to anon, authenticated;

create or replace function public.get_admin_participant_ratings(session_token text, event_id_value text, application_id_value uuid)
returns table (round_number integer, partner_application_id uuid, partner_nickname text, score numeric)
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
  select rr.round_number, rr.ratee_application_id, a.nickname, rr.score
  from public.round_ratings rr
  join public.applications a on a.id = rr.ratee_application_id
  where rr.event_id = event_id_value and rr.rater_application_id = application_id_value
  order by rr.round_number asc;
end;
$$;

grant execute on function public.get_admin_participant_ratings(text, text, uuid) to anon, authenticated;
