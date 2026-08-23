-- 노쇼/중도이탈/인원 불균형 대응의 핵심 SQL 계층.
--
-- 1) applications.attendance_status: "오늘 행사에 실제로 참여 중인가"를 나타내는
--    새 컬럼(기존 status 컬럼은 심사/결제 파이프라인 의미 그대로 유지, 건드리지
--    않음). checked_in_at은 그대로 "QR 스캔했는지" 감사 기록으로 남긴다.
--
-- 2) compute_event_round_plan: 지금까지 4곳(advance_round_state_if_needed,
--    get_admin_round_progress, get_round_progress_for_participant/tablet)에
--    각각 복붙되어 있던 `greatest(1, least(male_capacity, female_capacity))`
--    (행사 "설정 정원" 기반) 공식을, 실제 활성 참가자 수 기반으로 통일한다.
--
-- 3) generate_round_schedule_if_missing: 여성 테이블 고정 + 남성 이동 원칙은
--    그대로 두고, N = greatest(활성남, 활성여)로 일반화한 원형법으로
--    재작성한다. 인원이 다르면 더 적은 쪽에 대응하는 "가상 슬롯"이 매 라운드
--    바뀌며(원형법 자체의 성질) 그 라운드엔 해당 여성 테이블에
--    male_application_id = null인 "휴식" 행을 명시적으로 남긴다
--    (event_table_assignments의 두 id 컬럼은 이미 nullable). 동수일 때는
--    기존 공식과 결과가 완전히 동일하다(회귀 없음).
--
--    from_round_number 파라미터를 추가해 그 라운드부터만 (재)생성할 수
--    있게 한다 - 이미 실행된(과거) 라운드의 event_table_assignments/
--    round_ratings는 이 함수가 절대 건드리지 않는다. 계속 참여 중인
--    여성의 테이블 번호는 이미 배정받은 적이 있으면 그 번호를 그대로
--    재사용한다(재계산 때마다 테이블이 바뀌지 않도록).
--
--    참고(알려진 한계): 라운드 중간 이탈 이후의 재계산은 "이전에 이미 만난
--    조합을 피하는 것"까지는 보장하지 않는다(완전히 새로 만난 적 없는
--    상태를 가정한 원형법을 향후 라운드 구간에 다시 적용) - 이미 지난
--    라운드 결과/호감도는 그대로 유지되고, 향후 라운드에서 활성 인원
--    기준으로 공정하게(휴식 순환 포함) 다시 짜인다는 것만 보장한다.

alter table public.applications
  add column if not exists attendance_status text not null default 'active';

alter table public.applications drop constraint if exists applications_attendance_status_check;
alter table public.applications
  add constraint applications_attendance_status_check check (attendance_status in ('active', 'no_show', 'left_early'));

create or replace function public.compute_event_round_plan(event_id_value text)
returns table (active_male_count integer, active_female_count integer, total_rounds integer, active_tables integer)
language sql
stable
set search_path = 'public'
as $$
  with counts as (
    select
      count(*) filter (where a.gender = '남성') as m,
      count(*) filter (where a.gender = '여성') as f
    from public.applications a
    where a.event_id = event_id_value
      and a.status = '참가 확정'
      and a.checked_in_at is not null
      and a.attendance_status = 'active'
  )
  select m::integer, f::integer, greatest(1, greatest(m, f))::integer, greatest(0, least(m, f))::integer
  from counts;
$$;

-- Adding from_round_number as a new trailing default param registers a
-- second overload unless the old 1-arg signature is dropped first (same
-- pitfall as memo_value/hashtags_value additions elsewhere this session).
drop function if exists public.generate_round_schedule_if_missing(text);
drop function if exists public.generate_round_schedule_if_missing(text, integer);

-- max_rounds_value: caps how many rounds get (re)generated starting at
-- from_round_number - used by mid-event regeneration so a dropout never
-- silently extends the event past however many rounds were already
-- planned (see regenerate_round_schedule_from_round). null = uncapped,
-- i.e. use the ideal round count for the current active roster as-is
-- (the normal case: first-ever generation, or a full pre-start redo where
-- there's no existing "planned length" to respect yet).
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

  select * into plan from public.compute_event_round_plan(event_id_value);
  -- ideal_n (= greatest(active_male, active_female)) MUST stay the true
  -- round-robin modulus for the fairness/coverage guarantee to hold - only
  -- round_count (how many of that ideal cycle's rounds we actually write)
  -- gets capped, never the modulus itself. A capped run still produces a
  -- fair PREFIX of the ideal cycle (same modular structure), just without
  -- the full "everyone meets everyone" guarantee if the cap cuts it short.
  ideal_n := plan.total_rounds;
  round_count := ideal_n;
  if max_rounds_value is not null then
    round_count := least(round_count, greatest(0, max_rounds_value));
  end if;
  if plan.active_male_count = 0 or plan.active_female_count = 0 or round_count <= 0 then
    return;
  end if;

  with males as (
    select a.id, row_number() over (order by a.checked_in_at asc nulls last, a.id asc) as rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '남성'
      and a.checked_in_at is not null and a.attendance_status = 'active'
  ),
  females as (
    select
      a.id,
      coalesce(
        (select eta.table_number from public.event_table_assignments eta
         where eta.event_id = event_id_value and not eta.is_bonus and eta.female_application_id = a.id
         order by eta.round_number asc limit 1),
        row_number() over (order by a.checked_in_at asc nulls last, a.id asc)
      ) as rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '여성'
      and a.checked_in_at is not null and a.attendance_status = 'active'
  )
  insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
  select event_id_value, f.rn, from_round_number + r - 1, m.id, f.id
  from generate_series(1, round_count) as r
  cross join females f
  left join males m on m.rn = (((f.rn - 1 + r - 1) % ideal_n) + 1);
end;
$$;

-- 노쇼 확정/복귀/긴급 참가자 승인 등에서 호출하는 실제 진입점 -
-- generate_round_schedule_if_missing 자체는 "이미 있으면 손대지 않는" 멱등
-- 함수라 재계산하려면 먼저 대상 구간을 지워야 한다. max_rounds_value는
-- 그대로 generate_round_schedule_if_missing에 전달된다 - 행사 중간
-- 재계산에서 "원래 계획된 라운드 수를 넘겨서 행사가 길어지지 않도록"
-- 호출부(참가자 상태변경 RPC)가 계산해서 넘긴다.
create or replace function public.regenerate_round_schedule_from_round(
  event_id_value text,
  from_round_number integer,
  max_rounds_value integer default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  delete from public.event_table_assignments
  where event_id = event_id_value and not is_bonus and round_number >= from_round_number;

  perform public.generate_round_schedule_if_missing(event_id_value, from_round_number, max_rounds_value);
end;
$$;

create or replace function public.advance_round_state_if_needed(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
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
  transition_seconds constant integer := 120;
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
  -- 실제로 생성된 스케줄이 있으면 그 마지막 라운드 번호를 우선한다 - 행사
  -- 중간 재계산이 원래 계획된 라운드 수를 넘지 않도록 상한을 뒀을 수
  -- 있어(regenerate_round_schedule_from_round), 활성 인원만으로 다시 계산한
  -- "이상적인" 라운드 수와 실제 생성된 라운드 수가 다를 수 있다.
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
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    if live_elapsed >= transition_seconds then
      bonus_index := target.current_round - total_rounds;
      next_bonus_index := bonus_index + 1;
      if next_bonus_index <= coalesce(target_event.bonus_round_count, 0) then
        update public.event_progress ep
        set stage = 'round_active',
            current_round = target.current_round + 1,
            round_phase = 'conversation',
            round_timer_status = 'running',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      else
        update public.event_progress ep
        set stage = 'final_selection',
            round_timer_status = 'paused',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
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
      else transition_seconds
    end;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    exit when live_elapsed < phase_duration;

    if target.is_bonus_round then
      bonus_index := target.current_round - total_rounds;
      next_bonus_index := bonus_index + 1;
      has_next_bonus := next_bonus_index <= coalesce(target_event.bonus_round_count, 0);
      if has_next_bonus then
        perform public.generate_bonus_round_assignments(event_id_value, target.current_round + 1);
      end if;
      update public.event_progress ep
      set stage = 'bonus_seat_guide',
          round_phase = 'transition',
          round_timer_status = 'running',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
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
    end if;
  end loop;
end;
$$;

-- 추가시간 leftover pairing에도 active 필터 + "이미 여러 번 쉰 사람 우선
-- 배정"을 반영한다. 정확히 매칭된 상호 rating 쌍(compute_mutual_ratings)은
-- 이미 실제로 만난 적 있는(=이미 attendance_status로 걸러진) 사람들
-- 사이에서만 나오므로 그 부분은 그대로 둔다.
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  rec record;
  used_males uuid[] := '{}';
  used_females uuid[] := '{}';
  remaining_males uuid[];
  remaining_females uuid[];
  female_table integer;
  i integer;
begin
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  for rec in
    select c.male_application_id, c.female_application_id
    from public.compute_mutual_ratings(event_id_value) c
    where c.male_to_female_score is not null and c.female_to_male_score is not null
      and not exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number < target_round_number
          and prev.is_bonus
          and prev.male_application_id = c.male_application_id
          and prev.female_application_id = c.female_application_id
      )
    order by (c.male_to_female_score + c.female_to_male_score) desc
  loop
    if not (rec.male_application_id = any(used_males)) and not (rec.female_application_id = any(used_females)) then
      select eta.table_number into female_table
      from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and eta.round_number = total_rounds
        and not eta.is_bonus
        and eta.female_application_id = rec.female_application_id
      limit 1;

      insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
      values (event_id_value, coalesce(female_table, 1), target_round_number, rec.male_application_id, rec.female_application_id, true);
      used_males := used_males || rec.male_application_id;
      used_females := used_females || rec.female_application_id;
    end if;
  end loop;

  select array_agg(a.id order by (
    select count(*) from public.event_table_assignments prev
    where prev.event_id = event_id_value and prev.is_bonus and prev.round_number < target_round_number
      and ((prev.male_application_id = a.id and prev.female_application_id is null))
  ), a.id)
  into remaining_males
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
    and a.attendance_status = 'active' and a.gender = '남성'
    and not (a.id = any(used_males));

  select array_agg(a.id order by (
    select count(*) from public.event_table_assignments prev
    where prev.event_id = event_id_value and prev.is_bonus and prev.round_number < target_round_number
      and ((prev.female_application_id = a.id and prev.male_application_id is null))
  ), a.id)
  into remaining_females
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
    and a.attendance_status = 'active' and a.gender = '여성'
    and not (a.id = any(used_females));

  for i in 1..least(coalesce(array_length(remaining_males, 1), 0), coalesce(array_length(remaining_females, 1), 0)) loop
    select eta.table_number into female_table
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = total_rounds
      and not eta.is_bonus
      and eta.female_application_id = remaining_females[i]
    limit 1;

    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
    values (event_id_value, coalesce(female_table, 1), target_round_number, remaining_males[i], remaining_females[i], true);
  end loop;
end;
$$;

-- regenerate_round_schedule_from_round은 의도적으로 anon/authenticated에
-- grant하지 않는다 - 자체 session_token 검증이 없는 내부 헬퍼라, admin
-- 세션을 검증하는 다른 SECURITY DEFINER 함수(예: 참가자 상태 변경/긴급
-- 참가자 승인 RPC)에서 perform으로만 호출되어야 한다.
