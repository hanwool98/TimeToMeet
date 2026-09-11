-- 마이페이지 "문의하기" -> 실제 고객 문의 게시판.
-- 전체 참가자가 함께 보는 일반 게시판이지만 비밀글은 작성자 본인과
-- 관리자만 상세를 볼 수 있어야 한다. 프론트에서 텍스트만 가리는 방식은
-- 요청에서 명시적으로 금지했으므로, event_reviews와 동일하게 테이블은
-- RLS로 완전히 잠그고(using(false)) 모든 조회/작성/답변을
-- SECURITY DEFINER 함수 안에서만 판단한다 - 다른 참가자가 테이블을 직접
-- select하거나 비밀글 id를 안다고 해도 이 함수들을 거치지 않는 한
-- 제목/내용/답변을 얻을 방법이 없다.
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references public.app_users(user_id),
  title text not null,
  content text not null,
  is_private boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'answered')),
  admin_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inquiries_created_at_idx on public.inquiries (created_at desc);
create index if not exists inquiries_author_user_id_idx on public.inquiries (author_user_id);

alter table public.inquiries enable row level security;

drop policy if exists "inquiries no direct access" on public.inquiries;
create policy "inquiries no direct access" on public.inquiries for all using (false);

drop trigger if exists inquiries_touch_updated_at on public.inquiries;
create trigger inquiries_touch_updated_at
before update on public.inquiries
for each row execute function public.touch_updated_at();

-- ── 참가자: 문의 작성 ─────────────────────────────────────────────
create or replace function public.create_inquiry_for_session(
  session_token text,
  title_value text,
  content_value text,
  is_private_value boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_row record;
  clean_title text;
  clean_content text;
  new_id uuid;
begin
  select s.user_id, s.role into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(coalesce(session_token, ''))
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_row.user_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  clean_title := trim(coalesce(title_value, ''));
  clean_content := trim(coalesce(content_value, ''));

  if clean_title = '' or clean_content = '' then
    raise exception '제목과 내용을 입력해주세요.';
  end if;
  if char_length(clean_title) > 200 then
    raise exception '제목은 200자 이내로 입력해주세요.';
  end if;
  if char_length(clean_content) > 4000 then
    raise exception '내용은 4000자 이내로 입력해주세요.';
  end if;

  insert into public.inquiries (author_user_id, title, content, is_private)
  values (session_row.user_id, clean_title, clean_content, coalesce(is_private_value, false))
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_inquiry_for_session(text, text, text, boolean) to anon, authenticated;

-- ── 참가자: 전체 문의 목록(검색 포함) ──────────────────────────────
-- 비밀글은 제목을 "비밀글입니다."로 가리고, 검색어가 있을 때는 남의
-- 비밀글은 애초에 제목/내용 비교 대상에서 빼서(권한 없는 행은
-- and 조건 자체가 false) 검색 결과로도 존재 여부/키워드가 새지 않는다.
create or replace function public.list_inquiries_for_session(session_token text, search_value text default null)
returns table (
  id uuid,
  title text,
  created_at timestamptz,
  status text,
  is_private boolean,
  is_locked boolean,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  session_row record;
  caller_user_id uuid;
  caller_is_admin boolean := false;
  trimmed_search text;
begin
  select s.user_id, s.role into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(coalesce(session_token, ''))
    and s.expires_at > now()
  limit 1;

  if session_row.role = 'admin' then
    caller_is_admin := true;
  elsif session_row.role in ('member', 'guest') then
    caller_user_id := session_row.user_id;
  end if;

  trimmed_search := nullif(trim(coalesce(search_value, '')), '');

  return query
  select
    i.id,
    case
      when (not i.is_private) or caller_is_admin or i.author_user_id = caller_user_id then i.title
      else '비밀글입니다.'
    end as title,
    i.created_at,
    i.status,
    i.is_private,
    (i.is_private and not caller_is_admin and i.author_user_id is distinct from caller_user_id) as is_locked,
    coalesce(i.author_user_id = caller_user_id, false) as is_mine
  from public.inquiries i
  where
    trimmed_search is null
    or (
      (not i.is_private or caller_is_admin or i.author_user_id = caller_user_id)
      and (i.title ilike '%' || trimmed_search || '%' or i.content ilike '%' || trimmed_search || '%')
    )
  order by i.created_at desc;
end;
$$;

grant execute on function public.list_inquiries_for_session(text, text) to anon, authenticated;

-- ── 참가자: 문의 상세 ─────────────────────────────────────────────
-- 잠긴(권한 없는 비밀글) 경우 id/isLocked 외 어떤 필드도 내려주지
-- 않는다 - 제목/내용/답변을 응답 바디에 아예 담지 않으므로 네트워크
-- 탭에서 요청을 직접 봐도 유추할 거리가 없다.
create or replace function public.get_inquiry_detail_for_session(session_token text, inquiry_id_value uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  session_row record;
  caller_user_id uuid;
  caller_is_admin boolean := false;
  target public.inquiries%rowtype;
  locked boolean;
begin
  select s.user_id, s.role into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(coalesce(session_token, ''))
    and s.expires_at > now()
  limit 1;

  if session_row.role = 'admin' then
    caller_is_admin := true;
  elsif session_row.role in ('member', 'guest') then
    caller_user_id := session_row.user_id;
  end if;

  select * into target from public.inquiries where id = inquiry_id_value;
  if not found then
    return null;
  end if;

  locked := target.is_private and not caller_is_admin and target.author_user_id is distinct from caller_user_id;

  if locked then
    return jsonb_build_object('id', target.id, 'isPrivate', true, 'isLocked', true);
  end if;

  return jsonb_build_object(
    'id', target.id,
    'title', target.title,
    'content', target.content,
    'isPrivate', target.is_private,
    'isLocked', false,
    'isMine', coalesce(target.author_user_id = caller_user_id, false),
    'status', target.status,
    'adminReply', target.admin_reply,
    'repliedAt', target.replied_at,
    'createdAt', target.created_at
  );
end;
$$;

grant execute on function public.get_inquiry_detail_for_session(text, uuid) to anon, authenticated;

-- ── 관리자: 작성자 표시 라벨(닉네임 없으면 마스킹 없이 회원/비회원) ──
-- get_my_page_summary의 닉네임 우선순위 로직과 동일하게 맞춰서 마이
-- 페이지에서 보이는 이름과 관리자 화면 "작성자"가 최대한 같은 값이
-- 되도록 한다.
create or replace function public.inquiry_author_label(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(
    (
      select pp.nickname from public.participant_profiles pp
      where pp.user_id = target_user_id and pp.is_active
      order by pp.updated_at desc limit 1
    ),
    (
      select a.nickname from public.applications a
      where a.user_id = target_user_id
      order by a.submitted_at desc limit 1
    ),
    (select ma.login_id from public.member_accounts ma where ma.user_id = target_user_id),
    case when exists(select 1 from public.guest_accounts ga where ga.user_id = target_user_id) then '비회원' else '알 수 없음' end
  );
$$;

-- ── 관리자: 전체 문의 목록(비밀글 포함, 검색 포함) ─────────────────
create or replace function public.list_inquiries_for_admin(session_token text, search_value text default null)
returns table (
  id uuid,
  author_label text,
  title text,
  is_private boolean,
  created_at timestamptz,
  status text
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  trimmed_search text;
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  trimmed_search := nullif(trim(coalesce(search_value, '')), '');

  return query
  select
    i.id,
    public.inquiry_author_label(i.author_user_id),
    i.title,
    i.is_private,
    i.created_at,
    i.status
  from public.inquiries i
  where
    trimmed_search is null
    or i.title ilike '%' || trimmed_search || '%'
    or i.content ilike '%' || trimmed_search || '%'
  order by i.created_at desc;
end;
$$;

grant execute on function public.list_inquiries_for_admin(text, text) to anon, authenticated;

-- ── 관리자: 문의 상세(비밀글도 전체 열람) ──────────────────────────
create or replace function public.get_inquiry_detail_for_admin(session_token text, inquiry_id_value uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  target public.inquiries%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  select * into target from public.inquiries where id = inquiry_id_value;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', target.id,
    'authorLabel', public.inquiry_author_label(target.author_user_id),
    'title', target.title,
    'content', target.content,
    'isPrivate', target.is_private,
    'status', target.status,
    'adminReply', target.admin_reply,
    'repliedAt', target.replied_at,
    'createdAt', target.created_at
  );
end;
$$;

grant execute on function public.get_inquiry_detail_for_admin(text, uuid) to anon, authenticated;

-- ── 관리자: 답변 작성/수정 ─────────────────────────────────────────
create or replace function public.admin_reply_to_inquiry(session_token text, inquiry_id_value uuid, reply_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  clean_reply text;
  updated_row public.inquiries%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  clean_reply := trim(coalesce(reply_value, ''));
  if clean_reply = '' then
    raise exception '답변 내용을 입력해주세요.';
  end if;
  if char_length(clean_reply) > 4000 then
    raise exception '답변은 4000자 이내로 입력해주세요.';
  end if;

  update public.inquiries
  set admin_reply = clean_reply,
      status = 'answered',
      replied_at = now()
  where id = inquiry_id_value
  returning * into updated_row;

  if not found then
    raise exception '문의를 찾을 수 없습니다.';
  end if;

  return jsonb_build_object(
    'id', updated_row.id,
    'adminReply', updated_row.admin_reply,
    'status', updated_row.status,
    'repliedAt', updated_row.replied_at
  );
end;
$$;

grant execute on function public.admin_reply_to_inquiry(text, uuid, text) to anon, authenticated;
