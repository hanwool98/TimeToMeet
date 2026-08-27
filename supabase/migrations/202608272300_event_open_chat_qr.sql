-- 행사별 오픈채팅방 QR 코드 이미지 경로. Storage 서명이 필요해 실제
-- 업로드/삭제/조회는 Edge Function(upload-event-open-chat-qr,
-- delete-event-open-chat-qr, get-event-open-chat-qr)이 처리하고, 여기서는
-- 그 경로를 담을 컬럼만 추가한다(추가 전용, nullable).
alter table public.events add column if not exists open_chat_qr_path text;
