-- Tablets connect themselves: an operator logs into the admin app once on
-- each physical tablet to claim a number (connect_event_tablet_for_session),
-- then the tablet stores a per-connection secret token in localStorage and
-- uses it (verify_event_tablet_connection) to restore/heartbeat its
-- connection on every reload WITHOUT needing another admin login - matching
-- the same "anon-callable, token-gated" pattern already used for test-event
-- preview tokens elsewhere in this project.
alter table public.event_tablets add column if not exists connection_token_hash text;

create or replace function public.connect_event_tablet_for_session(
  session_token text,
  event_id_value text,
  table_number_value integer
)
returns table (connection_token text, connected_at timestamptz, table_number integer)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  required_tablets integer;
  existing public.event_tablets%rowtype;
  new_token text;
  now_ts timestamptz := now();
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  if not target_event.is_test_event and target_event.event_date <> (now_ts at time zone 'Asia/Seoul')::date then
    raise exception '행사 당일에만 태블릿을 연결할 수 있습니다.';
  end if;

  required_tablets := greatest(1, least(target_event.male_capacity, target_event.female_capacity));
  if table_number_value < 1 or table_number_value > required_tablets then
    raise exception '이 행사에서 사용할 수 없는 태블릿 번호입니다.';
  end if;

  select * into existing
  from public.event_tablets
  where event_id = event_id_value and table_number = table_number_value
  for update;

  if found and existing.connection_status = 'online' then
    raise exception '%번 태블릿은 이미 연결되어 있습니다.', table_number_value;
  end if;

  new_token := encode(extensions.gen_random_bytes(32), 'hex');

  if found then
    update public.event_tablets
    set connection_status = 'online',
        connection_token_hash = encode(extensions.digest(new_token, 'sha256'), 'hex'),
        device_label = table_number_value || '번 태블릿',
        last_seen_at = now_ts,
        updated_at = now_ts
    where id = existing.id;
  else
    insert into public.event_tablets (event_id, table_number, device_label, connection_status, connection_token_hash, last_seen_at)
    values (event_id_value, table_number_value, table_number_value || '번 태블릿', 'online', encode(extensions.digest(new_token, 'sha256'), 'hex'), now_ts);
  end if;

  return query select new_token, now_ts, table_number_value;
end;
$$;

grant execute on function public.connect_event_tablet_for_session(text, text, integer) to anon, authenticated;

create or replace function public.verify_event_tablet_connection(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns table (ok boolean, connected_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_tablets%rowtype;
begin
  select * into target
  from public.event_tablets
  where event_id = event_id_value
    and table_number = table_number_value
    and connection_status = 'online'
    and connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::timestamptz;
    return;
  end if;

  update public.event_tablets
  set last_seen_at = now(), updated_at = now()
  where id = target.id;

  return query select true, target.created_at;
end;
$$;

grant execute on function public.verify_event_tablet_connection(text, integer, text) to anon, authenticated;

create or replace function public.disconnect_event_tablet_for_session(
  session_token text,
  event_id_value text,
  table_number_value integer
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

  update public.event_tablets
  set connection_status = 'offline',
      connection_token_hash = null,
      updated_at = now()
  where event_id = event_id_value and table_number = table_number_value;
end;
$$;

grant execute on function public.disconnect_event_tablet_for_session(text, text, integer) to anon, authenticated;
