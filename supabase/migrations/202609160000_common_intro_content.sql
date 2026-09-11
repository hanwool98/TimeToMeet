-- 행사소개 콘텐츠를 "행사별로 따로 관리"하는 구조에서 "타임투밋 공통
-- 소개 콘텐츠 하나를 관리"하는 구조로 전면 변경한다. 이전 마이그레이션
-- (202609150000)이 만든 event_intro_sections/event_intro_images는 event_id
-- 기준으로 나뉘어 있었는데, 실제로는 한 건도 사용되지 않은 채(신규 기능,
-- 프로덕션 데이터 0건 확인 후) 방향이 바뀌었으므로 그대로 지우고 event_id
-- 없는 공통 테이블로 다시 만든다. 행사별 자동 정보(행사명/날짜/장소/가격/
-- 인원/대표이미지/모집상태)는 여전히 events 테이블에서만 읽고 여기 저장하지
-- 않는다 - 이 테이블들은 그 아래 붙는 공통 텍스트/이미지 갤러리 콘텐츠만
-- 담당한다.
drop function if exists public.create_event_intro_section_for_session(text, text, text, text, text);
drop function if exists public.update_event_intro_section_for_session(text, uuid, text, text);
drop function if exists public.set_event_intro_section_visible_for_session(text, uuid, boolean);
drop function if exists public.reorder_event_intro_sections_for_session(text, text, uuid[]);
drop function if exists public.delete_event_intro_section_for_session(text, uuid);
drop function if exists public.reorder_event_intro_images_for_session(text, uuid, uuid[]);
drop function if exists public.update_event_intro_image_caption_for_session(text, uuid, text);
drop function if exists public.delete_event_intro_image_for_session(text, uuid);

drop table if exists public.event_intro_images;
drop table if exists public.event_intro_sections;

create table public.intro_sections (
  id uuid primary key default gen_random_uuid(),
  section_type text not null check (section_type in ('text', 'gallery')),
  title text,
  content text,
  display_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index intro_sections_order_idx on public.intro_sections (display_order);

create table public.intro_images (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.intro_sections(id) on delete cascade,
  storage_path text not null,
  caption text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index intro_images_section_order_idx on public.intro_images (section_id, display_order);

alter table public.intro_sections enable row level security;
alter table public.intro_images enable row level security;

create policy "intro_sections no direct access" on public.intro_sections for all using (false);
create policy "intro_images no direct access" on public.intro_images for all using (false);

create trigger intro_sections_touch_updated_at
before update on public.intro_sections
for each row execute function public.touch_updated_at();

-- 기존 EventInfoPage에 하드코딩돼 있던 소개 문구를 그대로 초기값으로
-- 옮긴다(빈 페이지로 시작하지 않도록) - 순서도 기존 페이지 순서를 따른다.
-- 사진이 없던 "후기" 자리는 실제 콘텐츠가 아니었으므로 옮기지 않는다.
insert into public.intro_sections (section_type, title, content, display_order) values
(
  'text',
  '새로운 만남이 가장 기대되는 시간',
  '미혼남녀가 가장 선호하는 소개팅 시간대는 주말 초저녁이었습니다.

단순히 연인을 찾는 것을 넘어, 내 시간을 함께하고 싶은 사람을 만나는 곳.

행사의 끝이 새로운 만남의 시작이 될 수 있도록,

Time to Meet
여러분의 새로운 만남이 시작될 시간입니다.',
  1
),
(
  'text',
  '왜 타임투밋인가요?',
  '전용 앱으로 편안하게
타임투밋은 전용 앱을 사용합니다. 행사 중에도 앱이 설치된 태블릿을 사용하여 더욱 쉽게 즐길 수 있습니다.

닉네임으로 부담없이
행사 중에는 닉네임을 사용합니다. 실명 및 연락처는 매칭 전까지 공개되지 않습니다.

첫인상은 외모만이 아닙니다
참가자들을 만나보기 전에 목소리를 먼저 들어보세요!

I도 편하게 즐길 수 있는 대화
태블릿을 통해 100개가 넘는 대화 주제를 제공받아 누구나 편하게 대화할 수 있어요.

불편한 순간엔 바로 신고
상대방의 부적절한 언행을 발견하면 개인 휴대전화의 앱을 통해 즉시 운영자에게 알릴 수 있어요.

만남이 아쉬웠다면 한번 더
첫번째 대화가 끝난 후 호감도를 반영해 특정 인물 2-3인과 2nd 대화 찬스가 제공됩니다.

차분한 자리의 소개팅
차를 마시며 편안하게 대화할 수 있는 분위기에서 진행됩니다.',
  2
),
(
  'text',
  '진행순서',
  '1. 입장 및 안내
2. 1:1 로테이션 대화
3. 호감도 작성 및 메모
4. 자리 이동
5. 2nd 대화 찬스
6. 최종선택
7. 매칭',
  3
),
(
  'text',
  '콘텐츠 참여 혜택',
  '행사 후기 콘텐츠 제작(유튜브, 릴스, 블로그 등)에 참여하고 싶으시다면 타임투밋 공식 DM으로 문의해주세요.

별도의 참여 혜택을 안내해드립니다.',
  4
);

-- ── 관리자: 섹션 생성 ──
create or replace function public.create_intro_section_for_session(
  session_token text,
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

  select coalesce(max(display_order), 0) + 1 into next_order from public.intro_sections;

  insert into public.intro_sections (section_type, title, content, display_order)
  values (
    section_type_value,
    nullif(trim(coalesce(title_value, '')), ''),
    nullif(trim(coalesce(content_value, '')), ''),
    next_order
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_intro_section_for_session(text, text, text, text) to anon, authenticated;

-- ── 관리자: 제목/본문 수정 ──
create or replace function public.update_intro_section_for_session(
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

  update public.intro_sections
  set title = nullif(trim(coalesce(title_value, '')), ''),
      content = nullif(trim(coalesce(content_value, '')), '')
  where id = section_id_value;

  if not found then
    raise exception '섹션을 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.update_intro_section_for_session(text, uuid, text, text) to anon, authenticated;

-- ── 관리자: 노출/숨김 ──
create or replace function public.set_intro_section_visible_for_session(
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

  update public.intro_sections set is_visible = coalesce(is_visible_value, is_visible) where id = section_id_value;
  if not found then
    raise exception '섹션을 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.set_intro_section_visible_for_session(text, uuid, boolean) to anon, authenticated;

-- ── 관리자: 섹션 순서 변경(공통 콘텐츠 전체 안에서 하나의 순서) ──
create or replace function public.reorder_intro_sections_for_session(
  session_token text,
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

  update public.intro_sections s
  set display_order = pos.ordinality
  from unnest(ordered_ids) with ordinality as pos(id, ordinality)
  where s.id = pos.id;
end;
$$;

grant execute on function public.reorder_intro_sections_for_session(text, uuid[]) to anon, authenticated;

-- ── 관리자: 섹션 삭제(그 안 이미지들의 storage_path를 반환) ──
create or replace function public.delete_intro_section_for_session(
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
  from public.intro_images where section_id = section_id_value;

  delete from public.intro_sections where id = section_id_value;
  if not found then
    raise exception '섹션을 찾을 수 없습니다.';
  end if;

  return removed_paths;
end;
$$;

grant execute on function public.delete_intro_section_for_session(text, uuid) to anon, authenticated;

-- ── 관리자: 이미지 순서 변경(같은 섹션 안에서만) ──
create or replace function public.reorder_intro_images_for_session(
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

  update public.intro_images img
  set display_order = pos.ordinality
  from unnest(ordered_ids) with ordinality as pos(id, ordinality)
  where img.id = pos.id and img.section_id = section_id_value;
end;
$$;

grant execute on function public.reorder_intro_images_for_session(text, uuid, uuid[]) to anon, authenticated;

-- ── 관리자: 이미지 캡션 수정 ──
create or replace function public.update_intro_image_caption_for_session(
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

  update public.intro_images set caption = coalesce(trim(caption_value), '') where id = image_id_value;
  if not found then
    raise exception '이미지를 찾을 수 없습니다.';
  end if;
end;
$$;

grant execute on function public.update_intro_image_caption_for_session(text, uuid, text) to anon, authenticated;

-- ── 관리자: 이미지 삭제(storage_path 반환) ──
create or replace function public.delete_intro_image_for_session(
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

  delete from public.intro_images where id = image_id_value
  returning storage_path into removed_path;

  if removed_path is null then
    raise exception '이미지를 찾을 수 없습니다.';
  end if;

  return removed_path;
end;
$$;

grant execute on function public.delete_intro_image_for_session(text, uuid) to anon, authenticated;
