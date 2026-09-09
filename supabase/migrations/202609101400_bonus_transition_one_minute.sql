-- 추가시간의 첫 상대 공개/자리이동, 라운드 사이 호감도 수정/자리이동,
-- 마지막 호감도 수정을 모두 하나의 60초 서버 타이머로 통일한다.
-- 정규 라운드 transition은 기존 120초를 유지한다.
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
  regular_transition_seconds constant integer := 120;
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

notify pgrst, 'reload schema';
