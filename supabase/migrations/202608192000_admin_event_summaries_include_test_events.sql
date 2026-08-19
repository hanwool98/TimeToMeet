-- get_public_event_summaries deliberately hides test events from real
-- visitors (where coalesce(is_test_event, false) = false). Admin screens
-- (e.g. the per-event participant list) reused that same public RPC for
-- their events list, so looking up a test event by id always came up empty
-- there - "행사를 찾을 수 없습니다" even though the event and its confirmed
-- participants existed. This mirrors get_public_event_summaries exactly
-- but without the test-event filter, gated behind an admin session.
create or replace function public.get_admin_event_summaries(session_token text)
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
  group by e.id;
end;
$$;

grant execute on function public.get_admin_event_summaries(text) to anon, authenticated;
