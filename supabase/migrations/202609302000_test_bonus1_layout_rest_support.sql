-- "첫 추가대화 자리 변경" 기능 확장 - 남/여 불참(7:8, 8:7) 케이스를 정확히
-- 표현하고 수동으로 휴식자/배치를 바꿀 수 있게 한다.
--
-- ============================================================
-- 구현 전 확인한 사실 (요청 9) - 여성 고정 table_number의 authoritative source
-- ============================================================
-- public.event_preround_seats(event_id, table_number, male_application_id,
-- female_application_id)가 유일한 authoritative source다.
-- ensure_preround_seats_for_event(생성 시점: 정규 라운드 최초 생성 시
-- generate_round_schedule_if_missing 안에서 호출, 이후 해당 event_id에
-- 대해 한 번만 채워지는 멱등 함수)가 '참가 확정' 상태의 남/여 전원을
-- application_no 순서로 1..N 테이블에 배정해두고, generate_round_schedule_if_missing은
-- 정규 라운드를 만들 때마다 이 표의 female_application_id의 table_number를
-- "여성 고정 좌석"으로 그대로 재사용하며 남성만 그 위에서 회전시킨다
-- (males의 rn을 오프셋만큼 순환). 즉 어떤 여성의 "고정 테이블"이 몇 번인지는
-- event_table_assignments(정규 라운드 배정 결과, 파생 데이터)가 아니라
-- event_preround_seats(원본 배정, 체크인 여부와 무관하게 '참가 확정'
-- 전원을 담고 있음)에서 authoritative하게 가져와야 한다 - 이래야
-- "assignment row가 아예 없는" 여성(이번 추가대화에 쉬는 여성, 혹은
-- 애초에 체크인 안 한 여성)의 테이블도 화면에서 사라지지 않는다.
--
-- ============================================================
-- 설계
-- ============================================================
-- GET(get_test_bonus1_layout_for_session)이 반환하는 구조를 확장한다.
--
--   tables: event_preround_seats 중 "현재 active(참가확정+체크인+active)"인
--     여성의 테이블 전부(고정 table_number, 여성) - 각 테이블에 현재
--     bonus1(round_number=first_bonus_round) 배정이 있으면 그 남성을,
--     없으면 maleApplicationId=null(휴식)을 붙인다. 8:8이면 전부 채워져
--     있고, 7:8이면 정확히 1개가 null이다.
--   inactiveFemaleTables: event_preround_seats 중 여성이 현재 active가
--     아닌(체크인 안 함/no_show/left_early 등) 테이블 - 표시만 하고
--     절대 편집 대상이 아니다("여성 불참", 배치 불가).
--   restingMales: 현재 active인 남성 중 bonus1에 어느 테이블에도
--     배정되지 않은 사람 - 8:7일 때만 채워진다(8:8/7:8은 항상 빈 배열).
--
-- 이 세 목록만으로 8:8/7:8/8:7 세 경우 모두 하나의 일관된 모델로 표현된다
-- - "테이블 슬롯 집합"(활성 여성 수만큼) + "그 슬롯을 채우는 남성
-- 풀(활성 남성)"이고, 슬롯보다 남성이 적으면 남는 슬롯이 비고(7:8),
-- 슬롯보다 남성이 많으면 남는 남성이 restingMales로 빠진다(8:7).
--
-- SAVE(save_test_bonus1_layout_for_session)는 이제 "기존 bonus1 행을
-- UPDATE"가 아니라, 전체를 다시 계산해 DELETE 후 INSERT하는 방식으로
-- 바뀐다(요청 7) - 7:8/8:7에서는 assignment 행 자체의 유무가 바뀌어야
-- 하므로 단순 UPDATE만으로는 표현할 수 없다. 검증 기준도 "예전 bonus1
-- 행"이 아니라 lock 획득 "이후" 다시 계산한 현재 active roster +
-- event_preround_seats로 완전히 새로 판단한다(요청 8) - GET~SAVE 사이
-- roster가 바뀌었으면(no_show 등) 그 변화가 정확히 반영되어 검증되고,
-- 낡은 테이블 구성을 그대로 제출하면 거부된다.
--
-- 검증 규칙(모든 케이스에 공통, 하나의 로직으로 8:8/7:8/8:7을 전부 커버):
--   1. 제출된 테이블 번호 집합 == 현재 active 여성의 테이블 번호 집합
--      (정확히 일치, 하나라도 빠지거나 늘어나면 거부)
--   2. 제출된 남성 값(null 아닌 것들) 중 중복 없음
--   3. 제출된 남성 값(null 아닌 것들)은 전부 현재 active 남성 집합의
--      부분집합(비활성/외부 참가자 사용 불가)
--   4. 제출된 남성 값(null 아닌 것들)의 개수 == expected_matches
--      (= least(active 남성 수, active 여성 수))
-- 이 네 조건이 전부 참이면, 자동으로 "빈 테이블 개수 = 여성 초과분",
-- "언급되지 않은 active 남성 = 정확히 restingMales"가 성립한다 - 별도로
-- restingMales를 클라이언트가 제출할 필요가 없다.
--
-- 최저점/baseline 호감도/자동 matching weight/직전 상대 하드 제약 등은
-- 전혀 건드리지 않는다 - generate_bonus_round_assignments, advisory
-- lock/event_progress 행 잠금 방식(202609301900)도 그대로 재사용한다.

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
  tables_json jsonb;
  inactive_json jsonb;
  resting_males_json jsonb;
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

  -- active 여성 테이블 전부(event_preround_seats가 authoritative source) -
  -- 현재 bonus1 배정이 없으면(=이번 추가대화 휴식) maleApplicationId는 null.
  select coalesce(jsonb_agg(jsonb_build_object(
    'tableNumber', s.table_number,
    'femaleApplicationId', s.female_application_id,
    'femaleNickname', fa.nickname,
    'maleApplicationId', eta.male_application_id,
    'maleNickname', ma.nickname
  ) order by s.table_number), '[]'::jsonb)
  into tables_json
  from public.event_preround_seats s
  join public.applications fa on fa.id = s.female_application_id
  left join public.event_table_assignments eta
    on eta.event_id = event_id_value and eta.round_number = first_bonus_round and eta.table_number = s.table_number
  left join public.applications ma on ma.id = eta.male_application_id
  where s.event_id = event_id_value and s.female_application_id is not null
    and fa.status = '참가 확정' and fa.checked_in_at is not null and fa.attendance_status = 'active';

  -- 여성이 비활성(체크인 안 함/no_show/left_early 등)인 테이블 - 표시만,
  -- 절대 편집(남성 배치) 대상이 아니다.
  select coalesce(jsonb_agg(jsonb_build_object(
    'tableNumber', s.table_number,
    'femaleApplicationId', s.female_application_id,
    'femaleNickname', fa.nickname
  ) order by s.table_number), '[]'::jsonb)
  into inactive_json
  from public.event_preround_seats s
  join public.applications fa on fa.id = s.female_application_id
  where s.event_id = event_id_value and s.female_application_id is not null
    and not (fa.status = '참가 확정' and fa.checked_in_at is not null and fa.attendance_status = 'active');

  -- 현재 active인 남성 중 bonus1 어느 테이블에도 배정되지 않은 사람
  -- (8:7일 때만 존재).
  select coalesce(jsonb_agg(jsonb_build_object(
    'maleApplicationId', ma.id,
    'maleNickname', ma.nickname
  ) order by ma.id), '[]'::jsonb)
  into resting_males_json
  from public.applications ma
  where ma.event_id = event_id_value and ma.gender = '남성' and ma.status = '참가 확정'
    and ma.checked_in_at is not null and ma.attendance_status = 'active'
    and not exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = event_id_value and eta.round_number = first_bonus_round and eta.male_application_id = ma.id
    );

  return jsonb_build_object(
    'ok', true,
    'firstBonusRound', first_bonus_round,
    'tables', tables_json,
    'inactiveFemaleTables', inactive_json,
    'restingMales', resting_males_json
  );
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
  active_male_count integer;
  active_female_count integer;
  expected_matches integer;
  active_male_ids uuid[];
  active_female_tables integer[]; -- 현재 active 여성의 테이블 번호 집합(authoritative)
  input_tables integer[];
  input_males_nonnull uuid[];
  inserted_count integer := 0;
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

  if not exists (
    select 1 from public.event_table_assignments where event_id = event_id_value and round_number = first_bonus_round
  ) then
    raise exception '아직 생성된 추가대화1 배치가 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  end if;

  -- lock 획득 이후 "지금" 기준으로 active roster를 완전히 새로 계산한다
  -- (요청 8) - GET 시점과 다를 수 있으므로 절대 예전 값을 재사용하지 않는다.
  -- 기존 bonus 알고리즘과 동일한 기준: 참가 확정 + checked_in_at is not null
  -- + attendance_status = active.
  select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]), count(*)
    into active_male_ids, active_male_count
  from public.applications a
  where a.event_id = event_id_value and a.gender = '남성' and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active';

  select coalesce(array_agg(s.table_number order by s.table_number), '{}'::integer[]), count(*)
    into active_female_tables, active_female_count
  from public.event_preround_seats s
  join public.applications fa on fa.id = s.female_application_id
  where s.event_id = event_id_value and s.female_application_id is not null
    and fa.status = '참가 확정' and fa.checked_in_at is not null and fa.attendance_status = 'active';

  expected_matches := least(active_male_count, active_female_count);
  if expected_matches = 0 then
    raise exception '현재 유효한 참가자가 없어 배치를 저장할 수 없습니다.';
  end if;

  select coalesce(array_agg((elem->>'tableNumber')::integer order by (elem->>'tableNumber')::integer), '{}'::integer[])
    into input_tables
  from jsonb_array_elements(coalesce(male_assignments, '[]'::jsonb)) elem;

  select coalesce(array_agg((elem->>'maleApplicationId')::uuid order by (elem->>'maleApplicationId')::uuid), '{}'::uuid[])
    into input_males_nonnull
  from jsonb_array_elements(coalesce(male_assignments, '[]'::jsonb)) elem
  where elem->>'maleApplicationId' is not null;

  -- 검증 1: 제출된 테이블 번호 집합 == 현재 active 여성의 테이블 번호
  -- 집합(authoritative, event_preround_seats 기준). GET~SAVE 사이
  -- 여성의 active 여부가 바뀌었다면 여기서 정확히 걸린다.
  if (select array_agg(x order by x) from unnest(input_tables) x) is distinct from
     (select array_agg(x order by x) from unnest(active_female_tables) x) then
    raise exception '테이블 구성이 현재 참가자 상태와 일치하지 않습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  end if;

  -- 검증 2: 제출된 남성(null 아닌 것) 중 중복 없음.
  if array_length(input_males_nonnull, 1) is distinct from (
    select count(distinct x) from unnest(input_males_nonnull) x
  ) then
    raise exception '남성 참가자 구성이 올바르지 않습니다(중복된 참가자가 있습니다).';
  end if;

  -- 검증 3: 제출된 남성(null 아닌 것)은 전부 현재 active 남성 집합의
  -- 부분집합이어야 한다(비활성/외부 참가자 사용 불가) - 안전성 보완:
  -- GET~SAVE 사이 no_show/left_early로 바뀐 남성이 그대로 제출되면
  -- 여기서 정확히 거부된다.
  if exists (
    select 1 from unnest(input_males_nonnull) x where not (x = any(active_male_ids))
  ) then
    raise exception '더 이상 유효하지 않은 참가자가 포함되어 있습니다(불참/중도이탈 등). 화면을 새로고침해 최신 배치를 다시 확인해주세요.';
  end if;

  -- 검증 4: 제출된 남성(null 아닌 것) 개수 == expected_matches. 이 네
  -- 검증이 전부 통과하면 "빈 테이블 개수 = 여성 초과분", "언급되지 않은
  -- active 남성 = 정확히 휴식 남성"이 자동으로 성립한다.
  if coalesce(array_length(input_males_nonnull, 1), 0) <> expected_matches then
    raise exception '배치된 pair 수가 올바르지 않습니다(기대 %쌍, 제출 %쌍).',
      expected_matches, coalesce(array_length(input_males_nonnull, 1), 0);
  end if;

  -- 적용: 기존 bonus1 배정을 전부 지우고, 제출된 내용으로 다시 만든다
  -- (7:8/8:7은 행 유무 자체가 바뀔 수 있어 단순 UPDATE로 표현할 수
  -- 없다 - 요청 7). 하나의 함수 호출(=하나의 트랜잭션) 안에서 처리된다.
  delete from public.event_table_assignments
  where event_id = event_id_value and round_number = first_bonus_round;

  for item in
    select
      (elem->>'tableNumber')::integer as table_number,
      (elem->>'maleApplicationId')::uuid as male_application_id,
      (
        select s.female_application_id from public.event_preround_seats s
        where s.event_id = event_id_value and s.table_number = (elem->>'tableNumber')::integer
      ) as female_application_id
    from jsonb_array_elements(male_assignments) elem
    where elem->>'maleApplicationId' is not null
  loop
    insert into public.event_table_assignments (
      event_id, table_number, round_number, male_application_id, female_application_id, is_bonus
    ) values (
      event_id_value, item.table_number, first_bonus_round, item.male_application_id, item.female_application_id, true
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'insertedCount', inserted_count);
end;
$function$;
