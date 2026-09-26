-- "직전 상대" HARD CONSTRAINT의 최종 정의를 확정한다.
--
-- 최종 정의: "바로 직전 라운드(target_round_number - 1)에서 실제로
-- 배정되어 대화한 상대"만 하드 제외 대상이다. 직전 라운드에 휴식해
-- 배정이 없었던 참가자는, 그 이전 라운드의 상대를 계속 "직전 상대"로
-- 유지하지 않는다(=그 이전 상대와는 다시 매칭될 수 있다).
--
-- (경위 기록용 메모: 한때 "각 참가자가 실제로 가장 최근에 대화한 상대"로
-- 정의를 넓히는 것을 검토했으나, 이는 "제외 대상 쌍들이 그 자체로 하나의
-- matching을 이룬다"는, 정상 8:8에서 8쌍 완전매칭이 항상 가능함을
-- 보장하는 수학적 전제를 깨뜨릴 수 있음이 최소 반례(2:2)로 실제 확인되어
-- 폐기했다. round_number = target_round_number - 1 정의는 "그 라운드의
-- 배정 자체가 하나의 matching"이므로 이 전제가 항상 성립한다.)
--
-- 202609301500과 달라지는 유일한 지점: is_bonus 필터를 넣지 않는다.
-- 직전 라운드가 정규 라운드든 추가대화든 상관없이 round_number =
-- target_round_number - 1인 배정을 그대로 제외한다 - 정규 마지막 라운드
-- -> 추가대화1 경계에도 동일하게 하드 제약이 적용되도록 하기 위해서다
-- (202609301500 이전 코드의 구멍이었던 지점).
--
-- 최저점 동점자 tie-break을 random()에서 결정론적 기준으로 바꾼 부분은
-- 그대로 유지한다: "score asc, round_number asc, ratee_application_id
-- asc" - 같은 점수를 가장 먼저 준 라운드를 우선하고, 그래도 같으면(이론상
-- 발생하지 않음) ratee_application_id로 완전히 결정론적인 순서를 보장한다.

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
  -- 이건 "직전 추가대화" 배정 유무만 보고, 정규 라운드는 쉬는 개념이
  -- 없으므로 is_bonus 조건을 유지한다.
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
    -- ratee_application_id로 완전히 결정론적으로 고른다(재계산해도 항상
    -- 동일한 결과).
    drop table if exists tmp_bonus_lowest;
    create temporary table tmp_bonus_lowest on commit drop as
    select distinct on (rr.rater_application_id)
      rr.rater_application_id, rr.ratee_application_id
    from public.round_ratings rr
    where rr.event_id = event_id_value and rr.round_number <= total_rounds
    order by rr.rater_application_id, rr.score asc, rr.round_number asc, rr.ratee_application_id asc;

    -- 후보 edge: "바로 직전 라운드(target_round_number - 1, 정규든
    -- 추가대화든 상관없이)에서 실제로 배정된 상대"만 하드 제외 - 그 외에는
    -- 전부 후보. 직전 라운드 배정 자체가 하나의 matching이므로, 이걸
    -- 제외한 그래프에서도 완전매칭은 항상 존재한다(Hall의 정리). weight =
    -- -최저점 위반 penalty(지배적) + 휴식 우선 보너스(중간) + 상호
    -- 호감도(기존 공식 그대로: 최신 평점 두 방향의 합).
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
  -- 대비), "바로 직전 라운드 상대만 제외"라는 하드 제약만 지키는 완전히
  -- 독립된 안전 매칭을 시도한다.
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
