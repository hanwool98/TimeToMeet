-- 문제 1: 남자(또는 여자) 정원이 이미 찬 상태에서도 심사 승인('결제 대기'
-- 요청, 0원 행사면 그 자리에서 '참가 확정'으로 자동 승격)이 그대로 통과되는
-- 버그. update_application_review_for_session에는 애초에 정원 검증이 전혀
-- 없었다 - 화면단에서 막아도 두 관리자가 동시에 승인하면 그대로 뚫리므로,
-- 검증은 반드시 이 RPC 안(실제 승인 처리 지점)에 있어야 한다.
--
-- "정원을 차지한 상태"로 취급하는 status는 결제 대기/결제중/입금 확인
-- 중/참가 확정 - 아직 결제가 끝나지 않았어도 이미 그 성비의 자리 하나를
-- 예약한 것으로 보고, 반려/신청취소/자동취소/환불완료/참여보류는 자리를
-- 비운 것으로 본다(AdminApplicationsPage의 결제/완료 탭 필터와 동일한 분류).
--
-- 동시 승인 레이스는 events 행을 select ... for update로 잠가 직렬화한다 -
-- 같은 이벤트에 대한 두 번째 승인 트랜잭션은 첫 번째가 커밋될 때까지 여기서
-- 대기했다가, 갱신된 카운트로 다시 검사하게 된다.
drop function if exists public.update_application_review_for_session(text, uuid, application_status, timestamptz, timestamptz, timestamptz, text);

create function public.update_application_review_for_session(
  session_token text,
  target_application_id uuid,
  next_status application_status,
  next_payment_deadline timestamptz,
  next_payment_notice_sent_at timestamptz,
  next_reviewed_at timestamptz,
  next_review_reason text default null
)
returns application_status
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  admin_user_id uuid;
  target_payment_amount integer;
  target_event_id text;
  target_gender text;
  target_capacity integer;
  occupied_count integer;
  applied_status application_status;
  is_free_confirmation boolean;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role = 'admin';

  select a.payment_amount, a.event_id, a.gender
  into target_payment_amount, target_event_id, target_gender
  from public.applications a
  where a.id = target_application_id
    and a.status in ('심사 대기', '참여 보류', '참가 확정')
  for update;

  if not found then
    raise exception 'Only applications currently under review, on hold, or already confirmed can be updated.';
  end if;

  if next_status = '결제 대기' then
    -- Serializes concurrent approvals for the same event so two admins
    -- approving two different applications for the same gender at the same
    -- moment can't both pass the capacity check below.
    perform 1 from public.events where id = target_event_id for update;

    select case when target_gender = '남성' then e.male_capacity else e.female_capacity end
    into target_capacity
    from public.events e
    where e.id = target_event_id;

    select count(*)
    into occupied_count
    from public.applications a
    where a.event_id = target_event_id
      and a.gender = target_gender
      and a.id <> target_application_id
      and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정');

    if target_capacity is not null and occupied_count >= target_capacity then
      raise exception '% 정원이 모두 찼습니다 (%/%)', target_gender, occupied_count, target_capacity;
    end if;
  end if;

  is_free_confirmation := next_status = '결제 대기' and target_payment_amount = 0;
  applied_status := case when is_free_confirmation then '참가 확정'::application_status else next_status end;

  update public.applications
  set
    is_new = false,
    payment_deadline = case when is_free_confirmation then null else next_payment_deadline end,
    payment_notice_sent_at = case when is_free_confirmation then null else next_payment_notice_sent_at end,
    reviewed_at = coalesce(next_reviewed_at, now()),
    status = applied_status,
    review_reason = next_review_reason,
    payment_method = case when is_free_confirmation then coalesce(payment_method, 'free') else payment_method end,
    payment_completed_at = case when is_free_confirmation then coalesce(payment_completed_at, now()) else payment_completed_at end,
    payment_confirmed_by = case when is_free_confirmation then coalesce(payment_confirmed_by, admin_user_id) else payment_confirmed_by end,
    updated_at = now()
  where id = target_application_id;

  if is_free_confirmation then
    -- Same ticket-issuance side effect confirm_bank_transfer_for_session
    -- does for a paid confirmation, so a free participant gets a QR ticket
    -- exactly like everyone else once confirmed.
    insert into public.application_tickets (application_id, user_id, event_id)
    select a.id, a.user_id, a.event_id
    from public.applications a
    where a.id = target_application_id
    on conflict (application_id) do update set
      revoked_at = null,
      updated_at = now();
  end if;

  if applied_status = '결제 대기' then
    insert into public.payment_invitations (application_id, user_id)
    select a.id, a.user_id
    from public.applications a
    where a.id = target_application_id
      and a.payment_deadline is not null
      and a.payment_deadline > now()
    on conflict (application_id) do update set
      read_at = null, dismissed_at = null, updated_at = now();
  else
    update public.payment_invitations
    set dismissed_at = coalesce(dismissed_at, now()), read_at = coalesce(read_at, now()), updated_at = now()
    where payment_invitations.application_id = target_application_id
      and applied_status in ('참여 보류', '반려', '참가 확정', '환불 완료', '자동 취소');
  end if;

  return applied_status;
end;
$$;

grant execute on function public.update_application_review_for_session(text, uuid, application_status, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;
