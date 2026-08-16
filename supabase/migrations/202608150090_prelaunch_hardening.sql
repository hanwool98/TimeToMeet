-- Pre-launch hardening for guest-only test operations.
-- This migration is intentionally additive and safe to run after 202608150080.

-- 1) Event operational fields -------------------------------------------------
alter table public.events
add column if not exists application_deadline timestamptz,
add column if not exists venue_detail text not null default '';

-- Keep internal security-definer helpers off the public RPC surface.
revoke all on function public.issue_app_session(uuid, text, interval) from public, anon, authenticated;
revoke all on function public.hash_app_session_token(text) from public, anon, authenticated;
revoke all on function public.get_app_session_user_id(text, text[]) from public, anon, authenticated;
revoke all on function public.guest_phone_hash(text) from public, anon, authenticated;
revoke all on function public.can_attempt_guest_login(text) from public, anon, authenticated;
revoke all on function public.record_guest_login_failure(text) from public, anon, authenticated;
revoke all on function public.clear_guest_login_failures(text) from public, anon, authenticated;

-- is_admin_session(text) stays callable because AdminRoute verifies the local
-- admin session with this RPC. It only returns a boolean for a supplied token.

-- 2) Event create/edit RPC ----------------------------------------------------
drop function if exists public.upsert_event_for_admin_session(
  text, text, text, text, date, time, time, text, integer, integer, boolean, integer, integer
);

create or replace function public.upsert_event_for_admin_session(
  session_token text,
  event_id_value text,
  event_title text,
  event_short_name text,
  event_date_value date,
  event_start_time time,
  event_end_time time,
  event_location text,
  event_venue_detail text,
  event_application_deadline timestamptz,
  event_male_price integer,
  event_female_price integer,
  event_venue_booked boolean,
  male_capacity_value integer,
  female_capacity_value integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if trim(coalesce(event_id_value, '')) = '' or trim(coalesce(event_title, '')) = '' then
    raise exception 'Event id and title are required.';
  end if;

  if event_end_time <= event_start_time then
    raise exception 'Event end time must be later than start time.';
  end if;

  if event_application_deadline is not null
     and event_application_deadline >= ((event_date_value + event_start_time) at time zone 'Asia/Seoul') then
    raise exception 'Application deadline must be before the event starts.';
  end if;

  if male_capacity_value < 1 or female_capacity_value < 1 then
    raise exception 'Event capacity must be positive.';
  end if;

  if event_male_price < 0 or event_female_price < 0 then
    raise exception 'Event price cannot be negative.';
  end if;

  insert into public.events (
    id,
    title,
    short_name,
    event_date,
    start_time,
    end_time,
    location,
    venue_detail,
    application_deadline,
    male_price,
    female_price,
    venue_booked,
    male_capacity,
    female_capacity
  )
  values (
    event_id_value,
    trim(event_title),
    trim(event_short_name),
    event_date_value,
    event_start_time,
    event_end_time,
    trim(event_location),
    trim(coalesce(event_venue_detail, '')),
    event_application_deadline,
    event_male_price,
    event_female_price,
    event_venue_booked,
    male_capacity_value,
    female_capacity_value
  )
  on conflict (id) do update set
    title = excluded.title,
    short_name = excluded.short_name,
    event_date = excluded.event_date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    location = excluded.location,
    venue_detail = excluded.venue_detail,
    application_deadline = excluded.application_deadline,
    male_price = excluded.male_price,
    female_price = excluded.female_price,
    venue_booked = excluded.venue_booked,
    male_capacity = excluded.male_capacity,
    female_capacity = excluded.female_capacity,
    updated_at = now();
end;
$$;

grant execute on function public.upsert_event_for_admin_session(
  text, text, text, text, date, time, time, text, text, timestamptz, integer, integer, boolean, integer, integer
) to anon, authenticated;

create or replace function public.get_admin_event_for_session(
  session_token text,
  event_id_value text
)
returns table (
  id text,
  title text,
  short_name text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  venue_detail text,
  application_deadline timestamptz,
  venue_booked boolean,
  male_capacity integer,
  female_capacity integer,
  male_price integer,
  female_price integer
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
    e.short_name,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    e.venue_detail,
    e.application_deadline,
    e.venue_booked,
    e.male_capacity,
    e.female_capacity,
    e.male_price,
    e.female_price
  from public.events e
  where e.id = event_id_value
  limit 1;
end;
$$;

grant execute on function public.get_admin_event_for_session(text, text) to anon, authenticated;

-- Public summaries expose only the application deadline, never venue_detail.
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
  female_confirmed integer,
  application_deadline timestamptz,
  male_capacity integer,
  female_capacity integer
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
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer as female_confirmed,
    e.application_deadline,
    e.male_capacity,
    e.female_capacity
  from public.events e
  left join public.applications a on a.event_id = e.id
  where coalesce(e.is_test_event, false) = false
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

-- Reject inserts after the configured application deadline even if a caller
-- bypasses the normal submit Edge Function.
create or replace function public.enforce_event_application_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  deadline_value timestamptz;
begin
  select e.application_deadline
    into deadline_value
  from public.events e
  where e.id = new.event_id;

  if deadline_value is not null and now() >= deadline_value then
    raise exception 'Application deadline has passed.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_event_application_deadline_before_insert on public.applications;
create trigger enforce_event_application_deadline_before_insert
before insert on public.applications
for each row execute function public.enforce_event_application_deadline();

-- Confirmed participants can receive the private venue detail through their own
-- ticket RPC. Before confirmation, only the public area is returned.
create or replace function public.get_my_event_tickets(session_token text)
returns table (
  application_id uuid,
  application_no text,
  status public.application_status,
  event_id text,
  event_title text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  nickname text,
  job text,
  age integer,
  gender text,
  applicant_name text,
  payment_deadline timestamptz,
  payment_amount integer,
  deposit_requested_at timestamptz,
  deposit_failed_at timestamptz,
  deposit_failure_reason text,
  depositor_name text,
  payment_method text,
  refund_policy_confirmed boolean,
  refund_policy_confirmed_at timestamptz,
  transfer_guide_confirmed_at timestamptz,
  transfer_intent_confirmed boolean,
  payment_completed_at timestamptz,
  qr_token text,
  qr_issued_at timestamptz,
  checked_in_at timestamptz,
  bank_name text,
  bank_account_number text,
  bank_account_holder text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
begin
  select s.user_id
  into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest');

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  return query
  select
    a.id,
    a.application_no,
    a.status,
    e.id,
    e.title,
    e.event_date,
    e.start_time,
    e.end_time,
    case
      when a.status = '참가 확정' and trim(coalesce(e.venue_detail, '')) <> '' then e.venue_detail
      else e.location
    end,
    a.nickname,
    a.job,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer,
    a.gender,
    a.name,
    a.payment_deadline,
    case when a.gender = '남성' then e.male_price else e.female_price end,
    a.deposit_requested_at,
    a.deposit_failed_at,
    a.deposit_failure_reason,
    a.depositor_name,
    a.payment_method,
    a.refund_policy_confirmed,
    a.refund_policy_confirmed_at,
    a.transfer_guide_confirmed_at,
    a.transfer_intent_confirmed,
    a.payment_completed_at,
    case when a.status = '참가 확정' and t.revoked_at is null then t.qr_token else null end,
    t.issued_at,
    coalesce(t.checked_in_at, a.checked_in_at),
    ps.bank_name,
    ps.account_number,
    ps.account_holder
  from public.applications a
  join public.events e on e.id = a.event_id
  cross join public.payment_settings ps
  left join public.application_tickets t on t.application_id = a.id
  where a.user_id = session_user_id
    and ps.is_active = true
    and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정')
  order by e.event_date asc, e.start_time asc;
end;
$$;

grant execute on function public.get_my_event_tickets(text) to anon, authenticated;

-- 3) Participant profile schema was previously left in a legacy patch file. ---
create table if not exists public.participant_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  is_active boolean not null default true,
  source_application_id uuid references public.applications(id) on delete set null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists participant_profiles_one_active_per_user
on public.participant_profiles (user_id)
where is_active;

alter table public.participant_profiles enable row level security;

drop policy if exists "No direct participant profile reads" on public.participant_profiles;
create policy "No direct participant profile reads"
on public.participant_profiles
for select
using (false);

create or replace function public.get_my_page_summary(session_token text)
returns table (
  account_type text,
  has_profile boolean,
  nickname text,
  phone_masked text,
  avatar_index integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_row record;
begin
  select s.user_id, s.role
  into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_row.user_id is null then
    return query select null::text, false, null::text, null::text, 0;
    return;
  end if;

  return query
  with active_profile as (
    select pp.*
    from public.participant_profiles pp
    where pp.user_id = session_row.user_id
      and pp.is_active
    order by pp.updated_at desc
    limit 1
  ),
  latest_application as (
    select a.*
    from public.applications a
    where a.user_id = session_row.user_id
    order by a.submitted_at desc
    limit 1
  ),
  chosen as (
    select
      coalesce(
        (select nickname from active_profile),
        (select nickname from latest_application),
        (select login_id from public.member_accounts where user_id = session_row.user_id),
        '비회원'
      ) as nickname,
      coalesce(
        (select phone from active_profile),
        (select phone from latest_application),
        (select phone_normalized from public.guest_accounts where user_id = session_row.user_id)
      ) as phone_value,
      coalesce(
        (select representative_photo_index from active_profile),
        (select representative_photo_index from latest_application),
        0
      )::integer as avatar_index,
      exists(select 1 from active_profile) or exists(select 1 from latest_application) as has_profile
  )
  select
    session_row.role::text,
    chosen.has_profile,
    chosen.nickname,
    case
      when chosen.phone_value is null or length(regexp_replace(chosen.phone_value, '\D', '', 'g')) < 8 then null
      else left(regexp_replace(chosen.phone_value, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(chosen.phone_value, '\D', '', 'g'), 4)
    end,
    chosen.avatar_index
  from chosen;
end;
$$;

create or replace function public.get_my_participant_profile(session_token text)
returns table (
  id uuid,
  account_type text,
  source text,
  can_reuse boolean,
  name text,
  birth_date date,
  gender text,
  residence text,
  phone_masked text,
  relationship_status text,
  nickname text,
  profile_photo_count integer,
  representative_photo_index integer,
  representative_crop jsonb,
  has_voice_intro boolean,
  height text,
  job text,
  has_id_photo boolean,
  has_employment_proof boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_row record;
begin
  select s.user_id, s.role
  into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_row.user_id is null then
    return;
  end if;

  if session_row.role = 'member' then
    return query
    select
      pp.id,
      'member'::text,
      'default_profile'::text,
      true,
      pp.name,
      pp.birth_date,
      pp.gender,
      pp.residence,
      left(regexp_replace(pp.phone, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(pp.phone, '\D', '', 'g'), 4),
      pp.relationship_status,
      pp.nickname,
      coalesce(array_length(pp.profile_photo_paths, 1), 0),
      pp.representative_photo_index,
      pp.representative_crop,
      pp.voice_intro_path is not null,
      pp.height,
      pp.job,
      pp.id_photo_path is not null,
      pp.employment_proof_path is not null,
      pp.updated_at
    from public.participant_profiles pp
    where pp.user_id = session_row.user_id
      and pp.is_active
    order by pp.updated_at desc
    limit 1;
    return;
  end if;

  return query
  select
    a.id,
    'guest'::text,
    'application_profile'::text,
    false,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    left(regexp_replace(a.phone, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(a.phone, '\D', '', 'g'), 4),
    a.relationship_status,
    a.nickname,
    coalesce(array_length(a.profile_photo_paths, 1), 0),
    a.representative_photo_index,
    a.representative_crop,
    a.voice_intro_path is not null,
    a.height,
    a.job,
    a.id_photo_path is not null,
    a.employment_proof_path is not null,
    a.submitted_at
  from public.applications a
  where a.user_id = session_row.user_id
  order by a.submitted_at desc
  limit 1;
end;
$$;

create or replace function public.update_my_participant_profile_nickname(session_token text, nickname_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := public.get_app_session_user_id(session_token, array['member']);
  if current_user_id is null then
    raise exception 'Member session required.';
  end if;

  if length(trim(nickname_value)) < 1 then
    raise exception 'Nickname is required.';
  end if;

  update public.participant_profiles
  set nickname = trim(nickname_value),
      updated_at = now()
  where user_id = current_user_id
    and is_active;

  return found;
end;
$$;

grant execute on function public.get_my_page_summary(text) to anon, authenticated;
grant execute on function public.get_my_participant_profile(text) to anon, authenticated;
grant execute on function public.update_my_participant_profile_nickname(text, text) to anon, authenticated;

-- 4) Guest cleanup: remove the old DB-only cron and expose cleanup only to the
-- service role used by the cleanup Edge Function. --------------------------------
-- Keep guests while an upcoming event still has an active application. The
-- original cleanup migration predates the bank-transfer statuses, so include
-- those states here before deriving cleanup targets.
create or replace function public.get_expired_guest_account_cleanup_candidates()
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
    ga.user_id,
    ga.delete_after
  from public.guest_accounts ga
  join public.user_accounts ua on ua.user_id = ga.user_id
  where ua.account_type = 'guest'
    and ua.converted_to_member_at is null
    and ga.delete_after <= now()
    and not exists (
      select 1
      from public.applications a
      join public.events e on e.id = a.event_id
      where a.user_id = ga.user_id
        and e.event_date >= current_date
        and a.status in (
          '심사 대기',
          '결제 대기',
          '결제중',
          '입금 확인 중',
          '참가 확정',
          '참여 보류'
        )
    )
    and not exists (
      select 1
      from public.applications a
      where a.user_id = ga.user_id
        and (a.legal_hold = true or a.has_dispute = true)
    );
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('cleanup-expired-guest-accounts');
    exception when others then
      null;
    end;
  end if;
end $$;

revoke all on function public.get_expired_guest_account_cleanup_candidates() from public, anon, authenticated;
revoke all on function public.cleanup_expired_guest_accounts() from public, anon, authenticated;

create or replace function public.get_expired_guest_cleanup_targets()
returns table (
  user_id uuid,
  storage_bucket text,
  storage_path text
)
language sql
security definer
set search_path = public
as $$
  with expired_guests as (
    select c.user_id
    from public.get_expired_guest_account_cleanup_candidates() c
  ),
  application_file_paths as (
    select a.user_id, unnest(array_remove(array[
      a.id_photo_path,
      a.voice_intro_path,
      a.employment_proof_path
    ], null)) as storage_path
    from public.applications a
    join expired_guests eg on eg.user_id = a.user_id

    union all

    select a.user_id, unnest(coalesce(a.profile_photo_paths, '{}'::text[])) as storage_path
    from public.applications a
    join expired_guests eg on eg.user_id = a.user_id
  )
  select
    eg.user_id,
    'application-files'::text as storage_bucket,
    fp.storage_path
  from expired_guests eg
  left join application_file_paths fp on fp.user_id = eg.user_id;
$$;

revoke all on function public.get_expired_guest_cleanup_targets() from public, anon, authenticated;
grant execute on function public.get_expired_guest_cleanup_targets() to service_role;

create or replace function public.finalize_expired_guest_cleanup(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The candidate query already excludes legal holds/disputes and upcoming
  -- active applications. Keep historical application rows for event records,
  -- but erase personal/profile data after the Storage objects are removed.
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
    and legal_hold = false
    and has_dispute = false;

  delete from public.application_drafts where user_id = target_user_id;
  delete from public.app_sessions where user_id = target_user_id and role = 'guest';

  delete from public.guest_login_attempts
  where phone_hash in (
    select public.guest_phone_hash(ga.phone_normalized)
    from public.guest_accounts ga
    where ga.user_id = target_user_id
  );

  delete from public.guest_accounts where user_id = target_user_id;
  delete from public.user_accounts
  where user_id = target_user_id
    and account_type = 'guest';
  delete from public.app_users
  where user_id = target_user_id
    and account_type = 'guest';
end;
$$;

revoke all on function public.finalize_expired_guest_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.finalize_expired_guest_cleanup(uuid) to service_role;

notify pgrst, 'reload schema';
