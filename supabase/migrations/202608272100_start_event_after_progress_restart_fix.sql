-- 버그: restart_test_event_progress_for_session("행사 진행 초기화")는
-- event_progress 행을 지우지 않고 stage='seat_guide'로 UPDATE만 한다
-- (get_admin_round_progress 등 다른 RPC가 이 행이 없으면 예외를 던지므로
-- 일부러 유지). 그런데 start_admin_event_for_session은 "행사가 처음
-- 시작될 때는 event_progress 행 자체가 아직 없다"는 걸 전제로
-- `on conflict (event_id) do nothing`을 쓰고 있었다 - 초기화 후 이미 행이
-- 존재하는 상태에서 "행사 시작"을 누르면 insert가 조용히 무시되어
-- events.started_at만 바뀌고 stage는 영원히 seat_guide에 멈춰버렸다.
--
-- 행이 있어도 아직 시작 전 상태(seat_guide)라면 intro_video로 밀어주도록
-- do update ... where 조건을 추가한다 - 이미 진행 중이거나 끝난 행사의
-- 기존 event_progress는 stage가 seat_guide가 아니므로 이 조건에 걸리지
-- 않아 전혀 영향받지 않는다.
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

  insert into public.event_progress (event_id, stage, intro_video_status, intro_video_position_seconds, intro_video_updated_at)
  values (event_id_value, 'intro_video', 'playing', 0, now())
  on conflict (event_id) do update
    set stage = 'intro_video',
        intro_video_status = 'playing',
        intro_video_position_seconds = 0,
        intro_video_updated_at = now()
    where public.event_progress.stage = 'seat_guide';

  perform public.generate_round_schedule_if_missing(event_id_value);

  return result_started_at;
end;
$$;
