-- 수동(직접) 체크인을 위한 서버 로직. QR 체크인(check_in_ticket_for_session)과
-- 완전히 동일한 최종 저장 로직을 공유하도록, 실제 체크인 기록(application_tickets/
-- applications 갱신)을 finalize_application_check_in 헬퍼로 뽑아내고 두 RPC
-- 모두 이 헬퍼를 통해서만 체크인을 저장한다. 헬퍼는 PUBLIC/anon/authenticated
-- 어디에도 직접 노출하지 않는다(자체 인증 검증이 없으므로 SECURITY DEFINER
-- 함수 내부에서만 호출되어야 함).
create or replace function public.finalize_application_check_in(admin_user_id uuid, target_application_id uuid)
returns table (checked_in_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result_checked_in_at timestamptz;
begin
  update public.application_tickets
  set checked_in_at = coalesce(checked_in_at, now()),
      checked_in_by = coalesce(checked_in_by, admin_user_id),
      updated_at = now()
  where application_id = target_application_id
  returning public.application_tickets.checked_in_at into result_checked_in_at;

  update public.applications
  set checked_in_at = result_checked_in_at,
      checked_in_by = coalesce(checked_in_by, admin_user_id),
      updated_at = now()
  where id = target_application_id;

  return query select result_checked_in_at;
end;
$$;

revoke all on function public.finalize_application_check_in(uuid, uuid) from public, anon, authenticated;

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
  result_checked_in_at timestamptz;
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

  select f.checked_in_at into result_checked_in_at from public.finalize_application_check_in(admin_user_id, target_ticket.application_id) f;

  return query select true, false, '입장 확인이 완료되었습니다.', target_application.application_no, target_application.nickname, result_checked_in_at;
end;
$$;

create or replace function public.check_in_application_for_session(session_token text, event_id_value text, application_id_value uuid)
returns table (ok boolean, already_checked_in boolean, message text, application_no text, nickname text, checked_in_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  admin_user_id uuid;
  target_application public.applications%rowtype;
  target_ticket public.application_tickets%rowtype;
  target_event public.events%rowtype;
  result_checked_in_at timestamptz;
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

  select * into target_application from public.applications where id = application_id_value for update;
  if not found then
    return query select false, false, '참가자를 찾을 수 없습니다.', ''::text, ''::text, null::timestamptz;
    return;
  end if;

  if target_application.event_id <> event_id_value then
    return query select false, false, '이 행사의 참가자가 아닙니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;

  if target_application.status <> '참가 확정' then
    return query select false, false, '참가 확정 상태가 아닌 참가자입니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  if not target_event.is_test_event and (now() at time zone 'Asia/Seoul')::date <> target_event.event_date then
    return query select false, false, '행사 당일에만 입장 확인할 수 있습니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  select * into target_ticket from public.application_tickets where application_id = application_id_value;

  if not found then
    return query select false, false, '체크인 정보를 찾을 수 없습니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  if target_ticket.checked_in_at is not null then
    return query select true, true, '이미 체크인한 참가자입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  select f.checked_in_at into result_checked_in_at from public.finalize_application_check_in(admin_user_id, application_id_value) f;

  return query select true, false, '입장 확인이 완료되었습니다.', target_application.application_no, target_application.nickname, result_checked_in_at;
end;
$$;

grant execute on function public.check_in_application_for_session(text, text, uuid) to anon, authenticated;
