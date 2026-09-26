-- 추가대화 상대가 여러 회차에 걸쳐 반복되는 문제(bonus1과 bonus3 전체 매칭이
-- 동일하게 생성된 실제 관찰 사례)를 개선한다.
--
-- 기존(202609301600까지): "바로 직전 라운드(target_round_number - 1)" 상대만
-- 하드 제외. bonus3 생성 시 bonus1 상대는 후보에 다시 들어올 수 있었다.
--
-- 목표: 정상적인 8:8 행사에서는 bonus1/2/3의 상대가 참가자별로 전부 달라야
-- 한다. 단, "바로 직전 라운드 상대 재매칭 금지"는 절대(ABSOLUTE) 하드
-- 제약으로 어떤 fallback에서도 풀지 않는다.
--
-- ============================================================
-- 수학적 검증 (구현 전 확인)
-- ============================================================
-- 8:8, 추가대화 3회 기준:
--   bonus1: 정규 마지막 라운드 매칭 M0(1개 matching) 하나만 제외
--     -> K(8,8)(8-regular)에서 매칭 1개 제거 = 7-regular bipartite graph
--     -> 7-regular bipartite graph는 항상 perfect matching을 가진다
--        (regular bipartite graph의 perfect matching 존재는 표준 정리:
--         k-regular bipartite graph는 정확히 k개의 서로소인 perfect
--         matching으로 분해된다 - König's edge coloring theorem의 따름정리)
--     -> M1 존재.
--   bonus2: "바로 직전 라운드" = bonus1 = M1만 제외(하드 제약은 여전히
--     이것 하나뿐) -> 마찬가지로 7-regular -> perfect matching M2 존재.
--     M2는 "M1이 아닌" 매칭이므로 M1과 자동으로 edge-disjoint다(같은
--     간선을 두 번 배정할 수 없으므로).
--   bonus3: 이번 수정으로 "M1 ∪ M2"(과거 모든 추가대화 상대) 전부 제외.
--     M1, M2는 서로 edge-disjoint한 두 개의 perfect matching(각 1-regular)
--     이므로 그 합집합은 2-regular 그래프다. 8-regular K(8,8)에서 이를
--     제거하면 6-regular bipartite graph가 남고, 이 역시 항상 perfect
--     matching을 가진다 -> M3 존재, M1/M2 어느 쪽과도 완전히 겹치지 않음.
--
-- 결론: 정상적인 8:8 고정 roster(중간에 인원 변화 없음)에서는 "직전 라운드
-- 하드 제약"과 "과거 모든 추가대회 상대 하드 제외"를 동시에 적용해도
-- bonus 3회까지는 fallback 없이 완전매칭이 항상 존재한다. 사용자의 수학적
-- 판단이 정확함을 확인했다.
--
-- 다만 roster가 라운드마다 변한 경우(7:8<->8:8 전환, no_show/복귀 등)는
-- 과거 bonus 배정들이 서로 다른 부분매칭일 수 있어 위 "edge-disjoint 두
-- matching의 합집합" 구조가 깨질 수 있다 - 이런 비정상 상황에 대비해
-- 아래 2단계(PRIMARY/SAFETY) 구조를 둔다.
--
-- ============================================================
-- 구현
-- ============================================================
-- PRIMARY: "바로 직전 라운드" + "과거 모든 추가대화 상대"를 모두 하드
--   제외한 후보 그래프로 기존 weighted bitmask DP를 그대로 수행한다.
--   최저점 penalty/휴식 우선/호감도 가중치 공식은 변경하지 않는다.
--   expected_matches를 채우면 그대로 사용한다(=이 결과는 과거 bonus
--   재매칭이 항상 0건).
--
-- SAFETY(신설, "안전망(Kuhn) 최후 fallback"과는 다른 중간 단계): PRIMARY가
--   expected_matches에 못 미칠 때만 진입한다. 하드 제약은 "바로 직전
--   라운드"만 유지하고(여전히 ABSOLUTE), "과거 모든 추가대화 상대"는
--   가중치 페널티(기존 최저점 penalty보다 100배 큰 스케일 - 항상 더
--   우선시됨)로 완화해 같은 DP를 다시 한 번 수행한다. 완전매칭이
--   가능하면서 old-bonus 반복이 있는 조합보다, 완전매칭이 가능하면서
--   old-bonus 반복이 없는 조합을 항상 더 선호하고, 완전매칭 자체가 여러
--   개면 그중 old-bonus 반복이 가장 적은 조합을 선택한다(매칭 개수
--   최우선 -> old-bonus 반복 최소화 -> 최저점 penalty -> 휴식 우선 ->
--   호감도 순서가 가중치 스케일로 그대로 구현됨).
--
-- 기존의 "안전망(Kuhn's augmenting path)"은 그대로 최후 fallback으로
-- 유지한다 - PRIMARY와 SAFETY 둘 다 예외를 던지거나(버그) SAFETY조차
-- expected_matches를 채우지 못하는, 수학적으로는 발생하지 않아야 하는
-- 극단적 상황에서만 사용된다. 이 함수 자체는 "바로 직전 라운드"만
-- 확인하므로 변경하지 않는다.
--
-- 최저점 tie-break(202609301600에서 도입한 deterministic 기준)는 그대로
-- 유지한다.

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
  used_tier text := 'primary';
  pair_index integer;
  table_number_value integer;
  male_index_value integer;
  safety_match_female integer[];
  penalty_scale constant numeric := 10000;       -- 최저점 위반 1건의 가중치 - 호감도(최대 10점대)를 압도
  rest_scale constant numeric := 1000;           -- 휴식 순환 우선 - 최저점보다는 약하고 호감도보다는 강함
  old_bonus_scale constant numeric := 1000000;   -- SAFETY 단계에서: 오래된 추가대화 상대 재매칭 1건의 페널티 - 최저점 penalty(10000)를 압도
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
    -- 정규 라운드에서 각 참가자가 가장 낮게 평가한 상대. 동점이면
    -- "그 점수를 가장 먼저 준 라운드"를 우선하고, 그래도 같으면
    -- ratee_application_id로 완전히 결정론적으로 고른다.
    drop table if exists tmp_bonus_lowest;
    create temporary table tmp_bonus_lowest on commit drop as
    select distinct on (rr.rater_application_id)
      rr.rater_application_id, rr.ratee_application_id
    from public.round_ratings rr
    where rr.event_id = event_id_value and rr.round_number <= total_rounds
    order by rr.rater_application_id, rr.score asc, rr.round_number asc, rr.ratee_application_id asc;

    -- PRIMARY 후보 edge: "바로 직전 라운드" 상대 + "과거 모든 추가대화
    -- (is_bonus=true, target_round_number보다 이전)" 상대를 전부 하드
    -- 제외한다. 정규 라운드 상대는 계속 허용(정책 유지).
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
      )
      and not exists (
        select 1 from public.event_table_assignments prevbonus
        where prevbonus.event_id = event_id_value
          and prevbonus.is_bonus
          and prevbonus.round_number < target_round_number
          and prevbonus.male_application_id = ma.id
          and prevbonus.female_application_id = fa.id
      );

    select * into final_males, final_females, final_matched
      from public._bonus_weighted_dp(male_ids, female_ids, male_count, female_count);
  exception when others then
    raise log '[BONUS_MATCH] primary weighted matching raised unexpectedly - event=% round=% error=%',
      event_id_value, target_round_number, sqlerrm;
    final_matched := 0;
    final_males := '{}'::uuid[];
    final_females := '{}'::uuid[];
  end;

  -- SAFETY: PRIMARY가 expected_matches를 채우지 못했을 때만 진입한다.
  -- "바로 직전 라운드" 하드 제약은 그대로 유지하되, "과거 모든 추가대화
  -- 상대"는 하드 제외가 아니라 매우 큰 가중치 페널티로 완화해 같은 DP를
  -- 다시 수행한다 - 완전매칭을 우선 채우되, 그중 old-bonus 반복이 최소인
  -- 조합을 고른다.
  if final_matched < expected_matches then
    used_tier := 'safety_soft_old_bonus';
    begin
      drop table if exists tmp_bonus_edges;
      create temporary table tmp_bonus_edges on commit drop as
      select
        ma.id as male_application_id,
        fa.id as female_application_id,
        array_position(male_ids, ma.id) as male_index,
        array_position(female_ids, fa.id) as female_index,
        (
          - old_bonus_scale * (
              case when exists (
                select 1 from public.event_table_assignments prevbonus
                where prevbonus.event_id = event_id_value
                  and prevbonus.is_bonus
                  and prevbonus.round_number < target_round_number
                  and prevbonus.male_application_id = ma.id
                  and prevbonus.female_application_id = fa.id
              ) then 1 else 0 end
            )
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

      select * into final_males, final_females, final_matched
        from public._bonus_weighted_dp(male_ids, female_ids, male_count, female_count);

      raise log '[BONUS_MATCH] safety_soft_old_bonus matching used - event=% round=% matched=%/%',
        event_id_value, target_round_number, final_matched, expected_matches;
    exception when others then
      raise log '[BONUS_MATCH] safety_soft_old_bonus matching raised unexpectedly - event=% round=% error=%',
        event_id_value, target_round_number, sqlerrm;
      final_matched := 0;
      final_males := '{}'::uuid[];
      final_females := '{}'::uuid[];
    end;
  end if;

  -- 최후 안전망: 위 두 단계 모두 예외를 던졌거나(수학적으로는 발생하지
  -- 않아야 함) 여전히 expected_matches에 못 미치면, "바로 직전 라운드"만
  -- 지키는 완전히 독립된 결정론적 매칭(Kuhn's augmenting path)으로
  -- 넘어간다. 이 경로는 절대 직전 상대를 재매칭하지 않는다(하드 유지).
  if final_matched < expected_matches then
    used_tier := 'emergency_safety_net';
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

      raise log '[BONUS_MATCH] emergency safety matching used - event=% round=% matched=%/%',
        event_id_value, target_round_number, final_matched, expected_matches;
    exception when others then
      raise log '[BONUS_MATCH] emergency safety matching also raised unexpectedly - event=% round=% error=%',
        event_id_value, target_round_number, sqlerrm;
      final_matched := coalesce(array_length(final_males, 1), 0);
    end;
  end if;

  if is_test then
    raise notice '[BONUS_MATCH] eventId=% bonusRound=% method=% matched=%/%',
      event_id_value, bonus_round_index, used_tier, final_matched, expected_matches;
  end if;

  if final_matched < expected_matches then
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

-- ============================================================
-- weighted bitmask DP를 별도 함수로 추출 (PRIMARY/SAFETY 두 단계에서
-- 동일 로직을 재호출하기 위함). tmp_bonus_edges(male_application_id,
-- female_application_id, male_index, female_index, weight) 임시 테이블을
-- 그대로 사용한다 - 호출부가 이 테이블을 원하는 후보 그래프로 미리
-- 채워둔 뒤 호출한다.
-- ============================================================
create or replace function public._bonus_weighted_dp(
  male_ids uuid[], female_ids uuid[], male_count integer, female_count integer,
  out out_selected_males uuid[], out out_selected_females uuid[], out out_matched_count integer
)
language plpgsql
as $function$
declare
  male_index_value integer;
begin
  -- 주의: 이 함수의 OUT 파라미터 이름(out_selected_males 등)은 아래 DP가
  -- 사용하는 임시테이블의 컬럼명(selected_males, matched_count 등)과
  -- 절대 겹치면 안 된다 - 겹치면 plpgsql이 "컬럼 참조가 모호함" 예외를
  -- 던지고, 이 예외가 호출부의 exception when others에서 조용히
  -- 삼켜지면서 PRIMARY가 매번 실패한 것처럼 오동작한다(실제로 이 문제로
  -- 한 번 발견되어 수정됨).
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

  select s.selected_males, s.selected_females, s.matched_count
    into out_selected_males, out_selected_females, out_matched_count
  from tmp_bonus_states s
  order by s.matched_count desc, s.total_weight desc, random()
  limit 1;

  if out_matched_count is null then
    out_matched_count := 0;
    out_selected_males := '{}'::uuid[];
    out_selected_females := '{}'::uuid[];
  end if;
end;
$function$;

revoke all on function public._bonus_weighted_dp(uuid[], uuid[], integer, integer) from public, anon, authenticated;
