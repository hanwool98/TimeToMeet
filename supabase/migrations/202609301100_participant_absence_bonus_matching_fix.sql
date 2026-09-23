-- 불참/중도이탈 이후 행사 진행 + 추가대화(bonus round) 매칭 전면 점검.
--
-- 배경: 실제 행사 테스트 중 다음 문제들이 발견됨.
--  1) attendance_status 변경 시 이미 생성되어 있는 미래 추가대화(is_bonus)
--     assignment가 전혀 정리/재생성되지 않음 - 불참자가 다음 추가대화
--     배정에 그대로 남을 수 있었다.
--  2) generate_bonus_round_assignments의 마지막 fallback(구 tier 4)이
--     "직전 추가대화 상대 제외" 제약 자체를 완전히 해제해, 완전매칭을
--     위해 동일 상대와 2회 연속 추가대화가 실제로 발생할 수 있었다.
--  3) get_round_progress_for_participant가 "다음 상대 없음"을 항상
--     "최종선택 임박"으로 해석해, 성비 불균형으로 이번 추가대화만 쉬는
--     경우에도 잘못된 안내가 노출됐다.
--  4) 상대가 no_show/left_early로 바뀐 뒤에도 assignment row 자체는 남아
--     있어 참가자/태블릿 화면에 이미 없는 사람의 프로필이 계속 노출될
--     여지가 있었다.
--  5) get_round_progress_for_participant가 attendance_status를 전혀
--     검사하지 않아, 불참/중도이탈 처리된 본인도 계속 정상 참가자처럼
--     대화 화면/최종선택에 접근할 수 있었다.
--
-- 자세한 원인 분석/의사결정 배경은 docs/incidents/
-- participant-absence-bonus-matching-incident.md 참고.

-- ---------------------------------------------------------------------------
-- 1) generate_bonus_round_assignments: hard constraint 재작성
--
--    새 tier 구조(전부 "직전 추가대화 상대 재매칭 금지"는 하드 제약으로
--    항상 유지 - 더 이상 해제하는 tier가 없다):
--      tier 1: 규칙1(지각 미대화) + 규칙3(우선권) 강제 배정 + 쉬었던 사람
--               재배정 우선 + 나머지는 "이전 추가대화에서 만난 적 전혀
--               없는" 후보로만 최대매칭(호감도 가중치 적용)
--      tier 2: 위와 동일하되 호감도 가중치 없이 최대매칭
--      tier 3: 강제 배정 없이(쉬었던 사람 우선만 유지) "이전 추가대화에서
--               만난 적 전혀 없는" 후보로 최대매칭
--      tier 4: 강제 배정 없이, "직전 추가대화 상대"만 제외(더 이전
--               추가대화에서 만난 적은 허용)하고 최대매칭 - 이게 마지막
--               단계이며 그 이상 완화하지 않는다.
--    tier 4에서도 expected_matches를 못 채우면 채운 만큼만 배정하고
--    나머지는 이번 추가대화를 쉰다(완전매칭보다 중복 방지가 우선).
-- ---------------------------------------------------------------------------
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  majority_gender text;
  rested_last_round_ids uuid[];
  tier_excludes_any_prior boolean;
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

  majority_gender := case
    when male_count > female_count then '남성'
    when female_count > male_count then '여성'
    else null
  end;

  -- 성비 불균형 쪽(majority_gender)에서 "직전 추가대화(target_round_number-1,
  -- is_bonus)에 배정이 없었던" 사람 = 직전에 쉰 사람. 이번엔 가능하면 이
  -- 사람들을 우선 배정해 같은 사람이 연속으로 쉬지 않게 한다. 첫 추가대화
  -- (bonus_round_index=1)에는 "직전 추가대화"가 없으므로 대상이 없다.
  rested_last_round_ids := '{}'::uuid[];
  if majority_gender is not null and bonus_round_index > 1 then
    select coalesce(array_agg(a.id), '{}'::uuid[]) into rested_last_round_ids
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
      and a.attendance_status = 'active' and a.gender = majority_gender
      and a.id <> all (
        select unnest(array[male_application_id, female_application_id])
        from public.event_table_assignments
        where event_id = event_id_value and is_bonus and round_number = target_round_number - 1
      );
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
    -- 규칙 2(하드 제약): 직전 "추가시간"(반드시 is_bonus)에서 실제로
    -- 대화까지 끝난 상대. target_round_number-1이 정규 라운드인
    -- 경우(=이번이 첫 추가시간)는 항상 false가 되어 규칙 2가 적용되지
    -- 않는다 - 의도된 동작이다.
    exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number = target_round_number - 1
        and prev.is_bonus
        and prev.conversation_completed_at is not null
        and prev.male_application_id = ma.id
        and prev.female_application_id = fa.id
    ) as met_immediate_prior_bonus,
    -- 이번 추가대화보다 이전의 "어떤" 추가대화에서든(직전 포함) 이미
    -- 실제로 대화한 적이 있는지 - met_immediate_prior_bonus를 포함하는
    -- 상위 집합. tier 1~3은 이 전체를 피하려 시도하고, tier 4만 직전
    -- 상대만 제외하는 수준으로 완화한다.
    exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number < target_round_number
        and prev.is_bonus
        and prev.conversation_completed_at is not null
        and prev.male_application_id = ma.id
        and prev.female_application_id = fa.id
    ) as met_any_prior_bonus,
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

  -- tier 1 → 2 → 3 → 4 순서로 시도한다. 어떤 tier도 예외를 던지지 않는다.
  -- tier 4까지도 "직전 추가대화 상대 재매칭 금지"만은 절대 풀지 않는다 -
  -- 그 이상 완전매칭을 위해 완화하는 tier는 더 이상 존재하지 않는다.
  for tier_value in 1..4 loop
    forced_males := '{}'::uuid[];
    forced_females := '{}'::uuid[];
    tier_excludes_any_prior := tier_value <= 3;

    -- Phase A: 규칙 1 대상을 강제로 먼저 짝지어준다(1차, 2차 tier에서만).
    -- 규칙 1 대상은 실무적으로 소수(지각 합류자 등)라 그리디 배정으로도
    -- 사실상 항상 최댓값과 같은 결과가 나온다.
    if tier_value in (1, 2) then
      for candidate_row in
        select male_application_id, female_application_id
        from tmp_bonus_pair_audit
        where rule1_priority
          and (case when tier_excludes_any_prior then not met_any_prior_bonus else not met_immediate_prior_bonus end)
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
          and (case when tier_excludes_any_prior then not met_any_prior_bonus else not met_immediate_prior_bonus end)
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
          and (case when tier_excludes_any_prior then not met_any_prior_bonus else not met_immediate_prior_bonus end)
          and not (male_application_id = any(forced_males))
        order by mutual_score desc, random()
        limit 1;
        if best_partner_id is not null then
          forced_males := array_append(forced_males, best_partner_id);
          forced_females := array_append(forced_females, priority_pair[2]);
        end if;
      end if;
    end if;

    -- Phase A3: 직전 추가대화에서 쉬었던 사람을 이번엔 가능하면 우선
    -- 배정한다(모든 tier에서 시도 - 상대가 전혀 없으면 그냥 다시 쉰다).
    if array_length(rested_last_round_ids, 1) > 0 then
      for candidate_row in
        select a.id as person_id, a.gender as person_gender
        from public.applications a
        where a.id = any(rested_last_round_ids)
      loop
        if candidate_row.person_gender = '남성' and not (candidate_row.person_id = any(forced_males)) then
          select female_application_id into best_partner_id
          from tmp_bonus_pair_audit
          where male_application_id = candidate_row.person_id
            and (case when tier_excludes_any_prior then not met_any_prior_bonus else not met_immediate_prior_bonus end)
            and not (female_application_id = any(forced_females))
          order by mutual_score desc, random()
          limit 1;
          if best_partner_id is not null then
            forced_males := array_append(forced_males, candidate_row.person_id);
            forced_females := array_append(forced_females, best_partner_id);
          end if;
        elsif candidate_row.person_gender = '여성' and not (candidate_row.person_id = any(forced_females)) then
          select male_application_id into best_partner_id
          from tmp_bonus_pair_audit
          where female_application_id = candidate_row.person_id
            and (case when tier_excludes_any_prior then not met_any_prior_bonus else not met_immediate_prior_bonus end)
            and not (male_application_id = any(forced_males))
          order by mutual_score desc, random()
          limit 1;
          if best_partner_id is not null then
            forced_females := array_append(forced_females, candidate_row.person_id);
            forced_males := array_append(forced_males, best_partner_id);
          end if;
        end if;
      end loop;
    end if;

    forced_count := coalesce(array_length(forced_males, 1), 0);

    -- Phase B: 강제 배정되지 않은 나머지 인원을 매칭한다. tier 1~3은
    -- met_any_prior_bonus를 제외(=이전 추가대화 전체와 중복 회피 시도),
    -- tier 4만 met_immediate_prior_bonus만 제외(=직전 상대만은 하드 제약
    -- 으로 유지, 더 이전 추가대화 상대는 허용).
    drop table if exists tmp_bonus_tier_candidates;
    create temporary table tmp_bonus_tier_candidates on commit drop as
    select
      male_index, female_index, male_application_id, female_application_id,
      case when tier_value = 1 then mutual_score else 0 end as weight
    from tmp_bonus_pair_audit
    where (case when tier_excludes_any_prior then not met_any_prior_bonus else not met_immediate_prior_bonus end)
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
      -- 이미 Phase A/A2/A3에서 강제 배정된 남성은 이 DP에서 건너뛴다.
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
    -- tier 4(직전 상대만 제외)로도 완전매칭을 못 찾았다는 뜻 - 더 이상
    -- 완화하지 않고(요청 사항: 중복 매칭보다 휴식이 우선) 채운 만큼만
    -- 배정하고 나머지는 이번 추가대화를 쉰다. 참가자 화면은 이 인원을
    -- "이번 추가대화 휴식"으로 정상적으로 보여준다(get_round_progress_*).
    raise log '[BONUS_MATCH] partial matching accepted (rest applied) - event=% round=% matched=%/%',
      event_id_value, target_round_number, final_matched, expected_matches;
    if is_test then
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% partial matching - matched %/% (rest applied to remainder)',
        event_id_value, bonus_round_index, final_matched, expected_matches;
    end if;
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

-- ---------------------------------------------------------------------------
-- 2) set_participant_attendance_status_for_session: 미래 추가대화 무효화
--
--    기존엔 정규 라운드(not is_bonus)만 미래 구간을 재계산했다. 이미
--    생성된 미래 추가대화(is_bonus) assignment는 전혀 건드리지 않아
--    불참자가 그대로 남을 수 있었다 - 이번에 추가.
--
--    원칙:
--      - 이미 완료된 정규 라운드/추가대화 기록은 그대로 둔다(DELETE 대상은
--        항상 "아직 시작하지 않은 미래"만).
--      - 지금 한창 진행 중인 라운드/추가대화(사람이 화면을 보고 있는 그
--        순간)는 다른 상대로 재매칭하지 않는다 - 그 회차 자체는 그대로
--        두고, 그 다음 회차부터만 재계산한다.
--      - 재계산은 이 트랜잭션 안에서 즉시 수행한다(다음 polling까지
--        기다리지 않음 - "다음 상대" 미리보기가 끊기지 않게).
-- ---------------------------------------------------------------------------
create or replace function public.set_participant_attendance_status_for_session(session_token text, application_id_value uuid, status_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  has_existing_schedule boolean;
  boundary_round integer;
  original_last_round integer;
  max_rounds_value integer;
  plan record;
  total_regular_rounds integer;
  bonus_boundary_round integer;
  current_bonus_index integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if status_value not in ('active', 'no_show', 'left_early') then
    raise exception '올바르지 않은 참가 상태입니다.';
  end if;

  select * into target_application from public.applications where id = application_id_value;
  if not found then
    raise exception '참가자를 찾을 수 없습니다.';
  end if;
  if target_application.status <> '참가 확정' then
    raise exception '참가 확정 상태의 참가자만 대상이 될 수 있습니다.';
  end if;

  update public.applications set attendance_status = status_value where id = application_id_value;

  select exists (
    select 1 from public.event_table_assignments
    where event_id = target_application.event_id and not is_bonus
  ) into has_existing_schedule;

  if not has_existing_schedule then
    perform public.rebuild_preround_seats_for_event(target_application.event_id);
    return;
  end if;

  select * into target_progress from public.event_progress where event_id = target_application.event_id;
  boundary_round := coalesce(target_progress.current_round, 0) + 1;

  select max(round_number) into original_last_round
  from public.event_table_assignments
  where event_id = target_application.event_id and not is_bonus;

  if original_last_round is not null then
    max_rounds_value := greatest(0, original_last_round - boundary_round + 1);
  else
    max_rounds_value := null;
  end if;

  perform public.regenerate_round_schedule_from_round(target_application.event_id, boundary_round, max_rounds_value);

  -- 이미 만들어져 있는 "미래" 추가대화만 무효화한다 - 지금 진행/완료된
  -- 추가대화는 절대 건드리지 않는다.
  if target_progress.event_id is not null then
    select * into plan from public.compute_event_round_plan(target_application.event_id);
    total_regular_rounds := coalesce(original_last_round, plan.total_rounds);

    bonus_boundary_round := case
      when coalesce(target_progress.is_bonus_round, false) then target_progress.current_round
      else total_regular_rounds
    end;

    delete from public.event_table_assignments
    where event_id = target_application.event_id
      and is_bonus
      and round_number > bonus_boundary_round;

    -- 지금 정말로 추가대화가 진행 중이었다면(is_bonus_round=true), 방금
    -- 지운 "다음 추가대화"를 새 active roster 기준으로 바로 다시
    -- 만들어준다 - 참가자 화면의 "다음 상대" 미리보기가 공백 없이
    -- 이어지게 한다. 아직 설정된 추가대화 횟수 안에 있을 때만 시도한다.
    if coalesce(target_progress.is_bonus_round, false) then
      current_bonus_index := (bonus_boundary_round - total_regular_rounds) + 1;
      if current_bonus_index <= coalesce((select bonus_round_count from public.events where id = target_application.event_id), 0) then
        begin
          perform public.generate_bonus_round_assignments(target_application.event_id, bonus_boundary_round + 1);
        exception when others then
          -- 기존 원칙과 동일 - 매칭 재생성 실패가 이 RPC(attendance 변경)
          -- 자체를 실패시키면 안 된다. 다음 advance_round_state_if_needed
          -- 호출에서 다시 시도된다.
          raise log '[BONUS_MATCH] regenerate on attendance change failed - event=% round=% error=%',
            target_application.event_id, bonus_boundary_round + 1, sqlerrm;
        end;
      end if;
    end if;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) get_round_progress_for_participant:
--    - attendance_status가 active가 아니면 명시적으로 알린다(참가자 화면이
--      "다음 상대 없음=최종선택"처럼 잘못 추론하지 않도록 서버가 상태를
--      직접 내려준다).
--    - assignment/next_assignment 모두 상대가 실제로 active(참가 확정 +
--      attendance_status=active)일 때만 유효한 상대로 취급한다 - 상대가
--      no_show/left_early가 됐다면 assignment row는 남아있어도 화면에는
--      "상대 없음(휴식)"으로 보인다.
--    - hasNextBonusRound/nextBonusIsResting을 추가해 "다음 상대 없음"과
--      "정말 마지막 추가대화라 최종선택으로 감"을 프론트가 서버 상태로
--      명확히 구분할 수 있게 한다.
-- ---------------------------------------------------------------------------
create or replace function public.get_round_progress_for_participant(session_token text, event_id_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  assignment record;
  next_assignment record;
  has_submitted_profile_card boolean;
  bonus_partner_id uuid;
  bonus_original_round integer;
  has_submitted_bonus_rating boolean := false;
  bonus_index integer;
  has_next_bonus_round boolean := false;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  -- 불참/중도이탈 처리된 본인은 더 이상 정상 참가자 화면(대화/최종선택
  -- 등)에 접근시키지 않는다 - 서버가 명시적으로 이 상태를 알려주고,
  -- 프론트는 별도 안내 화면을 보여준다. 운영자가 다시 '복귀' 처리하면
  -- attendance_status가 active로 돌아오므로 다음 polling에서 자동으로
  -- 정상 화면으로 돌아간다.
  if target_application.attendance_status is distinct from 'active' then
    return jsonb_build_object(
      'ok', true,
      'excludedFromEvent', true,
      'attendanceStatus', target_application.attendance_status,
      'serverNow', now()
    );
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_application_id,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname,
    case when eta.male_application_id = target_application.id
      then extract(year from age(target_event.event_date::timestamp, fa.birth_date::timestamp))::integer
      else extract(year from age(target_event.event_date::timestamp, ma.birth_date::timestamp))::integer
    end as partner_age,
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job,
    case when eta.male_application_id = target_application.id then fa.height else ma.height end as partner_height
  into assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.round_number = coalesce(target_progress.current_round, 1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id)
    -- 상대가 실제로 아직 active일 때만 "상대 있음"으로 취급한다 - 상대가
    -- no_show/left_early가 된 뒤에는 이 라운드에 남은 참가자에게 이미
    -- 없는 사람의 프로필을 계속 보여주지 않는다(휴식으로 보인다).
    and coalesce(
      (select a2.status = '참가 확정' and a2.attendance_status = 'active'
       from public.applications a2
       where a2.id = case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end),
      false
    );

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_application_id,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname,
    case when eta.male_application_id = target_application.id
      then extract(year from age(target_event.event_date::timestamp, fa.birth_date::timestamp))::integer
      else extract(year from age(target_event.event_date::timestamp, ma.birth_date::timestamp))::integer
    end as partner_age,
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job,
    case when eta.male_application_id = target_application.id then fa.height else ma.height end as partner_height
  into next_assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where target_progress.stage = 'bonus_seat_guide'
    and eta.event_id = event_id_value
    and eta.round_number = coalesce(target_progress.current_round, 1) + 1
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id)
    and coalesce(
      (select a2.status = '참가 확정' and a2.attendance_status = 'active'
       from public.applications a2
       where a2.id = case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end),
      false
    );

  -- 다음 추가대화가 "설정상 남아있고 실제로도 생성됐는지"를
  -- advance_round_state_if_needed와 동일한 기준으로 판단한다 - 프론트가
  -- nextPartnerNickname의 유무만으로 "최종선택 임박"을 잘못 추론하지 않게
  -- 서버가 명시적으로 내려준다.
  if target_progress.stage = 'bonus_seat_guide' then
    bonus_index := target_progress.current_round - total_rounds;
    has_next_bonus_round := (bonus_index + 1) <= coalesce(target_event.bonus_round_count, 0)
      and exists (
        select 1 from public.event_table_assignments
        where event_id = event_id_value and round_number = target_progress.current_round + 1
      );
  end if;

  select exists (
    select 1 from public.event_profile_cards
    where event_id = event_id_value and application_id = target_application.id and submitted_at is not null
  ) into has_submitted_profile_card;

  if target_progress.stage = 'bonus_seat_guide' and target_progress.round_phase = 'transition' then
    select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
    into bonus_partner_id
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = target_progress.current_round
      and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

    if bonus_partner_id is not null then
      select eta.round_number into bonus_original_round
      from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and not eta.is_bonus
        and ((eta.male_application_id = target_application.id and eta.female_application_id = bonus_partner_id)
          or (eta.female_application_id = target_application.id and eta.male_application_id = bonus_partner_id))
      limit 1;

      -- 정규 이력이 없으면(이번에 새로 가능해진, 정규에서 못 만난 채
      -- 추가시간에서 처음 만난 케이스) submit_bonus_round_rating과 동일하게
      -- 지금 이 추가시간 라운드 번호 자체를 기준으로 제출 여부를 본다.
      if target_progress.round_phase_started_at is not null then
        select exists (
          select 1 from public.round_ratings rr
          where rr.event_id = event_id_value
            and rr.round_number = coalesce(bonus_original_round, target_progress.current_round)
            and rr.rater_application_id = target_application.id
            and rr.updated_at >= target_progress.round_phase_started_at
        ) into has_submitted_bonus_rating;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'excludedFromEvent', false,
    'attendanceStatus', target_application.attendance_status,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'tableNumber', assignment.table_number,
    'partnerApplicationId', assignment.partner_application_id,
    'partnerNickname', assignment.partner_nickname,
    'partnerAge', assignment.partner_age,
    'partnerJob', assignment.partner_job,
    'partnerHeight', assignment.partner_height,
    'isResting', target_progress.stage = 'round_active' and assignment.partner_application_id is null,
    'nextTableNumber', next_assignment.table_number,
    'nextPartnerNickname', next_assignment.partner_nickname,
    'nextPartnerAge', next_assignment.partner_age,
    'nextPartnerJob', next_assignment.partner_job,
    'nextPartnerHeight', next_assignment.partner_height,
    'hasNextBonusRound', has_next_bonus_round,
    'nextBonusIsResting', has_next_bonus_round and next_assignment.partner_application_id is null,
    'gender', target_application.gender,
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'hasSubmittedProfileCard', has_submitted_profile_card,
    'hasSubmittedBonusRating', has_submitted_bonus_rating,
    'serverNow', now()
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) get_round_progress_for_tablet: 상대가 no_show/left_early가 되면 태블릿
--    화면도 그 사람의 닉네임을 "현재 앉아있는 상대"처럼 계속 보여주지
--    않는다(참가자 화면과 동일 기준).
-- ---------------------------------------------------------------------------
create or replace function public.get_round_progress_for_tablet(event_id_value text, table_number_value integer, connection_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tablet public.event_tablets%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  match_row record;
begin
  select et.* into tablet
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.event_tablets et set last_seen_at = now(), updated_at = now() where et.id = tablet.id;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select
    case when ma.status = '참가 확정' and ma.attendance_status = 'active' then ma.nickname else null end as male_nickname,
    case when fa.status = '참가 확정' and fa.attendance_status = 'active' then fa.nickname else null end as female_nickname,
    eta.bonus_mission_shown_at is not null as bonus_mission_shown
  into match_row
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.table_number = table_number_value
    and eta.round_number = coalesce(target_progress.current_round, 1);

  return jsonb_build_object(
    'ok', true,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'maleNickname', match_row.male_nickname,
    'femaleNickname', match_row.female_nickname,
    'isResting', target_progress.stage = 'round_active' and (match_row.male_nickname is null or match_row.female_nickname is null),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusMissionShown', coalesce(match_row.bonus_mission_shown, false),
    'bonusRoundIndex', case
      when target_progress.round_phase = 'reveal' then 1
      when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds
      else null
    end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'serverNow', now()
  );
end;
$function$;
