-- 운영자가 행사 시작 직전에 현재 자리배치를 확인/수정할 수 있는 기능.
--
-- 핵심 원칙: "체크인 -> 자리 없음 -> 운영자 확정 -> 자리 생성" 구조로
-- 바꾸지 않는다. 참가자는 체크인 즉시(운영자 개입 없이) 자신의 테이블을
-- 안내받아야 하므로, event_preround_seats는 참가 확정된 전원(체크인
-- 여부 무관, 신청번호 순)을 기준으로 즉시 생성되는 "기본 배치"이고,
-- 운영자는 이 위에서 참여취소/지각 표시/직접 이동만 편집한다.
--
-- 자리유도(get_event_table_seat_guide_by_roster)는 이제 이 테이블을 그대로
-- 읽고, 1라운드 생성(generate_round_schedule_if_missing)도 1라운드에
-- 한해서 이 테이블을 그대로 복사해 쓰므로, 자리유도 화면 - 운영자 확인
-- 화면 - 실제 1라운드가 항상 같은 데이터를 본다.

create table if not exists public.event_preround_seats (
  event_id text not null references public.events(id) on delete cascade,
  table_number integer not null,
  male_application_id uuid references public.applications(id) on delete set null,
  female_application_id uuid references public.applications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, table_number)
);

alter table public.event_preround_seats enable row level security;

drop policy if exists "No direct preround seat access" on public.event_preround_seats;
create policy "No direct preround seat access"
on public.event_preround_seats
for all
using (false)
with check (false);

-- 지각(아직 도착 전이지만 참여 예정)을 표시해두는 순수 안내용 플래그.
-- 계산 로직에는 전혀 영향을 주지 않는다(지각 여부와 무관하게 자리는
-- 항상 유지됨) - 운영자가 현황을 한눈에 보기 위한 용도.
alter table public.applications add column if not exists is_marked_late boolean not null default false;

-- 참가 확정된 전원(신청번호 순, 체크인 여부 무관)으로 기본 배치를
-- 만든다. 이미 생성된 적이 있으면 그대로 둔다(운영자가 이미 편집한
-- 내용을 덮어쓰지 않기 위함).
create or replace function public.ensure_preround_seats_for_event(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if exists (select 1 from public.event_preround_seats where event_id = event_id_value) then
    return;
  end if;

  with males as (
    select id, row_number() over (order by application_no asc) as rn
    from public.applications
    where event_id = event_id_value and status = '참가 확정' and gender = '남성'
  ),
  females as (
    select id, row_number() over (order by application_no asc) as rn
    from public.applications
    where event_id = event_id_value and status = '참가 확정' and gender = '여성'
  ),
  table_numbers as (
    select generate_series(1, greatest(
      coalesce((select max(rn) from males), 0),
      coalesce((select max(rn) from females), 0)
    )) as table_number
  )
  insert into public.event_preround_seats (event_id, table_number, male_application_id, female_application_id)
  select event_id_value, tn.table_number, m.id, f.id
  from table_numbers tn
  left join males m on m.rn = tn.table_number
  left join females f on f.rn = tn.table_number
  where tn.table_number > 0;
end;
$$;

-- 현재 event_preround_seats 내용을 "각 성별 안에서 테이블 번호 순서를
-- 유지한 채" 빈 칸 없이 다시 채운다(운영자 참여취소로 뚫린 구멍을
-- 메움). 순서만 재배치할 뿐 어떤 사람도 새로 넣거나 빼지 않는다.
create or replace function public.densify_preround_seats_for_event(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  create temporary table tmp_preround_densify on commit drop as
  with current_males as (
    select male_application_id as id, table_number
    from public.event_preround_seats
    where event_id = event_id_value and male_application_id is not null
  ),
  current_females as (
    select female_application_id as id, table_number
    from public.event_preround_seats
    where event_id = event_id_value and female_application_id is not null
  ),
  males_ordered as (
    select id, row_number() over (order by table_number asc) as rn from current_males
  ),
  females_ordered as (
    select id, row_number() over (order by table_number asc) as rn from current_females
  ),
  table_numbers as (
    select generate_series(1, greatest(
      coalesce((select max(rn) from males_ordered), 0),
      coalesce((select max(rn) from females_ordered), 0)
    )) as table_number
  )
  select tn.table_number, m.id as male_application_id, f.id as female_application_id
  from table_numbers tn
  left join males_ordered m on m.rn = tn.table_number
  left join females_ordered f on f.rn = tn.table_number
  where tn.table_number > 0;

  delete from public.event_preround_seats where event_id = event_id_value;

  insert into public.event_preround_seats (event_id, table_number, male_application_id, female_application_id)
  select event_id_value, table_number, male_application_id, female_application_id from tmp_preround_densify;

  drop table tmp_preround_densify;
end;
$$;

-- 참여취소(attendance_status <> 'active') 처리된 사람을 자리에서 비우고
-- 압축하며, 반대로 복귀 처리(다시 active)된 사람 중 아직 자리가 없는
-- 사람은 끝에 새로 추가한다. set_participant_attendance_status_for_session이
-- "아직 1라운드가 생성되기 전" 상태에서 호출한다.
create or replace function public.rebuild_preround_seats_for_event(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  perform public.ensure_preround_seats_for_event(event_id_value);

  update public.event_preround_seats s
  set male_application_id = null, updated_at = now()
  from public.applications a
  where a.id = s.male_application_id and s.event_id = event_id_value and a.attendance_status <> 'active';

  update public.event_preround_seats s
  set female_application_id = null, updated_at = now()
  from public.applications a
  where a.id = s.female_application_id and s.event_id = event_id_value and a.attendance_status <> 'active';

  insert into public.event_preround_seats (event_id, table_number, male_application_id, female_application_id)
  select
    event_id_value,
    (select coalesce(max(table_number), 0) from public.event_preround_seats where event_id = event_id_value)
      + row_number() over (order by combined.gender, combined.application_no),
    case when combined.gender = '남성' then combined.id else null end,
    case when combined.gender = '여성' then combined.id else null end
  from (
    select a.id, a.gender, a.application_no
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.attendance_status = 'active' and a.gender = '남성'
      and not exists (select 1 from public.event_preround_seats s where s.event_id = event_id_value and s.male_application_id = a.id)
    union all
    select a.id, a.gender, a.application_no
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.attendance_status = 'active' and a.gender = '여성'
      and not exists (select 1 from public.event_preround_seats s where s.event_id = event_id_value and s.female_application_id = a.id)
  ) combined;

  perform public.densify_preround_seats_for_event(event_id_value);
end;
$$;

-- 운영자 "자리배치 확인" 화면 조회.
create or replace function public.get_admin_preround_seat_plan_for_session(session_token text, event_id_value text)
returns table (
  table_number integer,
  male_application_id uuid,
  male_nickname text,
  male_checked_in boolean,
  male_attendance_status text,
  male_is_late boolean,
  female_application_id uuid,
  female_nickname text,
  female_checked_in boolean,
  female_attendance_status text,
  female_is_late boolean,
  round_one_started boolean
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.ensure_preround_seats_for_event(event_id_value);

  return query
  select
    s.table_number,
    ma.id, ma.nickname, ma.checked_in_at is not null, ma.attendance_status, ma.is_marked_late,
    fa.id, fa.nickname, fa.checked_in_at is not null, fa.attendance_status, fa.is_marked_late,
    exists (
      select 1 from public.event_table_assignments
      where event_id = event_id_value and not is_bonus and round_number = 1
    )
  from public.event_preround_seats s
  left join public.applications ma on ma.id = s.male_application_id
  left join public.applications fa on fa.id = s.female_application_id
  where s.event_id = event_id_value
  order by s.table_number asc;
end;
$$;

-- 지각 표시만 토글(계산 로직에는 영향 없음, 순수 운영자 안내용).
create or replace function public.set_preround_late_flag_for_session(session_token text, application_id_value uuid, is_late_value boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_application public.applications%rowtype;
  round_one_started boolean;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_application from public.applications where id = application_id_value;
  if not found or target_application.status <> '참가 확정' then
    raise exception '참가 확정 상태의 참가자만 대상이 될 수 있습니다.';
  end if;

  select exists (
    select 1 from public.event_table_assignments
    where event_id = target_application.event_id and not is_bonus and round_number = 1
  ) into round_one_started;
  if round_one_started then
    raise exception '이미 1라운드가 시작되어 상태를 변경할 수 없습니다.';
  end if;

  update public.applications set is_marked_late = is_late_value where id = application_id_value;
end;
$$;

-- 운영자가 두 참가자(또는 참가자와 빈 자리)의 테이블을 서로 바꾼다.
create or replace function public.move_preround_seat_for_session(session_token text, event_id_value text, application_id_value uuid, target_table_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_application public.applications%rowtype;
  round_one_started boolean;
  source_table integer;
  other_at_target uuid;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_application from public.applications where id = application_id_value and event_id = event_id_value;
  if not found then
    raise exception '참가자를 찾을 수 없습니다.';
  end if;

  select exists (
    select 1 from public.event_table_assignments where event_id = event_id_value and not is_bonus and round_number = 1
  ) into round_one_started;
  if round_one_started then
    raise exception '이미 1라운드가 시작되어 자리를 수정할 수 없습니다.';
  end if;

  perform public.ensure_preround_seats_for_event(event_id_value);

  if not exists (select 1 from public.event_preround_seats where event_id = event_id_value and table_number = target_table_number) then
    raise exception '존재하지 않는 테이블입니다.';
  end if;

  if target_application.gender = '남성' then
    select table_number into source_table from public.event_preround_seats
    where event_id = event_id_value and male_application_id = application_id_value;

    select male_application_id into other_at_target from public.event_preround_seats
    where event_id = event_id_value and table_number = target_table_number;

    if source_table is null then
      update public.event_preround_seats set male_application_id = application_id_value, updated_at = now()
      where event_id = event_id_value and table_number = target_table_number;
    elsif source_table <> target_table_number then
      update public.event_preround_seats set male_application_id = other_at_target, updated_at = now()
      where event_id = event_id_value and table_number = source_table;
      update public.event_preround_seats set male_application_id = application_id_value, updated_at = now()
      where event_id = event_id_value and table_number = target_table_number;
    end if;
  else
    select table_number into source_table from public.event_preround_seats
    where event_id = event_id_value and female_application_id = application_id_value;

    select female_application_id into other_at_target from public.event_preround_seats
    where event_id = event_id_value and table_number = target_table_number;

    if source_table is null then
      update public.event_preround_seats set female_application_id = application_id_value, updated_at = now()
      where event_id = event_id_value and table_number = target_table_number;
    elsif source_table <> target_table_number then
      update public.event_preround_seats set female_application_id = other_at_target, updated_at = now()
      where event_id = event_id_value and table_number = source_table;
      update public.event_preround_seats set female_application_id = application_id_value, updated_at = now()
      where event_id = event_id_value and table_number = target_table_number;
    end if;
  end if;

  perform public.densify_preround_seats_for_event(event_id_value);
end;
$$;

-- 체크인 즉시 기본 배치가 존재하도록 보장(참가자 본인의 자리가 이미
-- 있어야 자리유도가 바로 보인다).
create or replace function public.finalize_application_check_in(admin_user_id uuid, target_application_id uuid)
 returns table (checked_in_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  result_checked_in_at timestamptz;
  target_event_id text;
  already_scheduled boolean;
  boundary_round integer;
  original_last_round integer;
  max_rounds_value integer;
begin
  update public.application_tickets t
  set checked_in_at = coalesce(t.checked_in_at, now()),
      checked_in_by = coalesce(t.checked_in_by, admin_user_id),
      updated_at = now()
  where t.application_id = target_application_id
  returning t.checked_in_at into result_checked_in_at;

  update public.applications a
  set checked_in_at = result_checked_in_at,
      checked_in_by = coalesce(a.checked_in_by, admin_user_id),
      updated_at = now()
  where a.id = target_application_id
  returning a.event_id into target_event_id;

  perform public.ensure_preround_seats_for_event(target_event_id);

  select exists (
    select 1 from public.event_table_assignments where event_id = target_event_id and not is_bonus
  ) into already_scheduled;

  if already_scheduled then
    select coalesce(ep.current_round, 0) + 1 into boundary_round
    from public.event_progress ep where ep.event_id = target_event_id;
    boundary_round := coalesce(boundary_round, 1);

    if not exists (
      select 1 from public.event_table_assignments
      where event_id = target_event_id and not is_bonus and round_number >= boundary_round
        and (male_application_id = target_application_id or female_application_id = target_application_id)
    ) then
      select max(round_number) into original_last_round
      from public.event_table_assignments where event_id = target_event_id and not is_bonus;

      if original_last_round is not null then
        max_rounds_value := greatest(0, original_last_round - boundary_round + 1);
      else
        max_rounds_value := null;
      end if;

      perform public.regenerate_round_schedule_from_round(target_event_id, boundary_round, max_rounds_value);
    end if;
  end if;

  return query select result_checked_in_at;
end;
$function$;

-- 참여취소(no_show)/복귀(active) 처리: 1라운드가 아직 생성되기 전이면
-- (행사 시작 전) 기존처럼 곧장 실제 라운드를 만드는 대신, 자리배치
-- 초안(event_preround_seats)을 압축/보정한다. 1라운드가 이미 시작된
-- 뒤의 동작(중도 이탈 등)은 그대로 둔다.
create or replace function public.set_participant_attendance_status_for_session(session_token text, application_id_value uuid, status_value text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  has_existing_schedule boolean;
  boundary_round integer;
  original_last_round integer;
  max_rounds_value integer;
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
end;
$function$;

-- 자리유도: 이제 event_preround_seats를 그대로 읽는다(직접 계산하지
-- 않음) - 운영자가 이 화면에서 확인/수정하는 내용과 완전히 같은
-- 데이터를 보여주기 위함.
create or replace function public.get_event_table_seat_guide_by_roster(event_id_value text, table_number_value integer, connection_token text)
 returns table(ok boolean, male_nickname text, female_nickname text, male_checked_in boolean, female_checked_in boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  target public.event_tablets%rowtype;
  seat public.event_preround_seats%rowtype;
  male_nickname_value text;
  female_nickname_value text;
  male_checked_in_value boolean;
  female_checked_in_value boolean;
begin
  select et.* into target
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::text, null::text, null::boolean, null::boolean;
    return;
  end if;

  update public.event_tablets et
  set last_seen_at = now(), updated_at = now()
  where et.id = target.id;

  perform public.ensure_preround_seats_for_event(event_id_value);

  select * into seat
  from public.event_preround_seats
  where event_id = event_id_value and table_number = table_number_value;

  select a.nickname, a.checked_in_at is not null into male_nickname_value, male_checked_in_value
  from public.applications a where a.id = seat.male_application_id;

  select a.nickname, a.checked_in_at is not null into female_nickname_value, female_checked_in_value
  from public.applications a where a.id = seat.female_application_id;

  return query
  select
    true,
    case when male_checked_in_value then male_nickname_value else null end,
    case when female_checked_in_value then female_nickname_value else null end,
    coalesce(male_checked_in_value, false),
    coalesce(female_checked_in_value, false);
end;
$function$;

-- 1라운드 생성: 운영자가 확정한 event_preround_seats를 그대로 복사해
-- 쓴다(체크인 순서로 다시 계산하지 않음). 2라운드 이후(지각 합류 등,
-- from_round_number > 1)는 기존 로직을 그대로 둔다.
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

    -- 지각(아직 체크인 전) 참가자는 자리 자체는 draft에 예약돼 있지만,
    -- "행사 시작 시 해당 자리는 빈자리"이어야 하므로 실제 1라운드에는
    -- 체크인을 마친 사람만 채워 넣는다 - 체크인하지 않은 쪽은 자연히
    -- null(성비 불균형과 동일한 방식으로 화면에 "자리 배정 대기"로 표시).
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
