create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_status') then
    create type public.application_status as enum (
      '심사 대기',
      '결제 대기',
      '참가 확정',
      '반려',
      '참여 보류',
      '환불 완료',
      '자동 취소'
    );
  end if;
end $$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key,
  title text not null,
  short_name text not null,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  location text not null,
  venue_booked boolean not null default false,
  male_capacity integer not null default 10,
  female_capacity integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.application_no_seq start 1;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  application_no text not null unique default ('TTM_' || lpad(nextval('public.application_no_seq')::text, 3, '0')),
  event_id text not null references public.events(id) on delete restrict,
  user_id uuid not null default auth.uid(),
  applicant_kind text not null default 'guest',
  returning boolean not null default false,
  status public.application_status not null default '심사 대기',
  is_new boolean not null default true,
  name text not null,
  birth_date date not null,
  gender text not null check (gender in ('남성', '여성')),
  residence text not null,
  phone text not null,
  relationship_status text not null,
  id_photo_path text,
  nickname text not null,
  profile_photo_paths text[] not null default '{}',
  representative_photo_index integer not null default 0,
  representative_crop jsonb not null default '{}'::jsonb,
  voice_intro_path text,
  height text not null,
  job text not null,
  employment_proof_path text,
  access_route text not null,
  filming_consent boolean not null default false,
  interview_consent text not null,
  refund_agreement boolean not null default false,
  inquiry text not null default '',
  review_notice_confirmed boolean not null default false,
  consents jsonb not null default '{}'::jsonb,
  payment_deadline timestamptz,
  payment_notice_sent_at timestamptz,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_events_updated_at on public.events;
create trigger touch_events_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

drop trigger if exists touch_applications_updated_at on public.applications;
create trigger touch_applications_updated_at
before update on public.applications
for each row execute function public.touch_updated_at();

alter table public.admin_users enable row level security;
alter table public.events enable row level security;
alter table public.applications enable row level security;

drop policy if exists "Admins can manage admin users" on public.admin_users;
create policy "Admins can manage admin users"
on public.admin_users
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read public events" on public.events;
create policy "Anyone can read public events"
on public.events
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage events" on public.events;
create policy "Admins can manage events"
on public.events
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Applicants can create own applications" on public.applications;
create policy "Applicants can create own applications"
on public.applications
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Applicants can read own applications" on public.applications;
create policy "Applicants can read own applications"
on public.applications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins can read all applications" on public.applications;
create policy "Admins can read all applications"
on public.applications
for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can review all applications" on public.applications;
create policy "Admins can review all applications"
on public.applications
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.events (
  id,
  title,
  short_name,
  event_date,
  start_time,
  end_time,
  location,
  venue_booked,
  male_capacity,
  female_capacity
)
values (
  'seongnam-rotation-2026-08-16',
  '성남 로테이션 소개팅',
  '로테이션',
  '2026-08-16',
  '15:00',
  '18:00',
  '성남',
  false,
  10,
  10
)
on conflict (id) do update set
  title = excluded.title,
  short_name = excluded.short_name,
  event_date = excluded.event_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  location = excluded.location,
  venue_booked = excluded.venue_booked,
  male_capacity = excluded.male_capacity,
  female_capacity = excluded.female_capacity;

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
    count(a.id) filter (where a.status = '참가 확정')::integer as current_participants,
    (e.male_capacity + e.female_capacity)::integer as target_participants,
    count(a.id) filter (where a.gender = '남성')::integer as male_applications,
    count(a.id) filter (where a.gender = '여성')::integer as female_applications,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer as male_confirmed,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer as female_confirmed
  from public.events e
  left join public.applications a on a.event_id = e.id
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('application-files', 'application-files', false)
on conflict (id) do nothing;

drop policy if exists "Applicants can upload own private files" on storage.objects;
create policy "Applicants can upload own private files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'application-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Applicants can read own private files" on storage.objects;
create policy "Applicants can read own private files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'application-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "Admins can manage private application files" on storage.objects;
create policy "Admins can manage private application files"
on storage.objects
for all
to authenticated
using (bucket_id = 'application-files' and public.is_admin())
with check (bucket_id = 'application-files' and public.is_admin());

do $$
begin
  alter publication supabase_realtime add table public.events;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.applications;
exception
  when duplicate_object then null;
end $$;
