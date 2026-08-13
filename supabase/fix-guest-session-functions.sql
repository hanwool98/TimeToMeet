create or replace function public.issue_app_session(target_user_id uuid, target_role text, ttl interval default interval '30 days')
returns table (
  session_token text,
  user_id uuid,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text := gen_random_uuid()::text || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.app_sessions (token_hash, user_id, role, expires_at)
  values (public.hash_app_session_token(raw_token), target_user_id, target_role, now() + ttl);

  issue_app_session.session_token := raw_token;
  issue_app_session.user_id := target_user_id;
  issue_app_session.role := target_role;
  issue_app_session.expires_at := now() + ttl;
  return next;
end;
$$;

create or replace function public.get_app_session_user_id(session_token text, allowed_roles text[] default array['member', 'guest'])
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select app_sessions.user_id
  from public.app_sessions
  where app_sessions.token_hash = public.hash_app_session_token(session_token)
    and app_sessions.expires_at > now()
    and app_sessions.role = any(allowed_roles)
  limit 1;
$$;

create or replace function public.create_guest_session(phone_value text, pin_value text)
returns table (
  session_token text,
  user_id uuid,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_user_id uuid;
begin
  if phone_value !~ '^01[016789][0-9]{7,8}$' then
    raise exception 'Invalid phone number.';
  end if;
  if pin_value !~ '^[0-9]{6}$' then
    raise exception 'Invalid PIN.';
  end if;
  if exists (select 1 from public.guest_accounts where phone_normalized = phone_value) then
    raise exception 'Guest account already exists.';
  end if;

  insert into public.app_users (account_type)
  values ('guest')
  returning app_users.user_id into next_user_id;

  insert into public.guest_accounts (user_id, phone_normalized, pin_hash)
  values (next_user_id, phone_value, extensions.crypt(pin_value, extensions.gen_salt('bf')));

  insert into public.user_accounts (user_id, account_type)
  values (next_user_id, 'guest')
  on conflict on constraint user_accounts_pkey do update set account_type = 'guest', updated_at = now();

  return query select * from public.issue_app_session(next_user_id, 'guest', interval '30 days');
end;
$$;

create or replace function public.login_guest_session(phone_value text, pin_value text)
returns table (
  session_token text,
  user_id uuid,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if not public.can_attempt_guest_login(phone_value) then
    raise exception 'Too many attempts.';
  end if;

  select guest_accounts.user_id
  into target_user_id
  from public.guest_accounts
  where phone_normalized = phone_value
    and pin_hash = extensions.crypt(pin_value, pin_hash)
  limit 1;

  if target_user_id is null then
    perform public.record_guest_login_failure(phone_value);
    raise exception 'Invalid login.';
  end if;

  perform public.clear_guest_login_failures(phone_value);
  return query select * from public.issue_app_session(target_user_id, 'guest', interval '30 days');
end;
$$;

create or replace function public.login_member_session(login_id_value text, password_value text)
returns table (
  session_token text,
  user_id uuid,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  select member_accounts.user_id
  into target_user_id
  from public.member_accounts
  where lower(login_id) = lower(trim(login_id_value))
    and password_hash = extensions.crypt(password_value, password_hash)
  limit 1;

  if target_user_id is null then
    raise exception 'Invalid login.';
  end if;

  return query select * from public.issue_app_session(target_user_id, 'member', interval '30 days');
end;
$$;

grant execute on function public.issue_app_session(uuid, text, interval) to anon, authenticated;
grant execute on function public.get_app_session_user_id(text, text[]) to anon, authenticated;
grant execute on function public.create_guest_session(text, text) to anon, authenticated;
grant execute on function public.login_guest_session(text, text) to anon, authenticated;
grant execute on function public.login_member_session(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
