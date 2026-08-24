-- 실제 운영 중 발견된 버그: resume_after_regular_rounds_for_session(운영자
-- "재개" 버튼, 정규 라운드 종료 후 추가시간 시작)가 event_progress.stage를
-- 'bonus_matching'으로만 세팅하고 끝났다. 이 stage는 이전 세션의
-- bonus_flow_merge 리팩터링(202608241400) 이전에는 advance_round_state_if_needed
-- 가 알아서 매칭 계산 후 'bonus_seat_guide'로 넘겨줬지만, 그 리팩터링 이후
-- advance_round_state_if_needed는 'round_complete'/'bonus_seat_guide'/
-- 'round_active' 외의 stage(=bonus_matching 포함)를 만나면 즉시 return하고
-- 아무 것도 하지 않도록 바뀌었다. 즉 resume_after_regular_rounds_for_session만
-- 그 리팩터링에서 빠져, 누르는 순간 'bonus_matching'에 영원히 멈추고
-- 첫 추가시간 event_table_assignments도 전혀 생성되지 않았다(참가자/태블릿
-- 화면에 "매칭 중"만 계속 보이는 이유).
--
-- 고침: 매칭 계산(generate_bonus_round_assignments)을 직접 호출하고,
-- stage를 곧장 'round_active'(is_bonus_round=true, round_phase='conversation',
-- 타이머 시작)로 세팅한다 - 이후는 advance_round_state_if_needed의 기존
-- 추가시간 루프가 그대로 이어받는다(다음 라운드부터는 원래도 정상 동작).
-- total_rounds도 이제는 capacity 기반이 아니라 active roster/실제 생성된
-- 스케줄 기준으로 계산한다(다른 함수들과 동일한 패턴).
create or replace function public.resume_after_regular_rounds_for_session(session_token text, event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
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

  perform public.generate_bonus_round_assignments(event_id_value, first_bonus_round);

  update public.event_progress ep
  set stage = 'round_active',
      current_round = first_bonus_round,
      is_bonus_round = true,
      round_phase = 'conversation',
      round_timer_status = 'running',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;
end;
$$;
