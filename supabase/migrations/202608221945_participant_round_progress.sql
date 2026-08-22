-- Participant-facing "행사 진행" screen support: (1) a session-gated read of
-- the caller's own current round/table/partner, mirroring
-- get_round_progress_for_tablet's shape but resolved via app_sessions
-- instead of a tablet connection token; (2) event_pause_requests gains a
-- request_type so "일시정지 요청" and "운영자 호출" can share one table/panel
-- without breaking the existing admin pause-requests UI (rows without a
-- type default to 'pause', matching every row created before this migration).
alter table public.event_pause_requests
  add column if not exists request_type text not null default 'pause';

alter table public.event_pause_requests
  drop constraint if exists event_pause_requests_request_type_check;

alter table public.event_pause_requests
  add constraint event_pause_requests_request_type_check check (request_type in ('pause', 'call_staff'));

create or replace function public.get_round_progress_for_participant(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
  assignment record;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname
  into assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.round_number = coalesce(target_progress.current_round, 1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  return jsonb_build_object(
    'ok', true,
    'stage', coalesce(target_progress.stage, 'seat_guide'),
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'tableNumber', assignment.table_number,
    'partnerNickname', assignment.partner_nickname
  );
end;
$$;

grant execute on function public.get_round_progress_for_participant(text, text) to anon, authenticated;

-- Extends the existing create_event_pause_request with a request type and
-- de-duplicates: repeatedly tapping the same button while a request is
-- still pending returns the existing row instead of inserting a new one.
-- The old 3-arg signature must be dropped explicitly - adding a 4th
-- parameter with a default does not replace it in Postgres' catalog, it
-- registers a second overload, which makes PostgREST's function lookup
-- ambiguous for any call that only passes 3 args.
drop function if exists public.create_event_pause_request(text, text, integer);

create or replace function public.create_event_pause_request(
  session_token text,
  event_id_value text,
  table_number_value integer,
  request_type_value text default 'pause'
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  existing_id uuid;
  new_id uuid;
begin
  if request_type_value not in ('pause', 'call_staff') then
    raise exception '알 수 없는 요청 유형입니다: %', request_type_value;
  end if;

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  select epr.id into existing_id
  from public.event_pause_requests epr
  where epr.event_id = event_id_value
    and epr.requested_by_application_id = target_application.id
    and epr.request_type = request_type_value
    and epr.status = 'pending'
  order by epr.requested_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.event_pause_requests (event_id, table_number, requested_by_application_id, requested_by_nickname, request_type)
  values (event_id_value, table_number_value, target_application.id, target_application.nickname, request_type_value)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_event_pause_request(text, text, integer, text) to anon, authenticated;

-- Surface request_type so the admin panel can distinguish "일시정지 요청"
-- from "운영자 호출" without changing the panel's existing pending-count/
-- resolve flow (both types still share status/resolve handling).
drop function if exists public.get_admin_pause_requests(text, text);

create or replace function public.get_admin_pause_requests(session_token text, event_id_value text)
returns table (id uuid, table_number integer, nickname text, requested_at timestamptz, status text, request_type text)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select epr.id, epr.table_number, epr.requested_by_nickname, epr.requested_at, epr.status, epr.request_type
  from public.event_pause_requests epr
  where epr.event_id = event_id_value
  order by epr.requested_at desc
  limit 50;
end;
$$;

grant execute on function public.get_admin_pause_requests(text, text) to anon, authenticated;
