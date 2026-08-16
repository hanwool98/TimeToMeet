-- update_application_review_for_session only allowed transitions starting
-- from '심사 대기' or '참여 보류'. AdminEventParticipantsPage uses this same
-- RPC to cancel ('자동 취소') or hold ('참여 보류') a participant who is
-- already '참가 확정' (e.g. a no-show or dispute discovered after
-- confirmation), so that call always hit the guard's exception and the
-- admin's "참여 취소" / "참여 대기 전환" buttons could never succeed.
create or replace function public.update_application_review_for_session(
  session_token text,
  target_application_id uuid,
  next_status application_status,
  next_payment_deadline timestamptz,
  next_payment_notice_sent_at timestamptz,
  next_reviewed_at timestamptz,
  next_review_reason text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if not exists (
    select 1
    from public.applications a
    where a.id = target_application_id
      and a.status in ('심사 대기', '참여 보류', '참가 확정')
  ) then
    raise exception 'Only applications currently under review, on hold, or already confirmed can be updated.';
  end if;

  update public.applications
  set
    is_new = false,
    payment_deadline = next_payment_deadline,
    payment_notice_sent_at = next_payment_notice_sent_at,
    reviewed_at = coalesce(next_reviewed_at, now()),
    status = next_status,
    review_reason = next_review_reason,
    updated_at = now()
  where id = target_application_id;

  if next_status = '결제 대기' then
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
      and next_status in ('참여 보류', '반려', '참가 확정', '환불 완료', '자동 취소');
  end if;
end;
$$;
