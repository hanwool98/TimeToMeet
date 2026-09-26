-- 테스트 행사 전용 "첫 추가대화(bonus1) 자리 수동 변경" 기능.
--
-- 목적: 관리자가 bonus1 조합을 직접 바꿔서, 그 수동 배치를 기준으로
-- bonus2/bonus3 자동 매칭(직전 상대 하드 제외, 과거 bonus 상대 회피 등)이
-- 정상 작동하는지 확인하기 위함. 실제 행사에서는 절대 호출될 수 없다.
--
-- ============================================================
-- 구현 전 확인한 사실 (요청 10)
-- ============================================================
-- - bonus1은 정확히 resume_after_regular_rounds_for_session(관리자가
--   "재개"를 누르는 순간, stage='round_complete'에서만 호출 가능)에서
--   generate_bonus_round_assignments(event_id, total_regular_rounds+1)를
--   호출할 때 생성된다. "휴식 중" 화면에 진입하는 것 자체(=stage가
--   round_complete가 되는 것)만으로는 bonus1이 자동 생성되지 않는다 -
--   advance_round_state_if_needed의 round_complete 분기는 bonus_round_count
--   가 0일 때 final_selection으로 넘기는 것 외에는 아무 것도 하지 않는다.
-- - generate_bonus_round_assignments는 이미 해당 round_number에 배정이
--   있으면 즉시 return하는 멱등 함수다(수정 없음, 기존 그대로 재사용).
--   따라서 "휴식 화면에서 자리 변경 버튼을 누르는 시점"에 bonus1이 아직
--   없다면 그 자리에서 한 번 생성해 보여주고, 이미 있다면(수동 편집을
--   다시 열어보는 경우) 그대로 재사용해도 안전하다.
-- - "재개" 시 호출되는 resume_after_regular_rounds_for_session은 bonus1이
--   이미 존재하면(=이번 기능으로 미리 생성/수정해둔 경우)
--   generate_bonus_round_assignments의 위 멱등성 덕분에 절대 다시
--   생성하거나 덮어쓰지 않는다 - 이번 작업에서 그 함수를 전혀 수정할
--   필요가 없다(수정 안 함, 확인만).
-- - bonus_matching_baseline_ratings 캡처(resume_after_regular_rounds_for_session
--   안에서 "이미 있으면 건드리지 않음" 가드로 202609301800에서 확정)도
--   bonus1 assignment 존재 여부와 무관하게 독립적으로 동작하므로, 이
--   기능이 bonus1을 미리 생성해도 baseline 캡처 시점/값에는 전혀 영향을
--   주지 않는다.
--
-- ============================================================
-- 설계
-- ============================================================
-- 여성 자리는 그대로 두고 남성만 테이블 간에 재배치한다(요청 사항). 이
-- 방식을 선택한 이유: event_table_assignments의 각 행은 이미
-- (table_number, female_application_id)로 고정된 "자리"이고, 저장 시
-- 이 두 컬럼은 절대 건드리지 않은 채 male_application_id만
-- update한다 - table_number 유니크 제약과 절대 충돌할 수 없고(각 행의
-- table_number는 그대로이므로), 중복/누락도 아래 검증 한 번으로 전부
-- 막힌다.
--
-- 저장 검증의 핵심: 제출된 남성 목록을 정렬한 배열이 "현재 bonus1에
-- 이미 배정된" 남성 목록을 정렬한 배열과 완전히 동일한 집합인지만
-- 확인한다. 이 한 번의 비교로 동일 참가자 중복 배치/참가자 누락/
-- expected_matches 수 변경이 전부 동시에 차단된다. 다만 "현재
-- 배정된 남성 목록" 자체가 GET~SAVE 사이에 attendance_status/checked_in_at
-- 변경으로 이미 무효해졌을 수 있으므로(아래 안전성 보완 1), 저장
-- 직전에 그 목록의 유효성을 다시 확인한다.
--
-- ============================================================
-- 안전성 보완 1 - SAVE 시 active roster 재검증
-- ============================================================
-- GET으로 bonus1을 불러온 뒤 SAVE하기 전 사이에 관리자가 다른 화면에서
-- 해당 참가자를 no_show/left_early로 바꾸거나 체크인을 취소할 수 있다.
-- 이 경우 "현재 bonus1에 이미 배정된 남성 목록"(existing_males) 자체가
-- 더 이상 유효한 roster가 아니게 되므로, 제출된 순열이 이 목록과
-- 일치하더라도 저장을 거부해야 한다. save_test_bonus1_layout_for_session은
-- existing_males를 다시 조회한 직후 applications를 다시 조회해
-- status='참가 확정' and checked_in_at is not null and attendance_status='active'
-- 조건을 전부 만족하는지 확인하고, 하나라도 어긋나면 명확한 오류로
-- 거부한다(화면을 새로고침해 최신 배치를 다시 받아가도록 안내).
--
-- ============================================================
-- 안전성 보완 2 - 동시 실행 방지
-- ============================================================
-- 이 기능과 상호작용하는 4개 RPC(get/save_test_bonus1_layout_for_session,
-- restart_bonus_phase_for_test_session, resume_after_regular_rounds_for_session)가
-- 같은 event에 대해 동시에 실행될 가능성을 검토했다.
--
-- restart_bonus_phase_for_test_session은 이미 pg_advisory_xact_lock(
-- hashtext(event_id_value || ':bonus_restart'))로 같은 행사에 대한 자신의
-- 반복 호출을 직렬화하고 있다(기존 코드, 무수정). get/save_test_bonus1_layout_for_session도
-- 이 "행사 단위" advisory lock을 그대로 재사용해 restart와도 서로
-- 직렬화되도록 한다 - "자리변경 저장 중 재시작" / "재시작 직후 stale
-- layout 저장"이 모두 이 하나의 lock으로 막힌다.
--
-- resume_after_regular_rounds_for_session은 (실제 행사에서도 쓰이는
-- 일반 함수라 이번 작업에서 수정하지 않는다) 이미 자기 자신의
-- event_progress 행을 `for update`로 잠그고 트랜잭션이 끝날 때까지
-- 들고 있다. get/save_test_bonus1_layout_for_session도 동일하게
-- event_progress 행을 `for update`로 잠그도록 해서, "재개와 자리변경
-- 저장 동시 실행"이 이 행 잠금(row lock, PostgreSQL 표준 방식)으로
-- 자동 직렬화되게 한다 - resume을 전혀 건드리지 않고도 동일한 잠금
-- 대상을 공유하는 것만으로 상호 배제가 성립한다.
--
-- SAVE는 이 두 잠금(advisory lock + event_progress 행 잠금)을 모두
-- 획득한 "이후"에 stage가 여전히 round_complete인지 다시 확인한다 -
-- 잠금 대기 중 다른 트랜잭션이 이미 재개/재시작을 끝냈다면 그 결과를
-- 정확히 반영해 거부하기 위함이다.

create or replace function public.get_test_bonus1_layout_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  plan record;
  total_rounds integer;
  first_bonus_round integer;
  rows_json jsonb;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found or target_event.deleted_at is not null then
    raise exception '삭제되었거나 존재하지 않는 행사입니다.';
  end if;

  -- 하드 안전장치: 프론트에서 버튼을 숨기는 것과 무관하게, 실제 행사
  -- event_id를 넣어 직접 호출해도 절대 실행되지 않는다.
  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 사용할 수 있습니다.';
  end if;

  -- restart_bonus_phase_for_test_session과 동일한 행사 단위 advisory
  -- lock을 공유해, 재시작과 이 조회(그 안에서 bonus1을 새로 생성할 수도
  -- 있음)가 서로 겹치지 않게 직렬화한다.
  perform pg_advisory_xact_lock(hashtext(event_id_value || ':bonus_restart'));

  -- resume_after_regular_rounds_for_session과 동일하게 event_progress
  -- 행을 잠가, 재개와 이 조회가 서로 겹치지 않게 한다.
  select * into target_progress from public.event_progress where event_id = event_id_value for update;
  if not found or target_progress.stage <> 'round_complete' then
    raise exception '추가대화1이 시작되기 전(휴식 단계)에만 자리를 확인/변경할 수 있습니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  first_bonus_round := total_rounds + 1;

  -- bonus1이 아직 없으면 지금 생성한다(이미 있으면 아무 것도 하지
  -- 않는 기존 멱등 함수를 그대로 재사용 - 수정 없음).
  begin
    perform public.generate_bonus_round_assignments(event_id_value, first_bonus_round);
  exception when others then
    raise log '[BONUS_MATCH] get_test_bonus1_layout_for_session: generate_bonus_round_assignments raised - event=% error=%',
      event_id_value, sqlerrm;
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tableNumber', eta.table_number,
    'maleApplicationId', eta.male_application_id,
    'maleNickname', ma.nickname,
    'femaleApplicationId', eta.female_application_id,
    'femaleNickname', fa.nickname
  ) order by eta.table_number), '[]'::jsonb) into rows_json
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value and eta.round_number = first_bonus_round;

  return jsonb_build_object('ok', true, 'firstBonusRound', first_bonus_round, 'rows', rows_json);
end;
$function$;

create or replace function public.save_test_bonus1_layout_for_session(session_token text, event_id_value text, male_assignments jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  plan record;
  total_rounds integer;
  first_bonus_round integer;
  existing_tables integer[];
  existing_males uuid[];
  input_tables integer[];
  input_males uuid[];
  invalid_nickname text;
  updated_count integer := 0;
  item record;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found or target_event.deleted_at is not null then
    raise exception '삭제되었거나 존재하지 않는 행사입니다.';
  end if;

  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 사용할 수 있습니다.';
  end if;

  -- 행사 단위 직렬화: restart_bonus_phase_for_test_session과 같은 lock을
  -- 공유해 "자리변경 저장 중 재시작" / "재시작 직후 stale layout 저장"을
  -- 막는다.
  perform pg_advisory_xact_lock(hashtext(event_id_value || ':bonus_restart'));

  -- resume_after_regular_rounds_for_session과 동일하게 event_progress
  -- 행을 잠가, "재개와 자리변경 저장 동시 실행"을 막는다. 위 두 lock을
  -- 모두 획득한 "이후"에 stage를 다시 확인한다 - 대기 중 다른 트랜잭션이
  -- 이미 재개/재시작을 끝냈을 수 있기 때문이다.
  select * into target_progress from public.event_progress where event_id = event_id_value for update;
  if not found or target_progress.stage <> 'round_complete' then
    raise exception '추가대화1이 시작되기 전(휴식 단계)에만 자리를 변경할 수 있습니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  first_bonus_round := total_rounds + 1;

  select coalesce(array_agg(table_number order by table_number), '{}'::integer[]),
         coalesce(array_agg(male_application_id order by table_number), '{}'::uuid[])
    into existing_tables, existing_males
  from public.event_table_assignments
  where event_id = event_id_value and round_number = first_bonus_round;

  if coalesce(array_length(existing_tables, 1), 0) = 0 then
    raise exception '아직 생성된 추가대화1 배치가 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  end if;

  -- 안전성 보완 1: GET~SAVE 사이 attendance_status/checked_in_at 변경으로
  -- "현재 bonus1에 이미 배정된" 남성 중 누군가 더 이상 유효한 active
  -- roster가 아니게 됐다면 저장을 거부한다. 이미 no_show/left_early가
  -- 된 참가자가 예전 assignment에 남아 있다는 이유만으로 그 상태가
  -- 그대로 저장되는 일이 없어야 한다.
  select a.nickname into invalid_nickname
  from public.applications a
  where a.id = any(existing_males)
    and (a.status <> '참가 확정' or a.checked_in_at is null or a.attendance_status <> 'active')
  limit 1;

  if invalid_nickname is not null then
    raise exception '% 님이 더 이상 유효한 참가 상태가 아닙니다(불참/중도이탈 등). 화면을 새로고침해 최신 배치를 다시 확인해주세요.', invalid_nickname;
  end if;

  select coalesce(array_agg((elem->>'tableNumber')::integer order by (elem->>'tableNumber')::integer), '{}'::integer[]),
         coalesce(array_agg((elem->>'maleApplicationId')::uuid order by (elem->>'tableNumber')::integer), '{}'::uuid[])
    into input_tables, input_males
  from jsonb_array_elements(coalesce(male_assignments, '[]'::jsonb)) elem;

  -- 테이블 구성 검증: 제출된 테이블 번호 집합이 현재 bonus1의 테이블
  -- 번호 집합과 완전히 같아야 한다(빠지거나 늘어난 테이블 불가).
  if input_tables is distinct from existing_tables then
    raise exception '테이블 구성이 올바르지 않습니다(빠지거나 중복된 테이블이 있습니다).';
  end if;

  -- 남성 참가자 순열 검증(이 한 번으로 중복/누락/비활성 참가자 사용을
  -- 전부 차단): 정렬된 남성 목록이 원래 배치와 완전히 동일한 집합이어야
  -- 한다.
  if (select array_agg(x order by x) from unnest(input_males) x) is distinct from
     (select array_agg(x order by x) from unnest(existing_males) x) then
    raise exception '남성 참가자 구성이 올바르지 않습니다(중복되었거나 빠진 참가자가 있습니다).';
  end if;

  for item in
    select (elem->>'tableNumber')::integer as table_number, (elem->>'maleApplicationId')::uuid as male_application_id
    from jsonb_array_elements(male_assignments) elem
  loop
    update public.event_table_assignments
    set male_application_id = item.male_application_id, updated_at = now()
    where event_id = event_id_value and round_number = first_bonus_round and table_number = item.table_number;
    updated_count := updated_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updatedCount', updated_count);
end;
$function$;
