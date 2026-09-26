-- 버그: advance_round_state_if_needed()가 다음 추가대화(bonus N+1) 배정을
-- 생성한 "뒤에" event_progress를 bonus_seat_guide로 전환하고 있었다. 그런데
-- 직전 추가대화(bonus N)의 event_table_assignments.conversation_completed_at은
-- 바로 이 event_progress UPDATE가 트리거(mark_completed_round_encounters_trigger,
-- 202609101300에서 도입)를 발동시켜야만 기록된다. 즉 다음 추가대화를 생성하는
-- 시점에는 직전 추가대화가 아직 "완료된 적 없음"으로 보여, 직전 상대 제외
-- 하드 제약(met_immediate_prior_bonus / met_any_prior_bonus, 둘 다
-- conversation_completed_at is not null을 전제로 함)이 모든 tier에서 사실상
-- 무력화되고, 직전 추가대화 상대가 바로 다음 추가대화에서 다시 배정될 수
-- 있었다. (실제 사고: test-1기-2026-09-26-a45bfb22의 bonus1↔bonus2에서
-- 동일 커플이 연속 재매칭됨 - round9 conversation_completed_at과 round10
-- created_at이 완전히 동일한 트랜잭션 타임스탬프였음이 증거.)
--
-- 수정: generate_bonus_round_assignments(...) 호출을 event_progress UPDATE
-- "뒤"가 아니라 "앞"으로 옮기지 않고, 반대로 event_progress UPDATE를
-- generate_bonus_round_assignments 호출보다 먼저 실행되도록 순서만 바꾼다.
-- 이 UPDATE는 current_round를 바꾸지 않으므로(다음 라운드로의 실제 진입은
-- bonus_seat_guide 단계에서 별도로 처리됨) target.current_round 값은
-- 그대로 유지되고, 이후 generate_bonus_round_assignments(target.current_round
-- + 1) 호출은 변경 없이 그대로 쓸 수 있다. generate_bonus_round_assignments
-- 자체(tier/fallback/휴식자/호감도 로직)는 전혀 건드리지 않는다.
--
-- 같은 함수 호출(같은 트랜잭션) 내부의 순서만 바뀌는 것이므로, 다른
-- 세션에는 "event_progress만 bonus_seat_guide로 바뀌고 다음 라운드
-- assignment는 아직 없는" 중간 상태가 노출되지 않는다(커밋 전까지는
-- 어차피 트랜잭션 내부 상태). generate_bonus_round_assignments가 예외를
-- 던지는 경우의 처리(로그만 남기고 삼킴, bonus_seat_guide 단계의 기존
-- "다음 라운드 assignment 없으면 최종선택으로 전환" 안전장치)도 기존과
-- 동일하게 유지된다.

create or replace function public.advance_round_state_if_needed(event_id_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  bonus_index integer;
  next_bonus_index integer;
  has_next_bonus boolean;
  next_bonus_assignments_exist boolean;
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

    -- bonus_round_count상 다음 추가시간이 남아있어야 하더라도, 실제로 그
    -- 라운드의 매칭 row가 생성되어 있지 않다면(매칭 생성이 최종 실패한
    -- 경우) 다음 추가시간으로 넘어가지 않고 최종선택으로 전환한다 - 이게
    -- 이번 수정의 핵심 안전장치다.
    next_bonus_assignments_exist := exists (
      select 1 from public.event_table_assignments
      where event_id = event_id_value and round_number = target.current_round + 1
    );
    has_next_bonus := next_bonus_index <= coalesce(target_event.bonus_round_count, 0)
      and next_bonus_assignments_exist;

    if next_bonus_index <= coalesce(target_event.bonus_round_count, 0) and not next_bonus_assignments_exist then
      raise log '[BONUS_MATCH] 추가시간 매칭 생성 실패 - 최종선택 단계로 전환됨 (event=% failedRound=%)',
        event_id_value, target.current_round + 1;
    end if;

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

      -- 순서 수정 지점: 다음 추가대화(target.current_round + 1) 배정을
      -- 생성하기 "전에" 먼저 event_progress를 bonus_seat_guide로 전환한다.
      -- 이 UPDATE가 mark_completed_round_encounters_trigger를 발동시켜
      -- 직전 추가대화(target.current_round)의 conversation_completed_at을
      -- 지금 확정한다 - generate_bonus_round_assignments가 참조하는
      -- met_immediate_prior_bonus/met_any_prior_bonus가 정확한 값을 읽게
      -- 하기 위해서다. 이 UPDATE는 current_round를 바꾸지 않으므로 아래에서
      -- target.current_round + 1을 그대로 다음 추가대화 라운드 번호로 쓸 수
      -- 있다(다음 라운드로의 실제 진입은 bonus_seat_guide 단계에서 별도
      -- 처리됨).
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

      if has_next_bonus then
        begin
          perform public.generate_bonus_round_assignments(event_id_value, target.current_round + 1);
        exception when others then
          -- 다음 추가시간 매칭 생성 문제로 현재 라운드 종료 처리가 절대
          -- 막히면 안 된다. 여기서 예외를 삼키고 관리자 로그에만 남긴다 -
          -- 참가자 화면에는 노출하지 않는다. event_progress는 이미 위에서
          -- bonus_seat_guide로 전환됐으므로, 그 단계의 기존 안전장치
          -- (next_bonus_assignments_exist=false 감지 → 최종선택 전환)가
          -- 그대로 작동한다.
          raise log '[BONUS_MATCH] generate_bonus_round_assignments raised unexpectedly - event=% round=% error=%',
            event_id_value, target.current_round + 1, sqlerrm;
        end;

        if not exists (
          select 1 from public.event_table_assignments
          where event_id = event_id_value and round_number = target.current_round + 1
        ) then
          raise log '[BONUS_MATCH] 추가시간 매칭 생성 실패 - 최종선택 단계로 전환됨 (event=% failedRound=%)',
            event_id_value, target.current_round + 1;
        end if;
      end if;

      if target_event.is_test_event then
        perform public.revise_test_bonus_round_ratings(event_id_value, target.current_round);
      end if;

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
