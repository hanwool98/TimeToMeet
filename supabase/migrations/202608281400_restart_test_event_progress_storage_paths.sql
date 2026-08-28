-- "행사 진행 초기화"가 event_profile_cards를 지우기 직전에, 행사 전용으로
-- 업로드된 photo_path(기본 프로필 사진이 아닌 것만)를 먼저 모아 반환하게
-- 한다 - 클라이언트가 이걸로 admin-delete-storage-objects Edge Function을
-- 호출해 실제 Storage 파일까지 정리할 수 있게 하기 위함. 반환 타입이
-- void->jsonb로 바뀌므로 drop 후 재생성한다.
drop function if exists public.restart_test_event_progress_for_session(text, text);

create function public.restart_test_event_progress_for_session(session_token text, event_id_value text)
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

  select coalesce(array_agg(photo_path), '{}')
  into orphaned_paths
  from public.event_profile_cards
  where event_id = event_id_value and photo_path is not null;

  delete from public.event_table_assignments where event_id = event_id_value;
  delete from public.round_ratings where event_id = event_id_value;
  delete from public.final_selections where event_id = event_id_value;
  delete from public.final_selection_submissions where event_id = event_id_value;
  delete from public.event_pause_requests where event_id = event_id_value;
  delete from public.participant_reports where event_id = event_id_value;
  delete from public.event_preround_seats where event_id = event_id_value;
  -- 행사 전용 프로필카드(대표사진/crop/취미/MBTI/... + 제출 상태) 초기화 -
  -- 참가자의 기본 프로필(닉네임/나이/직업/기본 대표사진)은 applications에
  -- 그대로 남아있으므로 카드 작성 화면을 다시 열면 그 기본값으로 정상
  -- 로드된다. Storage의 실제 파일 삭제는 이 함수 밖(Edge Function)에서
  -- orphaned_paths를 받아 처리한다 - 이 RPC는 서비스 롤이 아니라 Storage
  -- API를 직접 호출할 수 없다.
  delete from public.event_profile_cards where event_id = event_id_value;

  -- final_selections/submissions를 지웠으므로 레거시 동기화 컬럼도 함께
  -- 되돌려야 한다 - 안 그러면 simulate_test_event_final_selections가
  -- "이미 제출됨"으로 착각해 다음 테스트에서 조용히 건너뛴다.
  update public.applications
  set final_selection_submitted_at = null
  where event_id = event_id_value;

  update public.events
  set started_at = null, ended_at = null
  where id = event_id_value;

  update public.event_progress
  set stage = 'seat_guide',
      intro_video_status = 'paused',
      intro_video_position_seconds = 0,
      intro_video_updated_at = now(),
      intro_video_completed_at = null,
      current_round = null,
      round_phase = null,
      round_timer_status = 'paused',
      round_timer_position_seconds = 0,
      round_timer_updated_at = null,
      is_bonus_round = false,
      round_phase_started_at = null,
      updated_at = now()
  where event_id = event_id_value;

  return jsonb_build_object('ok', true, 'orphanedPhotoPaths', to_jsonb(orphaned_paths));
end;
$$;

grant execute on function public.restart_test_event_progress_for_session(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
