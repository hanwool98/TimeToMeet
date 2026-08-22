-- Two operator conveniences for the round-progress screen:
-- 1) "시간 건너뛰기" (skip) - test events only - fast-forwards the current
--    phase to its end and immediately cascades advance_round_state_if_needed,
--    so testers don't have to wait out real 10/2-minute phases.
-- 2) "라운드 이동" (manual round jump) - ALL events, including live/production
--    ones - lets the operator jump event_progress.current_round directly for
--    contingency situations (event had to be paused/interrupted and the
--    round pointer needs manual correction). Table/partner matches for every
--    round already exist from the initial round-robin generation, so no
--    reassignment is needed - tablets/participants just pick up the new
--    round's existing match on their next poll.
create or replace function public.control_round_timer_for_session(session_token text, event_id_value text, action text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
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
  elsif action = 'skip' then
    select * into target_event from public.events where id = event_id_value;
    if not coalesce(target_event.is_test_event, false) then
      raise exception '테스트 행사에서만 사용할 수 있습니다.';
    end if;
    update public.event_progress ep
    set round_timer_status = 'running', round_timer_position_seconds = phase_duration, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
    perform public.advance_round_state_if_needed(event_id_value);
  else
    raise exception '알 수 없는 동작입니다: %', action;
  end if;

  select * into target from public.event_progress where event_id = event_id_value;
  return jsonb_build_object(
    'currentRound', target.current_round,
    'roundPhase', target.round_phase,
    'stage', target.stage,
    'timerStatus', target.round_timer_status,
    'timerPositionSeconds', target.round_timer_position_seconds,
    'timerUpdatedAt', target.round_timer_updated_at
  );
end;
$$;

grant execute on function public.control_round_timer_for_session(text, text, text) to anon, authenticated;

create or replace function public.set_current_round_for_session(session_token text, event_id_value text, round_number_value integer)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage not in ('round_active', 'round_complete') then
    raise exception '라운드가 시작된 이후에만 라운드를 이동할 수 있습니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  if round_number_value < 1 or round_number_value > total_rounds then
    raise exception '올바른 라운드 번호가 아닙니다. (1~%)', total_rounds;
  end if;

  update public.event_progress ep
  set stage = 'round_active',
      current_round = round_number_value,
      round_phase = 'conversation',
      round_timer_status = 'paused',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;

  return jsonb_build_object('ok', true, 'currentRound', round_number_value, 'totalRounds', total_rounds);
end;
$$;

grant execute on function public.set_current_round_for_session(text, text, integer) to anon, authenticated;
