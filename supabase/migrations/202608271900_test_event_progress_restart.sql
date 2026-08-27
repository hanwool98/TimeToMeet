-- "행사 진행 초기화" - 기존 "행사 전체 테스트 초기화"(finalize_test_event_reset,
-- applications까지 통째로 delete)와는 완전히 별개 기능이다. 이건 체크인/
-- 프로필카드/태블릿 연결은 그대로 둔 채 "라운드 진행 중 생성된 데이터"만
-- 지워서, 참가자 재생성 없이 라운드 흐름만 반복 테스트할 수 있게 한다.
--
-- 지우는 대상(모두 event_id로 확인된, 라운드 진행 중에만 생성되는 데이터):
--   - event_table_assignments (정규 + 추가시간 배정 전부, is_bonus 구분 없이)
--   - round_ratings (정규 호감도 + 추가시간 수정본 - 같은 테이블)
--   - final_selections / final_selection_submissions
--   - event_pause_requests (참가자 "도움 요청"/일시정지 요청)
--   - participant_reports (참가자 신고)
--   - event_preround_seats (1라운드 시작 전 좌석 draft - 다음 "행사 시작" 때
--     ensure_preround_seats_for_event가 그대로 재생성한다)
-- applications/application_tickets/event_profile_cards/event_tablets는
-- 전혀 건드리지 않는다 - 체크인/프로필카드/태블릿 연결 유지가 이 기능의
-- 핵심 목적이다.
--
-- events.started_at/ended_at과 event_progress를 "행사 시작을 아직 한 번도
-- 누르지 않은" 최초 기본값(stage 기본값 'seat_guide' 등 컬럼 default와
-- 동일)으로 되돌린다 - 그러면 운영자가 준비 화면에서 "행사 시작"을 다시
-- 누르는 것만으로 start_admin_event_for_session -> generate_round_schedule_if_missing
-- 이라는 기존에 이미 검증된 정상 경로를 그대로 다시 타면서 새 체크인
-- 상태 기준으로 라운드 스케줄이 처음부터 재생성된다 - 이 함수가 직접
-- "시작 직후" 상태를 흉내 낼 필요가 없다.
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
