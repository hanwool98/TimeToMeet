-- "참가자 체크인" 화면은 QR 스캔 즉시 체크인하지 않고, 먼저 참가자 정보를
-- 보여준 뒤 운영자가 "행사 입장 완료"를 눌러야 실제로 저장되어야 한다.
-- 기존 check_in_ticket_for_session은 스캔=즉시 체크인(mutating) 이었으므로,
-- 동일한 검증 로직을 읽기 전용으로 수행하는 미리보기 RPC를 새로 추가한다.
--
-- 동시에 check_in_ticket_for_session 자체도 두 가지를 보정한다:
--   1) 테스트 행사(is_test_event)는 행사 당일이 아니어도 체크인 가능해야 하는데
--      기존 구현은 이 예외가 빠져 있었다.
--   2) 안내 문구를 화면 요구사항에 맞게 다듬는다.
create or replace function public.get_admin_ticket_preview_for_session(
  session_token text,
  event_id_value text,
  qr_token_value text
)
returns table (
  ok boolean,
  already_checked_in boolean,
  message text,
  application_id text,
  application_no text,
  nickname text,
  checked_in_at timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_ticket public.application_tickets%rowtype;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select *
  into target_ticket
  from public.application_tickets
  where qr_token = regexp_replace(qr_token_value, '^t2m:', '', 'i');

  if target_ticket.application_id is null then
    return query select false, false, '유효하지 않은 QR입니다.', null::text, ''::text, ''::text, null::timestamptz;
    return;
  end if;

  select * into target_application from public.applications where id = target_ticket.application_id;
  select * into target_event from public.events where id = target_ticket.event_id;

  if target_ticket.event_id <> event_id_value then
    return query select
      false, false, '이 행사의 참가자가 아닙니다.',
      target_application.id::text, target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.revoked_at is not null or target_application.status <> '참가 확정' then
    return query select
      false, false, '취소되었거나 확정되지 않은 티켓입니다.',
      target_application.id::text, target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if not target_event.is_test_event and (now() at time zone 'Asia/Seoul')::date <> target_event.event_date then
    return query select
      false, false, '행사 당일에만 입장 확인할 수 있습니다.',
      target_application.id::text, target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.checked_in_at is not null then
    return query select
      true, true, '이미 체크인한 참가자입니다.',
      target_application.id::text, target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  return query select
    true, false, '참가자 정보를 확인했습니다.',
    target_application.id::text, target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
end;
$$;

grant execute on function public.get_admin_ticket_preview_for_session(text, text, text) to anon, authenticated;

create or replace function public.check_in_ticket_for_session(session_token text, event_id_value text, qr_token_value text)
returns table (ok boolean, already_checked_in boolean, message text, application_no text, nickname text, checked_in_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  admin_user_id uuid;
  target_ticket public.application_tickets%rowtype;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role = 'admin';

  select *
  into target_ticket
  from public.application_tickets
  where qr_token = regexp_replace(qr_token_value, '^t2m:', '', 'i')
  for update;

  if target_ticket.application_id is null then
    return query select false, false, '유효하지 않은 QR입니다.', ''::text, ''::text, null::timestamptz;
    return;
  end if;

  select * into target_application from public.applications where id = target_ticket.application_id;
  select * into target_event from public.events where id = target_ticket.event_id;

  if target_ticket.event_id <> event_id_value then
    return query select false, false, '이 행사의 참가자가 아닙니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.revoked_at is not null or target_application.status <> '참가 확정' then
    return query select false, false, '취소되었거나 확정되지 않은 티켓입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if not target_event.is_test_event and (now() at time zone 'Asia/Seoul')::date <> target_event.event_date then
    return query select false, false, '행사 당일에만 입장 확인할 수 있습니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.checked_in_at is not null then
    return query select true, true, '이미 체크인한 참가자입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  update public.application_tickets
  set checked_in_at = now(), checked_in_by = admin_user_id, updated_at = now()
  where application_id = target_ticket.application_id
  returning public.application_tickets.checked_in_at into target_ticket.checked_in_at;

  update public.applications
  set checked_in_at = target_ticket.checked_in_at, checked_in_by = admin_user_id, updated_at = now()
  where id = target_ticket.application_id;

  return query select true, false, '입장 확인이 완료되었습니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
end;
$$;
