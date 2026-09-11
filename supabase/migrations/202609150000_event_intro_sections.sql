-- 행사 상세/소개 페이지(참가자 /events/:eventId/info)를 관리자가 행사별로
-- 직접 편집할 수 있게 하는 콘텐츠 구조. 날짜/시간/장소/가격/인원 같은
-- 운영 정보는 여기 저장하지 않는다 - events 테이블이 그대로 유일한
-- source of truth이고, 이 테이블들은 그 정보 아래에 붙는 자유 콘텐츠
-- (텍스트/이미지 갤러리)만 담당한다.
-- 이미지는 Storage 서명(service role)이 필요해 RPC로는 못 다루므로
-- home_contents와 동일하게 조회/업로드는 Edge Function(event-intro,
-- upload-event-intro-image)이 처리하고, 여기 RPC들은 텍스트 필드 CRUD와
-- 순서 변경만 담당한다. 삭제 RPC는 지워야 할 storage_path를 반환하고
-- 클라이언트가 기존 admin-delete-storage-objects로 실제 파일을 정리한다.
create table if not exists public.event_intro_sections (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  section_type text not null check (section_type in ('text', 'gallery')),
  title text,
  content text,
  display_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_intro_sections_event_order_idx
  on public.event_intro_sections (event_id, display_order);

create table if not exists public.event_intro_images (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.event_intro_sections(id) on delete cascade,
  storage_path text not null,
  caption text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_intro_images_section_order_idx
  on public.event_intro_images (section_id, display_order);

alter table public.event_intro_sections enable row level security;
alter table public.event_intro_images enable row level security;

drop policy if exists "event_intro_sections no direct access" on public.event_intro_sections;
create policy "event_intro_sections no direct access" on public.event_intro_sections for all using (false);

drop policy if exists "event_intro_images no direct access" on public.event_intro_images;
create policy "event_intro_images no direct access" on public.event_intro_images for all using (false);

drop trigger if exists event_intro_sections_touch_updated_at on public.event_intro_sections;
create trigger event_intro_sections_touch_updated_at
before update on public.event_intro_sections
for each row execute function public.touch_updated_at();

-- ── 관리자: 섹션 생성 ──
create or replace function public.create_event_intro_section_for_session(
  session_token text,
  event_id_value text,
  section_type_value text,
  title_value text default null,
  content_value text default null
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
    raise exception '관리자 권한이 필요합니다.';
  end if;
  if section_type_value not in ('text', 'gallery') then
    raise exception '알 수 없는 섹션 유형입니다.';
  end if;
  if not exists (select 1 from public.events where id = event_id_value) then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  select coalesce(max(display_order), 0) + 1 into next_order
  from public.event_intro_sections where event_id = event_id_value;

  insert into public.event_intro_sections (event_id, section_type, title, content, display_order)
  values (
    event_id_value,
    section_type_value,
    nullif(trim(coalesce(title_value, '')), ''),
    nullif(trim(coalesce(content_value, '')), ''),
    next_order
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_event_intro_section_for_session(text, text, text, text, text) to anon, authenticated;

-- ── 관리자: 제목/본문 수정 ──
create or replace function public.update_event_intro_section_for_session(
  session_token text,
  section_id_value uuid,
  title_value text,
  content_value text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  update public.event_intro_sections
  set title = nullif(trim(coalesce(title_value, '')), ''),
      content = nullif(trim(coalesce(content_value, '')), '')
  where id = section_id_value;

  if not found then
    raise exception '섹션을 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.update_event_intro_section_for_session(text, uuid, text, text) to anon, authenticated;

-- ── 관리자: 노출/숨김 ──
create or replace function public.set_event_intro_section_visible_for_session(
  session_token text,
  section_id_value uuid,
  is_visible_value boolean
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  update public.event_intro_sections set is_visible = coalesce(is_visible_value, is_visible) where id = section_id_value;
  if not found then
    raise exception '섹션을 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.set_event_intro_section_visible_for_session(text, uuid, boolean) to anon, authenticated;

-- ── 관리자: 섹션 순서 변경(같은 행사 안에서만) ──
create or replace function public.reorder_event_intro_sections_for_session(
  session_token text,
  event_id_value text,
  ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  update public.event_intro_sections s
  set display_order = pos.ordinality
  from unnest(ordered_ids) with ordinality as pos(id, ordinality)
  where s.id = pos.id and s.event_id = event_id_value;
end;
$$;

grant execute on function public.reorder_event_intro_sections_for_session(text, text, uuid[]) to anon, authenticated;

-- ── 관리자: 섹션 삭제(그 안 이미지들의 storage_path를 반환) ──
create or replace function public.delete_event_intro_section_for_session(
  session_token text,
  section_id_value uuid
)
returns text[]
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  removed_paths text[];
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  select coalesce(array_agg(storage_path), '{}') into removed_paths
  from public.event_intro_images where section_id = section_id_value;

  delete from public.event_intro_sections where id = section_id_value;
  if not found then
    raise exception '섹션을 찾을 수 없습니다.';
  end if;

  return removed_paths;
end;
$$;

grant execute on function public.delete_event_intro_section_for_session(text, uuid) to anon, authenticated;

-- ── 관리자: 이미지 순서 변경(같은 섹션 안에서만) ──
create or replace function public.reorder_event_intro_images_for_session(
  session_token text,
  section_id_value uuid,
  ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  update public.event_intro_images img
  set display_order = pos.ordinality
  from unnest(ordered_ids) with ordinality as pos(id, ordinality)
  where img.id = pos.id and img.section_id = section_id_value;
end;
$$;

grant execute on function public.reorder_event_intro_images_for_session(text, uuid, uuid[]) to anon, authenticated;

-- ── 관리자: 이미지 캡션 수정 ──
create or replace function public.update_event_intro_image_caption_for_session(
  session_token text,
  image_id_value uuid,
  caption_value text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  update public.event_intro_images set caption = coalesce(trim(caption_value), '') where id = image_id_value;
  if not found then
    raise exception '이미지를 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.update_event_intro_image_caption_for_session(text, uuid, text) to anon, authenticated;

-- ── 관리자: 이미지 삭제(storage_path 반환) ──
create or replace function public.delete_event_intro_image_for_session(
  session_token text,
  image_id_value uuid
)
returns text
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  removed_path text;
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  delete from public.event_intro_images where id = image_id_value
  returning storage_path into removed_path;

  if removed_path is null then
    raise exception '이미지를 찾을 수 없습니다.';
  end if;

  return removed_path;
end;
$$;

grant execute on function public.delete_event_intro_image_for_session(text, uuid) to anon, authenticated;
