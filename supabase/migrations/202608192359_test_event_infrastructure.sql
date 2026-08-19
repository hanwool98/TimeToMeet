-- Test-event layer: lets admins mark an event as test-only (already had
-- events.is_test_event from earlier work), gives admins a way to open the
-- real participant flow for a test event without using their admin login as
-- participant auth (a short-lived, event-scoped preview token instead), and
-- adds admin-only helpers to seed/reset test participants. No new
-- applications/session/ticket tables - everything rides the existing
-- structures, gated by events.is_test_event.

-- 1) Admin event create/edit now carries is_test_event ----------------------
drop function if exists public.upsert_event_for_admin_session(text, text, text, text, date, time, time, text, text, timestamptz, integer, integer, boolean, integer, integer, timestamptz, integer, integer);

create function public.upsert_event_for_admin_session(
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
  event_early_bird_discount_female integer default 0,
  event_is_test_event boolean default false
)
returns void
language plpgsql
security definer
set search_path = 'public'
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
    id, title, short_name, event_date, start_time, end_time, location, venue_detail,
    application_deadline, male_price, female_price, venue_booked, male_capacity, female_capacity,
    early_bird_deadline, early_bird_discount_male, early_bird_discount_female, is_test_event
  )
  values (
    event_id_value, trim(event_title), trim(event_short_name), event_date_value, event_start_time, event_end_time,
    trim(event_location), trim(coalesce(event_venue_detail, '')), event_application_deadline,
    event_male_price, event_female_price, event_venue_booked, male_capacity_value, female_capacity_value,
    event_early_bird_deadline, coalesce(event_early_bird_discount_male, 0), coalesce(event_early_bird_discount_female, 0),
    coalesce(event_is_test_event, false)
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
    is_test_event = excluded.is_test_event,
    updated_at = now();
end;
$$;

grant execute on function public.upsert_event_for_admin_session(text, text, text, text, date, time, time, text, text, timestamptz, integer, integer, boolean, integer, integer, timestamptz, integer, integer, boolean) to anon, authenticated;

drop function if exists public.get_admin_event_for_session(text, text);

create function public.get_admin_event_for_session(session_token text, event_id_value text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time,
  location text, venue_detail text, application_deadline timestamptz, venue_booked boolean,
  male_capacity integer, female_capacity integer, male_price integer, female_price integer,
  early_bird_deadline timestamptz, early_bird_discount_male integer, early_bird_discount_female integer,
  is_test_event boolean
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_detail,
    e.application_deadline, e.venue_booked, e.male_capacity, e.female_capacity, e.male_price, e.female_price,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event
  from public.events e
  where e.id = event_id_value
  limit 1;
end;
$$;

grant execute on function public.get_admin_event_for_session(text, text) to anon, authenticated;

-- 2) Preview tokens ----------------------------------------------------------
create table if not exists public.event_preview_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists event_preview_tokens_event_id_idx on public.event_preview_tokens (event_id);

alter table public.event_preview_tokens enable row level security;

drop policy if exists "No direct preview token access" on public.event_preview_tokens;
create policy "No direct preview token access"
on public.event_preview_tokens
for all
using (false)
with check (false);

create or replace function public.create_test_event_preview_token(session_token text, event_id_value text, ttl_hours integer default 24)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  new_token text;
  new_expires_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if not exists (select 1 from public.events e where e.id = event_id_value and e.is_test_event = true) then
    raise exception 'Preview links can only be created for test events.';
  end if;

  new_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_expires_at := now() + make_interval(hours => greatest(1, least(coalesce(ttl_hours, 24), 168)));

  insert into public.event_preview_tokens (event_id, token_hash, expires_at)
  values (event_id_value, encode(extensions.digest(new_token, 'sha256'), 'hex'), new_expires_at);

  return query select new_token, new_expires_at;
end;
$$;

grant execute on function public.create_test_event_preview_token(text, text, integer) to anon, authenticated;

-- Shared validity check reused by both the public event-preview lookup and
-- submit-application's server-side re-check, so there's exactly one place
-- that decides whether a token is currently good for a given event.
create or replace function public.is_test_event_preview_token_valid(event_id_value text, preview_token text)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.event_preview_tokens t
    join public.events e on e.id = t.event_id
    where t.event_id = event_id_value
      and t.token_hash = encode(extensions.digest(coalesce(preview_token, ''), 'sha256'), 'hex')
      and t.expires_at > now()
      and e.is_test_event = true
  );
$$;

grant execute on function public.is_test_event_preview_token_valid(text, text) to anon, authenticated, service_role;

-- Public (anon-callable) single-event lookup for a valid preview token -
-- same shape as get_public_event_summaries, but for one test event and
-- gated by the token instead of coalesce(is_test_event,false)=false.
create or replace function public.get_test_event_preview(event_id_value text, preview_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_test_event_preview_token_valid(event_id_value, preview_token) then
    return;
  end if;

  return query
  select
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_booked,
    e.male_price, e.female_price,
    count(a.id) filter (where a.status = '참가 확정')::integer as current_participants,
    (e.male_capacity + e.female_capacity)::integer as target_participants,
    count(a.id) filter (where a.gender = '남성')::integer as male_applications,
    count(a.id) filter (where a.gender = '여성')::integer as female_applications,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer as male_confirmed,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer as female_confirmed,
    e.application_deadline, e.male_capacity, e.female_capacity,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female
  from public.events e
  left join public.applications a on a.event_id = e.id
  where e.id = event_id_value
  group by e.id;
end;
$$;

grant execute on function public.get_test_event_preview(text, text) to anon, authenticated;

-- Participant-preview roster: same public RPC, now also reachable for a
-- test event when a valid preview token for it is supplied (defaults to
-- null, so every other existing caller is unaffected).
drop function if exists public.get_public_participant_previews(text);

create function public.get_public_participant_previews(target_event_id text, preview_token text default null)
returns table (id text, gender text, nickname text, age integer, job text, avatar_index integer)
language sql
stable
security definer
set search_path = 'public'
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
    and (e.is_test_event = false or public.is_test_event_preview_token_valid(target_event_id, preview_token))
    and a.status = '참가 확정'
  order by a.gender, a.submitted_at asc, a.id asc;
$$;

grant execute on function public.get_public_participant_previews(text, text) to anon, authenticated;

-- 3) Test participant generation (admin, test events only) ------------------
create or replace function public.create_test_participants_for_session(
  session_token text,
  event_id_value text,
  male_count integer,
  female_count integer
)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  created_count integer := 0;
  new_user_id uuid;
  i integer;
  seed_birth_date date;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if target_event.id is null then
    raise exception '행사를 찾을 수 없습니다.';
  end if;
  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 테스트 참가자를 생성할 수 있습니다.';
  end if;

  if coalesce(male_count, 0) < 0 or coalesce(female_count, 0) < 0 or coalesce(male_count, 0) + coalesce(female_count, 0) > 60 then
    raise exception '생성 인원이 올바르지 않습니다.';
  end if;

  seed_birth_date := (target_event.event_date - interval '28 years')::date;

  for i in 1..coalesce(male_count, 0) loop
    insert into public.app_users (account_type) values ('guest') returning user_id into new_user_id;
    insert into public.applications (
      event_id, user_id, name, birth_date, gender, residence, phone, relationship_status,
      nickname, height, job, access_route, interview_consent, status,
      applicant_kind, filming_consent, refund_agreement, review_notice_confirmed
    ) values (
      event_id_value, new_user_id, '테스트 참가자', seed_birth_date, '남성', '서울', '', '미혼이며 교제하는 인원 없음',
      '테스트남' || i, '175', '테스트', '테스트 생성', '가능', '참가 확정',
      'guest', true, true, true
    );
    insert into public.application_tickets (application_id, user_id, event_id)
    select a.id, a.user_id, a.event_id from public.applications a
    where a.event_id = event_id_value and a.user_id = new_user_id;
    created_count := created_count + 1;
  end loop;

  for i in 1..coalesce(female_count, 0) loop
    insert into public.app_users (account_type) values ('guest') returning user_id into new_user_id;
    insert into public.applications (
      event_id, user_id, name, birth_date, gender, residence, phone, relationship_status,
      nickname, height, job, access_route, interview_consent, status,
      applicant_kind, filming_consent, refund_agreement, review_notice_confirmed
    ) values (
      event_id_value, new_user_id, '테스트 참가자', seed_birth_date, '여성', '서울', '', '미혼이며 교제하는 인원 없음',
      '테스트여' || i, '162', '테스트', '테스트 생성', '가능', '참가 확정',
      'guest', true, true, true
    );
    insert into public.application_tickets (application_id, user_id, event_id)
    select a.id, a.user_id, a.event_id from public.applications a
    where a.event_id = event_id_value and a.user_id = new_user_id;
    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

grant execute on function public.create_test_participants_for_session(text, text, integer, integer) to anon, authenticated;

-- 4) Test data reset (admin, test events only) -------------------------------
-- Storage files can't be deleted via SQL (Storage API only), so this is
-- split: a read-only "what files exist" step the reset-test-event Edge
-- Function calls first, then this finalize step that actually deletes rows
-- once the Edge Function has removed those files.
create or replace function public.get_test_event_reset_storage_paths(session_token text, event_id_value text)
returns table (storage_path text)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if not exists (select 1 from public.events e where e.id = event_id_value and e.is_test_event = true) then
    raise exception '테스트 행사만 초기화할 수 있습니다.';
  end if;

  return query
  select unnest(array_remove(array[a.id_photo_path, a.voice_intro_path, a.employment_proof_path], null))
  from public.applications a where a.event_id = event_id_value
  union
  select unnest(a.profile_photo_paths)
  from public.applications a where a.event_id = event_id_value;
end;
$$;

grant execute on function public.get_test_event_reset_storage_paths(text, text) to anon, authenticated;

create or replace function public.finalize_test_event_reset(session_token text, event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  placeholder_user_ids uuid[];
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  -- Hard safety gate: this can never touch a real event's data, no matter
  -- what event_id_value is passed in.
  if not exists (select 1 from public.events e where e.id = event_id_value and e.is_test_event = true) then
    raise exception '테스트 행사만 초기화할 수 있습니다.';
  end if;

  -- Auto-generated test participants (from create_test_participants_for_session)
  -- never got a guest_accounts/user_accounts row - anyone who logged in for
  -- real through a preview token did, and keeps their account so they can
  -- reapply after the reset. Collect the placeholder ones before their
  -- applications disappear underneath them.
  select array_agg(distinct a.user_id)
  into placeholder_user_ids
  from public.applications a
  where a.event_id = event_id_value
    and not exists (select 1 from public.guest_accounts ga where ga.user_id = a.user_id)
    and not exists (select 1 from public.user_accounts ua where ua.user_id = a.user_id);

  delete from public.applications where event_id = event_id_value; -- cascades tickets + payment_invitations
  delete from public.application_drafts where event_id = event_id_value;
  delete from public.event_tablets where event_id = event_id_value;

  if placeholder_user_ids is not null then
    delete from public.app_users where user_id = any(placeholder_user_ids);
  end if;
end;
$$;

grant execute on function public.finalize_test_event_reset(text, text) to anon, authenticated;
