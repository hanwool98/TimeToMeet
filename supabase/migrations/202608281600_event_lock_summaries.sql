-- 행사 잠금(202608281200_event_lock.sql) 상태를 관리자 화면이 실제로
-- 읽을 수 있게, 행사 목록/상세 조회 RPC 반환 컬럼에 is_locked를 추가한다.
-- 반환 컬럼이 늘어나므로 둘 다 drop 후 재생성.
drop function if exists public.get_admin_event_summaries(text);

create function public.get_admin_event_summaries(session_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  ended_at timestamptz, is_locked boolean
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
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event,
    e.ended_at, e.is_locked
  from public.events e
  left join public.applications a on a.event_id = e.id
  group by e.id;
end;
$$;

grant execute on function public.get_admin_event_summaries(text) to anon, authenticated;

drop function if exists public.get_admin_event_for_session(text, text);

create function public.get_admin_event_for_session(session_token text, event_id_value text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time,
  location text, venue_detail text, application_deadline timestamptz, venue_booked boolean,
  male_capacity integer, female_capacity integer, male_price integer, female_price integer,
  early_bird_deadline timestamptz, early_bird_discount_male integer, early_bird_discount_female integer,
  is_test_event boolean, is_locked boolean
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
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event, e.is_locked
  from public.events e
  where e.id = event_id_value
  limit 1;
end;
$$;

grant execute on function public.get_admin_event_for_session(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
