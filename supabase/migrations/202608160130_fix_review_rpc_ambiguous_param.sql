-- Fix "column reference application_id is ambiguous" (PGRST/42702) raised when
-- approving/deciding on an application: the plpgsql parameter `application_id`
-- collided with the `applications`/`payment_invitations` column of the same
-- name inside the INSERT ... ON CONFLICT (application_id) statement. Renaming
-- the parameter removes the ambiguity entirely (safer than qualifying, since
-- Postgres's plpgsql preprocessor flags the collision before qualification
-- inside INSERT column-lists/ON CONFLICT targets ever gets evaluated).
drop function if exists public.update_application_review_for_session(
  text, uuid, public.application_status, timestamptz, timestamptz, timestamptz, text
);

create or replace function public.update_application_review_for_session(
  session_token text,
  target_application_id uuid,
  next_status public.application_status,
  next_payment_deadline timestamptz,
  next_payment_notice_sent_at timestamptz,
  next_reviewed_at timestamptz,
  next_review_reason text default null
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

  if not exists (
    select 1
    from public.applications a
    where a.id = target_application_id
      and a.status in ('심사 대기', '참여 보류')
  ) then
    raise exception 'Only applications currently under review or on hold can be updated.';
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

grant execute on function public.update_application_review_for_session(
  text, uuid, public.application_status, timestamptz, timestamptz, timestamptz, text
) to anon, authenticated;

notify pgrst, 'reload schema';
