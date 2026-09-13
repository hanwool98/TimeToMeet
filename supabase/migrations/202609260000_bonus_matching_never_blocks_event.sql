-- 추가시간(bonus round) 매칭 로직 전면 재작성.
--
-- 배경(실제 운영 중 발생한 문제): generate_bonus_round_assignments가 "어떤
-- 추가시간에서도 이미 만난 적 있는 상대는 절대 재매칭 불가"라는 과도하게
-- 엄격한 규칙 때문에 완전매칭을 못 찾으면 예외를 던졌다. 이 예외는
-- advance_round_state_if_needed / control_round_timer_for_session 트랜잭션을
-- 그대로 타고 올라가 현재 라운드 종료 처리(호감도 수정/자리이동 진입 포함)
-- 까지 통째로 롤백시켰다 - 실제 진행 중이던 테스트 행사에서
-- "중복되지 않는 추가시간 매칭을 생성할 수 없습니다 (가능 7/8쌍)" 형태로
-- 재현됨.
--
-- 이번 수정의 최우선 원칙: 매칭 알고리즘 문제로 행사 진행 자체가 멈추는
-- 일은 구조적으로 다시는 생기면 안 된다. 이를 위해 두 가지를 동시에 한다.
--
--   1) generate_bonus_round_assignments 자체를 "완전매칭을 못 찾으면 예외"
--      구조에서 "정해진 우선순위를 최대한 지키되, 안 되면 단계적으로
--      기준을 완화해서라도 반드시 완전매칭을 만든다" 구조로 재작성한다.
--      절대로 예외를 던지지 않는다.
--   2) 그럼에도 불구하고 예상치 못한 오류(버그, 통계적으로 불가능한 edge
--      case 등)가 나더라도 안전하도록, 이 함수를 호출하는 두 지점
--      (advance_round_state_if_needed, resume_after_regular_rounds_for_session)
--      에서 호출 자체를 begin/exception 블록으로 감싼다. PL/pgSQL의
--      exception 블록은 암묵적 SAVEPOINT라서, 여기서 예외를 잡아도 그
--      exception 블록 "안에서" 실행된 변경만 되돌아가고 바깥 트랜잭션
--      (현재 라운드 종료 → bonus_seat_guide 진입 등)은 정상적으로 커밋된다.
--      매칭이 실패해도 다음 추가시간 매칭 row가 비어있을 뿐, 행사 진행
--      자체는 절대 멈추지 않는다. 실패 시 참가자에게는 아무 것도 노출하지
--      않고 서버 로그(raise log)에만 남긴다.
--
-- 매칭 우선순위 3가지 규칙(요청 사항 그대로):
--   규칙 1: 지각 등으로 기본 라운드에서 대화를 완료하지 못했고, 그 이후
--           어떤 추가시간에서도 아직 실제로 만난 적 없는 남녀 쌍은 최우선
--           매칭 대상이다. 단, 이미 추가시간에서 실제로 만난 적이 있다면
--           이 우선권은 해제된다.
--   규칙 2: 직전 추가시간(바로 이전 한 번, 전체 추가시간 아님)에서 실제로
--           만난 상대와는 이번 추가시간에서 재매칭하지 않는다.
--   규칙 3: 추가시간 1에서 테이블 호감도 합이 가장 낮았던 테이블의 두 참가
--           자는, 그 "다음" 추가시간(=추가시간 2)에서 각자 상대를 고를 때
--           우선권(가장 높은 상호 호감도 상대를 우선 배정)을 가진다.
--
-- 4단계 fallback (숫자가 커질수록 조건 완화, 상위 단계에서 완전매칭을 못
-- 만들 때만 다음 단계로 내려간다 - 참가자 화면에는 노출되지 않고 관리자
-- 로그에만 "fallback level N used" 형태로 남는다):
--   1차: 규칙 1(강제 매칭) + 규칙 3(강제 우선 픽) + 규칙 2(제외) 모두 적용.
--   2차: 규칙 1(강제 매칭) + 규칙 2(제외)만 적용. 규칙 3과 호감도 기반
--        우선순위는 버리고 나머지는 무작위로 완전매칭.
--   3차: 규칙 2(제외)만 적용. 규칙 1 강제 매칭도 버리고 전부 무작위.
--   4차(안전장치, 요청서에 없지만 "무엇이 있어도 절대 멈추지 않는다"는
--        원칙을 지키기 위해 추가): 규칙 2까지 전부 해제하고 완전 무작위로
--        만든다. n>=2에서 규칙 2만 적용해도 항상 완전매칭이 존재하므로
--        (직전 라운드 배정 자체가 하나의 완전매칭이고, 거기서 간선 하나씩만
--        제외한 상태이므로) 3차에서 사실상 항상 해결되지만, 데이터 이상 등
--        예상 밖의 상황에서도 절대 실패하지 않도록 마지막 안전망을 둔다.

create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  plan record;
  total_rounds integer;
  bonus_round_index integer;
  is_test boolean;
  male_ids uuid[];
  female_ids uuid[];
  male_count integer;
  female_count integer;
  expected_matches integer;
  male_index_value integer;
  priority_pair uuid[];
  tier_value integer;
  used_tier integer := 1;
  forced_males uuid[];
  forced_females uuid[];
  forced_count integer;
  candidate_row record;
  best_partner_id uuid;
  phase_b_best record;
  final_males uuid[];
  final_females uuid[];
  final_matched integer;
  pair_index integer;
  table_number_value integer;
begin
  -- 같은 event/round에 대해 동시에 두 번 생성 요청이 들어와도(운영자 조작 +
  -- polling이 겹치는 경우 등) 경합하지 않도록 직렬화한다.
  perform pg_catalog.pg_advisory_xact_lock(hashtext(event_id_value), target_round_number);

  -- 이미 생성된 라운드라면 그대로 둔다(멱등성 - 재시도로 인한 중복 생성 방지).
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select coalesce(e.is_test_event, false) into is_test
  from public.events e where e.id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  bonus_round_index := target_round_number - total_rounds;

  select array_agg(a.id order by a.id) into male_ids
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active' and a.gender = '남성';
  select array_agg(a.id order by a.id) into female_ids
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active' and a.gender = '여성';

  male_count := coalesce(array_length(male_ids, 1), 0);
  female_count := coalesce(array_length(female_ids, 1), 0);
  expected_matches := least(male_count, female_count);

  -- 매칭 문제로 행사 진행이 멈추면 절대 안 되므로, 처리 대상이 없거나
  -- 비트마스크(bigint, 최대 63비트)로 감당 못 할 만큼 큰 비정상적인 규모
  -- 에서도 예외를 던지지 않고 조용히 아무 것도 하지 않는다.
  if expected_matches = 0 or male_count > 60 or female_count > 60 then
    return;
  end if;

  -- 규칙 3: 추가시간 1 → 추가시간 2로 넘어갈 때만 적용된다("다음 추가시간
  -- 상대 선택 우선권" = 추가시간 1 직후 1회성). 추가시간 1에서 실제로
  -- 성사된 배정 중 상호 호감도 합이 가장 낮았던 테이블의 남녀를 찾는다.
  priority_pair := null;
  if bonus_round_index = 2 then
    select array[eta.male_application_id, eta.female_application_id] into priority_pair
    from public.event_table_assignments eta
    left join lateral (
      select rr.score from public.round_ratings rr
      where rr.event_id = event_id_value and rr.rater_application_id = eta.male_application_id
        and rr.ratee_application_id = eta.female_application_id
      order by rr.updated_at desc limit 1
    ) mf on true
    left join lateral (
      select rr.score from public.round_ratings rr
      where rr.event_id = event_id_value and rr.rater_application_id = eta.female_application_id
        and rr.ratee_application_id = eta.male_application_id
      order by rr.updated_at desc limit 1
    ) fm on true
    where eta.event_id = event_id_value and eta.is_bonus and eta.round_number = target_round_number - 1
      and eta.male_application_id is not null and eta.female_application_id is not null
    order by (coalesce(mf.score, 0) + coalesce(fm.score, 0)) asc, eta.table_number asc
    limit 1;
  end if;

  -- 제외/우선순위 판단에 필요한 관계 데이터를 한 번만 계산한다. tier마다
  -- 달라지는 건 "이 데이터를 어떻게 거르고 활용하는지"뿐이다.
  drop table if exists tmp_bonus_pair_audit;
  create temporary table tmp_bonus_pair_audit on commit drop as
  select
    ma.id as male_application_id,
    fa.id as female_application_id,
    array_position(male_ids, ma.id) as male_index,
    array_position(female_ids, fa.id) as female_index,
    coalesce(mf.score, 0) + coalesce(fm.score, 0) as mutual_score,
    -- 규칙 2: 직전 "추가시간"(반드시 is_bonus)에서 실제로 대화까지 끝난 상대.
    -- target_round_number-1이 정규 라운드인 경우(=이번이 첫 추가시간)는
    -- 항상 false가 되어 규칙 2가 적용되지 않는다 - 의도된 동작이다.
    exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number = target_round_number - 1
        and prev.is_bonus
        and prev.conversation_completed_at is not null
        and prev.male_application_id = ma.id
        and prev.female_application_id = fa.id
    ) as met_immediate_prior_bonus,
    -- 규칙 1: "지각 등으로 기본 라운드에서 서로 대화를 하지 못한" 쌍 -
    -- 단순히 지금까지 우연히 스케줄이 안 겹친 쌍(라운드 수보다 인원이 많아
    -- 원래도 못 만나는 조합) 전부를 잡으면 범위가 너무 넓어지므로, 실제로
    -- 정규 라운드에 "배정은 됐지만"(=만났어야 했지만) 대화가 끝나지 못한
    -- 기록이 있는 쌍만 규칙 1 대상으로 삼는다. 이후 어떤 추가시간에서든
    -- 실제로 만난 적이 있다면 우선권은 해제된다(요청 사항 그대로).
    (
      exists (
        select 1 from public.event_table_assignments met
        where met.event_id = event_id_value
          and not met.is_bonus
          and met.conversation_completed_at is null
          and met.male_application_id = ma.id
          and met.female_application_id = fa.id
      )
      and not exists (
        select 1 from public.event_table_assignments met
        where met.event_id = event_id_value
          and met.is_bonus
          and met.round_number < target_round_number
          and met.conversation_completed_at is not null
          and met.male_application_id = ma.id
          and met.female_application_id = fa.id
      )
    ) as rule1_priority
  from public.applications ma
  cross join public.applications fa
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
    order by rr.updated_at desc limit 1
  ) mf on true
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
    order by rr.updated_at desc limit 1
  ) fm on true
  where ma.id = any(male_ids) and fa.id = any(female_ids);

  -- tier 1 → 2 → 3 → 4 순서로 완전매칭을 찾을 때까지 시도한다. 어떤 tier도
  -- 예외를 던지지 않는다 - "이 tier로는 완전매칭 실패"는 그냥 다음 tier로
  -- 넘어가는 조건일 뿐, 행사 진행을 막는 이유가 아니다.
  for tier_value in 1..4 loop
    forced_males := '{}'::uuid[];
    forced_females := '{}'::uuid[];

    -- Phase A: 규칙 1 대상을 강제로 먼저 짝지어준다(1차, 2차 tier에서만).
    -- 규칙 1 대상은 실무적으로 소수(지각 합류자 등)라 그리디 배정으로도
    -- 사실상 항상 최댓값과 같은 결과가 나온다.
    if tier_value in (1, 2) then
      for candidate_row in
        select male_application_id, female_application_id
        from tmp_bonus_pair_audit
        where rule1_priority and not met_immediate_prior_bonus
        order by (case when tier_value = 1 then mutual_score end) desc nulls last, random()
      loop
        if not (candidate_row.male_application_id = any(forced_males))
           and not (candidate_row.female_application_id = any(forced_females)) then
          forced_males := array_append(forced_males, candidate_row.male_application_id);
          forced_females := array_append(forced_females, candidate_row.female_application_id);
        end if;
      end loop;
    end if;

    -- Phase A2: 규칙 3(1차 tier에서만) - 우선권을 가진 두 참가자가 각자
    -- 아직 배정되지 않았다면, 남은 후보 중 상호 호감도가 가장 높은 상대를
    -- 강제로 먼저 배정해준다("상대 선택 우선권").
    if tier_value = 1 and priority_pair is not null then
      if not (priority_pair[1] = any(forced_males)) then
        select female_application_id into best_partner_id
        from tmp_bonus_pair_audit
        where male_application_id = priority_pair[1]
          and not met_immediate_prior_bonus
          and not (female_application_id = any(forced_females))
        order by mutual_score desc, random()
        limit 1;
        if best_partner_id is not null then
          forced_males := array_append(forced_males, priority_pair[1]);
          forced_females := array_append(forced_females, best_partner_id);
        end if;
      end if;

      if priority_pair[2] is not null and not (priority_pair[2] = any(forced_females)) then
        select male_application_id into best_partner_id
        from tmp_bonus_pair_audit
        where female_application_id = priority_pair[2]
          and not met_immediate_prior_bonus
          and not (male_application_id = any(forced_males))
        order by mutual_score desc, random()
        limit 1;
        if best_partner_id is not null then
          forced_males := array_append(forced_males, best_partner_id);
          forced_females := array_append(forced_females, priority_pair[2]);
        end if;
      end if;
    end if;

    forced_count := coalesce(array_length(forced_males, 1), 0);

    -- Phase B: 강제 배정되지 않은 나머지 인원을 매칭한다.
    -- tier 1..3은 규칙 2(직전 추가시간 상대 제외)를 유지하고, tier 4만
    -- 최후의 안전장치로 그마저 해제한다.
    drop table if exists tmp_bonus_tier_candidates;
    create temporary table tmp_bonus_tier_candidates on commit drop as
    select
      male_index, female_index, male_application_id, female_application_id,
      case when tier_value = 1 then mutual_score else 0 end as weight
    from tmp_bonus_pair_audit
    where (case when tier_value <= 3 then not met_immediate_prior_bonus else true end)
      and not (male_application_id = any(forced_males))
      and not (female_application_id = any(forced_females));

    drop table if exists tmp_bonus_states;
    create temporary table tmp_bonus_states (
      used_female_mask bigint not null,
      matched_count integer not null,
      total_weight numeric not null,
      selected_males uuid[] not null,
      selected_females uuid[] not null
    ) on commit drop;
    insert into tmp_bonus_states values (0, 0, 0, '{}'::uuid[], '{}'::uuid[]);

    for male_index_value in 1..male_count loop
      -- 이미 Phase A/A2에서 강제 배정된 남성은 이 DP에서 건너뛴다.
      if male_ids[male_index_value] = any(forced_males) then
        continue;
      end if;

      drop table if exists tmp_bonus_next_states;
      create temporary table tmp_bonus_next_states on commit drop as
      select * from tmp_bonus_states where false;

      -- 짝을 못 찾고 남는 경우도 고려해야 인원이 안 맞을 때도 최대 인원을
      -- 매칭하는 상태를 놓치지 않는다.
      insert into tmp_bonus_next_states select * from tmp_bonus_states;
      insert into tmp_bonus_next_states
      select
        s.used_female_mask | (1::bigint << (c.female_index - 1)),
        s.matched_count + 1,
        s.total_weight + c.weight,
        array_append(s.selected_males, c.male_application_id),
        array_append(s.selected_females, c.female_application_id)
      from tmp_bonus_states s
      join tmp_bonus_tier_candidates c on c.male_index = male_index_value
      where (s.used_female_mask & (1::bigint << (c.female_index - 1))) = 0;

      truncate tmp_bonus_states;
      insert into tmp_bonus_states
      select used_female_mask, matched_count, total_weight, selected_males, selected_females
      from (
        select distinct on (used_female_mask) *
        from tmp_bonus_next_states
        order by used_female_mask,
          matched_count desc,
          case when tier_value = 1 then total_weight end desc nulls last,
          random()
      ) ranked;
    end loop;

    select * into phase_b_best
    from tmp_bonus_states
    order by matched_count desc,
      case when tier_value = 1 then total_weight end desc nulls last,
      random()
    limit 1;

    used_tier := tier_value;
    final_matched := forced_count + coalesce(phase_b_best.matched_count, 0);
    final_males := forced_males || coalesce(phase_b_best.selected_males, '{}'::uuid[]);
    final_females := forced_females || coalesce(phase_b_best.selected_females, '{}'::uuid[]);

    exit when final_matched >= expected_matches;
  end loop;

  if used_tier > 1 then
    raise log '[BONUS_MATCH] bonus matching primary failed - fallback level % used - event=% round=% matched=%/%',
      used_tier - 1, event_id_value, target_round_number, final_matched, expected_matches;
    if is_test then
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% fallback level % used (matched %/%)',
        event_id_value, bonus_round_index, used_tier - 1, final_matched, expected_matches;
    end if;
  end if;

  if final_matched < expected_matches then
    -- 이론상 tier 4(무제한 완전 무작위)는 항상 완전매칭을 찾을 수 있으므로
    -- 여기 도달해서는 안 되지만, 혹시라도 도달하면 참가자 화면을 절대
    -- 막지 않기 위해 부분 매칭이라도 그대로 진행하고 관리자 로그만 남긴다.
    raise log '[BONUS_MATCH] CRITICAL: even fallback level 3 could not reach a full matching - event=% round=% matched=%/%',
      event_id_value, target_round_number, final_matched, expected_matches;
  end if;

  for pair_index in 1..final_matched loop
    select eta.table_number into table_number_value
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and not eta.is_bonus
      and eta.female_application_id = final_females[pair_index]
    order by eta.round_number desc
    limit 1;

    insert into public.event_table_assignments (
      event_id, table_number, round_number, male_application_id, female_application_id, is_bonus
    ) values (
      event_id_value, coalesce(table_number_value, pair_index), target_round_number,
      final_males[pair_index], final_females[pair_index], true
    );

    if is_test then
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% maleApplicationId=% femaleApplicationId=% tier=%',
        event_id_value, bonus_round_index, final_males[pair_index], final_females[pair_index], used_tier;
    end if;
  end loop;
end;
$function$;

revoke all on function public.generate_bonus_round_assignments(text, integer) from public, anon, authenticated;

-- advance_round_state_if_needed: 추가시간 conversation phase가 끝나
-- bonus_seat_guide(호감도 수정/자리이동)로 넘어가는 분기에서
-- generate_bonus_round_assignments 호출을 exception-safe 블록으로 감싼다.
-- 이 함수 안에서 이제 예외를 던지지 않도록 재작성했지만, 예상 밖의 오류
-- (다른 원인의 버그 포함)가 나더라도 "다음 추가시간 매칭 생성 실패"가
-- "현재 라운드 종료 처리 자체의 롤백"으로 번지지 않도록 하는 구조적
-- 방어선이다. exception when others는 암묵적 SAVEPOINT라서 여기서 잡은
-- 예외는 그 블록 안의 변경만 되돌리고, 바깥의 round_progress 업데이트는
-- 정상적으로 계속 진행된다. 이 함수의 나머지 로직(정규 라운드 진행 포함)
-- 은 전혀 바꾸지 않았다.
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
        begin
          perform public.generate_bonus_round_assignments(event_id_value, target.current_round + 1);
        exception when others then
          -- 다음 추가시간 매칭 생성 문제로 현재 라운드 종료 처리(아래
          -- bonus_seat_guide 진입)가 절대 막히면 안 된다. 여기서 예외를
          -- 삼키고 관리자 로그에만 남긴다 - 참가자 화면에는 노출하지 않는다.
          raise log '[BONUS_MATCH] generate_bonus_round_assignments raised unexpectedly - event=% round=% error=%',
            event_id_value, target.current_round + 1, sqlerrm;
        end;
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

-- resume_after_regular_rounds_for_session: 정규 라운드 종료 후 운영자가
-- 수동으로 재개할 때 첫 추가시간 매칭을 생성하는 두 번째(유일한 다른)
-- 호출 지점. 같은 이유로 exception-safe하게 감싼다 - 매칭 생성이 실패해도
-- bonus_seat_guide 진입(자리이동/호감도수정 단계)은 정상적으로 이루어져야
-- 한다.
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

  -- current_round는 아직 total_rounds(마지막 정규 라운드)로 둔다 -
  -- get_round_progress_for_participant의 next_assignment 조회가
  -- current_round+1을 보므로, 이렇게 해야 정확히 1번째 추가시간 짝을
  -- "다음 상대"로 보여줄 수 있다. reveal이 끝나 conversation으로 넘어갈
  -- 때 비로소 current_round가 first_bonus_round로 올라간다.
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
