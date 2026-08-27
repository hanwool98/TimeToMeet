-- "행사 진행 초기화"의 기준점을 수정한다: 처음 버전은 event_profile_cards를
-- 보존한 채 라운드 진행부터만 되돌렸는데, 실제로 필요한 건 프로필카드
-- 작성 단계부터 행사 진행 전체를 반복 테스트하는 것이었다. 그래서 이번
-- 버전은 event_profile_cards(초안+제출본, 행사 전용 대표사진/crop 포함)도
-- 함께 지운다 - 신청/참가확정/체크인/태블릿 연결은 이전과 동일하게 그대로
-- 둔다.
--
-- event_profile_cards.photo_path가 가리키는 Storage 오브젝트
-- (upload-event-profile-card-photo가 "{userId}/event-card-{eventId}/..."
-- 경로에 올려둔 파일)는 이 함수가 서비스 롤 없이 일반 RPC로 실행되므로
-- 여기서 물리적으로 지우지 않는다 - DB 행이 사라지면 그 경로를 가리키는
-- 참조가 전혀 남지 않아(다른 어떤 화면도 이 경로로 signed URL을 다시
-- 발급하지 않음) 사실상 고아 상태의 접근 불가능한 파일로만 남는다. 실제
-- 스토리지 바이트까지 지우려면 (finalize_test_event_reset이 쓰는
-- reset-test-event 패턴처럼) 서비스 롤 Edge Function이 필요한데, 반복
-- 테스트용 소용량 파일 정리를 위해 이번 스코프에서 새 Edge Function을
-- 추가하지는 않는다.
--
-- get_admin_round_progress가 event_progress row가 없으면 예외를 던지므로
-- (｢행사 진행 상태가 없습니다.｣) 이 함수는 이전과 마찬가지로 그 행을
-- delete하지 않고 컬럼을 초기값으로 update만 한다.
create or replace function public.restart_test_event_progress_for_session(session_token text, event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  -- 하드 안전장치: 프론트에서 버튼을 숨기는 것과 무관하게, 실제 행사
  -- event_id를 넣어 직접 호출해도 절대 실행되지 않는다.
  if not exists (select 1 from public.events e where e.id = event_id_value and e.is_test_event = true) then
    raise exception '테스트 행사만 초기화할 수 있습니다.';
  end if;

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
  -- 로드된다.
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
end;
$$;

grant execute on function public.restart_test_event_progress_for_session(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
