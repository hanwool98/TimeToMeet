-- 추가대화 매칭 알고리즘 개편.
--
-- 기존 구조(tier 1~4 + Phase A/A2/A3)를 다음 원칙에 따라 정리한다.
--
--   0. 행사는 절대 멈추지 않는다 (계산 실패/예외가 stage stuck으로 이어지면 안 됨)
--   1. 정상 8:8이면 반드시 8쌍(전원 배치). 7:8/8:7처럼 성비가 다르면
--      min(남,여)쌍 + 나머지 1명 휴식은 정상.
--   2. "직전 라운드 상대"만 하드 제외 (그 이전 라운드 상대는 재매칭 허용 -
--      기존의 "지금까지 어떤 추가대화에서든 만난 적 없음(met_any_prior_bonus)"
--      우선순위는 이번에 완전히 제거한다. 정규 라운드에서 만난 상대를
--      추가대화에서 다시 만나는 것도 허용 - "직전 라운드"가 정규 라운드인
--      경우(=추가대화1 생성 시점)에도 동일하게 적용된다. 이는 기존 동작의
--      변경이다: 기존에는 met_immediate_prior_bonus가 is_bonus=true인
--      라운드에만 적용되어 "추가대화1은 정규 마지막 라운드 상대와 다시
--      매칭될 수 있었음" - 이번 요청으로 그 구멍을 막는다.
--   3. 최저점(정규 라운드에서 가장 낮게 평가한 상대) 재매칭은 SOFT
--      constraint - "필요한 만큼만" 자동으로 완화되는 weighted maximum
--      matching으로 구현한다(수동 tier 완화가 아니라 최적화 자체가 최소
--      위반 조합을 찾음).
--   4. 위반 개수가 같다면 상호 호감도(mutual_score, 기존 공식 그대로 재사용)가
--      높은 조합을 선택한다.
--   5. 위 최적화가 어떤 이유로든 실패해도(예외/버그) 행사가 멈추지 않도록,
--      "직전 상대만 제외"라는 하드 제약만 지키는 완전히 독립적인 안전
--      매칭(Kuhn 알고리즘 기반 augmenting path)을 최후 fallback으로 둔다.
--      안전 매칭에서도 절대 직전 상대를 다시 붙이지 않는다.
--
-- 수학적 근거 (요청 7번 검토): 직전 라운드 배정은 그 자체로 하나의 매칭
-- M0(각 남성이 최대 1명의 여성과, 각 여성이 최대 1명의 남성과 - 서로소인
-- pair 집합)이다. 현재 라운드의 활성 로스터에 대해 완전 이분 그래프에서
-- M0의 간선만 제거한 그래프를 생각하면: 남성 집합의 임의의 부분집합 S에
-- 대해, |S|>=2이면 M0가 매칭이므로 S 안의 서로 다른 남성들이 "같은" 여성을
-- 각자의 직전 상대로 가질 수 없어 그 여성들을 모두 합친 금지 집합은
-- 최대 |S|개의 서로 다른 여성뿐이지만, 실제로 한 여성은 최대 한 명의
-- 남성에게만 금지되므로 S 전체의 이웃 N(S)는 여전히 전체 여성 집합과
-- 같다(임의의 여성이 S 안 "모든" 남성에게 동시에 금지될 수는 없다 - M0가
-- 매칭이라 한 여성의 직전 상대는 최대 1명). |S|=1이면 N(S) = 전체 여성 -
-- 1명(자기 직전 상대만 제외) >= 1 (여성이 2명 이상이면). 따라서 Hall의
-- 결혼 정리(Hall's marriage theorem) 조건이 항상 성립하고, "남성 전원을
-- 매칭하는" 완전매칭(성비가 다르면 인원이 적은 쪽 전원을 매칭)이 항상
-- 존재한다 - 정상 8:8이든 7:8/8:7이든, "직전 상대를 피할 수 없어서
-- 완전매칭 실패"라는 상황은 이 알고리즘 구조상 수학적으로 발생할 수 없다.

-- ============================================================
-- 안전 매칭(최후 fallback) 전용 내부 함수 - Kuhn's algorithm(augmenting
-- path)으로 "직전 상대만 제외"한 그래프에서 최대매칭을 구한다. 최적화
-- 실패 시에도 "완전매칭이 항상 존재한다"는 위 수학적 근거를 그대로
-- 만족시키는, 가중치/최저점/호감도를 전혀 고려하지 않는 가장 단순하고
-- 신뢰할 수 있는 별도 코드 경로다. tmp_bonus_safety_edges(male_index,
-- female_index)만 참조한다 - 가중치 계산 등 복잡한 조인에서 발생할 수
-- 있는 문제와 완전히 분리하기 위해 별도 테이블을 쓴다.
-- ============================================================
create or replace function public._bonus_kuhn_augment(
  m integer,
  visited boolean[],
  match_female integer[],
  out success boolean,
  out visited_out boolean[],
  out match_female_out integer[]
)
language plpgsql
as $function$
declare
  f integer;
  rec record;
begin
  visited_out := visited;
  match_female_out := match_female;
  success := false;

  for f in select female_index from tmp_bonus_safety_edges where male_index = m loop
    if not visited_out[f] then
      visited_out[f] := true;
      if match_female_out[f] is null then
        match_female_out[f] := m;
        success := true;
        return;
      else
        select * into rec from public._bonus_kuhn_augment(match_female_out[f], visited_out, match_female_out);
        visited_out := rec.visited_out;
        match_female_out := rec.match_female_out;
        if rec.success then
          match_female_out[f] := m;
          success := true;
          return;
        end if;
      end if;
    end if;
  end loop;
end;
$function$;

revoke all on function public._bonus_kuhn_augment(integer, boolean[], integer[]) from public, anon, authenticated;

create or replace function public._bonus_safety_matching(male_count integer, female_count integer)
returns integer[] -- index = female_index(1..female_count), value = matched male_index or null
language plpgsql
as $function$
declare
  match_female integer[];
  visited boolean[];
  m integer;
  rec record;
begin
  match_female := array_fill(null::integer, array[female_count]);
  for m in 1..male_count loop
    visited := array_fill(false, array[female_count]);
    select * into rec from public._bonus_kuhn_augment(m, visited, match_female);
    match_female := rec.match_female_out;
  end loop;
  return match_female;
end;
$function$;

revoke all on function public._bonus_safety_matching(integer, integer) from public, anon, authenticated;

-- ============================================================
-- 본 함수
-- ============================================================
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path to 'public'
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
  majority_gender text;
  rested_last_round_ids uuid[];
  final_males uuid[];
  final_females uuid[];
  final_matched integer;
  used_safety_net boolean := false;
  pair_index integer;
  table_number_value integer;
  male_index_value integer;
  safety_match_female integer[];
  penalty_scale constant numeric := 10000;   -- 최저점 위반 1건의 가중치 - 호감도(최대 10점대)를 압도
  rest_scale constant numeric := 1000;       -- 휴식 순환 우선 - 최저점보다는 약하고 호감도보다는 강함
begin
  -- 같은 event/round에 대해 동시에 두 번 생성 요청이 들어와도 경합하지
  -- 않도록 직렬화한다.
  perform pg_catalog.pg_advisory_xact_lock(hashtext(event_id_value), target_round_number);

  -- 이미 생성된 라운드라면 그대로 둔다(멱등성).
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

  -- 성비 불균형 쪽(majority_gender)에서 "직전 추가대화(반드시 is_bonus)에
  -- 배정이 없었던" 사람 = 직전에 쉰 사람. 이번엔 가능하면 이 사람들을
  -- 우선 배정해 같은 사람이 연속으로 쉬지 않게 한다(soft, weight로 반영).
  -- "직전 라운드 상대" 하드 제외(아래 tmp_bonus_edges)와는 별개 개념이다 -
  -- 이건 "직전 추가대화"만 보고, 정규 라운드는 쉬는 개념이 없으므로
  -- is_bonus 조건을 유지한다.
  rested_last_round_ids := '{}'::uuid[];
  if majority_gender is not null then
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

  begin
    -- 정규 라운드에서 각 참가자가 가장 낮게 평가한 상대(동점이면 무작위로
    -- 1명). "정규 라운드에서"이므로 round_number <= total_rounds(=정규
    -- 라운드 수)만 본다.
    drop table if exists tmp_bonus_lowest;
    create temporary table tmp_bonus_lowest on commit drop as
    select distinct on (rr.rater_application_id)
      rr.rater_application_id, rr.ratee_application_id
    from public.round_ratings rr
    where rr.event_id = event_id_value and rr.round_number <= total_rounds
    order by rr.rater_application_id, rr.score asc, random();

    -- 후보 edge: "직전 라운드(정규든 추가대화든 상관없이 round_number =
    -- target_round_number - 1) 상대"만 하드 제외 - 그 외에는 전부 후보.
    -- weight = -최저점 위반 penalty(지배적) + 휴식 우선 보너스(중간) +
    -- 상호 호감도(기존 공식 그대로: 최신 평점 두 방향의 합).
    drop table if exists tmp_bonus_edges;
    create temporary table tmp_bonus_edges on commit drop as
    select
      ma.id as male_application_id,
      fa.id as female_application_id,
      array_position(male_ids, ma.id) as male_index,
      array_position(female_ids, fa.id) as female_index,
      (
        - penalty_scale * (
            coalesce((select lm.ratee_application_id = fa.id from tmp_bonus_lowest lm where lm.rater_application_id = ma.id), false)::int
            + coalesce((select lf.ratee_application_id = ma.id from tmp_bonus_lowest lf where lf.rater_application_id = fa.id), false)::int
          )
        + rest_scale * (case when ma.id = any(rested_last_round_ids) or fa.id = any(rested_last_round_ids) then 1 else 0 end)
        + coalesce(mf.score, 0) + coalesce(fm.score, 0)
      ) as weight
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
    where ma.id = any(male_ids) and fa.id = any(female_ids)
      and not exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.male_application_id = ma.id
          and prev.female_application_id = fa.id
      );

    -- weighted maximum matching: female-mask 기준 bitmask DP. 각 male을
    -- 순서대로 처리하며 "이 female-집합을 이미 썼을 때 최댓값" 상태만
    -- 남긴다(매칭 개수 우선 -> weight 우선 -> 무작위). 매칭 개수를 항상
    -- 최우선으로 하므로, 위 수학적 근거에 따라 이 DP는 예외 없이 동작하는
    -- 한 반드시 expected_matches만큼의 쌍을 찾는다.
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
      drop table if exists tmp_bonus_next_states;
      create temporary table tmp_bonus_next_states on commit drop as
      select * from tmp_bonus_states where false;

      -- 이 남성에게 맞는 상대가 하나도 없어도(이론상 발생하지 않지만) 짝을
      -- 못 찾고 남는 상태를 그대로 이어간다.
      insert into tmp_bonus_next_states select * from tmp_bonus_states;
      insert into tmp_bonus_next_states
      select
        s.used_female_mask | (1::bigint << (c.female_index - 1)),
        s.matched_count + 1,
        s.total_weight + c.weight,
        array_append(s.selected_males, c.male_application_id),
        array_append(s.selected_females, c.female_application_id)
      from tmp_bonus_states s
      join tmp_bonus_edges c on c.male_index = male_index_value
      where (s.used_female_mask & (1::bigint << (c.female_index - 1))) = 0;

      truncate tmp_bonus_states;
      insert into tmp_bonus_states
      select used_female_mask, matched_count, total_weight, selected_males, selected_females
      from (
        select distinct on (used_female_mask) *
        from tmp_bonus_next_states
        order by used_female_mask, matched_count desc, total_weight desc, random()
      ) ranked;
    end loop;

    select selected_males, selected_females, matched_count
      into final_males, final_females, final_matched
    from tmp_bonus_states
    order by matched_count desc, total_weight desc, random()
    limit 1;

    if final_matched is null then
      final_matched := 0;
      final_males := '{}'::uuid[];
      final_females := '{}'::uuid[];
    end if;
  exception when others then
    -- 가중치 매칭 계산이 어떤 이유로든 실패해도 행사가 멈추면 안 된다 -
    -- 아래 안전 매칭으로 넘어간다.
    raise log '[BONUS_MATCH] weighted matching raised unexpectedly, falling back to safety matching - event=% round=% error=%',
      event_id_value, target_round_number, sqlerrm;
    final_matched := 0;
    final_males := '{}'::uuid[];
    final_females := '{}'::uuid[];
  end;

  -- 안전장치: 가중치 매칭이 예외를 던졌거나(final_matched=0으로 리셋됨)
  -- 예상보다 적게 찾았다면(수학적으로는 발생하지 않아야 하지만 방어적으로
  -- 대비), "직전 상대만 제외"라는 하드 제약만 지키는 완전히 독립된 안전
  -- 매칭을 시도한다. 여기서도 직전 상대를 다시 붙이는 일은 없다.
  if final_matched < expected_matches then
    used_safety_net := true;
    begin
      drop table if exists tmp_bonus_safety_edges;
      create temporary table tmp_bonus_safety_edges on commit drop as
      select
        array_position(male_ids, ma) as male_index,
        array_position(female_ids, fa) as female_index
      from unnest(male_ids) as ma
      cross join unnest(female_ids) as fa
      where not exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.male_application_id = ma
          and prev.female_application_id = fa
      );

      safety_match_female := public._bonus_safety_matching(male_count, female_count);

      select array_agg(male_ids[safety_match_female[fi]] order by fi), array_agg(female_ids[fi] order by fi), count(*)
        into final_males, final_females, final_matched
      from generate_series(1, female_count) as fi
      where safety_match_female[fi] is not null;

      final_matched := coalesce(final_matched, 0);
      final_males := coalesce(final_males, '{}'::uuid[]);
      final_females := coalesce(final_females, '{}'::uuid[]);

      raise log '[BONUS_MATCH] safety matching used - event=% round=% matched=%/%',
        event_id_value, target_round_number, final_matched, expected_matches;
    exception when others then
      -- 이 지경까지 왔다면(수학적으로 있을 수 없지만) 조용히 포기하고
      -- 채운 만큼만 배정한다 - 절대로 직전 상대를 다시 붙이지 않는다.
      raise log '[BONUS_MATCH] safety matching also raised unexpectedly - event=% round=% error=%',
        event_id_value, target_round_number, sqlerrm;
      final_matched := coalesce(array_length(final_males, 1), 0);
    end;
  end if;

  if is_test then
    raise notice '[BONUS_MATCH] eventId=% bonusRound=% method=% matched=%/%',
      event_id_value, bonus_round_index, (case when used_safety_net then 'safety_net' else 'weighted_matching' end),
      final_matched, expected_matches;
  end if;

  if final_matched < expected_matches then
    -- 완전매칭을 못 찾았다는 뜻 - 더 이상 완화하지 않고(요청 사항: 중복
    -- 매칭보다 휴식이 우선) 채운 만큼만 배정하고 나머지는 이번 추가대화를
    -- 쉰다.
    raise log '[BONUS_MATCH] partial matching accepted (rest applied) - event=% round=% matched=%/%',
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
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% maleApplicationId=% femaleApplicationId=%',
        event_id_value, bonus_round_index, final_males[pair_index], final_females[pair_index];
    end if;
  end loop;
end;
$function$;

revoke all on function public.generate_bonus_round_assignments(text, integer) from public, anon, authenticated;
