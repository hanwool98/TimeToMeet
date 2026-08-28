-- 프로필 카드 "나를 표현하는 키워드"를 코드 상수(src/constants/profileKeywords.ts)
-- 대신 관리자가 콘텐츠 관리 화면에서 조정할 수 있게 테이블로 옮긴다.
-- event_profile_cards.keywords는 이미 key 문자열(프리셋) 또는 정규화된
-- #custom 문자열을 저장하는 구조라, key가 안 바뀌는 한 과거 저장값과의
-- 호환성이 자동으로 유지된다 - 그래서 key를 primary key로 쓰고, "삭제"는
-- 실제 delete가 아니라 is_active=false만 지원한다(과거 카드 데이터 보호).
create table if not exists public.profile_keyword_options (
  key text primary key,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_keyword_options enable row level security;

drop policy if exists "profile_keyword_options no direct access" on public.profile_keyword_options;
create policy "profile_keyword_options no direct access" on public.profile_keyword_options for all using (false);

-- 기존 constants/profileKeywords.ts의 25개를 key/label/순서 그대로 seed.
insert into public.profile_keyword_options (key, label, sort_order) values
  ('lively', '#활발함', 1),
  ('calm', '#차분함', 2),
  ('humorous', '#유머러스함', 3),
  ('friendly', '#친근함', 4),
  ('considerate', '#배려심있음', 5),
  ('honest', '#솔직함', 6),
  ('positive', '#긍정적임', 7),
  ('quirky', '#엉뚱함', 8),
  ('witty', '#센스있음', 9),
  ('intellectual', '#지적인느낌', 10),
  ('workaholic', '#워커홀릭', 11),
  ('self_disciplined', '#자기관리잘함', 12),
  ('organized', '#계획적임', 13),
  ('spontaneous', '#즉흥적임', 14),
  ('frugal', '#알뜰함', 15),
  ('likes_music', '#음악좋아함', 16),
  ('likes_movies', '#영화좋아함', 17),
  ('likes_exercise', '#운동좋아함', 18),
  ('likes_travel', '#여행좋아함', 19),
  ('likes_food', '#맛집좋아함', 20),
  ('likes_cafe', '#카페좋아함', 21),
  ('likes_games', '#게임좋아함', 22),
  ('likes_books', '#책좋아함', 23),
  ('likes_pets', '#반려동물좋아함', 24),
  ('likes_driving', '#드라이브좋아함', 25)
on conflict (key) do nothing;

-- 관리자: 전체 목록(비활성 포함).
create or replace function public.get_admin_profile_keywords(session_token text)
returns table (key text, label text, sort_order integer, is_active boolean, created_at timestamptz, updated_at timestamptz)
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
  select k.key, k.label, k.sort_order, k.is_active, k.created_at, k.updated_at
  from public.profile_keyword_options k
  order by k.sort_order asc, k.created_at asc;
end;
$$;

grant execute on function public.get_admin_profile_keywords(text) to anon, authenticated;

create or replace function public.upsert_admin_profile_keyword_for_session(
  session_token text,
  key_value text,
  label_value text,
  sort_order_value integer default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  clean_key text;
  next_sort_order integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  clean_key := trim(coalesce(key_value, ''));
  if clean_key = '' then
    raise exception '키워드 key를 입력해주세요.';
  end if;
  if trim(coalesce(label_value, '')) = '' then
    raise exception '키워드 문구를 입력해주세요.';
  end if;

  if sort_order_value is null then
    select coalesce(max(sort_order), 0) + 1 into next_sort_order from public.profile_keyword_options;
  else
    next_sort_order := sort_order_value;
  end if;

  insert into public.profile_keyword_options (key, label, sort_order)
  values (clean_key, trim(label_value), next_sort_order)
  on conflict (key) do update set
    label = excluded.label,
    sort_order = coalesce(sort_order_value, public.profile_keyword_options.sort_order),
    updated_at = now();
end;
$$;

grant execute on function public.upsert_admin_profile_keyword_for_session(text, text, text, integer) to anon, authenticated;

create or replace function public.set_profile_keyword_active_for_session(session_token text, key_value text, is_active_value boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  update public.profile_keyword_options
  set is_active = is_active_value, updated_at = now()
  where key = key_value;
end;
$$;

grant execute on function public.set_profile_keyword_active_for_session(text, text, boolean) to anon, authenticated;

-- 참가자/태블릿 등에서 사용할 활성 키워드 목록 - 민감정보가 아니고 다른
-- 공개 콘텐츠(get_public_event_summaries 등)와 동일하게 세션 없이 공개.
create or replace function public.get_active_profile_keywords()
returns table (key text, label text)
language sql
stable
security definer
set search_path = 'public'
as $$
  select k.key, k.label
  from public.profile_keyword_options k
  where k.is_active = true
  order by k.sort_order asc;
$$;

grant execute on function public.get_active_profile_keywords() to anon, authenticated;

notify pgrst, 'reload schema';
