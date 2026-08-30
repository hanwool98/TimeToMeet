-- 추가시간 매칭 정확도 개선.
--
-- 기존 문제: generate_bonus_round_assignments가 (1) 정규라운드에서 한 번도
-- 못 만난 pair를 전혀 우대하지 않고 호감도 점수(없으면 0점)와 동일하게
-- 취급했고, (2) "이전 추가시간과 겹치지 않기"만 검사할 뿐 "바로 직전
-- 라운드(정규 라운드 포함)와 겹치지 않기"는 전혀 검사하지 않아서, 정규
-- 마지막 라운드 상대와 추가시간 1에서 곧바로 다시 만나는 경우가 실제로
-- 발생했다(라이브 테스트로 재현 확인: 정규 5라운드의 남2-여1 조합이 바로
-- 추가시간 1에서도 그대로 나옴).
--
-- 이번 수정:
--  1) met_regular(정규라운드에서 실제로 만난 적 있는지)를 event_table_
--     assignments에 남녀 둘 다 채워진 행이 실제로 존재하는지로 판단한다
--     (지각/중도합류/no_show로 애초에 배정 행 자체가 없었으면 자동으로
--     "못 만남"이 된다 - 별도 attendance 테이블이 없어 이게 가장 신뢰할
--     수 있는 판단 기준).
--  2) 후보 쌍 생성 시 "바로 직전 라운드(target_round_number - 1, 정규/
--     추가시간 구분 없음)에서 이미 만난 조합"을 새 hard exclusion으로
--     추가한다. 기존 "이전 추가시간 어느 라운드든" 제외 규칙은 그대로
--     유지한다.
--  3) met_regular = false인 pair를 별도 단계(phase 1)에서 점수와 무관하게
--     최우선으로 먼저 매칭하고, 남은 사람들만 기존 방식(phase 2, 호감도
--     점수 기반 MRV greedy)으로 매칭한다 - rating이 없어도 순위가 밀리지
--     않고, 점수 기반 단계가 못-만난 쌍의 유일한 상대를 먼저 가로채는
--     것도 막는다.
--  4) 테스트 행사(is_test_event)에서만 각 매칭 결과를 RAISE NOTICE로
--     남긴다 - 운영 UI에는 노출되지 않고, Supabase 로그에서만 확인 가능.
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  plan record;
  total_rounds integer;
  is_test boolean;
  remaining_males uuid[];
  remaining_females uuid[];
  matched_count integer := 0;
  expected_matches integer;
  pick_side text;
  pick_id uuid;
  pick_count integer;
  partner_id uuid;
  female_table integer;
  loop_guard integer := 0;
  match_male_id uuid;
  match_female_id uuid;
  match_weight numeric;
begin
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select coalesce(is_test_event, false) into is_test from public.events where id = event_id_value;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select array_agg(a.id) into remaining_males
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
    and a.attendance_status = 'active' and a.gender = '남성';

  select array_agg(a.id) into remaining_females
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
    and a.attendance_status = 'active' and a.gender = '여성';

  expected_matches := least(coalesce(array_length(remaining_males, 1), 0), coalesce(array_length(remaining_females, 1), 0));
  if expected_matches <= 0 then
    return;
  end if;

  drop table if exists tmp_bonus_candidates;
  create temporary table tmp_bonus_candidates on commit drop as
  select
    ma.id as male_application_id,
    fa.id as female_application_id,
    exists (
      select 1 from public.event_table_assignments met
      where met.event_id = event_id_value and not met.is_bonus
        and met.male_application_id = ma.id and met.female_application_id = fa.id
    ) as met_regular,
    (mf.score is not null and fm.score is not null) as has_mutual,
    coalesce(mf.score, 0) + coalesce(fm.score, 0) as weight
  from public.applications ma
  cross join public.applications fa
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
    order by rr.round_number asc limit 1
  ) mf on true
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
    order by rr.round_number asc limit 1
  ) fm on true
  where ma.id = any(remaining_males) and fa.id = any(remaining_females)
    -- 이전 추가시간 어느 라운드에서든 이미 짝지어졌던 조합 제외(기존 규칙).
    and not exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number < target_round_number
        and prev.is_bonus
        and prev.male_application_id = ma.id
        and prev.female_application_id = fa.id
    )
    -- 바로 직전 라운드(정규든 추가시간이든)에서 이미 만난 조합 제외(신규).
    and not exists (
      select 1 from public.event_table_assignments last_round
      where last_round.event_id = event_id_value
        and last_round.round_number = target_round_number - 1
        and last_round.male_application_id = ma.id
        and last_round.female_application_id = fa.id
    );

  -- Phase 1: 정규라운드에서 한 번도 못 만난 pair(met_regular=false)를
  -- 점수와 무관하게 최우선으로 매칭한다.
  loop
    loop_guard := loop_guard + 1;
    exit when loop_guard > 200;
    exit when coalesce(array_length(remaining_males, 1), 0) = 0 or coalesce(array_length(remaining_females, 1), 0) = 0;

    select side, id, cnt into pick_side, pick_id, pick_count
    from (
      select 'male' as side, male_application_id as id, count(*) as cnt
      from tmp_bonus_candidates
      where not met_regular and male_application_id = any(remaining_males) and female_application_id = any(remaining_females)
      group by male_application_id
      union all
      select 'female' as side, female_application_id as id, count(*) as cnt
      from tmp_bonus_candidates
      where not met_regular and male_application_id = any(remaining_males) and female_application_id = any(remaining_females)
      group by female_application_id
    ) combined
    order by cnt asc, side, id
    limit 1;

    exit when pick_side is null or pick_count = 0;

    if pick_side = 'male' then
      select female_application_id, weight into partner_id, match_weight
      from tmp_bonus_candidates
      where not met_regular and male_application_id = pick_id and female_application_id = any(remaining_females)
      order by has_mutual desc, weight desc, female_application_id
      limit 1;
      match_male_id := pick_id;
      match_female_id := partner_id;
    else
      select male_application_id, weight into partner_id, match_weight
      from tmp_bonus_candidates
      where not met_regular and female_application_id = pick_id and male_application_id = any(remaining_males)
      order by has_mutual desc, weight desc, male_application_id
      limit 1;
      match_male_id := partner_id;
      match_female_id := pick_id;
    end if;

    select eta.table_number into female_table
    from public.event_table_assignments eta
    where eta.event_id = event_id_value and eta.round_number = total_rounds
      and not eta.is_bonus and eta.female_application_id = match_female_id
    limit 1;

    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
    values (event_id_value, coalesce(female_table, 1), target_round_number, match_male_id, match_female_id, true);

    if pick_side = 'male' then
      remaining_males := array_remove(remaining_males, pick_id);
      remaining_females := array_remove(remaining_females, partner_id);
    else
      remaining_females := array_remove(remaining_females, pick_id);
      remaining_males := array_remove(remaining_males, partner_id);
    end if;

    matched_count := matched_count + 1;

    if is_test then
      raise notice '[BONUS_MATCH] male=% female=% reason=unmet_regular_pair mutualScore=% previousRound=false previousBonus=false round=%',
        (select nickname from public.applications where id = match_male_id),
        (select nickname from public.applications where id = match_female_id),
        coalesce(match_weight::text, 'null'),
        target_round_number;
    end if;
  end loop;

  -- Phase 2: 남은 사람들은 기존 방식(호감도 점수 기반 MRV greedy) 그대로.
  -- met_regular asc를 tie-break 맨 앞에 추가해, 혹시 여기까지 못-만난
  -- pair가 남아 있어도 같은 점수의 이미-만난 pair보다 우선하게 한다.
  loop_guard := 0;
  loop
    loop_guard := loop_guard + 1;
    exit when loop_guard > 200;
    exit when coalesce(array_length(remaining_males, 1), 0) = 0 or coalesce(array_length(remaining_females, 1), 0) = 0;

    select side, id, cnt into pick_side, pick_id, pick_count
    from (
      select 'male' as side, male_application_id as id, count(*) as cnt
      from tmp_bonus_candidates
      where male_application_id = any(remaining_males) and female_application_id = any(remaining_females)
      group by male_application_id
      union all
      select 'female' as side, female_application_id as id, count(*) as cnt
      from tmp_bonus_candidates
      where male_application_id = any(remaining_males) and female_application_id = any(remaining_females)
      group by female_application_id
    ) combined
    order by cnt asc, side, id
    limit 1;

    exit when pick_side is null or pick_count = 0;

    if pick_side = 'male' then
      select female_application_id, weight into partner_id, match_weight
      from tmp_bonus_candidates
      where male_application_id = pick_id and female_application_id = any(remaining_females)
      order by met_regular asc, has_mutual desc, weight desc, female_application_id
      limit 1;
      match_male_id := pick_id;
      match_female_id := partner_id;
    else
      select male_application_id, weight into partner_id, match_weight
      from tmp_bonus_candidates
      where female_application_id = pick_id and male_application_id = any(remaining_males)
      order by met_regular asc, has_mutual desc, weight desc, male_application_id
      limit 1;
      match_male_id := partner_id;
      match_female_id := pick_id;
    end if;

    select eta.table_number into female_table
    from public.event_table_assignments eta
    where eta.event_id = event_id_value and eta.round_number = total_rounds
      and not eta.is_bonus and eta.female_application_id = match_female_id
    limit 1;

    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
    values (event_id_value, coalesce(female_table, 1), target_round_number, match_male_id, match_female_id, true);

    if pick_side = 'male' then
      remaining_males := array_remove(remaining_males, pick_id);
      remaining_females := array_remove(remaining_females, partner_id);
    else
      remaining_females := array_remove(remaining_females, pick_id);
      remaining_males := array_remove(remaining_males, partner_id);
    end if;

    matched_count := matched_count + 1;

    if is_test then
      raise notice '[BONUS_MATCH] male=% female=% reason=mutual_score mutualScore=% previousRound=false previousBonus=false round=%',
        (select nickname from public.applications where id = match_male_id),
        (select nickname from public.applications where id = match_female_id),
        coalesce(match_weight::text, 'null'),
        target_round_number;
    end if;
  end loop;

  if matched_count < expected_matches then
    raise exception '중복되지 않는 추가시간 매칭을 생성할 수 없습니다.';
  end if;
end;
$function$;
