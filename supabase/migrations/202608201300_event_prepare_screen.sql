-- "행사 준비" 운영 대시보드에 필요한 서버 지원:
--   1) events.started_at - 관리자가 "행사 시작"을 눌렀는지 여부/시각.
--   2) start_admin_event_for_session - 행사 시작 처리. 테스트 행사이거나
--      행사 당일인 경우에만 허용한다. 태블릿이 전부 연결되지 않아도 시작을
--      막지 않는다(프론트는 경고만 표시).
--   3) get_admin_event_tablet_status - 필요한 테이블 수(1..N)별 태블릿
--      연결 현황.
--   4) get_admin_event_mode_summaries에 started_at 컬럼 추가.
alter table public.events add column if not exists started_at timestamptz;

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
  is_test_event boolean,
  started_at timestamptz
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
    e.is_test_event,
    e.started_at
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

create or replace function public.start_admin_event_for_session(session_token text, event_id_value text)
returns timestamptz
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  today_kst date;
  result_started_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception 'Event not found.';
  end if;

  today_kst := (now() at time zone 'Asia/Seoul')::date;
  if not target_event.is_test_event and target_event.event_date <> today_kst then
    raise exception 'Event can only be started on its event date.';
  end if;

  update public.events
  set started_at = coalesce(started_at, now())
  where id = event_id_value
  returning started_at into result_started_at;

  return result_started_at;
end;
$$;

grant execute on function public.start_admin_event_for_session(text, text) to anon, authenticated;

create or replace function public.get_admin_event_tablet_status(session_token text, event_id_value text)
returns table (
  table_number integer,
  connected boolean,
  device_label text,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  required_tablets integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception 'Event not found.';
  end if;

  required_tablets := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  return query
  select
    gs.table_number,
    coalesce(
      et.connection_status = 'online'
        and et.last_seen_at is not null
        and et.last_seen_at > now() - interval '90 seconds',
      false
    ) as connected,
    et.device_label,
    et.last_seen_at
  from generate_series(1, required_tablets) as gs(table_number)
  left join public.event_tablets et
    on et.event_id = event_id_value and et.table_number = gs.table_number
  order by gs.table_number asc;
end;
$$;

grant execute on function public.get_admin_event_tablet_status(text, text) to anon, authenticated;
