-- 실제 사고: 종료 예정 시각(events.end_time)이 지나면
-- get_admin_event_mode_summaries가 그 행사를 관리자 "행사모드" 목록에서
-- 곧바로 빼버렸다(202608241200에서 도입된 필터). 그런데 실제 진행은
-- 예정보다 길어질 수 있고(추가시간, 지각 등), 이번처럼 아직 최종선택도
-- 안 끝난 행사가 예정 종료 시각을 넘겼다는 이유만으로 관리자 화면에서
-- 통째로 사라져 운영자가 라이브 화면에 접근할 방법이 없어졌다.
--
-- event_progress.stage='ended'는 운영자가 명시적으로 "행사 종료"를 눌러
-- (end_admin_event_for_session, 전원 최종선택 제출 완료가 전제조건) 세팅
-- 하는 진짜 종료 신호다 - 이걸 events.ended_at과 함께 목록에 남을지
-- 말지의 기준으로 삼는다. 즉 "예정 종료 시각이 지났다"만으로는 더 이상
-- 목록에서 빠지지 않고, event_progress가 실제로 'ended'에 도달했거나
-- (혹은 애초에 시작도 안 해 progress row가 없는 채로 예정 시각이 지난
-- 경우만) 빠진다. 반환 컬럼/그 외 로직은 전혀 바꾸지 않았다.
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
    and (
      e.is_test_event
      or (e.event_date + e.end_time) >= ((now() at time zone 'Asia/Seoul')::timestamp)
      -- 예정 종료 시각을 넘겼어도, 실제 진행 상태(event_progress)가 아직
      -- 'ended'에 도달하지 않았다면(추가시간/최종선택이 길어지는 등) 계속
      -- 목록에 남긴다 - 운영자가 라이브 화면으로 돌아갈 수 있어야 한다.
      or exists (
        select 1 from public.event_progress ep
        where ep.event_id = e.id and ep.stage is distinct from 'ended'
      )
    )
  group by e.id
  order by e.event_date asc, e.start_time asc;
end;
$function$;

notify pgrst, 'reload schema';
