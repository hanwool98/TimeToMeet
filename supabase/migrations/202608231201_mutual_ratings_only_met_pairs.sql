-- Bug found in verification before this ever reached the UI: round-robin
-- pre-generates event_table_assignments for every round of the whole event
-- up front (so future rounds' matches are already sitting in the table),
-- so the first version of compute_mutual_ratings pulled in every possible
-- male/female combination instead of only the pairs that have actually been
-- seated together so far. Restrict to rounds up to and including the
-- event's current round; before the first round starts (no event_progress
-- row, or current_round still null) this correctly yields zero pairs.
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
  with progress as (
    select coalesce(ep.current_round, 0) as current_round
    from public.event_progress ep
    where ep.event_id = event_id_value
  ),
  pairs as (
    select distinct eta.male_application_id, eta.female_application_id
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number <= coalesce((select current_round from progress), 0)
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
