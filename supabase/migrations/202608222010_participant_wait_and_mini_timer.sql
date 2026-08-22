-- 1) A participant sending "운영자 호출" before the operator has started
-- rounds has no table assignment yet, so table_number must be allowed to be
-- unknown at request time.
alter table public.event_pause_requests
  alter column table_number drop not null;

-- 2) get_round_progress_for_participant needs two things it didn't have
-- before: (a) a way to distinguish "event hasn't started at all" (no
-- event_progress row - operator hasn't pressed 행사 시작 on
-- AdminEventPreparePage yet) from a real in-progress stage, so the
-- participant screen can show a start-waiting screen instead of guessing
-- 'seat_guide'; (b) the common round timer snapshot fields, so the
-- participant's mini timer can extrapolate the same live remaining time as
-- the operator screen and table tablets.
create or replace function public.get_round_progress_for_participant(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
  assignment record;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  -- No row means the operator hasn't pressed 행사 시작 yet - target_progress
  -- stays entirely null in that case (plain `select into` on zero rows does
  -- not raise), and target_progress.stage flows through as sql null below.
  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname
  into assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.round_number = coalesce(target_progress.current_round, 1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  return jsonb_build_object(
    'ok', true,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'tableNumber', assignment.table_number,
    'partnerNickname', assignment.partner_nickname
  );
end;
$$;

grant execute on function public.get_round_progress_for_participant(text, text) to anon, authenticated;
