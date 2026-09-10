-- 홈(메인 대시보드) 캐러셀에 쓰는 관리자 관리형 이미지 콘텐츠.
-- 행사/참가/결제와 무관한 순수 마케팅 콘텐츠다.
--   section_type: love_reason(타임투밋이 사랑받는 이유),
--                 field_sketch(현장 스케치),
--                 recruitment_application(모집방식 & 신청방식 - 구조만 미리
--                 준비, 실제 콘텐츠는 다음 단계)
-- 이미지 파일은 기존 단일 버킷(application-files)의 home-contents/ 프리픽스에
-- 저장하고, Storage 서명이 필요해 업로드/조회는 Edge Function
-- (upload-home-content, home-contents)이 처리한다. 삭제 시 고아 파일 정리는
-- 기존 admin-delete-storage-objects Edge Function을 재사용한다.
-- crop_position: 업로드한 원본에 바깥 흰 여백이 있어도 홈 카드 영역만 꽉
-- 차게 보이도록 관리자가 지정하는 확대/이동값. RepresentativeCrop과 동일한
-- {scale, offsetX, offsetY} 형태(오프셋은 표시 박스 대비 비율).
create table if not exists public.home_contents (
  id uuid primary key default gen_random_uuid(),
  section_type text not null check (section_type in ('love_reason', 'field_sketch', 'recruitment_application')),
  storage_path text not null,
  caption text not null default '',
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  crop_position jsonb not null default '{"scale": 1, "offsetX": 0, "offsetY": 0}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists home_contents_section_order_idx
  on public.home_contents (section_type, sort_order, created_at);

alter table public.home_contents enable row level security;

-- 조회/서명은 전부 service-role Edge Function을 거치므로 직접 접근은 막는다
-- (관리자 변경은 아래 security definer RPC들이 is_admin_session으로 검증).
drop policy if exists "No direct home content access" on public.home_contents;
create policy "No direct home content access" on public.home_contents for all using (false);

create or replace function public.update_home_content_for_session(
  session_token text,
  content_id uuid,
  caption_value text,
  crop_position_value jsonb
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

  update public.home_contents hc
  set caption = coalesce(caption_value, ''),
      crop_position = coalesce(crop_position_value, hc.crop_position),
      updated_at = now()
  where hc.id = content_id;
end;
$$;

grant execute on function public.update_home_content_for_session(text, uuid, text, jsonb) to anon, authenticated;

create or replace function public.set_home_content_visible_for_session(
  session_token text,
  content_id uuid,
  is_visible_value boolean
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

  update public.home_contents hc
  set is_visible = coalesce(is_visible_value, hc.is_visible), updated_at = now()
  where hc.id = content_id;
end;
$$;

grant execute on function public.set_home_content_visible_for_session(text, uuid, boolean) to anon, authenticated;

-- 한 섹션 안에서만 순서를 재배열한다. ordered_ids에 없는 그 섹션의 다른
-- 행은 건드리지 않지만, 정상 흐름에서는 프론트가 항상 그 섹션 전체 id를
-- 현재 순서대로 보내준다.
create or replace function public.reorder_home_contents_for_session(
  session_token text,
  section_type_value text,
  ordered_ids uuid[]
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

  update public.home_contents hc
  set sort_order = pos.ordinality, updated_at = now()
  from unnest(ordered_ids) with ordinality as pos(id, ordinality)
  where hc.id = pos.id and hc.section_type = section_type_value;
end;
$$;

grant execute on function public.reorder_home_contents_for_session(text, text, uuid[]) to anon, authenticated;

-- 행을 지우고 그 storage_path를 돌려준다. 클라이언트는 이 경로를
-- admin-delete-storage-objects에 넘겨 실제 파일을 지운다(RPC는 Storage를
-- 직접 지울 수 없음).
create or replace function public.delete_home_content_for_session(
  session_token text,
  content_id uuid
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
    raise exception 'Admin session required.';
  end if;

  delete from public.home_contents hc
  where hc.id = content_id
  returning hc.storage_path into removed_path;

  return removed_path;
end;
$$;

grant execute on function public.delete_home_content_for_session(text, uuid) to anon, authenticated;
