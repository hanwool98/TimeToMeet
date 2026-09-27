-- 추가대화 매칭 - 최종 비상 방어선(EMERGENCY FALLBACK) 추가.
--
-- 배경: 현재 추가대화 매칭은 이미 두 단계를 갖고 있다.
--   1) PRIMARY/soft-old-bonus weighted matching (_bonus_weighted_dp 기반,
--      비트마스크 DP) - 호감도/최저점/휴식우선/과거bonus회피를 반영.
--   2) SAFETY matching (_bonus_safety_matching/_bonus_kuhn_augment 기반,
--      Kuhn's 알고리즘) - 직전 상대만 하드 제외한 그래프에서 최대매칭을
--      찾는 결정적 알고리즘. Hall의 결혼 정리에 의해(이 저장소의
--      202609301500/202609301700 migration에서 이미 상세히 증명/기록됨)
--      "직전 라운드가 완전매칭이면 그 직전 상대만 제외한 완전매칭은
--      항상 존재한다"가 성립하므로, 정상적인 8:8/7:8/8:7 roster에서는
--      이 SAFETY 단계가 이론상 절대 실패하지 않는다.
--
-- 이번 작업은 "이론상 절대 실패하지 않는다"를 맹신하지 않고, 정말
-- 예상하지 못한 버그/예외/데이터 꼬임으로 위 두 단계가 모두
-- expected_matches를 채우지 못했을 때도 행사가 절대 멈추지 않도록 완전히
-- 독립적인 3번째/4번째 방어선을 추가한다:
--   3) EMERGENCY 순환 이동(rotation) - 직전 배치를 좌석 슬롯 기준으로
--      n칸(1..slot_count-1) 회전시켜 유효한 배치를 찾는다.
--   4) EMERGENCY permutation search - 순환 이동으로도 못 찾는 극단적인
--      경우를 대비한 완전 탐색(백트래킹) - _bonus_kuhn_augment와 완전히
--      독립된 별도 구현으로, 그 함수 자체에 버그가 있어도 영향받지 않는다.
--
-- 두 단계 모두 호감도/최저점/과거bonus 회피는 포기하고, 오직
--   (1) expected_matches 충족, (2) 직전 상대 재매칭 0건(하드), (3) 활성
--   roster만 사용
-- 만 지킨다. 기존 weighted matching/safety matching/baseline
-- ratings/휴식자 우선순위 정책은 단 한 줄도 수정하지 않았다 - 정상
-- 경로가 expected_matches를 채우면 아래 코드는 아예 실행되지 않는다.

-- ============================================================
-- 1) 순환 이동(rotation) 후보를 검증까지 마친 뒤 반환하는 헬퍼.
--
--    "여성 고정 좌석 / 남성 순환" 구조를 그대로 반영해, 부족한 쪽이
--    남성이든(7:8) 여성이든(8:7) 하나의 모델로 통합한다:
--      - 여성 수 >= 남성 수(8:8, 7:8): 슬롯 = 여성(테이블 순서 고정),
--        슬롯에 채우는 값 = 남성. 슬롯 수 - 남성 수 만큼 null(여성 휴식).
--      - 남성 수 > 여성 수(8:7): 슬롯 = 남성(id 순서 고정), 슬롯에
--        채우는 값 = 여성. 슬롯 수 - 여성 수 만큼 null(남성 휴식).
--
--    baseline(n=0에 해당하는 원본 배치)은 "직전 라운드(target_round_number-1)
--    에서 각 슬롯이 실제로 파트너였던 값"으로 채우고, 그 라운드에 없었던
--    사람(신규 합류 등)은 남은 슬롯/값을 id 오름차순으로 1:1 채워 넣는다.
--    이렇게 만든 baseline은 항상 "슬롯별로 서로 다른 값"을 갖는 진짜
--    전단사이므로, n=1..slot_count-1 어떤 회전을 적용해도 슬롯 i의 새
--    값이 슬롯 i의 원래 값(=직전 상대)과 같아지는 경우가 수학적으로
--    없다(n=0 mod slot_count가 아닌 한 baseline[i-n] = baseline[i]가 될
--    수 없음 - 모든 값이 서로 다르므로). 그럼에도 "이론상 항상 성립"을
--    맹신하지 않고 아래에서 각 후보를 실제로 전부 검증한다.
create or replace function public._bonus_emergency_rotation_matching(
  event_id_value text,
  target_round_number integer,
  male_ids uuid[],
  female_ids uuid[],
  out out_selected_males uuid[],
  out out_selected_females uuid[],
  out out_matched_count integer,
  out out_chosen_n integer
)
returns record
language plpgsql
as $function$
declare
  male_count integer := coalesce(array_length(male_ids, 1), 0);
  female_count integer := coalesce(array_length(female_ids, 1), 0);
  expected_matches integer := least(male_count, female_count);
  slot_count integer;
  identity_is_female boolean;
  n integer;
  cand_males uuid[];
  cand_females uuid[];
  cand_count integer;
  distinct_male_count integer;
  distinct_female_count integer;
  repeat_count integer;
begin
  out_matched_count := 0;
  out_selected_males := '{}'::uuid[];
  out_selected_females := '{}'::uuid[];
  out_chosen_n := null;

  if expected_matches = 0 then
    return;
  end if;

  identity_is_female := female_count >= male_count;
  slot_count := greatest(male_count, female_count);

  -- 슬롯 순서: 여성 쪽이 슬롯이면 실제 고정 테이블 번호 순서(없으면
  -- id 순서로 fallback), 남성 쪽이 슬롯이면 남성은 고정 테이블이 없으므로
  -- id 순서.
  drop table if exists tmp_rotation_slots;
  create temporary table tmp_rotation_slots (slot_index integer primary key, slot_id uuid not null) on commit drop;

  if identity_is_female then
    insert into tmp_rotation_slots (slot_index, slot_id)
    select row_number() over (order by coalesce(eps.table_number, 999999), fa.id), fa.id
    from unnest(female_ids) as fa(id)
    left join public.event_preround_seats eps
      on eps.event_id = event_id_value and eps.female_application_id = fa.id;
  else
    insert into tmp_rotation_slots (slot_index, slot_id)
    select row_number() over (order by ma.id), ma.id
    from unnest(male_ids) as ma(id);
  end if;

  drop table if exists tmp_rotation_baseline;
  create temporary table tmp_rotation_baseline (slot_index integer primary key, value_id uuid) on commit drop;

  if identity_is_female then
    insert into tmp_rotation_baseline (slot_index, value_id)
    select s.slot_index,
      (
        select prev.male_application_id from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.female_application_id = s.slot_id
          and prev.male_application_id = any(male_ids)
        limit 1
      )
    from tmp_rotation_slots s;
  else
    insert into tmp_rotation_baseline (slot_index, value_id)
    select s.slot_index,
      (
        select prev.female_application_id from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.male_application_id = s.slot_id
          and prev.female_application_id = any(female_ids)
        limit 1
      )
    from tmp_rotation_slots s;
  end if;

  -- 직전 라운드에서 파트너를 못 찾은 슬롯(신규 합류 등)과, 아직 어느
  -- 슬롯에도 배치되지 못한 값을 각각 고정 순서로 정렬해 1:1로 채운다.
  -- 두 집합의 크기가 다르면(성비 불균형) 작은 쪽 개수만큼만 채워지고
  -- 남는 슬롯은 null(휴식)로 유지된다 - join이 자동으로 그렇게 만든다.
  with leftover_slots as (
    select slot_index, row_number() over (order by slot_index) as rn
    from tmp_rotation_baseline where value_id is null
  ),
  leftover_values as (
    select v as value_id, row_number() over (order by v) as rn
    from unnest(case when identity_is_female then male_ids else female_ids end) as v
    where v <> all (
      select value_id from tmp_rotation_baseline where value_id is not null
    )
  )
  update tmp_rotation_baseline b
  set value_id = lv.value_id
  from leftover_slots ls
  join leftover_values lv on lv.rn = ls.rn
  where b.slot_index = ls.slot_index;

  for n in 1..(slot_count - 1) loop
    drop table if exists tmp_rotation_candidate;
    create temporary table tmp_rotation_candidate on commit drop as
    select s.slot_index, s.slot_id, b2.value_id
    from tmp_rotation_slots s
    join tmp_rotation_baseline b2
      on b2.slot_index = (((s.slot_index - 1 - n) % slot_count + slot_count) % slot_count) + 1;

    if identity_is_female then
      select
        array_agg(value_id order by slot_index) filter (where value_id is not null),
        array_agg(slot_id order by slot_index) filter (where value_id is not null),
        count(*) filter (where value_id is not null)
      into cand_males, cand_females, cand_count
      from tmp_rotation_candidate;
    else
      select
        array_agg(slot_id order by slot_index) filter (where value_id is not null),
        array_agg(value_id order by slot_index) filter (where value_id is not null),
        count(*) filter (where value_id is not null)
      into cand_males, cand_females, cand_count
      from tmp_rotation_candidate;
    end if;

    cand_count := coalesce(cand_count, 0);

    -- 검증 1) expected_matches 충족
    if cand_count <> expected_matches then
      continue;
    end if;

    -- 검증 2) 동일 참가자 중복 없음(male/female table_number 충돌도
    -- 이 중복 검사로 함께 걸러진다 - female은 고정 테이블 1:1이므로
    -- female 중복이 없으면 table_number 충돌도 없다).
    select count(distinct m) into distinct_male_count from unnest(cand_males) m;
    select count(distinct f) into distinct_female_count from unnest(cand_females) f;
    if distinct_male_count <> cand_count or distinct_female_count <> cand_count then
      continue;
    end if;

    -- 검증 3) active roster만 사용(구성상 항상 참이지만 방어적으로 확인)
    if exists (select 1 from unnest(cand_males) m where m <> all (male_ids))
      or exists (select 1 from unnest(cand_females) f where f <> all (female_ids))
    then
      continue;
    end if;

    -- 검증 4) 직전 상대 재매칭 0건(HARD)
    select count(*) into repeat_count
    from unnest(cand_males, cand_females) as pair(m, f)
    where exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number = target_round_number - 1
        and prev.male_application_id = pair.m
        and prev.female_application_id = pair.f
    );
    if repeat_count > 0 then
      continue;
    end if;

    out_selected_males := cand_males;
    out_selected_females := cand_females;
    out_matched_count := cand_count;
    out_chosen_n := n;
    return;
  end loop;

  -- 어떤 n도 유효하지 않음 - matched_count=0으로 반환해 호출부가 다음
  -- 방어선(permutation search)으로 넘어가게 한다.
end;
$function$;

-- ============================================================
-- 2) 완전 탐색(백트래킹) - _bonus_kuhn_augment/tmp_bonus_safety_edges와
--    전혀 무관한 독립 구현. 공유 임시테이블을 전혀 쓰지 않고 파라미터로
--    받은 배열만으로 동작해, 기존 SAFETY matching 쪽 구현에 버그가
--    있어도 이 함수는 영향받지 않는다.
--
--    작은 쪽(primary) 인원 하나하나에 대해 아직 안 쓰인 큰 쪽(secondary)
--    후보를 순서대로 시도하며, "직전 라운드 파트너"(사람당 최대 1명,
--    미리 계산해 배열로 전달)만 건너뛰는 표준 백트래킹이다. 첫 번째로
--    찾아지는 완전 배치를 즉시 반환한다(최적화 아님 - emergency 단계는
--    호감도/최저점을 이미 포기했으므로 "아무 유효 배치"면 충분).
create or replace function public._bonus_emergency_backtrack(
  primary_count integer,
  secondary_count integer,
  forbidden_secondary_index integer[],
  idx integer,
  used_secondary boolean[],
  chosen_secondary integer[],
  out success boolean,
  out result_secondary integer[]
)
returns record
language plpgsql
as $function$
declare
  si integer;
  rec record;
begin
  if idx > primary_count then
    success := true;
    result_secondary := chosen_secondary;
    return;
  end if;

  for si in 1..secondary_count loop
    if used_secondary[si] then
      continue;
    end if;
    if forbidden_secondary_index[idx] = si then
      continue;
    end if;

    used_secondary[si] := true;
    chosen_secondary[idx] := si;

    select * into rec from public._bonus_emergency_backtrack(
      primary_count, secondary_count, forbidden_secondary_index,
      idx + 1, used_secondary, chosen_secondary
    );

    if rec.success then
      success := true;
      result_secondary := rec.result_secondary;
      return;
    end if;

    used_secondary[si] := false;
    chosen_secondary[idx] := null;
  end loop;

  success := false;
  result_secondary := null;
end;
$function$;

-- permutation search 진입점 - 직전 라운드 파트너(사람당 최대 1명)를
-- forbidden index로 미리 계산해두고 순수 배열 연산인 _bonus_emergency_backtrack에
-- 넘긴다(재귀 안에서는 DB 조회를 전혀 하지 않아, 최대 8!=40,320회
-- 재귀호출이 걸려도 매우 빠르다).
create or replace function public._bonus_emergency_permutation_matching(
  event_id_value text,
  target_round_number integer,
  male_ids uuid[],
  female_ids uuid[],
  out out_selected_males uuid[],
  out out_selected_females uuid[],
  out out_matched_count integer
)
returns record
language plpgsql
as $function$
declare
  male_count integer := coalesce(array_length(male_ids, 1), 0);
  female_count integer := coalesce(array_length(female_ids, 1), 0);
  primary_ids uuid[];
  secondary_ids uuid[];
  primary_is_male boolean;
  primary_count integer;
  secondary_count integer;
  forbidden integer[];
  i integer;
  partner_id uuid;
  rec record;
  used_secondary boolean[];
  chosen_secondary integer[];
begin
  out_matched_count := 0;
  out_selected_males := '{}'::uuid[];
  out_selected_females := '{}'::uuid[];

  if male_count = 0 or female_count = 0 then
    return;
  end if;

  if male_count <= female_count then
    primary_ids := male_ids;
    secondary_ids := female_ids;
    primary_is_male := true;
  else
    primary_ids := female_ids;
    secondary_ids := male_ids;
    primary_is_male := false;
  end if;

  primary_count := array_length(primary_ids, 1);
  secondary_count := array_length(secondary_ids, 1);

  forbidden := array_fill(0, array[primary_count]);
  for i in 1..primary_count loop
    if primary_is_male then
      select female_application_id into partner_id
      from public.event_table_assignments
      where event_id = event_id_value and round_number = target_round_number - 1
        and male_application_id = primary_ids[i];
    else
      select male_application_id into partner_id
      from public.event_table_assignments
      where event_id = event_id_value and round_number = target_round_number - 1
        and female_application_id = primary_ids[i];
    end if;
    if partner_id is not null then
      forbidden[i] := coalesce(array_position(secondary_ids, partner_id), 0);
    end if;
  end loop;

  used_secondary := array_fill(false, array[secondary_count]);
  chosen_secondary := array_fill(null::integer, array[primary_count]);

  select * into rec from public._bonus_emergency_backtrack(
    primary_count, secondary_count, forbidden, 1, used_secondary, chosen_secondary
  );

  if not coalesce(rec.success, false) then
    return;
  end if;

  if primary_is_male then
    select array_agg(primary_ids[gi] order by gi), array_agg(secondary_ids[rec.result_secondary[gi]] order by gi)
      into out_selected_males, out_selected_females
    from generate_series(1, primary_count) as gi;
  else
    select array_agg(secondary_ids[rec.result_secondary[gi]] order by gi), array_agg(primary_ids[gi] order by gi)
      into out_selected_males, out_selected_females
    from generate_series(1, primary_count) as gi;
  end if;
  out_matched_count := coalesce(array_length(out_selected_males, 1), 0);
end;
$function$;

-- ============================================================
-- 3) generate_bonus_round_assignments에 두 EMERGENCY 단계를 이어붙인다.
--    기존 PRIMARY/soft-old-bonus/SAFETY(Kuhn's) 블록은 한 글자도
--    수정하지 않았다 - 그 세 단계가 expected_matches를 채우면 아래
--    코드는 아예 실행되지 않는다.
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
  penalty_scale constant numeric := 10000;
  rest_scale constant numeric := 1000;
  old_bonus_scale constant numeric := 1000000;
  -- EMERGENCY FALLBACK 관련
  weighted_matched_snapshot integer := 0;
  safety_matched_snapshot integer := 0;
  chosen_rotation_n integer;
  final_repeat_count integer;
  emergency_permutation_max_matches constant integer := 8; -- 8! = 40,320 - 현재 venue 최대 규모 기준
begin
  perform pg_catalog.pg_advisory_xact_lock(hashtext(event_id_value), target_round_number);

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

  if expected_matches = 0 or male_count > 60 or female_count > 60 then
    return;
  end if;

  majority_gender := case
    when male_count > female_count then '남성'
    when female_count > male_count then '여성'
    else null
  end;

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
    -- 호감도/최저점 source: "정규 라운드 종료 시점" 스냅샷이 이 행사에
    -- 존재하면 그것만 쓰고, 존재하지 않으면(이 migration 배포 이전에
    -- 이미 bonus1이 생성된 진행 중인 행사 - 호환성 폴백) round_ratings의
    -- 정규 라운드 구간을 그대로 쓴다. 이 시점 이후로는 추가대화 중
    -- 수정이 반영되지 않는다는 정책이 두 경우 모두 동일하게 지켜진다
    -- (스냅샷 경로는 애초에 얼려둔 값이라 당연히 무관하고, 폴백 경로도
    -- round_ratings의 "정규 라운드 번호" 구간만 보므로 - 다만 폴백
    -- 경로는 submit_bonus_round_rating이 정규 라운드 행을 그 자리에서
    -- 덮어쓸 수 있다는 기존 제약이 여전히 남아있다 - 폴백은 오직 이번
    -- 배포 "이전에 이미 bonus1이 생성된" 극히 일시적인 경우에만
    -- 발동한다).
    drop table if exists tmp_bonus_rating_source;
    create temporary table tmp_bonus_rating_source on commit drop as
    select rater_application_id, ratee_application_id, round_number, score
    from public.bonus_matching_baseline_ratings
    where event_id = event_id_value
    union all
    select rater_application_id, ratee_application_id, round_number, score
    from public.round_ratings
    where event_id = event_id_value and round_number <= total_rounds
      and not exists (
        select 1 from public.bonus_matching_baseline_ratings where event_id = event_id_value
      );

    drop table if exists tmp_bonus_lowest;
    create temporary table tmp_bonus_lowest on commit drop as
    select distinct on (rr.rater_application_id)
      rr.rater_application_id, rr.ratee_application_id
    from tmp_bonus_rating_source rr
    order by rr.rater_application_id, rr.score asc, rr.round_number asc, rr.ratee_application_id asc;

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
      select rr.score from tmp_bonus_rating_source rr
      where rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
      order by rr.round_number desc limit 1
    ) mf on true
    left join lateral (
      select rr.score from tmp_bonus_rating_source rr
      where rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
      order by rr.round_number desc limit 1
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

  if final_matched < expected_matches then
    used_tier := 'safety_soft_old_bonus';
    begin
      drop table if exists tmp_bonus_rating_source;
      create temporary table tmp_bonus_rating_source on commit drop as
      select rater_application_id, ratee_application_id, round_number, score
      from public.bonus_matching_baseline_ratings
      where event_id = event_id_value
      union all
      select rater_application_id, ratee_application_id, round_number, score
      from public.round_ratings
      where event_id = event_id_value and round_number <= total_rounds
        and not exists (
          select 1 from public.bonus_matching_baseline_ratings where event_id = event_id_value
        );

      drop table if exists tmp_bonus_lowest;
      create temporary table tmp_bonus_lowest on commit drop as
      select distinct on (rr.rater_application_id)
        rr.rater_application_id, rr.ratee_application_id
      from tmp_bonus_rating_source rr
      order by rr.rater_application_id, rr.score asc, rr.round_number asc, rr.ratee_application_id asc;

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
        select rr.score from tmp_bonus_rating_source rr
        where rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
        order by rr.round_number desc limit 1
      ) mf on true
      left join lateral (
        select rr.score from tmp_bonus_rating_source rr
        where rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
        order by rr.round_number desc limit 1
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

  weighted_matched_snapshot := coalesce(final_matched, 0);

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

  safety_matched_snapshot := coalesce(final_matched, 0);

  -- ============================================================
  -- EMERGENCY FALLBACK 3단계: 순환 이동(rotation). PRIMARY/soft-old-bonus/
  -- SAFETY(Kuhn's)가 전부 expected_matches를 채우지 못했을 때만 실행.
  -- ============================================================
  if final_matched < expected_matches then
    used_tier := 'emergency_fallback_rotation';
    begin
      select out_selected_males, out_selected_females, out_matched_count, out_chosen_n
        into final_males, final_females, final_matched, chosen_rotation_n
        from public._bonus_emergency_rotation_matching(event_id_value, target_round_number, male_ids, female_ids);

      final_matched := coalesce(final_matched, 0);
      final_males := coalesce(final_males, '{}'::uuid[]);
      final_females := coalesce(final_females, '{}'::uuid[]);

      raise log '[BONUS_EMERGENCY_FALLBACK] rotation attempted - event=% round=% activeMale=% activeFemale=% expected=% primaryMatched=% safetyMatched=% method=rotation chosenN=% matched=%',
        event_id_value, target_round_number, male_count, female_count, expected_matches,
        weighted_matched_snapshot, safety_matched_snapshot, chosen_rotation_n, final_matched;
    exception when others then
      raise log '[BONUS_EMERGENCY_FALLBACK] rotation raised unexpectedly - event=% round=% activeMale=% activeFemale=% expected=% primaryMatched=% safetyMatched=% error=%',
        event_id_value, target_round_number, male_count, female_count, expected_matches,
        weighted_matched_snapshot, safety_matched_snapshot, sqlerrm;
      final_matched := 0;
      final_males := '{}'::uuid[];
      final_females := '{}'::uuid[];
    end;
  end if;

  -- ============================================================
  -- EMERGENCY FALLBACK 4단계: permutation search(완전 탐색). rotation까지
  -- 실패했을 때만 실행. expected_matches가 안전 탐색 상한(8, 8!=40,320)을
  -- 넘으면 탐색 폭주를 막기 위해 건너뛰고 아래 최종 partial-accept로
  -- 넘어간다(현재 venue 최대 규모인 8:8을 기준으로 한 방어적 상한).
  -- ============================================================
  if final_matched < expected_matches and expected_matches <= emergency_permutation_max_matches then
    used_tier := 'emergency_fallback_permutation';
    begin
      select out_selected_males, out_selected_females, out_matched_count
        into final_males, final_females, final_matched
        from public._bonus_emergency_permutation_matching(event_id_value, target_round_number, male_ids, female_ids);

      final_matched := coalesce(final_matched, 0);
      final_males := coalesce(final_males, '{}'::uuid[]);
      final_females := coalesce(final_females, '{}'::uuid[]);

      raise log '[BONUS_EMERGENCY_FALLBACK] permutation attempted - event=% round=% activeMale=% activeFemale=% expected=% primaryMatched=% safetyMatched=% method=permutation matched=%',
        event_id_value, target_round_number, male_count, female_count, expected_matches,
        weighted_matched_snapshot, safety_matched_snapshot, final_matched;
    exception when others then
      raise log '[BONUS_EMERGENCY_FALLBACK] permutation raised unexpectedly - event=% round=% activeMale=% activeFemale=% expected=% primaryMatched=% safetyMatched=% error=%',
        event_id_value, target_round_number, male_count, female_count, expected_matches,
        weighted_matched_snapshot, safety_matched_snapshot, sqlerrm;
      final_matched := 0;
      final_males := '{}'::uuid[];
      final_females := '{}'::uuid[];
    end;
  elsif final_matched < expected_matches then
    raise log '[BONUS_EMERGENCY_FALLBACK] permutation skipped(expected_matches % exceeds safe search bound %) - event=% round=% activeMale=% activeFemale=% primaryMatched=% safetyMatched=%',
      expected_matches, emergency_permutation_max_matches, event_id_value, target_round_number,
      male_count, female_count, weighted_matched_snapshot, safety_matched_snapshot;
  end if;

  if used_tier like 'emergency_fallback%' then
    -- 최종적으로 선택된 배치에 직전 상대 재매칭이 정말 0건인지 감사
    -- 로그용으로 한 번 더 확인한다(하드 제약이 실제로 지켜졌는지의
    -- 최종 증거 - 위 두 헬퍼 내부 검증과 별개로 여기서도 재확인).
    select count(*) into final_repeat_count
    from unnest(final_males, final_females) as pair(m, f)
    where exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number = target_round_number - 1
        and prev.male_application_id = pair.m
        and prev.female_application_id = pair.f
    );

    raise log '[BONUS_EMERGENCY_FALLBACK] result - event=% round=% activeMale=% activeFemale=% expected=% primaryMatched=% safetyMatched=% method=% matched=%/% immediateRepeatCount=%',
      event_id_value, target_round_number, male_count, female_count, expected_matches,
      weighted_matched_snapshot, safety_matched_snapshot, used_tier, final_matched, expected_matches, coalesce(final_repeat_count, 0);
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
