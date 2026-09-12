-- 정규 라운드의 "호감도 작성 및 자리 이동" 시간을 2분(120초)에서 1분(60초)로
-- 통일한다. 추가시간(bonus round) transition은 이미 이전 마이그레이션
-- (202609101400_bonus_transition_one_minute.sql)에서 60초로 바뀌었는데,
-- 정규 라운드는 그대로 120초로 남아있었다 - 화면(참가자 폰/태블릿/운영자
-- 행사모드)이 60초와 120초를 뒤섞어 보여주던 실제 원인이다.
--
-- 이 시간을 실제로 결정하는 서버 함수는 두 개다:
--   1) advance_round_state_if_needed - 라운드를 자동으로 진행시키는 함수.
--      regular_transition_seconds가 곧 "실제 몇 초가 지나야 다음 라운드로
--      넘어가는지"를 결정한다.
--   2) control_round_timer_for_session - 운영자가 타이머를 일시정지/재개할
--      때 남은 시간을 다시 계산하는 함수. 여기 있는 phase_duration이
--      advance_round_state_if_needed의 값과 다르면, 일시정지했다가 재개한
--      라운드만 다른 라운드와 다른 시간에 넘어가는 불일치가 생긴다.
--      이 함수는 bonus_seat_guide 케이스도 옛날 120초 그대로 남아있었다
--      (추가시간 transition을 60초로 바꾼 마이그레이션이 이 함수는 놓치고
--      advance_round_state_if_needed만 고쳤다) - 같이 60초로 맞춘다.
--
-- 클라이언트 쪽 화면 표시(카운트다운/문구)는 src/utils/roundTimerSync.ts의
-- TRANSITION_PHASE_SECONDS와 src/pages/AdminTabletSeatPage.tsx의 "2분" 문구를
-- 같은 커밋에서 60초/1분으로 함께 수정했다 - 서버·클라이언트 값이 반드시
-- 같이 움직여야 하는 하나의 상수라서다.
create or replace function public.advance_round_state_if_needed(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  bonus_index integer;
  next_bonus_index integer;
  has_next_bonus boolean;
  conversation_seconds integer;
  bonus_conversation_seconds constant integer := 420;
  regular_transition_seconds constant integer := 60;
  bonus_transition_seconds constant integer := 60;
  live_elapsed numeric;
  phase_duration integer;
  loop_guard integer := 0;
begin
  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  conversation_seconds := coalesce(target_event.conversation_duration_seconds, 600);

  if target.stage = 'round_complete' then
    if coalesce(target_event.bonus_round_count, 0) <= 0 then
      update public.event_progress ep
      set stage = 'final_selection', updated_at = now()
      where ep.event_id = event_id_value;
    end if;
    return;
  end if;

  if target.stage = 'bonus_seat_guide' then
    if target.round_timer_status <> 'running' then
      return;
    end if;

    bonus_index := target.current_round - total_rounds;
    next_bonus_index := bonus_index + 1;
    has_next_bonus := next_bonus_index <= coalesce(target_event.bonus_round_count, 0);

    -- reveal과 transition 모두 동일한 서버 phase/endAt에 해당하는 60초를
    -- 사용한다. 호감도를 일찍 제출해 화면이 바뀌어도 이 값은 재설정하지 않는다.
    phase_duration := bonus_transition_seconds;

    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    if live_elapsed >= phase_duration then
      if has_next_bonus then
        update public.event_progress ep
        set stage = 'round_active',
            current_round = target.current_round + 1,
            round_phase = 'conversation',
            round_timer_status = 'running',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            round_phase_started_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      else
        update public.event_progress ep
        set stage = 'final_selection',
            round_timer_status = 'paused',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            round_phase_started_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      end if;
    end if;
    return;
  end if;

  if target.stage <> 'round_active' then
    return;
  end if;

  if not target.is_bonus_round then
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

      if target_event.is_test_event then
        perform public.seed_test_round_ratings(event_id_value, target.current_round);
      end if;
    end if;
  end if;

  if target.round_timer_status <> 'running' then
    return;
  end if;

  loop
    loop_guard := loop_guard + 1;
    exit when loop_guard > 200;

    phase_duration := case
      when target.round_phase = 'conversation' and target.is_bonus_round then bonus_conversation_seconds
      when target.round_phase = 'conversation' then conversation_seconds
      else regular_transition_seconds
    end;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    exit when live_elapsed < phase_duration;

    if target.is_bonus_round then
      bonus_index := target.current_round - total_rounds;
      next_bonus_index := bonus_index + 1;
      has_next_bonus := next_bonus_index <= coalesce(target_event.bonus_round_count, 0);
      if has_next_bonus then
        perform public.generate_bonus_round_assignments(event_id_value, target.current_round + 1);
      end if;

      if target_event.is_test_event then
        perform public.revise_test_bonus_round_ratings(event_id_value, target.current_round);
      end if;

      update public.event_progress ep
      set stage = 'bonus_seat_guide',
          round_phase = 'transition',
          round_timer_status = 'running',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
          round_phase_started_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
      exit;
    elsif target.round_phase = 'conversation' then
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

      if target_event.is_test_event then
        perform public.seed_test_round_ratings(event_id_value, target.current_round);
      end if;
    end if;
  end loop;
end;
$function$;

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
  if not found or target.stage not in ('round_active', 'bonus_seat_guide', 'bonus_rating') then
    raise exception '라운드 진행 중이 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;

  phase_duration := case
    when target.stage = 'bonus_rating' then 60
    when target.stage = 'bonus_seat_guide' then 60
    when target.round_phase = 'conversation' and target.is_bonus_round then 420
    when target.round_phase = 'conversation' then coalesce(target_event.conversation_duration_seconds, 600)
    else 60
  end;

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

notify pgrst, 'reload schema';
