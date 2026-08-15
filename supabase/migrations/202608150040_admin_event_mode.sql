create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.events
add column if not exists is_test_event boolean not null default false,
add column if not exists table_count integer not null default 10;

create index if not exists events_event_date_start_time_idx
on public.events (event_date, start_time);

create index if not exists events_is_test_event_idx
on public.events (is_test_event);

create table if not exists public.event_tablets (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  table_number integer not null,
  device_label text,
  connection_status text not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_tablets_status_check check (connection_status in ('online', 'offline')),
  constraint event_tablets_table_number_check check (table_number > 0),
  constraint event_tablets_event_table_unique unique (event_id, table_number)
);

create index if not exists event_tablets_event_idx
on public.event_tablets (event_id);

create table if not exists public.event_table_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  table_number integer not null,
  male_application_id uuid references public.applications(id) on delete set null,
  female_application_id uuid references public.applications(id) on delete set null,
  round_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_table_assignments_table_number_check check (table_number > 0),
  constraint event_table_assignments_round_table_unique unique (event_id, round_number, table_number)
);

create index if not exists event_table_assignments_event_idx
on public.event_table_assignments (event_id, round_number, table_number);

drop trigger if exists touch_event_tablets_updated_at on public.event_tablets;
create trigger touch_event_tablets_updated_at
before update on public.event_tablets
for each row execute function public.touch_updated_at();

drop trigger if exists touch_event_table_assignments_updated_at on public.event_table_assignments;
create trigger touch_event_table_assignments_updated_at
before update on public.event_table_assignments
for each row execute function public.touch_updated_at();

alter table public.event_tablets enable row level security;
alter table public.event_table_assignments enable row level security;

drop policy if exists "Admins can manage event tablets" on public.event_tablets;
create policy "Admins can manage event tablets"
on public.event_tablets
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage event table assignments" on public.event_table_assignments;
create policy "Admins can manage event table assignments"
on public.event_table_assignments
for all
using (public.is_admin())
with check (public.is_admin());

drop function if exists public.get_public_event_summaries();
create or replace function public.get_public_event_summaries()
returns table (
  id text,
  title text,
  short_name text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  venue_booked boolean,
  male_price integer,
  female_price integer,
  current_participants integer,
  target_participants integer,
  male_applications integer,
  female_applications integer,
  male_confirmed integer,
  female_confirmed integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.short_name,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    e.venue_booked,
    e.male_price,
    e.female_price,
    count(a.id) filter (where a.status = '참가 확정')::integer as current_participants,
    (e.male_capacity + e.female_capacity)::integer as target_participants,
    count(a.id) filter (where a.gender = '남성')::integer as male_applications,
    count(a.id) filter (where a.gender = '여성')::integer as female_applications,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer as male_confirmed,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer as female_confirmed
  from public.events e
  left join public.applications a on a.event_id = e.id
  where e.is_test_event = false
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

drop function if exists public.get_public_participant_previews(text);
create or replace function public.get_public_participant_previews(target_event_id text)
returns table (
  id text,
  gender text,
  nickname text,
  age integer,
  job text,
  avatar_index integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id::text,
    a.gender,
    a.nickname,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer as age,
    a.job,
    (((row_number() over (partition by a.gender order by a.submitted_at asc, a.id asc)) - 1) % 6 + 1)::integer as avatar_index
  from public.applications a
  join public.events e on e.id = a.event_id
  where a.event_id = target_event_id
    and e.is_test_event = false
    and a.status = '참가 확정'
  order by a.gender, a.submitted_at asc, a.id asc;
$$;

grant execute on function public.get_public_participant_previews(text) to anon, authenticated;

drop function if exists public.get_admin_event_mode_summaries(text);
create or replace function public.get_admin_event_mode_summaries(session_token text)
returns table (
  id text,
  title text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  confirmed_count integer,
  checkin_count integer,
  tablet_count integer,
  required_tablets integer,
  is_test_event boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    e.id,
    e.title,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    count(distinct a.id) filter (where a.status = '참가 확정')::integer as confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as checkin_count,
    count(distinct et.id) filter (
      where et.connection_status = 'online'
        and et.last_seen_at is not null
        and et.last_seen_at > now() - interval '90 seconds'
    )::integer as tablet_count,
    e.table_count::integer as required_tablets,
    e.is_test_event
  from public.events e
  left join public.applications a on a.event_id = e.id
  left join public.application_tickets t on t.application_id = a.id
  left join public.event_tablets et on et.event_id = e.id
  where (e.event_date + e.end_time) >= ((now() at time zone 'Asia/Seoul')::timestamp)
  group by e.id
  order by e.event_date asc, e.start_time asc;
end;
$$;

grant execute on function public.get_admin_event_mode_summaries(text) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.event_tablets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
declare
  today_date date := (now() at time zone 'Asia/Seoul')::date;
  event_id_value text := 'admin-event-mode-test-' || to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
  male_user_id uuid;
  female_user_id uuid;
  male_application_id uuid;
  female_application_id uuid;
  i integer;
begin
  insert into public.events (
    id,
    title,
    short_name,
    event_date,
    start_time,
    end_time,
    location,
    male_price,
    female_price,
    venue_booked,
    male_capacity,
    female_capacity,
    table_count,
    is_test_event
  )
  values (
    event_id_value,
    '행사모드 기능 테스트',
    '로테이션',
    today_date,
    '15:00'::time,
    '18:00'::time,
    '테스트 장소',
    50000,
    40000,
    true,
    10,
    10,
    10,
    true
  )
  on conflict (id) do update set
    title = excluded.title,
    short_name = excluded.short_name,
    event_date = excluded.event_date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    location = excluded.location,
    male_capacity = excluded.male_capacity,
    female_capacity = excluded.female_capacity,
    table_count = excluded.table_count,
    is_test_event = true,
    updated_at = now();

  for i in 1..10 loop
    male_user_id := ('00000000-0000-4000-8000-0000000823' || lpad(i::text, 2, '0'))::uuid;
    female_user_id := ('00000000-0000-4000-8000-0000000824' || lpad(i::text, 2, '0'))::uuid;
    male_application_id := ('00000000-0000-4000-9000-0000000823' || lpad(i::text, 2, '0'))::uuid;
    female_application_id := ('00000000-0000-4000-9000-0000000824' || lpad(i::text, 2, '0'))::uuid;

    insert into public.app_users (user_id, account_type)
    values (male_user_id, 'guest'), (female_user_id, 'guest')
    on conflict (user_id) do update set account_type = excluded.account_type, updated_at = now();

    begin
      insert into public.user_accounts (user_id, account_type)
      values (male_user_id, 'guest'), (female_user_id, 'guest')
      on conflict (user_id) do update set account_type = excluded.account_type, updated_at = now();
    exception
      when foreign_key_violation then null;
      when undefined_table then null;
    end;

    insert into public.applications (
      id,
      event_id,
      user_id,
      applicant_kind,
      is_returning,
      status,
      is_new,
      name,
      birth_date,
      gender,
      residence,
      phone,
      relationship_status,
      nickname,
      profile_photo_paths,
      representative_photo_index,
      height,
      job,
      access_route,
      filming_consent,
      interview_consent,
      refund_agreement,
      inquiry,
      review_notice_confirmed,
      payment_deadline,
      payment_notice_sent_at,
      payment_completed_at,
      submitted_at
    )
    values (
      male_application_id,
      event_id_value,
      male_user_id,
      'guest',
      false,
      '참가 확정',
      false,
      '테스트 남성 ' || i,
      '1998-06-18'::date,
      '남성',
      '테스트 지역',
      '0100000' || lpad(i::text, 4, '0'),
      '미혼이며 교제하는 인원이 없습니다.',
      '남자 ' || i || '번',
      array[]::text[],
      0,
      '174',
      '테스터',
      '테스트',
      true,
      '미참여',
      true,
      '',
      true,
      now() + interval '24 hours',
      now(),
      now(),
      now()
    )
    on conflict (id) do update set
      status = '참가 확정',
      event_id = excluded.event_id,
      user_id = excluded.user_id,
      gender = excluded.gender,
      nickname = excluded.nickname,
      payment_completed_at = coalesce(public.applications.payment_completed_at, now()),
      updated_at = now();

    insert into public.applications (
      id,
      event_id,
      user_id,
      applicant_kind,
      is_returning,
      status,
      is_new,
      name,
      birth_date,
      gender,
      residence,
      phone,
      relationship_status,
      nickname,
      profile_photo_paths,
      representative_photo_index,
      height,
      job,
      access_route,
      filming_consent,
      interview_consent,
      refund_agreement,
      inquiry,
      review_notice_confirmed,
      payment_deadline,
      payment_notice_sent_at,
      payment_completed_at,
      submitted_at
    )
    values (
      female_application_id,
      event_id_value,
      female_user_id,
      'guest',
      false,
      '참가 확정',
      false,
      '테스트 여성 ' || i,
      '1998-06-18'::date,
      '여성',
      '테스트 지역',
      '0101000' || lpad(i::text, 4, '0'),
      '미혼이며 교제하는 인원이 없습니다.',
      '여자 ' || i || '번',
      array[]::text[],
      0,
      '164',
      '테스터',
      '테스트',
      true,
      '미참여',
      true,
      '',
      true,
      now() + interval '24 hours',
      now(),
      now(),
      now()
    )
    on conflict (id) do update set
      status = '참가 확정',
      event_id = excluded.event_id,
      user_id = excluded.user_id,
      gender = excluded.gender,
      nickname = excluded.nickname,
      payment_completed_at = coalesce(public.applications.payment_completed_at, now()),
      updated_at = now();

    insert into public.application_tickets (application_id, user_id, event_id)
    values
      (male_application_id, male_user_id, event_id_value),
      (female_application_id, female_user_id, event_id_value)
    on conflict (application_id) do update set
      event_id = excluded.event_id,
      user_id = excluded.user_id,
      revoked_at = null,
      checked_in_at = null,
      checked_in_by = null,
      updated_at = now();

    insert into public.event_tablets (
      event_id,
      table_number,
      device_label,
      connection_status,
      last_seen_at
    )
    values (
      event_id_value,
      i,
      i || '번 테이블',
      'offline',
      null
    )
    on conflict (event_id, table_number) do update set
      device_label = excluded.device_label,
      connection_status = 'offline',
      last_seen_at = null,
      updated_at = now();

    insert into public.event_table_assignments (
      event_id,
      table_number,
      male_application_id,
      female_application_id,
      round_number
    )
    values (
      event_id_value,
      i,
      male_application_id,
      female_application_id,
      1
    )
    on conflict (event_id, round_number, table_number) do update set
      male_application_id = excluded.male_application_id,
      female_application_id = excluded.female_application_id,
      updated_at = now();
  end loop;
end $$;

notify pgrst, 'reload schema';
