-- 지각자가 라운드 도중 체크인해서 테이블 수(ideal_n)가 바뀌는 순간, 이전
-- 수정(male continuity)이 오히려 새로운 문제를 만든다는 게 라이브 테스트로
-- 확인됐다: 이미 실제로 만난 적 있는 남녀 쌍은 서로 같은 table_number를
-- "자기 번호(rn)"로 그대로 물려받는데, 재계산의 첫 라운드(offset 0)는
-- 항상 "여성 rn = 남성 rn"인 항등 매칭이라, 이미 만났던 커플들이 재계산
-- 직후 첫 라운드에서 전원 그대로 다시 만나버린다(1번녀-김딱지처럼 우연이
-- 아니라 구조적으로 100% 재현됨). 지각자가 있을 때마다 재발할 수 있다.
--
-- 해결: 새로 채울 라운드들에 쓸 회전 offset(0..ideal_n-1)을 무작정
-- 순서대로(0,1,2,...) 쓰지 않고, "이미 실제로 만난 적 있는 남녀 쌍을
-- 재현하지 않는 offset"을 먼저 골라 쓰고, 그런 offset이 모자랄 때만
-- 어쩔 수 없이 나머지를 쓴다. 기존 원형(circle method) 계산 방식 자체는
-- 그대로 두고, "어떤 순서로 offset을 쓸지"만 바꾼다.
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

  -- 이미 실제로 배정받은 적 있는 사람은 그 번호를 그대로 유지하고, 처음
  -- 합류하는 사람(지각 등)만 "아직 아무도 안 쓰는 번호" 중에서 체크인
  -- 순서대로 채운다.
  with male_candidates as (
    select
      a.id,
      a.checked_in_at,
      (select eta.table_number from public.event_table_assignments eta
       where eta.event_id = event_id_value and not eta.is_bonus and eta.male_application_id = a.id
       order by eta.round_number asc limit 1) as existing_rn
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
       order by eta.round_number asc limit 1) as existing_rn
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
  -- 회전 offset(0..ideal_n-1) 중, 그 offset으로 매칭했을 때 "이미 실제로
  -- 만난 적 있는 남녀 쌍"을 재현하는 offset은 unsafe로 표시한다. 새로
  -- 합류하는 사람은 애초에 만난 기록이 없으니 그 사람이 낀 조합은 항상
  -- safe로 잡힌다.
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
  -- safe한 offset을 먼저 쓰고(작은 수부터), 모자라면 unsafe한 offset도
  -- 어쩔 수 없이 뒤에 채운다.
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
