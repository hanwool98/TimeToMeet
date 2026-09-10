-- (1) 다가오는 행사 카드의 대표 이미지. 경로만 저장하고 업로드/서명은
-- Edge Function(upload-event-cover, event-cover-urls)이 처리한다
-- (open_chat_qr_path와 동일 패턴, 추가 전용 nullable 컬럼).
alter table public.events add column if not exists cover_image_path text;

-- (2) 홈 "참가자 후기" 캐러셀에 노출할 후기를 관리자가 직접 고른다.
alter table public.event_reviews add column if not exists home_featured boolean not null default false;
alter table public.event_reviews add column if not exists home_sort_order integer not null default 0;

create index if not exists event_reviews_home_featured_idx
  on public.event_reviews (home_featured, home_sort_order);

-- 관리자: 후기 홈 노출 on/off. 켤 때 노출 목록의 맨 뒤 순서를 부여한다.
create or replace function public.set_review_home_featured_for_session(
  session_token text,
  review_id_value uuid,
  is_featured boolean
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  next_order integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if is_featured then
    select coalesce(max(er.home_sort_order), 0) + 1 into next_order
    from public.event_reviews er where er.home_featured = true;

    update public.event_reviews er
    set home_featured = true,
        home_sort_order = case when er.home_featured then er.home_sort_order else next_order end,
        updated_at = now()
    where er.id = review_id_value;
  else
    update public.event_reviews er
    set home_featured = false, updated_at = now()
    where er.id = review_id_value;
  end if;
end;
$$;

grant execute on function public.set_review_home_featured_for_session(text, uuid, boolean) to anon, authenticated;

-- 관리자: 홈 노출 후기 순서 재배열
create or replace function public.reorder_home_featured_reviews_for_session(
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
    raise exception 'Admin session required.';
  end if;

  update public.event_reviews er
  set home_sort_order = pos.ordinality, updated_at = now()
  from unnest(ordered_ids) with ordinality as pos(id, ordinality)
  where er.id = pos.id;
end;
$$;

grant execute on function public.reorder_home_featured_reviews_for_session(text, uuid[]) to anon, authenticated;

-- 홈(공개): 노출 후기 - 성별 / 나이 / 내용만. 작성자 계정이 정리(게스트
-- 만료 등)돼 익명화된 경우 체크인 당시 스냅샷의 성별/나이를 우선 쓴다.
create or replace function public.get_public_home_reviews()
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(row_to_json(r) order by r.sort_order asc, r.submitted_at desc), '[]'::jsonb)
  from (
    select
      er.id,
      er.home_sort_order as sort_order,
      er.submitted_at,
      coalesce(nullif(eps.gender, ''), a.gender, '') as gender,
      coalesce(
        eps.age,
        case when a.birth_date is not null and e.event_date is not null
          then extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer
          else null end
      ) as age,
      er.content
    from public.event_reviews er
    join public.applications a on a.id = er.application_id
    join public.events e on e.id = er.event_id
    left join public.event_participant_snapshots eps
      on eps.event_id = er.event_id and eps.application_id = er.application_id
    where er.home_featured = true
  ) r;
$$;

grant execute on function public.get_public_home_reviews() to anon, authenticated;
