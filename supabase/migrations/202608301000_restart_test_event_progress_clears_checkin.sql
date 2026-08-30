-- "행사 진행 초기화"가 지금까지는 체크인 상태(applications/application_tickets
-- 의 checked_in_at/checked_in_by)를 그대로 유지했는데, 운영자가 실제 현장에서
-- 반복 테스트할 때 체크인부터 다시 시작하고 싶어해서 이제 이것도 함께 지운다.
-- 이 RPC는 함수 맨 앞에서 e.is_test_event = true를 하드 검증하므로(우회 불가),
-- 실제 행사 참가자의 체크인 기록을 지울 위험은 없다.
create or replace function public.restart_test_event_progress_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  orphaned_paths text[];
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  -- 하드 안전장치: 프론트에서 버튼을 숨기는 것과 무관하게, 실제 행사
  -- event_id를 넣어 직접 호출해도 절대 실행되지 않는다.
  if not exists (select 1 from public.events e where e.id = event_id_value and e.is_test_event = true) then
    raise exception '테스트 행사만 초기화할 수 있습니다.';
  end if;

  select coalesce(array_agg(photo_path), '{}') into orphaned_paths
  from public.event_profile_cards where event_id = event_id_value and photo_path is not null;

  delete from public.event_table_assignments where event_id = event_id_value;
  delete from public.round_ratings where event_id = event_id_value;
  delete from public.final_selections where event_id = event_id_value;
  delete from public.final_selection_submissions where event_id = event_id_value;
  delete from public.event_pause_requests where event_id = event_id_value;
  delete from public.participant_reports where event_id = event_id_value;
  delete from public.event_preround_seats where event_id = event_id_value;
  delete from public.event_profile_cards where event_id = event_id_value;

  -- 체크인도 초기화 대상에 포함한다 - applications와 application_tickets
  -- 양쪽 다 checked_in_at을 갖고 있어(finalize_application_check_in이 둘 다
  -- 채움) 같이 지워야 한다.
  update public.application_tickets
  set checked_in_at = null, checked_in_by = null, updated_at = now()
  where application_id in (select id from public.applications where event_id = event_id_value);

  update public.applications
  set final_selection_submitted_at = null,
      checked_in_at = null,
      checked_in_by = null
  where event_id = event_id_value;

  update public.events set started_at = null, ended_at = null where id = event_id_value;

  update public.event_progress
  set stage = 'seat_guide', intro_video_status = 'paused', intro_video_position_seconds = 0,
      intro_video_updated_at = now(), intro_video_completed_at = null, current_round = null,
      round_phase = null, round_timer_status = 'paused', round_timer_position_seconds = 0,
      round_timer_updated_at = null, is_bonus_round = false, round_phase_started_at = null,
      updated_at = now()
  where event_id = event_id_value;

  return jsonb_build_object('ok', true, 'orphanedPhotoPaths', to_jsonb(orphaned_paths));
end;
$$;

notify pgrst, 'reload schema';
