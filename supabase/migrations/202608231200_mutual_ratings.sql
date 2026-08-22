-- 운영자 "호감도 확인" screen: mutual (both-directions) ratings per male-female
-- pair that actually met via the regular round-robin schedule. The core pair
-- + score lookup is split into a plain, non-admin-gated helper
-- (compute_mutual_ratings) precisely so the future bonus-matching algorithm
-- (mutual-affinity-first pairing) can call the exact same logic instead of
-- re-deriving it - only the JSON/admin-session wrapper is new UI plumbing.
--
-- Pairs come from event_table_assignments (one row per male/female pair
-- across the whole regular schedule, generated once at round start), so a
-- pair that met is only ever counted once even though round-robin never
-- repeats a pair - no dedup logic needed beyond `distinct`. If a bonus round
-- ever rates the same pair again, the lateral subqueries below take the
-- earliest (regular-round) rating rather than an arbitrary/duplicate one.
create or replace function public.compute_mutual_ratings(event_id_value text)
returns table (
  male_application_id uuid,
  male_nickname text,
  female_application_id uuid,
  female_nickname text,
  male_to_female_score numeric,
  female_to_male_score numeric
)
language sql
stable
security definer
set search_path = 'public'
as $$
  with pairs as (
    select distinct eta.male_application_id, eta.female_application_id
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
  )
  select
    p.male_application_id,
    ma.nickname,
    p.female_application_id,
    fa.nickname,
    mf.score,
    fm.score
  from pairs p
  join public.applications ma on ma.id = p.male_application_id
  join public.applications fa on fa.id = p.female_application_id
  left join lateral (
    select rr.score
    from public.round_ratings rr
    where rr.event_id = event_id_value
      and rr.rater_application_id = p.male_application_id
      and rr.ratee_application_id = p.female_application_id
    order by rr.round_number asc
    limit 1
  ) mf on true
  left join lateral (
    select rr.score
    from public.round_ratings rr
    where rr.event_id = event_id_value
      and rr.rater_application_id = p.female_application_id
      and rr.ratee_application_id = p.male_application_id
    order by rr.round_number asc
    limit 1
  ) fm on true;
$$;

revoke all on function public.compute_mutual_ratings(text) from public, anon, authenticated;

create or replace function public.get_admin_mutual_ratings_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result jsonb;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'maleApplicationId', c.male_application_id,
        'maleNickname', c.male_nickname,
        'femaleApplicationId', c.female_application_id,
        'femaleNickname', c.female_nickname,
        'maleToFemaleScore', c.male_to_female_score,
        'femaleToMaleScore', c.female_to_male_score,
        'total', case
          when c.male_to_female_score is not null and c.female_to_male_score is not null
          then c.male_to_female_score + c.female_to_male_score
          else null
        end
      )
      order by
        (case when c.male_to_female_score is not null and c.female_to_male_score is not null then 0 else 1 end),
        (c.male_to_female_score + c.female_to_male_score) desc nulls last,
        c.male_nickname asc
    ),
    '[]'::jsonb
  )
  into result
  from public.compute_mutual_ratings(event_id_value) c;

  return result;
end;
$$;

grant execute on function public.get_admin_mutual_ratings_for_session(text, text) to anon, authenticated;
