-- 추가시간 매칭이 (fallback 4단계까지 전부 시도해도) 정말 실패했거나
-- 예상 밖의 예외로 최종 실패한 경우의 처리를 한 단계 더 보강한다.
--
-- 지난 마이그레이션(202609260000)에서 generate_bonus_round_assignments 호출
-- 자체는 exception-safe하게 감싸 "현재 라운드 종료 → bonus_seat_guide 진입"
-- 이 매칭 실패로 롤백되는 일은 이미 막았다. 하지만 그 다음 문제가 남아있었다:
-- bonus_seat_guide의 transition 타이머가 끝나 "다음 추가시간으로 넘어갈지"를
-- 결정하는 시점(advance_round_state_if_needed의 stage='bonus_seat_guide'
-- 분기)에서는, "다음 추가시간이 아직 남아있는가"를 오직 bonus_round_count
-- 숫자만으로 판단했다 - 매칭 생성이 실제로 성공해서 event_table_assignments
-- row가 진짜 생겼는지는 확인하지 않았다. 그래서 매칭 생성이 (exception이든,
-- 극단적인 edge case든) 실패한 채로도 "다음 추가시간이 있다"고 판단해
-- round_active로 넘어가버리면, 정작 그 라운드엔 아무 배정도 없어 참가자는
-- 상대 없이 텅 빈 라운드를 만나게 된다.
--
-- 이번 수정: "다음 추가시간으로 넘어갈지"를 bonus_round_count뿐 아니라
-- 실제로 그 라운드의 event_table_assignments가 존재하는지까지 함께
-- 확인하도록 바꾼다. 존재하지 않으면(=매칭 생성이 어떤 이유로든 최종
-- 실패했으면) 곧바로 final_selection으로 전환한다. 참가자/태블릿 화면은
-- 이미 "다음 상대 없음"과 "final_selection 진입"을 정상 케이스(추가시간이
-- 원래 마지막 회차였던 경우)로 잘 처리하고 있으므로(get_round_progress_
-- for_participant의 next_assignment가 못 찾으면 그냥 null이 되어
-- "제출 완료 / 곧 최종 선택으로 넘어갑니다" 화면으로 자연스럽게 이어짐,
-- 태블릿의 stage='final_selection' 분기도 이미 존재) 프론트엔드 변경은
-- 필요 없다 - 서버가 정확한 stage만 내려주면 된다.
--
-- 동시에 실패 원인을 관리자가 추적할 수 있도록 두 지점(매칭 생성 시도
-- 직후, 그리고 다음 추가시간 진입 여부를 최종 결정하는 시점) 모두에서
-- 실패한 라운드 번호를 포함한 raise log를 남긴다. generate_bonus_round_
-- assignments 자신도 이미 어떤 fallback tier를 썼는지, 매칭이 몇 쌍
-- 만들어졌는지를 raise log로 남기고 있으므로(202609260000), 이 로그들을
-- 합쳐 보면 "몇 번 추가시간이, 어떤 tier까지 시도했다가, 결국 assignment가
-- 생겼는지/안 생겼는지, 예외 메시지가 무엇이었는지"를 전부 추적할 수 있다.
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
      if has_next_bonus then
        begin
          perform public.generate_bonus_round_assignments(event_id_value, target.current_round + 1);
        exception when others then
          -- 다음 추가시간 매칭 생성 문제로 현재 라운드 종료 처리(아래
          -- bonus_seat_guide 진입)가 절대 막히면 안 된다. 여기서 예외를
          -- 삼키고 관리자 로그에만 남긴다 - 참가자 화면에는 노출하지 않는다.
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

-- resume_after_regular_rounds_for_session: 정규 라운드 종료 후 첫 추가시간
-- 매칭을 생성하는 지점도 같은 로그를 남긴다. 실제 진입 여부 게이팅은 위
-- advance_round_state_if_needed의 bonus_seat_guide 분기가 이미 담당하므로
-- (여기서 만든 bonus_seat_guide는 그 분기를 그대로 거쳐 다음 단계로
-- 넘어간다) 로직 변경은 필요 없고, 실패 원인 추적용 로그만 추가한다.
create or replace function public.resume_after_regular_rounds_for_session(session_token text, event_id_value text)
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
  first_bonus_round integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_complete' then
    raise exception '지금은 재개할 수 있는 상태가 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if coalesce(target_event.bonus_round_count, 0) <= 0 then
    raise exception '추가시간이 설정되지 않은 행사입니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  first_bonus_round := total_rounds + 1;

  begin
    perform public.generate_bonus_round_assignments(event_id_value, first_bonus_round);
  exception when others then
    -- 매칭 생성 문제로 재개(자리이동/호감도수정 단계 진입) 자체가 막히면
    -- 안 된다. 관리자 로그에만 남기고 계속 진행한다.
    raise log '[BONUS_MATCH] generate_bonus_round_assignments raised unexpectedly on resume - event=% round=% error=%',
      event_id_value, first_bonus_round, sqlerrm;
  end;

  if not exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = first_bonus_round
  ) then
    raise log '[BONUS_MATCH] 추가시간 매칭 생성 실패 - 최종선택 단계로 전환됨 (event=% failedRound=%)',
      event_id_value, first_bonus_round;
  end if;

  -- current_round는 아직 total_rounds(마지막 정규 라운드)로 둔다 -
  -- get_round_progress_for_participant의 next_assignment 조회가
  -- current_round+1을 보므로, 이렇게 해야 정확히 1번째 추가시간 짝을
  -- "다음 상대"로 보여줄 수 있다. reveal이 끝나 conversation으로 넘어갈
  -- 때 비로소 current_round가 first_bonus_round로 올라간다. 매칭이
  -- 실패해서 first_bonus_round에 배정이 하나도 없더라도 이 단계
  -- (bonus_seat_guide/reveal) 진입 자체는 그대로 두고, 다음 단계 진입
  -- 여부는 advance_round_state_if_needed가 실제 assignment 존재 여부로
  -- 다시 판단한다(참가자는 "제출 완료 / 곧 최종 선택으로 넘어갑니다" 화면을
  -- 자연스럽게 보게 된다).
  update public.event_progress ep
  set stage = 'bonus_seat_guide',
      current_round = total_rounds,
      is_bonus_round = true,
      round_phase = 'reveal',
      round_timer_status = 'running',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      round_phase_started_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;
end;
$function$;

notify pgrst, 'reload schema';
