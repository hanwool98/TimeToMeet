-- [테스트 행사 전용] 추가대화 재시작 + 관리자 화면 추가대화 휴식자 표시 수정.
--
-- 배경: 추가대화 매칭 알고리즘을 반복 검증하려면 매번 정규 라운드부터 다시
-- 진행해야 해서 테스트 시간이 오래 걸렸다. 정규 라운드 배정/완료기록/호감도는
-- 그대로 두고 "추가대화 시작 전" 상태로만 되돌리는 테스트 전용 RPC를
-- 추가한다. 기존 restart_test_event_progress_for_session("행사 진행
-- 초기화")은 체크인부터 전부 지우는 훨씬 더 넓은 범위라 이 목적에 맞지
-- 않는다 - 별도 RPC로 분리한다(요청 사항).
--
-- 조사 결과 확인한 사실:
--   - event_table_assignments.is_bonus로 정규/추가대화 배정이 명확히
--     구분된다. 정규 라운드 개수는 max(round_number) where not is_bonus로
--     항상 다시 계산 가능하다(고정 저장값 없음).
--   - round_ratings는 (event_id, round_number, rater_application_id)
--     기준이라 정규 라운드 번호(<= 정규 라운드 수)로 남아있는 행은 전부
--     "정규 라운드 호감도"다.
--   - **중요 발견**: submit_bonus_round_rating(두 오버로드 전부)은 상대와
--     정규 라운드에서 이미 만난 적이 있으면, 새 행을 만들지 않고 그
--     "정규 라운드 round_number의 round_ratings 행을 그대로 UPDATE"한다 -
--     즉 추가대화 중 호감도를 "수정"하면 정규 라운드 원본 점수가 그
--     자리에서 덮어써지고 별도로 보존되지 않는다. 이건 기존에 이미 그렇게
--     동작하던 부분이고, 매칭 알고리즘 입력값과 얽혀 있어 이번 작업
--     범위(추가대화 매칭 알고리즘 자체는 변경 금지)에서 고치지 않는다.
--     다만 이 특성 덕분에 "정규 라운드 번호로 남아있는 round_ratings 행은
--     절대 건드리지 않는다"는 이번 재시작 로직이 자동으로 안전하다 -
--     혹시 수정됐더라도 그 행은 여전히 정규 라운드 round_number를 쓰고
--     있어서 아래 "round_number > 정규 라운드 수" 삭제 조건에 걸리지
--     않는다.
--   - final_selections/final_selection_submissions/heart_notes는
--     round_number가 없고 전부 "최종선택" 단계에서만 생성되는 데이터라
--     추가대화 재시작 시 통째로 지워도 안전하다.
--   - bonus_keyword_missions은 이름 그대로 추가대화 전용 미니게임이라
--     event 전체를 지워도 안전하다(정규 라운드용 대응 데이터 자체가 없음).
--   - event_pause_requests(참가자 도움 요청)는 라운드 구분 없이 저장돼
--     정규/추가대화 여부를 구분할 수 없다 - 이번 재시작 대상에 포함하지
--     않는다(요청 목록에도 명시되지 않음).

create or replace function public.restart_bonus_phase_for_test_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  target_event public.events%rowtype;
  plan record;
  total_regular_rounds integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  -- 하드 안전장치: 프론트에서 버튼을 숨기는 것과 무관하게, 실제 행사
  -- event_id로 직접 호출해도 절대 실행되지 않는다.
  if not coalesce(target_event.is_test_event, false) then
    raise exception '테스트 행사에서만 추가대화를 재시작할 수 있습니다.';
  end if;

  -- 반복 실행 안전성: 같은 행사에 대한 재시작 호출을 직렬화한다(중복
  -- 클릭/동시 요청이 서로 겹쳐 일부만 지워진 상태로 남는 것을 방지).
  perform pg_advisory_xact_lock(hashtext(event_id_value || ':bonus_restart'));

  select * into plan from public.compute_event_round_plan(event_id_value);
  select coalesce(max(round_number), plan.total_rounds) into total_regular_rounds
  from public.event_table_assignments
  where event_id = event_id_value and not is_bonus;

  -- 추가대화 배정만 삭제 - 정규 라운드 배정/완료기록(conversation_completed_at)은
  -- is_bonus=false라 전혀 영향받지 않는다. 재시작을 몇 번을 반복해도(이미
  -- 지워진 상태에서 다시 호출해도) 그냥 0건 삭제될 뿐이라 멱등적이다.
  delete from public.event_table_assignments
  where event_id = event_id_value and is_bonus;

  -- 정규 라운드 번호(<= total_regular_rounds)로 남아있는 호감도는 절대
  -- 건드리지 않는다 - 추가대화 매칭 알고리즘의 입력값이라 반드시 보존.
  delete from public.round_ratings
  where event_id = event_id_value and round_number > total_regular_rounds;

  delete from public.bonus_keyword_missions
  where event_id = event_id_value;

  delete from public.final_selections
  where event_id = event_id_value;

  delete from public.final_selection_submissions
  where event_id = event_id_value;

  delete from public.heart_notes
  where event_id = event_id_value;

  update public.applications
  set final_selection_submitted_at = null
  where event_id = event_id_value;

  -- 실제 행사에서 마지막 정규 라운드가 끝난 직후, 운영자가 "추가대화
  -- 시작"을 누르기 전까지 자연스럽게 머무는 상태(advance_round_state_if_needed의
  -- round_complete 분기)와 정확히 동일한 값으로 되돌린다 - 추가대화1로
  -- 바로 들어가지 않는다.
  -- round_phase는 실제 자연 흐름에서도 round_complete 진입 시 건드리지
  -- 않아 마지막 정규 라운드의 'transition' 값이 그대로 남는다(advance_round_state_if_needed
  -- 확인 결과) - null로 두면 실제로는 한 번도 나타나지 않는 인위적인
  -- 상태가 되므로, 여기서도 동일하게 'transition'으로 맞춘다.
  update public.event_progress
  set stage = 'round_complete',
      current_round = total_regular_rounds,
      round_phase = 'transition',
      round_timer_status = 'paused',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      is_bonus_round = false,
      round_phase_started_at = null,
      updated_at = now()
  where event_id = event_id_value;

  return jsonb_build_object('ok', true, 'totalRegularRounds', total_regular_rounds);
end;
$function$;

-- admin, authenticated 둘 다 인자로 명시하지 않는다(이 프로젝트의 admin
-- RPC들은 세션 토큰 자체로 권한을 검증하고, PostgREST 노출은 기존 패턴과
-- 동일하게 anon/authenticated에 grant한다).
grant execute on function public.restart_bonus_phase_for_test_session(text, text) to anon, authenticated;

-- 관리자 "추가대화 진행" 화면의 "이번 라운드 배정 없음" 목록이 추가대화
-- 중에는 사실상 전원을 잡아내던 버그 수정.
--
-- 원인: unassigned_participants를 계산할 때 event_table_assignments 조건이
-- "not eta.is_bonus"로 고정돼 있었다 - 추가대화 라운드(round_number가
-- 정규 라운드 수보다 큼)에는애초에 is_bonus=false인 행이 그 round_number로
-- 존재할 수 없으므로, 추가대화 중엔 활성 참가자 전원이 "정규 라운드
-- 배정 없음" 조건을 항상 만족해 버려 전원이 목록에 잡혔다.
--
-- 수정: 현재 event_progress.is_bonus_round 값에 맞는 is_bonus 조건으로
-- 검사한다(정규 라운드 중엔 기존과 완전히 동일하게 동작 - is_bonus_round가
-- false일 때 조건이 정확히 예전과 같은 "not eta.is_bonus"가 된다).
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
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1)
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
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

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
        and eta.is_bonus = coalesce(target_progress.is_bonus_round, false)
        and eta.round_number = coalesce(target_progress.current_round, 1)
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
      when target_progress.round_phase = 'reveal' then 1
      when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds
      else null
    end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'profileCardsSubmitted', profile_cards_submitted,
    'profileCardsTotal', profile_cards_total,
    'serverNow', now()
  );
end;
$function$;
