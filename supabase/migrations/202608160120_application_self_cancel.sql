-- Let a participant cancel their own held (참여 보류) application. Ownership is
-- derived from the session token server-side, never trusted from the client;
-- only applications currently on hold can be canceled this way.
create or replace function public.cancel_my_held_application(
  session_token text,
  application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
begin
  select s.user_id
  into session_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  update public.applications
  set
    status = '신청 취소',
    canceled_at = coalesce(canceled_at, now()),
    cancel_reason = coalesce(cancel_reason, 'participant_self_canceled'),
    updated_at = now()
  where id = application_id
    and user_id = session_user_id
    and status = '참여 보류';

  if not found then
    raise exception 'Only a held application can be canceled.';
  end if;
end;
$$;

grant execute on function public.cancel_my_held_application(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
