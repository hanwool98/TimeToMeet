-- Two fixes for the 행사모드 home screen:
--   1) It only showed a total confirmed count, no gender breakdown.
--   2) "필요한 태블릿 수" used events.table_count, a column with no admin
--      UI to set it (always its default of 10) - the actual constraint on
--      how many tables can run at once is min(남 정원, 여 정원), so derive
--      it from capacity instead, matching what admins actually configure.
drop function if exists public.get_admin_event_mode_summaries(text);

create function public.get_admin_event_mode_summaries(session_token text)
returns table (
  id text,
  title text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  confirmed_count integer,
  male_confirmed_count integer,
  female_confirmed_count integer,
  checkin_count integer,
  tablet_count integer,
  required_tablets integer,
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
    e.id,
    e.title,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    count(distinct a.id) filter (where a.status = '참가 확정')::integer as confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '남성')::integer as male_confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '여성')::integer as female_confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as checkin_count,
    count(distinct et.id) filter (
      where et.connection_status = 'online'
        and et.last_seen_at is not null
        and et.last_seen_at > now() - interval '90 seconds'
    )::integer as tablet_count,
    greatest(1, least(e.male_capacity, e.female_capacity))::integer as required_tablets,
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
