-- 운영자가 `행사 종료`를 눌러 events.ended_at을 세팅한 행사는 예정 종료
-- 시각이 아직 안 지났어도 행사모드 대시보드(진행/오늘/활성 목록)에서
-- 빠져야 한다. 반환 컬럼은 그대로라 CREATE OR REPLACE로 충분하고,
-- 콘텐츠 관리(get_admin_final_selection_events)는 별도 함수라 영향 없음 -
-- 종료된 행사의 호감도/최종선택/상호선택 결과는 그대로 조회 가능하다.
create or replace function public.get_admin_event_mode_summaries(session_token text)
 returns table(id text, title text, event_date date, start_time time without time zone, end_time time without time zone, location text, confirmed_count integer, male_confirmed_count integer, female_confirmed_count integer, checkin_count integer, male_checkin_count integer, female_checkin_count integer, tablet_count integer, required_tablets integer, is_test_event boolean, started_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '남성' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as male_checkin_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '여성' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as female_checkin_count,
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
  where e.ended_at is null
    and (e.is_test_event or (e.event_date + e.end_time) >= ((now() at time zone 'Asia/Seoul')::timestamp))
  group by e.id
  order by e.event_date asc, e.start_time asc;
end;
$function$;
