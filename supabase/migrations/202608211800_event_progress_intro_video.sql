-- 행사 진행 상태(자리유도 -> 소개영상 -> 라운드대기 -> 라운드진행 -> 종료)를
-- 서버에 저장해 운영자와 모든 태블릿이 동일한 상태를 폴링으로 공유한다.
-- (이 프로젝트는 Supabase Auth를 쓰지 않아 관리자 전용 테이블의 RLS(is_admin())가
-- anon/authenticated 어느 쪽으로도 항상 false라 Realtime이 이벤트를 전달하지
-- 못한다 - 태블릿 자리유도 화면에서 이미 확인된 제약이라 여기서도 폴링을 사용한다.)
alter table public.events add column if not exists intro_video_url text;
alter table public.events add column if not exists intro_video_title text;
alter table public.events add column if not exists intro_video_description text;
alter table public.events add column if not exists ended_at timestamptz;

create table if not exists public.event_progress (
  event_id text primary key references public.events(id) on delete cascade,
  stage text not null default 'seat_guide',
  intro_video_status text not null default 'paused',
  intro_video_position_seconds numeric not null default 0,
  intro_video_updated_at timestamptz not null default now(),
  intro_video_completed_at timestamptz,
  current_round integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_progress enable row level security;

drop policy if exists "Admins can manage event progress" on public.event_progress;
create policy "Admins can manage event progress" on public.event_progress
  for all using (public.is_admin()) with check (public.is_admin());

-- 행사 시작: 기존 started_at 설정에 더해 event_progress를 '소개영상' 단계로
-- 초기화한다(이미 존재하면 건드리지 않음 - 새로고침 후 재호출되어도 진행 중인
-- 영상 위치가 리셋되지 않도록).
create or replace function public.start_admin_event_for_session(session_token text, event_id_value text)
returns timestamptz
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  today_kst date;
  result_started_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception 'Event not found.';
  end if;

  today_kst := (now() at time zone 'Asia/Seoul')::date;
  if not target_event.is_test_event and target_event.event_date <> today_kst then
    raise exception 'Event can only be started on its event date.';
  end if;

  update public.events
  set started_at = coalesce(started_at, now())
  where id = event_id_value
  returning started_at into result_started_at;

  insert into public.event_progress (event_id, stage, intro_video_status, intro_video_position_seconds, intro_video_updated_at)
  values (event_id_value, 'intro_video', 'playing', 0, now())
  on conflict (event_id) do nothing;

  return result_started_at;
end;
$$;

create or replace function public.get_admin_event_progress(session_token text, event_id_value text)
returns table (
  stage text,
  intro_video_status text,
  intro_video_position_seconds numeric,
  intro_video_updated_at timestamptz,
  intro_video_completed_at timestamptz,
  current_round integer,
  intro_video_url text,
  intro_video_title text,
  intro_video_description text
)
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
  select
    coalesce(ep.stage, 'seat_guide'),
    coalesce(ep.intro_video_status, 'paused'),
    coalesce(ep.intro_video_position_seconds, 0),
    ep.intro_video_updated_at,
    ep.intro_video_completed_at,
    ep.current_round,
    e.intro_video_url,
    e.intro_video_title,
    e.intro_video_description
  from public.events e
  left join public.event_progress ep on ep.event_id = e.id
  where e.id = event_id_value;
end;
$$;

grant execute on function public.get_admin_event_progress(text, text) to anon, authenticated;

create or replace function public.get_event_progress_for_tablet(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns table (
  ok boolean,
  stage text,
  intro_video_status text,
  intro_video_position_seconds numeric,
  intro_video_updated_at timestamptz,
  intro_video_completed_at timestamptz,
  current_round integer,
  intro_video_url text,
  intro_video_title text,
  intro_video_description text
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_tablets%rowtype;
begin
  select et.* into target
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::text, null::text, null::numeric, null::timestamptz, null::timestamptz, null::integer, null::text, null::text, null::text;
    return;
  end if;

  update public.event_tablets et set last_seen_at = now(), updated_at = now() where et.id = target.id;

  return query
  select
    true,
    coalesce(ep.stage, 'seat_guide'),
    coalesce(ep.intro_video_status, 'paused'),
    coalesce(ep.intro_video_position_seconds, 0),
    ep.intro_video_updated_at,
    ep.intro_video_completed_at,
    ep.current_round,
    e.intro_video_url,
    e.intro_video_title,
    e.intro_video_description
  from public.events e
  left join public.event_progress ep on ep.event_id = e.id
  where e.id = event_id_value;
end;
$$;

grant execute on function public.get_event_progress_for_tablet(text, integer, text) to anon, authenticated;

create or replace function public.control_event_intro_video_for_session(session_token text, event_id_value text, action text)
returns table (
  stage text,
  intro_video_status text,
  intro_video_position_seconds numeric,
  intro_video_updated_at timestamptz,
  intro_video_completed_at timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  now_ts timestamptz := now();
  live_position numeric;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found then
    raise exception '행사 진행 상태를 찾을 수 없습니다. 먼저 행사를 시작해주세요.';
  end if;

  if target.stage <> 'intro_video' then
    raise exception '소개영상 단계가 아닙니다.';
  end if;

  if target.intro_video_status = 'playing' then
    live_position := target.intro_video_position_seconds + extract(epoch from (now_ts - target.intro_video_updated_at));
  else
    live_position := target.intro_video_position_seconds;
  end if;
  live_position := greatest(0, live_position);

  if action = 'play' then
    update public.event_progress ep
    set intro_video_status = 'playing', intro_video_position_seconds = live_position, intro_video_updated_at = now_ts, updated_at = now_ts
    where ep.event_id = event_id_value;
  elsif action = 'pause' then
    update public.event_progress ep
    set intro_video_status = 'paused', intro_video_position_seconds = live_position, intro_video_updated_at = now_ts, updated_at = now_ts
    where ep.event_id = event_id_value;
  elsif action = 'restart' then
    update public.event_progress ep
    set intro_video_status = 'playing', intro_video_position_seconds = 0, intro_video_updated_at = now_ts, updated_at = now_ts
    where ep.event_id = event_id_value;
  elsif action in ('skip', 'complete') then
    update public.event_progress ep
    set stage = 'round_waiting',
        intro_video_status = 'paused',
        intro_video_position_seconds = live_position,
        intro_video_updated_at = now_ts,
        intro_video_completed_at = coalesce(ep.intro_video_completed_at, now_ts),
        updated_at = now_ts
    where ep.event_id = event_id_value;
  else
    raise exception '알 수 없는 동작입니다: %', action;
  end if;

  return query
  select ep.stage, ep.intro_video_status, ep.intro_video_position_seconds, ep.intro_video_updated_at, ep.intro_video_completed_at
  from public.event_progress ep where ep.event_id = event_id_value;
end;
$$;

grant execute on function public.control_event_intro_video_for_session(text, text, text) to anon, authenticated;

create or replace function public.start_first_round_for_session(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_waiting' then
    raise exception '소개영상이 끝난 후에만 라운드를 시작할 수 있습니다.';
  end if;

  update public.event_progress ep
  set stage = 'round_active', current_round = 1, updated_at = now()
  where ep.event_id = event_id_value;

  return 1;
end;
$$;

grant execute on function public.start_first_round_for_session(text, text) to anon, authenticated;

create or replace function public.end_admin_event_for_session(session_token text, event_id_value text)
returns timestamptz
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result_ended_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  update public.events
  set ended_at = coalesce(ended_at, now())
  where id = event_id_value
  returning ended_at into result_ended_at;

  update public.event_progress set stage = 'ended', updated_at = now() where event_id = event_id_value;

  return result_ended_at;
end;
$$;

grant execute on function public.end_admin_event_for_session(text, text) to anon, authenticated;
