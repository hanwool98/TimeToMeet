-- 참가 신청 마감 기능 제거 요청: 더 이상 어떤 신청도 마감일 때문에 막지
-- 않는다. events.application_deadline 컬럼과 관리자 화면의 입력 필드는
-- 그대로 남겨두되(불필요한 스키마/관리자 UI 변경 회피), 실제로 신청을
-- 막던 유일한 서버측 관문이었던 이 트리거만 무력화한다 - 클라이언트/
-- Edge Function 쪽 마감 체크는 프론트 코드에서 별도로 제거했다.
create or replace function public.enforce_event_application_deadline()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  return new;
end;
$$;
