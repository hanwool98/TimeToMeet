-- [타임투밋 결제대기 흐름 수정 - 결제기한 이후 확인 허용 + 관리자 참가확정 독립 처리]
--
-- 문제 1: request_bank_transfer_confirmation(참가자의 "확인했습니다")이
-- payment_deadline을 지났다는 이유만으로 예외를 던져 제출 자체를 막고
-- 있었다. paymentDeadline은 안내용 정보로만 남기고, 상태가 '결제 대기'인
-- 동안은 기한과 무관하게 제출을 허용한다.
--
-- 문제 2: confirm_bank_transfer_for_session(관리자의 "참가 확정")이
-- status in ('결제중', '입금 확인 중')만 허용해서, 참가자가 아직
-- "확인했습니다"를 누르지 않아 상태가 '결제 대기'에 머물러 있으면
-- 관리자가 실제 입금을 확인했어도 참가확정으로 바꿀 방법이 없었다.
-- 참가자 확인 여부는 운영자에게 주는 보조 정보일 뿐, 참가확정의
-- 필수조건이 되어서는 안 되므로 '결제 대기'도 허용 상태에 추가한다.
--
-- 두 함수 모두 기존과 동일하게 `for update`로 해당 application 행을
-- 잠그고, 이미 '참가 확정'이면 조용히 return하는 멱등 처리를 그대로
-- 유지한다 - 그래서 참가자 confirmation과 관리자 참가확정이 거의
-- 동시에 들어와도, 먼저 commit된 쪽이 상태를 정하고 나중에 lock을
-- 얻는 쪽은 갱신된 최신 상태를 보고 안전하게 처리된다(상태 역행 없음).
--
-- 그 외 결제금액/계좌정보/신청승인/QR/체크인/행사모드/환불/soft delete/
-- payment_deadline 값 자체는 전혀 건드리지 않는다. 자동 취소 cron은
-- 이미 202609300300에서 비활성화되어 있어 이번 변경과 무관하다.

create or replace function public.request_bank_transfer_confirmation(session_token text, p_application_id uuid, depositor_name_value text, refund_policy_confirmed_value boolean default true)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  session_user_id uuid;
  current_status public.application_status;
  current_event_id text;
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

  select a.status, a.event_id
  into current_status, current_event_id
  from public.applications a
  where a.id = p_application_id
    and a.user_id = session_user_id
  for update;

  if current_status is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if exists (select 1 from public.events where id = current_event_id and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  if current_status = '참가 확정' then
    return;
  end if;

  if current_status not in ('결제 대기', '결제중', '입금 확인 중') then
    raise exception '계좌이체 확인을 저장할 수 없는 상태입니다.';
  end if;

  -- (변경) 결제기한이 지났다는 이유로 제출을 막던 raise exception을
  -- 제거했다. payment_deadline은 화면 안내용으로만 쓰고, 실제 입금
  -- 여부 판단은 관리자가 한다.

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

create or replace function public.confirm_bank_transfer_for_session(session_token text, p_application_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
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

  if exists (select 1 from public.events where id = target_application.event_id and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  if target_application.status = '참가 확정' then
    return;
  end if;

  -- (변경) '결제 대기'를 허용 상태에 추가 - 참가자가 아직 "확인했습니다"를
  -- 누르지 않았어도, 관리자가 실제 입금 내역을 확인했다면 바로 참가확정
  -- 처리할 수 있어야 한다.
  if target_application.status not in ('결제 대기', '결제중', '입금 확인 중') then
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
