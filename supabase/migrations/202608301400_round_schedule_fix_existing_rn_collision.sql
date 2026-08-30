-- 긴급 수정: 체크인이 막히는 실제 장애 재현/수정.
--
-- 원인: 남자 continuity 로직(202608301100)이 각자 "본인이 실제 배정받은
-- 적 있는 가장 이른 라운드"의 table_number를 그대로 rn으로 재사용했다.
-- 그런데 이 event가 여러 번 재계산을 거치면서(지각자가 여러 명 순차
-- 체크인), 어떤 두 남자는 서로 다른 라운드에서 각자의 "가장 이른 라운드"
-- table_number가 우연히 같은 값(예: 김딱지=1라운드/4번, 두식이행님=
-- 2라운드/4번 - 둘 다 4)이 되는 경우가 실제로 생겼다. 서로 다른 라운드는
-- 각각 그 라운드 안에서만 table_number가 유일함이 보장되지, 라운드를
-- 넘나들며 비교하면 유일성이 보장되지 않는다. 그 결과 males CTE에 rn=4인
-- 행이 두 개 생겨 INSERT가 unique 제약 위반으로 실패 -> 체크인 RPC 전체가
-- 실패했다(민짱 체크인 시도가 이 재계산을 트리거함).
--
-- 수정: 각자의 "가장 이른 라운드"가 아니라, 이번 재계산 시점 기준으로
-- 이미 실제로 존재하는 라운드 중 가장 최근 라운드(reference_round) 단
-- 하나를 모두에게 공통 기준으로 삼는다. 같은 라운드 안에서는
-- table_number가 항상 유일하다는 게 이미 DB 제약으로 보장되므로, 이
-- 방식은 구조적으로 충돌이 있을 수 없다. (그 라운드에 마침 쉬었던
-- 사람만 "새로 합류"로 취급돼 빈 번호를 새로 받는데, 이는 크래시가
-- 아니라 그 사람 한 명의 이번 재계산 연속성만 약간 덜 최적일 뿐이다.)
create or replace function public.generate_round_schedule_if_missing(
  event_id_value text,
  from_round_number integer default 1,
  max_rounds_value integer default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  plan record;
  ideal_n integer;
  round_count integer;
  reference_round integer;
begin
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and not is_bonus and round_number >= from_round_number
  ) then
    return;
  end if;

  if from_round_number = 1 then
    perform public.ensure_preround_seats_for_event(event_id_value);

    select count(distinct table_number) into ideal_n
    from public.event_preround_seats
    where event_id = event_id_value
      and (male_application_id is not null or female_application_id is not null);

    round_count := coalesce(ideal_n, 0);
    if max_rounds_value is not null then
      round_count := least(round_count, greatest(0, max_rounds_value));
    end if;
    if coalesce(ideal_n, 0) <= 0 or round_count <= 0 then
      return;
    end if;

    with males as (
      select s.male_application_id as id, s.table_number as rn
      from public.event_preround_seats s
      join public.applications a on a.id = s.male_application_id
      where s.event_id = event_id_value and a.checked_in_at is not null
    ),
    females as (
      select s.female_application_id as id, s.table_number as rn
      from public.event_preround_seats s
      join public.applications a on a.id = s.female_application_id
      where s.event_id = event_id_value and a.checked_in_at is not null
    )
    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
    select event_id_value, f.rn, from_round_number + r - 1, m.id, f.id
    from generate_series(1, round_count) as r
    cross join females f
    left join males m on m.rn = (((f.rn - 1 + r - 1) % ideal_n) + 1);

    return;
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  ideal_n := plan.total_rounds;
  round_count := ideal_n;
  if max_rounds_value is not null then
    round_count := least(round_count, greatest(0, max_rounds_value));
  end if;
  if plan.active_male_count = 0 or plan.active_female_count = 0 or round_count <= 0 then
    return;
  end if;

  -- 모두에게 공통된 단일 "기준 라운드"만 사용한다 - 사람마다 각자 다른
  -- 라운드를 기준으로 삼지 않는다.
  select max(round_number) into reference_round
  from public.event_table_assignments
  where event_id = event_id_value and not is_bonus and round_number < from_round_number;

  with male_candidates as (
    select
      a.id,
      a.checked_in_at,
      (select eta.table_number from public.event_table_assignments eta
       where eta.event_id = event_id_value and not eta.is_bonus and eta.male_application_id = a.id
         and eta.round_number = reference_round
       limit 1) as existing_rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '남성'
      and a.checked_in_at is not null and a.attendance_status = 'active'
  ),
  male_available_slots as (
    select gs as slot, row_number() over (order by gs) as slot_rank
    from generate_series(1, ideal_n) as gs
    where gs not in (select existing_rn from male_candidates where existing_rn is not null)
  ),
  male_new_ranked as (
    select id, row_number() over (order by checked_in_at asc nulls last, id asc) as rnk
    from male_candidates
    where existing_rn is null
  ),
  males as (
    select id, existing_rn as rn from male_candidates where existing_rn is not null
    union all
    select mnr.id, mas.slot as rn from male_new_ranked mnr join male_available_slots mas on mas.slot_rank = mnr.rnk
  ),
  female_candidates as (
    select
      a.id,
      a.checked_in_at,
      (select eta.table_number from public.event_table_assignments eta
       where eta.event_id = event_id_value and not eta.is_bonus and eta.female_application_id = a.id
         and eta.round_number = reference_round
       limit 1) as existing_rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '여성'
      and a.checked_in_at is not null and a.attendance_status = 'active'
  ),
  female_available_slots as (
    select gs as slot, row_number() over (order by gs) as slot_rank
    from generate_series(1, ideal_n) as gs
    where gs not in (select existing_rn from female_candidates where existing_rn is not null)
  ),
  female_new_ranked as (
    select id, row_number() over (order by checked_in_at asc nulls last, id asc) as rnk
    from female_candidates
    where existing_rn is null
  ),
  females as (
    select id, existing_rn as rn from female_candidates where existing_rn is not null
    union all
    select fnr.id, fas.slot as rn from female_new_ranked fnr join female_available_slots fas on fas.slot_rank = fnr.rnk
  ),
  offset_safety as (
    select
      k,
      exists (
        select 1
        from females fem
        join males mal on mal.rn = (((fem.rn - 1 + k) % ideal_n) + 1)
        join public.event_table_assignments h
          on h.event_id = event_id_value and not h.is_bonus
          and h.male_application_id = mal.id and h.female_application_id = fem.id
      ) as unsafe
    from generate_series(0, ideal_n - 1) as k
  ),
  ordered_offsets as (
    select k, row_number() over (order by unsafe asc, k asc) as ord
    from offset_safety
  ),
  round_offsets as (
    select r, oo.k
    from generate_series(1, round_count) as r
    join ordered_offsets oo on oo.ord = r
  )
  insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
  select event_id_value, f.rn, from_round_number + ro.r - 1, m.id, f.id
  from round_offsets ro
  cross join females f
  left join males m on m.rn = (((f.rn - 1 + ro.k) % ideal_n) + 1);
end;
$$;
