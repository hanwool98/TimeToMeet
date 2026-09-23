-- 행사 신청 화면(EventDetailPage)에서 참가자 리스트가 아직 공개되지 않은
-- "행사 시작 72시간 이전" 구간에 보여줄 후기 콘텐츠를 위한 새 섹션 타입.
-- 기존 home_contents 테이블/RPC(update_home_content_for_session,
-- set_home_content_visible_for_session, reorder_home_contents_for_session,
-- delete_home_content_for_session)가 이미 section_type 문자열 하나로
-- 완전히 범용적으로 동작하므로, 새 테이블을 만들지 않고 이 체크 제약에
-- 값 하나만 추가한다(이미지 추가/삭제/순서변경/노출 관리 전부 그대로 재사용).
alter table public.home_contents drop constraint if exists home_contents_section_type_check;
alter table public.home_contents add constraint home_contents_section_type_check
  check (section_type in ('love_reason', 'field_sketch', 'recruitment_application', 'event_application_reviews'));
