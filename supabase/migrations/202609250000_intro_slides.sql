-- 행사 진행 중 "소개영상" 단계를 운영자가 직접 손으로 넘기는 "행사 소개
-- 슬라이드"로 교체한다. 기존 event_progress.stage 값('intro_video')과
-- start_first_round_for_session의 게이트 조건(stage='round_waiting' +
-- 전원 프로필카드 제출)은 그대로 두고, 그 stage 안에서 보여주는 화면과
-- 진행 방식만 영상 재생에서 슬라이드 넘김으로 바꾼다 - "기존 행사 진행
-- 로직을 깨지 않고 소개 단계만 교체"하기 위해 stage 이름은 일부러
-- 그대로 둔다(내부 식별자일 뿐 화면에 노출되지 않음).

-- (1) 슬라이드 자체는 행사별로 따로 관리하지 않는 전역 하나의 덱이다 -
-- 관리자가 한 번 등록해두면 모든 행사가 같은 순서로 사용한다.
create table if not exists public.event_intro_slides (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  image_path text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_intro_slides_sort_order_idx on public.event_intro_slides (sort_order);

alter table public.event_intro_slides enable row level security;
drop policy if exists "No direct intro slide access" on public.event_intro_slides;
create policy "No direct intro slide access"
on public.event_intro_slides
for all
using (false)
with check (false);

-- (2) 진행 상태에 "지금 몇 번째 슬라이드인지"만 더한다 - 영상의
-- position/status 스냅샷과 달리 슬라이드는 연속 재생이 아니라 이산적인
-- 페이지 이동이라 인덱스 하나면 충분하다.
alter table public.event_progress add column if not exists intro_slide_index integer not null default 0;

-- (3) 행사 시작 시 슬라이드 인덱스도 0으로 초기화한다(기존 intro_video_*
-- 초기화 로직은 그대로 유지 - 컬럼 자체를 지우지 않으므로 건드릴 필요가
-- 없다. 단순히 더 이상 화면에서 쓰지 않을 뿐이다).
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

  insert into public.event_progress (event_id, stage, intro_video_status, intro_video_position_seconds, intro_video_updated_at, intro_slide_index)
  values (event_id_value, 'intro_video', 'playing', 0, now(), 0)
  on conflict (event_id) do update
    set stage = 'intro_video',
        intro_video_status = 'playing',
        intro_video_position_seconds = 0,
        intro_video_updated_at = now(),
        intro_slide_index = 0
    where public.event_progress.stage = 'seat_guide';

  perform public.generate_round_schedule_if_missing(event_id_value);

  return result_started_at;
end;
$$;

-- (4) 운영자/태블릿이 폴링으로 받는 진행 상태에 intro_slide_index를
-- 추가한다 - 반환 컬럼 목록이 바뀌므로 drop 후 재생성한다.
drop function if exists public.get_admin_event_progress(text, text);

create function public.get_admin_event_progress(session_token text, event_id_value text)
returns table (
  stage text,
  intro_video_status text,
  intro_video_position_seconds numeric,
  intro_video_updated_at timestamptz,
  intro_video_completed_at timestamptz,
  current_round integer,
  intro_video_url text,
  intro_video_title text,
  intro_video_description text,
  intro_slide_index integer
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

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
    e.intro_video_description,
    coalesce(ep.intro_slide_index, 0)
  from public.events e
  left join public.event_progress ep on ep.event_id = e.id
  where e.id = event_id_value;
end;
$$;

grant execute on function public.get_admin_event_progress(text, text) to anon, authenticated;

drop function if exists public.get_event_progress_for_tablet(text, integer, text);

create function public.get_event_progress_for_tablet(
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
  intro_video_description text,
  intro_slide_index integer
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
    return query select false, null::text, null::text, null::numeric, null::timestamptz, null::timestamptz, null::integer, null::text, null::text, null::text, null::integer;
    return;
  end if;

  update public.event_tablets et set last_seen_at = now(), updated_at = now() where et.id = target.id;

  perform public.advance_round_state_if_needed(event_id_value);

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
    e.intro_video_description,
    coalesce(ep.intro_slide_index, 0)
  from public.events e
  left join public.event_progress ep on ep.event_id = e.id
  where e.id = event_id_value;
end;
$$;

grant execute on function public.get_event_progress_for_tablet(text, integer, text) to anon, authenticated;

-- (5) 슬라이드 이동 전용 제어 함수 - 기존 control_event_intro_video_for_session
-- 는 영상 재생/일시정지 전용 액션(play/pause/restart)을 그대로 갖고 있어
-- 슬라이드 의미와 맞지 않는 부분이 있으므로 건드리지 않고 새 함수를
-- 추가한다(기존 함수는 더 이상 프론트에서 호출하지 않지만, 그대로 둬도
-- 무해하다).
--   - next: 다음 슬라이드로. 이미 마지막 슬라이드면 그대로 완료 처리
--     (round_waiting으로 전환) - "마지막 슬라이드까지 진행 완료"가 라운드
--     시작 활성화 조건 중 하나이기 때문.
--   - prev: 이전 슬라이드로. 이미 첫 슬라이드면 아무 동작 없음.
--   - goto: target_index로 직접 이동(스와이프 등으로 이미 계산된 인덱스를
--     그대로 반영할 때 사용, next/prev와 동일한 범위 검증을 거친다).
--   - skip / complete: 건너뛰기 / 소개 종료 버튼 - 둘 다 즉시
--     round_waiting으로 전환한다(기존 영상의 skip/complete와 동일하게
--     서버에서는 구분하지 않는다 - 두 버튼 모두 "지금 바로 다음 단계로"라는
--     동일한 효과이고, 라벨만 다르다).
create or replace function public.control_event_intro_slides_for_session(
  session_token text,
  event_id_value text,
  action text,
  target_index integer default null
)
returns table (
  stage text,
  intro_slide_index integer
)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  slide_count integer;
  next_index integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found then
    raise exception '행사 진행 상태를 찾을 수 없습니다. 먼저 행사를 시작해주세요.';
  end if;

  if target.stage <> 'intro_video' then
    raise exception '행사 소개 슬라이드 단계가 아닙니다.';
  end if;

  select count(*) into slide_count from public.event_intro_slides;

  if action = 'next' then
    if slide_count = 0 or target.intro_slide_index >= slide_count - 1 then
      update public.event_progress ep
      set stage = 'round_waiting', updated_at = now()
      where ep.event_id = event_id_value;
    else
      update public.event_progress ep
      set intro_slide_index = target.intro_slide_index + 1, updated_at = now()
      where ep.event_id = event_id_value;
    end if;
  elsif action = 'prev' then
    if target.intro_slide_index > 0 then
      update public.event_progress ep
      set intro_slide_index = target.intro_slide_index - 1, updated_at = now()
      where ep.event_id = event_id_value;
    end if;
  elsif action = 'goto' then
    if target_index is null or slide_count = 0 then
      raise exception '이동할 슬라이드가 올바르지 않습니다.';
    end if;
    next_index := greatest(0, least(slide_count - 1, target_index));
    update public.event_progress ep
    set intro_slide_index = next_index, updated_at = now()
    where ep.event_id = event_id_value;
  elsif action in ('skip', 'complete') then
    update public.event_progress ep
    set stage = 'round_waiting', updated_at = now()
    where ep.event_id = event_id_value;
  else
    raise exception '알 수 없는 동작입니다: %', action;
  end if;

  return query
  select ep.stage, ep.intro_slide_index from public.event_progress ep where ep.event_id = event_id_value;
end;
$$;

grant execute on function public.control_event_intro_slides_for_session(text, text, text, integer) to anon, authenticated;

-- (6) 라운드 시작 게이트 조건은 그대로(stage='round_waiting' + 전원
-- 프로필카드 제출) - 에러 문구만 "소개영상" -> "행사 소개"로 바꾼다.
create or replace function public.start_first_round_for_session(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  table_count integer;
  active_count integer;
  submitted_count integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_waiting' then
    raise exception '행사 소개가 끝난 후에만 라운드를 시작할 수 있습니다.';
  end if;

  select count(*) into active_count
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active';

  select count(*) into submitted_count
  from public.applications a
  join public.event_profile_cards epc on epc.event_id = a.event_id and epc.application_id = a.id
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and epc.submitted_at is not null;

  if submitted_count < active_count then
    raise exception '프로필 카드를 아직 제출하지 않은 참가자가 있습니다 (%/%명 제출).', submitted_count, active_count;
  end if;

  delete from public.event_table_assignments where event_id = event_id_value;
  perform public.generate_round_schedule_if_missing(event_id_value);

  select count(distinct table_number) into table_count from public.event_table_assignments where event_id = event_id_value;

  update public.event_progress ep
  set stage = 'round_active', current_round = 1, round_phase = 'conversation',
      round_timer_status = 'running', round_timer_position_seconds = 0,
      round_timer_updated_at = now(), updated_at = now()
  where ep.event_id = event_id_value;

  return table_count;
end;
$$;

-- (7) 관리자 "행사 소개 슬라이드 관리" CRUD. 이미지는 Storage 서명이
-- 필요해서(비공개 버킷) 목록 조회는 RPC가 아니라 Edge Function
-- (admin-list-intro-slides, tablet-list-intro-slides - intro-content와
-- 동일한 이유/패턴)이 담당한다. 여기서는 메타데이터(제목/경로/순서)만
-- 다루는, 서명이 필요 없는 CRUD만 RPC로 둔다.
create or replace function public.create_admin_intro_slide_for_session(
  session_token text,
  title_value text,
  image_path_value text
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  next_order integer;
  new_id uuid;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if trim(coalesce(image_path_value, '')) = '' then
    raise exception '슬라이드 이미지가 필요합니다.';
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_order from public.event_intro_slides;

  insert into public.event_intro_slides (title, image_path, sort_order)
  values (trim(coalesce(title_value, '')), image_path_value, next_order)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_admin_intro_slide_for_session(text, text, text) to anon, authenticated;

-- image_path_value가 null이면 이미지는 그대로 두고 제목만 바꾼다. 실제로
-- 이미지를 교체한 경우 이전 경로를 반환해 호출부가
-- admin-delete-storage-objects로 정리할 수 있게 한다.
create or replace function public.update_admin_intro_slide_for_session(
  session_token text,
  slide_id_value uuid,
  title_value text,
  image_path_value text default null
)
returns text
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  old_path text;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select image_path into old_path from public.event_intro_slides where id = slide_id_value;
  if not found then
    raise exception '슬라이드를 찾을 수 없습니다.';
  end if;

  update public.event_intro_slides
  set title = trim(coalesce(title_value, '')),
      image_path = coalesce(nullif(trim(coalesce(image_path_value, '')), ''), image_path),
      updated_at = now()
  where id = slide_id_value;

  if image_path_value is not null and trim(image_path_value) <> '' and old_path <> image_path_value then
    return old_path;
  end if;
  return null;
end;
$$;

grant execute on function public.update_admin_intro_slide_for_session(text, uuid, text, text) to anon, authenticated;

-- 삭제된 슬라이드의 image_path를 반환해 호출부가 Storage 정리를 하게 한다.
create or replace function public.delete_admin_intro_slide_for_session(session_token text, slide_id_value uuid)
returns text
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  removed_path text;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  delete from public.event_intro_slides where id = slide_id_value
  returning image_path into removed_path;

  if not found then
    raise exception '슬라이드를 찾을 수 없습니다.';
  end if;

  return removed_path;
end;
$$;

grant execute on function public.delete_admin_intro_slide_for_session(text, uuid) to anon, authenticated;

-- 순서 변경(위/아래 이동, drag & drop 모두 결과적으로 "새 전체 순서
-- 배열"을 만들어 이 함수 하나로 저장한다) - 배열에 없는 id는 건드리지
-- 않는다(방어적).
create or replace function public.reorder_admin_intro_slides_for_session(session_token text, ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  slide_id uuid;
  idx integer := 0;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  foreach slide_id in array ordered_ids loop
    update public.event_intro_slides set sort_order = idx, updated_at = now() where id = slide_id;
    idx := idx + 1;
  end loop;
end;
$$;

grant execute on function public.reorder_admin_intro_slides_for_session(text, uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';
