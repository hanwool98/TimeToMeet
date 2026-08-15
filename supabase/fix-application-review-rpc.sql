drop function if exists public.update_application_review_for_session(
  text,
  uuid,
  public.application_status,
  timestamptz,
  timestamptz,
  timestamptz,
  text
);

create or replace function public.update_application_review_for_session(
  session_token text,
  application_id uuid,
  next_status public.application_status,
  next_payment_deadline timestamptz,
  next_payment_notice_sent_at timestamptz,
  next_reviewed_at timestamptz,
  review_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_user_id uuid;
  previous_status_value public.application_status;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.role = 'admin'
    and s.expires_at > now()
  limit 1;

  select a.status
  into previous_status_value
  from public.applications a
  where a.id = update_application_review_for_session.application_id
  for update;

  if previous_status_value is null then
    raise exception 'Application not found.';
  end if;

  if previous_status_value <> '심사 대기' then
    return;
  end if;

  update public.applications
  set
    is_new = false,
    payment_deadline = case when next_status = '결제 대기' then next_payment_deadline else null end,
    payment_notice_sent_at = case when next_status = '결제 대기' then next_payment_notice_sent_at else null end,
    reviewed_at = coalesce(next_reviewed_at, now()),
    status = next_status,
    updated_at = now()
  where id = update_application_review_for_session.application_id;

  insert into public.application_review_logs (
    application_id,
    reviewed_by,
    previous_status,
    next_status,
    reason
  )
  values (
    update_application_review_for_session.application_id,
    admin_user_id,
    previous_status_value,
    next_status,
    nullif(btrim(review_reason), '')
  );

  if next_status = '결제 대기' then
    insert into public.payment_invitations (
      application_id,
      user_id
    )
    select
      a.id,
      a.user_id
    from public.applications a
    where a.id = update_application_review_for_session.application_id
      and a.payment_deadline is not null
      and a.payment_deadline > now()
    on conflict on constraint payment_invitations_application_id_key do update set
      read_at = null,
      dismissed_at = null,
      updated_at = now();
  else
    update public.payment_invitations pi
    set
      dismissed_at = coalesce(pi.dismissed_at, now()),
      read_at = coalesce(pi.read_at, now()),
      updated_at = now()
    where pi.application_id = update_application_review_for_session.application_id
      and next_status in ('참여 보류', '반려', '참가 확정', '환불 완료', '자동 취소');
  end if;
end;
$$;

grant execute on function public.update_application_review_for_session(text, uuid, public.application_status, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;

notify pgrst, 'reload schema';
