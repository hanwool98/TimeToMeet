-- Return the current event venue only to the member/guest who has a confirmed
-- application for that event. Public and payment-pending screens keep using
-- the coarse events.location value and cannot call this RPC successfully.
create or replace function public.get_my_confirmed_event_venue(
  session_token text,
  event_id_value text
)
returns table (
  location text,
  venue_detail text
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
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

  return query
  select trim(coalesce(e.location, '')), trim(coalesce(e.venue_detail, ''))
  from public.applications a
  join public.events e on e.id = a.event_id
  where a.user_id = session_user_id
    and a.event_id = event_id_value
    and a.status = '참가 확정'
  order by a.submitted_at desc
  limit 1;
end;
$$;

revoke all on function public.get_my_confirmed_event_venue(text, text) from public;
grant execute on function public.get_my_confirmed_event_venue(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
