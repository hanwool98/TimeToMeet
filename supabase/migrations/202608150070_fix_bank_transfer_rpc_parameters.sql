drop function if exists public.request_bank_transfer_confirmation(text, uuid, text);
drop function if exists public.request_bank_transfer_confirmation(text, uuid, text, boolean);
create or replace function public.request_bank_transfer_confirmation(
  session_token text,
  p_application_id uuid,
  depositor_name_value text,
  refund_policy_confirmed_value boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
  current_status public.application_status;
  current_deadline timestamptz;
begin
  select s.user_id
  into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest');

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  select a.status, a.payment_deadline
  into current_status, current_deadline
  from public.applications a
  where a.id = p_application_id
    and a.user_id = session_user_id
  for update;

  if current_status is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if current_status = '참가 확정' then
    return;
  end if;

  if current_status not in ('결제 대기', '결제중', '입금 확인 중') then
    raise exception '계좌이체 확인을 저장할 수 없는 상태입니다.';
  end if;

  if current_status = '결제 대기' and current_deadline is not null and current_deadline < now() then
    raise exception '결제 기한이 지났습니다.';
  end if;

  if nullif(trim(depositor_name_value), '') is null then
    raise exception '입금자명을 입력해주세요.';
  end if;

  if refund_policy_confirmed_value is not true then
    raise exception '환불 규정 확인이 필요합니다.';
  end if;

  update public.applications
  set
    depositor_name = trim(depositor_name_value),
    payment_method = 'bank_transfer',
    refund_policy_confirmed = true,
    refund_policy_confirmed_at = coalesce(refund_policy_confirmed_at, now()),
    transfer_guide_confirmed_at = coalesce(transfer_guide_confirmed_at, now()),
    transfer_intent_confirmed = true,
    deposit_requested_at = coalesce(deposit_requested_at, now()),
    deposit_failed_at = null,
    deposit_failure_reason = null,
    status = '결제중',
    updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.user_id = session_user_id;
end;
$$;

grant execute on function public.request_bank_transfer_confirmation(text, uuid, text, boolean) to anon, authenticated;

drop function if exists public.confirm_bank_transfer_for_session(text, uuid);
create or replace function public.confirm_bank_transfer_for_session(
  session_token text,
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_user_id uuid;
  target_application public.applications%rowtype;
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
  into target_application
  from public.applications
  where public.applications.id = p_application_id
  for update;

  if target_application.id is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if target_application.status = '참가 확정' then
    return;
  end if;

  if target_application.status not in ('결제중', '입금 확인 중') then
    raise exception '입금 확인 처리할 수 없는 상태입니다.';
  end if;

  update public.applications
  set
    status = '참가 확정',
    payment_method = coalesce(payment_method, 'bank_transfer'),
    payment_completed_at = coalesce(payment_completed_at, now()),
    payment_confirmed_by = admin_user_id,
    reviewed_at = coalesce(reviewed_at, now()),
    updated_at = now()
  where public.applications.id = p_application_id;

  insert into public.application_tickets (application_id, user_id, event_id)
  values (target_application.id, target_application.user_id, target_application.event_id)
  on conflict (application_id) do update set
    revoked_at = null,
    updated_at = now();

  update public.payment_invitations
  set read_at = coalesce(read_at, now()), dismissed_at = coalesce(dismissed_at, now()), updated_at = now()
  where public.payment_invitations.application_id = p_application_id;
end;
$$;

grant execute on function public.confirm_bank_transfer_for_session(text, uuid) to anon, authenticated;

drop function if exists public.reject_bank_transfer_for_session(text, uuid, text);
create or replace function public.reject_bank_transfer_for_session(
  session_token text,
  p_application_id uuid,
  failure_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  update public.applications
  set
    status = '결제 대기',
    deposit_failed_at = now(),
    deposit_failure_reason = coalesce(nullif(trim(failure_reason), ''), '입금 내역을 확인하지 못했습니다.'),
    updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.status in ('결제중', '입금 확인 중');
end;
$$;

grant execute on function public.reject_bank_transfer_for_session(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
