-- 문제 2 (원인 1/2): 태블릿의 "자리 유도" 화면(get_event_table_seat_guide)은
-- event_table_assignments를 정상적으로 읽고 있었지만, 그 테이블을 채우는
-- generate_round_schedule_if_missing이 지금까지 그 어디서도 "행사 시작" 시점에
-- 호출되지 않았다 - start_admin_event_for_session은 event_progress만
-- 만들고 곧장 intro_video로 넘어갈 뿐, 실제 라운드 스케줄(테이블 배정)은
-- 이후 라운드 진행 중 advance_round_state_if_needed의 self-heal 경로에서야
-- 뒤늦게 생성됐다. 그래서 체크인이 끝난 뒤 태블릿을 미리 연결해 두면
-- event_table_assignments가 비어 있는 채로 계속 폴링만 하게 됐다.
--
-- generate_round_schedule_if_missing은 이미 있으면 손대지 않는 멱등 함수이고,
-- active 참가자가 0명이면 조용히 아무 것도 하지 않으므로 여기서 미리
-- 호출해도 안전하다 - "행사 시작과 동시에 전 테이블 배정이 한 번에 끝난다"는
-- 의도를 실제로 구현한다.
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
  on conflict (event_id) do nothing;

  perform public.generate_round_schedule_if_missing(event_id_value);

  return result_started_at;
end;
$$;
