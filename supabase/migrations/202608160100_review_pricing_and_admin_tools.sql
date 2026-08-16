-- Batch 2 operational fixes: past-date event guard, guest PIN reset, app-session
-- server verification, early-bird pricing, duplicate-application handling after
-- rejection, review reason visibility, and re-opening held applications.
--
-- update_application_review_for_session has known drift between this repo and
-- the live project (a review_reason-carrying 7-arg version existed in a loose
-- SQL patch file that was later deleted from the repo without ever landing in
-- supabase-schema.sql). Both historically-possible signatures are dropped
-- explicitly before recreating so this migration applies cleanly either way.

-- 1) Event pricing/date columns -----------------------------------------------
alter table public.events
add column if not exists early_bird_deadline timestamptz,
add column if not exists early_bird_discount_male integer not null default 0,
add column if not exists early_bird_discount_female integer not null default 0;

do $$
begin
  alter table public.events
  add constraint events_early_bird_discount_male_non_negative check (early_bird_discount_male >= 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.events
  add constraint events_early_bird_discount_female_non_negative check (early_bird_discount_female >= 0);
exception
  when duplicate_object then null;
end $$;

-- 2) Application payment_amount (persisted at submission time) + review_reason -
alter table public.applications
add column if not exists review_reason text,
add column if not exists payment_amount integer;

-- Backfill using the same flat-price formula the app has always used, so
-- existing pending applications keep showing the same amount they do today.
update public.applications a
set payment_amount = case when a.gender = '남성' then e.male_price else e.female_price end
from public.events e
where e.id = a.event_id
  and a.payment_amount is null;

update public.applications set payment_amount = 0 where payment_amount is null;

alter table public.applications
alter column payment_amount set default 0;

alter table public.applications
alter column payment_amount set not null;

do $$
begin
  alter table public.applications
  add constraint applications_payment_amount_non_negative check (payment_amount >= 0);
exception
  when duplicate_object then null;
end $$;

-- 3) Allow re-application only after rejection (반려) -----------------------
drop index if exists public.applications_event_user_unique;
create unique index if not exists applications_event_user_unique
on public.applications (event_id, user_id)
where status <> '반려';

-- 4) Event create/edit RPC: past-date guard (insert-only) + early-bird fields -
drop function if exists public.upsert_event_for_admin_session(
  text, text, text, text, date, time, time, text, text, timestamptz, integer, integer, boolean, integer, integer
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
  female_capacity_value integer,
  event_early_bird_deadline timestamptz default null,
  event_early_bird_discount_male integer default 0,
  event_early_bird_discount_female integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_exists boolean;
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

  if coalesce(event_early_bird_discount_male, 0) < 0 or coalesce(event_early_bird_discount_female, 0) < 0 then
    raise exception 'Early-bird discount cannot be negative.';
  end if;

  select exists(select 1 from public.events where id = event_id_value) into event_exists;

  if not event_exists and event_date_value < ((now() at time zone 'Asia/Seoul')::date) then
    raise exception 'Event date cannot be in the past.';
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
    female_capacity,
    early_bird_deadline,
    early_bird_discount_male,
    early_bird_discount_female
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
    female_capacity_value,
    event_early_bird_deadline,
    coalesce(event_early_bird_discount_male, 0),
    coalesce(event_early_bird_discount_female, 0)
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
    early_bird_deadline = excluded.early_bird_deadline,
    early_bird_discount_male = excluded.early_bird_discount_male,
    early_bird_discount_female = excluded.early_bird_discount_female,
    updated_at = now();
end;
$$;

grant execute on function public.upsert_event_for_admin_session(
  text, text, text, text, date, time, time, text, text, timestamptz, integer, integer, boolean, integer, integer, timestamptz, integer, integer
) to anon, authenticated;

-- 5) get_admin_event_for_session: surface early-bird fields to the edit form --
drop function if exists public.get_admin_event_for_session(text, text);
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
  female_price integer,
  early_bird_deadline timestamptz,
  early_bird_discount_male integer,
  early_bird_discount_female integer
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
    e.female_price,
    e.early_bird_deadline,
    e.early_bird_discount_male,
    e.early_bird_discount_female
  from public.events e
  where e.id = event_id_value
  limit 1;
end;
$$;

grant execute on function public.get_admin_event_for_session(text, text) to anon, authenticated;

-- 6) get_public_event_summaries: surface early-bird fields to the public list -
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
  female_capacity integer,
  early_bird_deadline timestamptz,
  early_bird_discount_male integer,
  early_bird_discount_female integer
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
    e.female_capacity,
    e.early_bird_deadline,
    e.early_bird_discount_male,
    e.early_bird_discount_female
  from public.events e
  left join public.applications a on a.event_id = e.id
  where coalesce(e.is_test_event, false) = false
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

-- 7) get_my_event_tickets: use the persisted payment_amount, surface review
-- reasons, and widen visibility to 참여 보류/반려 so participants see why. ----
drop function if exists public.get_my_event_tickets(text);

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
  review_reason text,
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
    a.payment_amount,
    a.review_reason,
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
    and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정', '참여 보류', '반려')
  order by e.event_date asc, e.start_time asc;
end;
$$;

grant execute on function public.get_my_event_tickets(text) to anon, authenticated;

-- 8) update_application_review_for_session: accept + persist a review reason,
-- and allow re-opening a held (참여 보류) application back into a decision. ----
drop function if exists public.update_application_review_for_session(
  text, uuid, public.application_status, timestamptz, timestamptz, timestamptz
);
drop function if exists public.update_application_review_for_session(
  text, uuid, public.application_status, timestamptz, timestamptz, timestamptz, text
);

create or replace function public.update_application_review_for_session(
  session_token text,
  application_id uuid,
  next_status public.application_status,
  next_payment_deadline timestamptz,
  next_payment_notice_sent_at timestamptz,
  next_reviewed_at timestamptz,
  next_review_reason text default null
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

  if not exists (
    select 1
    from public.applications a
    where a.id = application_id
      and a.status in ('심사 대기', '참여 보류')
  ) then
    raise exception 'Only applications currently under review or on hold can be updated.';
  end if;

  update public.applications
  set
    is_new = false,
    payment_deadline = next_payment_deadline,
    payment_notice_sent_at = next_payment_notice_sent_at,
    reviewed_at = coalesce(next_reviewed_at, now()),
    status = next_status,
    review_reason = next_review_reason,
    updated_at = now()
  where id = application_id;

  if next_status = '결제 대기' then
    insert into public.payment_invitations (application_id, user_id)
    select a.id, a.user_id
    from public.applications a
    where a.id = application_id
      and a.payment_deadline is not null
      and a.payment_deadline > now()
    on conflict (application_id) do update set
      read_at = null, dismissed_at = null, updated_at = now();
  else
    update public.payment_invitations
    set dismissed_at = coalesce(dismissed_at, now()), read_at = coalesce(read_at, now()), updated_at = now()
    where public.payment_invitations.application_id = update_application_review_for_session.application_id
      and next_status in ('참여 보류', '반려', '참가 확정', '환불 완료', '자동 취소');
  end if;
end;
$$;

grant execute on function public.update_application_review_for_session(
  text, uuid, public.application_status, timestamptz, timestamptz, timestamptz, text
) to anon, authenticated;

-- 9) App session server-side verification (mirrors is_admin_session) ----------
create or replace function public.is_app_session_valid(session_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_sessions
    where token_hash = public.hash_app_session_token(session_token)
      and expires_at > now()
      and role in ('member', 'guest')
  );
$$;

grant execute on function public.is_app_session_valid(text) to anon, authenticated;

-- 10) Admin-triggered guest PIN reset ------------------------------------------
-- Never reads the existing PIN (bcrypt hash is one-way); generates a fresh
-- 6-digit PIN, hashes it the same way create_guest_session does, and returns
-- the plaintext once so the admin can relay it to the participant.
create or replace function public.reset_guest_pin_for_admin_session(
  session_token text,
  target_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_pin text;
  target_phone text;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select phone_normalized into target_phone
  from public.guest_accounts
  where user_id = target_user_id;

  if target_phone is null then
    raise exception 'Guest account not found.';
  end if;

  loop
    next_pin := lpad(floor(random() * 1000000)::text, 6, '0');
    exit when next_pin !~ '^(\d)\1{5}$';
  end loop;

  update public.guest_accounts
  set pin_hash = extensions.crypt(next_pin, extensions.gen_salt('bf')),
      updated_at = now()
  where user_id = target_user_id;

  perform public.clear_guest_login_failures(target_phone);

  return next_pin;
end;
$$;

grant execute on function public.reset_guest_pin_for_admin_session(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
