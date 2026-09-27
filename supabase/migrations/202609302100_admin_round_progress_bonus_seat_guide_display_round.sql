-- [관리자 행사모드] 추가대화 자리안내(bonus_seat_guide) 화면이 잘못된
-- round를 조회하던 문제 수정.
--
-- Root Cause (실제 코드 확인 결과):
--   get_admin_round_progress가 테이블 배치(matches/activeTables)와
--   휴식자(unassignedParticipants)를 전부
--     eta.round_number = coalesce(target_progress.current_round, 1)
--   로 그대로 조회하고 있었다. 그런데 event_progress.current_round는
--   stage='bonus_seat_guide'일 때 "곧 시작할 bonus round"가 아니라
--   "방금 끝난(혹은 아직 시작 전인) round"를 가리킨다 - 두 경우 모두
--   확인됨:
--     - round_phase='reveal'(정규 종료 직후 bonus1 최초 안내):
--       resume_after_regular_rounds_for_session이 bonus1 assignment는
--       이미 생성해두지만 current_round는 total_rounds(정규 마지막)
--       그대로 둔 채 stage만 bonus_seat_guide로 바꾼다(is_bonus_round는
--       이 시점에 이미 true). 즉 화면 제목은 "추가시간 1"인데 테이블은
--       정규 마지막 라운드 배치를 그대로 보여주는 상태가 된다.
--     - round_phase='transition'(bonus N 종료 → bonus N+1 안내):
--       current_round는 방금 끝난 bonus N의 round_number이고, 이미
--       생성돼 있는 bonus N+1의 배정은 current_round+1에 있다. 즉 이때도
--       화면은 "곧 보여줄 bonus N+1"이 아니라 "방금 끝난 bonus N"을
--       계속 보여주고 있었다(get_round_progress_for_participant는
--       이 필요성을 이미 알고 next_assignment를 current_round+1로 별도
--       조회해 해결해둔 상태였는데, 관리자용 함수만 이 처리가 없었다).
--
--   휴식자 계산(unassigned_participants)도 같은 round_number를 쓰는
--   데다, is_bonus 비교까지 target_progress.is_bonus_round에 의존하고
--   있어 reveal 구간에서는 "round8(is_bonus=false)에 is_bonus=true인
--   행이 있는지"를 묻는 셈이 되어 사실상 전원이 휴식자로 잡히는 문제도
--   함께 있었다.
--
-- 수정 범위: get_admin_round_progress 하나. "조회할 round를 무엇으로
-- 볼지"만 바꾼다 - matching 알고리즘, 참가자 EventMode, 태블릿 화면,
-- 호감도/baseline, no_show/left_early, 추가대화 재시작/수동 자리변경
-- 기능은 전혀 건드리지 않는다(해당 함수들 무수정 확인).
create or replace function public.get_admin_round_progress(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
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
  unassigned_participants jsonb;
  profile_cards_total integer;
  profile_cards_submitted integer;
  display_round_number integer;
  display_is_bonus boolean;
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

  -- bonus_seat_guide는 "곧 시작할 bonus round의 자리안내" 화면이다 -
  -- 이미 생성된 다음 bonus assignment가 실제로 존재할 때만 그 round를
  -- 표시 대상으로 삼는다(무조건 current_round+1로 가정하지 않음 - 마지막
  -- bonus 종료 직후처럼 다음 bonus 자체가 없으면 존재하지 않는 round를
  -- 조회하지 않고 current_round를 그대로 유지한다). 테이블 배치와
  -- 휴식자 계산이 반드시 같은 round를 보도록 여기서 한 번만 결정한다.
  display_round_number := coalesce(target_progress.current_round, 1);
  if target_progress.stage = 'bonus_seat_guide'
    and exists (
      select 1 from public.event_table_assignments
      where event_id = event_id_value and round_number = display_round_number + 1
    )
  then
    display_round_number := display_round_number + 1;
  end if;
  display_is_bonus := display_round_number > total_rounds;

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
  where eta.event_id = event_id_value and eta.round_number = display_round_number
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
  where eta.event_id = event_id_value and eta.round_number = display_round_number;

  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationId', a.id,
    'nickname', a.nickname,
    'gender', a.gender
  ) order by a.nickname), '[]'::jsonb)
  into unassigned_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and not exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and eta.is_bonus = display_is_bonus
        and eta.round_number = display_round_number
        and (eta.male_application_id = a.id or eta.female_application_id = a.id)
    );

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
    'unassignedParticipants', unassigned_participants,
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case
      when display_is_bonus then display_round_number - total_rounds
      else null
    end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'profileCardsSubmitted', profile_cards_submitted,
    'profileCardsTotal', profile_cards_total,
    'serverNow', now()
  );
end;
$function$;
