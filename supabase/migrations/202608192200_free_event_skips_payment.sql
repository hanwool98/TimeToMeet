-- A 0원 event (applications.payment_amount = 0, computed server-side at
-- submission time from events.male_price/female_price and never trusted
-- from the client) has nothing to collect payment for, so approving such an
-- application should go straight to 참가 확정 instead of 결제 대기. This
-- keeps the existing paid flow (승인 → 결제대기 → 결제확인 → 참가확정)
-- completely untouched - it only changes what happens when an admin
-- approves an application whose payment_amount is exactly 0.
--
-- payment_amount is `integer not null`, so there is no null/undefined/empty
-- case to misinterpret as free - only a genuine stored 0 triggers this.
--
-- The function now returns the status actually applied (which callers use
-- to know whether the requested 결제 대기 was silently turned into 참가
-- 확정) instead of void.
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

  select a.payment_amount
  into target_payment_amount
  from public.applications a
  where a.id = target_application_id
    and a.status in ('심사 대기', '참여 보류', '참가 확정')
  for update;

  if not found then
    raise exception 'Only applications currently under review, on hold, or already confirmed can be updated.';
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
