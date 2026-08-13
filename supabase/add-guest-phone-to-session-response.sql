drop function if exists public.create_guest_session(text, text);
create or replace function public.create_guest_session(phone_value text, pin_value text)
returns table (
  session_token text,
  user_id uuid,
  role text,
  expires_at timestamptz,
  phone_normalized text
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
  if exists (select 1 from public.guest_accounts where guest_accounts.phone_normalized = phone_value) then
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

  return query
  select issued.session_token, issued.user_id, issued.role, issued.expires_at, phone_value
  from public.issue_app_session(next_user_id, 'guest', interval '30 days') issued;
end;
$$;

drop function if exists public.login_guest_session(text, text);
create or replace function public.login_guest_session(phone_value text, pin_value text)
returns table (
  session_token text,
  user_id uuid,
  role text,
  expires_at timestamptz,
  phone_normalized text
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
  where guest_accounts.phone_normalized = phone_value
    and pin_hash = extensions.crypt(pin_value, pin_hash)
  limit 1;

  if target_user_id is null then
    perform public.record_guest_login_failure(phone_value);
    raise exception 'Invalid login.';
  end if;

  perform public.clear_guest_login_failures(phone_value);

  return query
  select issued.session_token, issued.user_id, issued.role, issued.expires_at, phone_value
  from public.issue_app_session(target_user_id, 'guest', interval '30 days') issued;
end;
$$;

grant execute on function public.create_guest_session(text, text) to anon, authenticated;
grant execute on function public.login_guest_session(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
