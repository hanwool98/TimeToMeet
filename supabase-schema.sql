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

create table if not exists public.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_type text not null check (account_type in ('member', 'guest')),
  converted_to_member_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guest_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_normalized text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guest_login_attempts (
  phone_hash text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz not null default now()
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
  expires_at timestamptz,
  legal_hold boolean not null default false,
  has_dispute boolean not null default false,
  payment_deadline timestamptz,
  payment_notice_sent_at timestamptz,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists applications_event_user_unique
on public.applications (event_id, user_id);

create table if not exists public.application_drafts (
  event_id text not null references public.events(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  draft_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
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
alter table public.user_accounts enable row level security;
alter table public.guest_accounts enable row level security;
alter table public.guest_login_attempts enable row level security;
alter table public.events enable row level security;
alter table public.applications enable row level security;
alter table public.application_drafts enable row level security;

drop policy if exists "Admins can manage admin users" on public.admin_users;
create policy "Admins can manage admin users"
on public.admin_users
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own account" on public.user_accounts;
create policy "Users can read own account"
on public.user_accounts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can create own account" on public.user_accounts;
create policy "Users can create own account"
on public.user_accounts
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own account without role escalation" on public.user_accounts;
create policy "Users can update own account without role escalation"
on public.user_accounts
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    account_type = 'guest'
    or exists (
      select 1
      from public.user_accounts previous
      where previous.user_id = auth.uid()
        and previous.account_type = 'member'
    )
  )
);

drop policy if exists "Admins can read all accounts" on public.user_accounts;
create policy "Admins can read all accounts"
on public.user_accounts
for select
to authenticated
using (public.is_admin());

drop policy if exists "Guests can read own guest account" on public.guest_accounts;
create policy "Guests can read own guest account"
on public.guest_accounts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Guests can create own guest account" on public.guest_accounts;
create policy "Guests can create own guest account"
on public.guest_accounts
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Guests can update own guest account" on public.guest_accounts;
create policy "Guests can update own guest account"
on public.guest_accounts
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Admins can read guest accounts" on public.guest_accounts;
create policy "Admins can read guest accounts"
on public.guest_accounts
for select
to authenticated
using (public.is_admin());

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

drop policy if exists "Users can manage own application drafts" on public.application_drafts;
create policy "Users can manage own application drafts"
on public.application_drafts
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Admins can read all application drafts" on public.application_drafts;
create policy "Admins can read all application drafts"
on public.application_drafts
for select
to authenticated
using (public.is_admin());

drop trigger if exists touch_application_drafts_updated_at on public.application_drafts;
create trigger touch_application_drafts_updated_at
before update on public.application_drafts
for each row execute function public.touch_updated_at();

create or replace function public.set_application_expiry()
returns trigger
language plpgsql
as $$
declare
  event_day date;
begin
  select event_date into event_day
  from public.events
  where id = new.event_id;

  if event_day is not null and new.expires_at is null then
    new.expires_at = (event_day::timestamptz + interval '31 days');
  end if;

  return new;
end;
$$;

drop trigger if exists set_application_expiry_before_insert on public.applications;
create trigger set_application_expiry_before_insert
before insert on public.applications
for each row execute function public.set_application_expiry();

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

create or replace function public.guest_phone_hash(phone_value text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(digest(phone_value, 'sha256'), 'hex');
$$;

create or replace function public.can_attempt_guest_login(phone_value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.guest_login_attempts
    where phone_hash = public.guest_phone_hash(phone_value)
      and locked_until is not null
      and locked_until > now()
  );
$$;

create or replace function public.record_guest_login_failure(phone_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_failed_count integer;
  next_locked_until timestamptz;
  hashed_phone text := public.guest_phone_hash(phone_value);
begin
  insert into public.guest_login_attempts (phone_hash, failed_count, last_failed_at)
  values (hashed_phone, 1, now())
  on conflict (phone_hash) do update set
    failed_count = case
      when public.guest_login_attempts.locked_until is not null
        and public.guest_login_attempts.locked_until > now()
      then public.guest_login_attempts.failed_count
      when public.guest_login_attempts.last_failed_at < now() - interval '30 minutes'
      then 1
      else public.guest_login_attempts.failed_count + 1
    end,
    last_failed_at = now();

  select failed_count into next_failed_count
  from public.guest_login_attempts
  where phone_hash = hashed_phone;

  if next_failed_count >= 5 then
    next_locked_until := now() + interval '15 minutes';
    update public.guest_login_attempts
    set locked_until = next_locked_until
    where phone_hash = hashed_phone;
  end if;
end;
$$;

create or replace function public.clear_guest_login_failures(phone_value text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.guest_login_attempts
  where phone_hash = public.guest_phone_hash(phone_value);
$$;

grant execute on function public.can_attempt_guest_login(text) to anon, authenticated;
grant execute on function public.record_guest_login_failure(text) to anon, authenticated;
grant execute on function public.clear_guest_login_failures(text) to anon, authenticated;

create or replace function public.get_admin_applications()
returns table (
  id uuid,
  application_no text,
  event_id text,
  user_id uuid,
  user_display_id text,
  account_type text,
  returning boolean,
  status public.application_status,
  is_new boolean,
  name text,
  birth_date date,
  gender text,
  residence text,
  phone text,
  relationship_status text,
  id_photo_path text,
  nickname text,
  profile_photo_paths text[],
  representative_photo_index integer,
  representative_crop jsonb,
  voice_intro_path text,
  height text,
  job text,
  employment_proof_path text,
  access_route text,
  filming_consent boolean,
  interview_consent text,
  refund_agreement boolean,
  inquiry text,
  review_notice_confirmed boolean,
  payment_deadline timestamptz,
  payment_notice_sent_at timestamptz,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  event_date date,
  short_name text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    a.id,
    a.application_no,
    a.event_id,
    a.user_id,
    case
      when coalesce(ua.account_type, 'member') = 'guest' and ga.phone_normalized is not null then
        '비회원 ' || substring(ga.phone_normalized from char_length(ga.phone_normalized) - 7 for 4)
        || '-' ||
        substring(ga.phone_normalized from char_length(ga.phone_normalized) - 3 for 4)
      else
        coalesce(u.email, a.nickname)
    end as user_display_id,
    coalesce(ua.account_type, 'member') as account_type,
    a.returning,
    a.status,
    a.is_new,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    a.phone,
    a.relationship_status,
    a.id_photo_path,
    a.nickname,
    a.profile_photo_paths,
    a.representative_photo_index,
    a.representative_crop,
    a.voice_intro_path,
    a.height,
    a.job,
    a.employment_proof_path,
    a.access_route,
    a.filming_consent,
    a.interview_consent,
    a.refund_agreement,
    a.inquiry,
    a.review_notice_confirmed,
    a.payment_deadline,
    a.payment_notice_sent_at,
    a.reviewed_at,
    a.submitted_at,
    e.event_date,
    e.short_name
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join auth.users u on u.id = a.user_id
  where public.is_admin();
$$;

grant execute on function public.get_admin_applications() to authenticated;

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
    a.id::text as id,
    a.gender,
    a.nickname,
    extract(year from age(e.event_date, a.birth_date))::integer as age,
    a.job,
    (row_number() over (partition by a.gender order by a.reviewed_at nulls last, a.submitted_at) - 1)::integer as avatar_index
  from public.applications a
  join public.events e on e.id = a.event_id
  where a.event_id = target_event_id
    and a.status = '참가 확정'
  order by a.gender, a.reviewed_at nulls last, a.submitted_at;
$$;

grant execute on function public.get_public_participant_previews(text) to anon, authenticated;

create or replace function public.get_guest_cleanup_candidates()
returns table (
  user_id uuid,
  delete_after timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ua.user_id,
    max(a.expires_at) as delete_after
  from public.user_accounts ua
  join public.applications a on a.user_id = ua.user_id
  where ua.account_type = 'guest'
    and ua.converted_to_member_at is null
    and a.expires_at < now()
    and a.status not in ('심사 대기', '결제 대기', '참가 확정', '참여 보류')
    and a.legal_hold = false
    and a.has_dispute = false
  group by ua.user_id
  having bool_and(a.expires_at < now())
     and bool_and(a.legal_hold = false)
     and bool_and(a.has_dispute = false);
$$;

grant execute on function public.get_guest_cleanup_candidates() to authenticated;

create or replace function public.cleanup_guest_profile_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can run cleanup.';
  end if;

  update public.applications
  set
    name = '삭제된 비회원',
    residence = '',
    phone = '',
    relationship_status = '',
    id_photo_path = null,
    nickname = '삭제된 프로필',
    profile_photo_paths = '{}',
    representative_crop = '{}',
    voice_intro_path = null,
    height = '',
    job = '',
    employment_proof_path = null,
    access_route = '',
    inquiry = '',
    consents = '{}',
    updated_at = now()
  where user_id = target_user_id
    and expires_at < now()
    and legal_hold = false
    and has_dispute = false;
end;
$$;

grant execute on function public.cleanup_guest_profile_data(uuid) to authenticated;

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
