-- Admin needs to see is_test_event on the event list to show the 🧪 TEST
-- badge and filter. Adding it to get_public_event_summaries too is safe -
-- that RPC already only ever returns non-test events, so the column is
-- always false there; keeping both summary RPCs on the same row shape
-- avoids the two frontend mappers drifting apart.
drop function if exists public.get_public_event_summaries();

create function public.get_public_event_summaries()
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean
)
language sql
stable
security definer
set search_path = 'public'
as $$
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
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event
  from public.events e
  left join public.applications a on a.event_id = e.id
  where coalesce(e.is_test_event, false) = false
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

drop function if exists public.get_admin_event_summaries(text);

create function public.get_admin_event_summaries(session_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean
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
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_booked,
    e.male_price, e.female_price,
    count(a.id) filter (where a.status = '참가 확정')::integer as current_participants,
    (e.male_capacity + e.female_capacity)::integer as target_participants,
    count(a.id) filter (where a.gender = '남성')::integer as male_applications,
    count(a.id) filter (where a.gender = '여성')::integer as female_applications,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer as male_confirmed,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer as female_confirmed,
    e.application_deadline, e.male_capacity, e.female_capacity,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event
  from public.events e
  left join public.applications a on a.event_id = e.id
  group by e.id;
end;
$$;

grant execute on function public.get_admin_event_summaries(text) to anon, authenticated;
