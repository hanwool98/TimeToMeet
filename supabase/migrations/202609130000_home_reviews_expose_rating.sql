-- 메인페이지 후기 카드에 별점을 표시하기 위해 get_public_home_reviews 응답에
-- event_reviews.rating을 함께 내려준다. 스키마/데이터 변경 없음(기존 rating
-- 값을 그대로 노출). 반환 타입(jsonb) 그대로라 create or replace로 충분.
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
      coalesce(er.rating, 5) as rating,
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
