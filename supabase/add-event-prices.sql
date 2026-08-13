alter table public.events
  add column if not exists male_price integer not null default 50000,
  add column if not exists female_price integer not null default 40000;

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
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

drop function if exists public.upsert_event_for_admin_session(text, text, text, text, date, time, time, text, boolean, integer, integer);
drop function if exists public.upsert_event_for_admin_session(text, text, text, text, date, time, time, text, integer, integer, boolean, integer, integer);

create or replace function public.upsert_event_for_admin_session(
  session_token text,
  event_id_value text,
  event_title text,
  event_short_name text,
  event_date_value date,
  event_start_time time,
  event_end_time time,
  event_location text,
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
    female_capacity
  )
  values (
    event_id_value,
    event_title,
    event_short_name,
    event_date_value,
    event_start_time,
    event_end_time,
    event_location,
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
    male_price = excluded.male_price,
    female_price = excluded.female_price,
    venue_booked = excluded.venue_booked,
    male_capacity = excluded.male_capacity,
    female_capacity = excluded.female_capacity,
    updated_at = now();
end;
$$;

grant execute on function public.upsert_event_for_admin_session(text, text, text, text, date, time, time, text, integer, integer, boolean, integer, integer) to anon, authenticated;

notify pgrst, 'reload schema';
