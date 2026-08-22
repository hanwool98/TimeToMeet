-- Root cause of "진행 테이블 0개": an event's stage can have been flipped to
-- 'round_active' by an EARLIER deployment of start_first_round_for_session
-- (before it generated event_table_assignments / initialized round_phase +
-- timer fields). Once stage is no longer 'round_waiting', the function's own
-- guard permanently blocks it from ever running again for that event - so
-- that event is stuck forever with round_phase/timer NULL and zero table
-- matches, no matter how many times "라운드 시작" is retried.
--
-- Fix: extract the round-robin generation into its own idempotent function,
-- and make advance_round_state_if_needed self-heal any round_active event
-- it finds with missing schedule/timer state, so the very next poll (from
-- any device) repairs it automatically.
create or replace function public.generate_round_schedule_if_missing(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if exists (select 1 from public.event_table_assignments eta where eta.event_id = event_id_value) then
    return;
  end if;

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
end;
$$;

revoke all on function public.generate_round_schedule_if_missing(text) from public, anon, authenticated;

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
  perform public.generate_round_schedule_if_missing(event_id_value);

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
  if not found or target.stage <> 'round_active' then
    return;
  end if;

  -- Self-heal: a round_active event with no generated schedule or
  -- uninitialized timer fields means it was stamped round_active before
  -- this state machine existed. Repair it in place rather than leaving it
  -- permanently stuck.
  perform public.generate_round_schedule_if_missing(event_id_value);

  if target.round_phase is null or target.round_timer_updated_at is null then
    update public.event_progress ep
    set round_phase = 'conversation',
        round_timer_status = 'running',
        round_timer_position_seconds = 0,
        round_timer_updated_at = now(),
        current_round = coalesce(ep.current_round, 1),
        updated_at = now()
    where ep.event_id = event_id_value
    returning ep.* into target;
  end if;

  if target.round_timer_status <> 'running' then
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
