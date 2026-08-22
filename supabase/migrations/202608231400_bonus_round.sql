-- Bonus round infrastructure: after all regular rounds + the last round's
-- ratings are done, an event that opted in computes a mutual-affinity-first
-- 1:1 bonus pairing, shows participants a "보너스 매칭" wait screen while
-- that's computed, then a 2-minute bonus seat-guide, then a single 7-minute
-- bonus conversation round, then the event ends.
--
-- Opt-in and off by default (bonus_round_enabled) so every event that
-- already exists or is created without touching this keeps working exactly
-- as before - round_complete stays a true terminal state unless an event
-- explicitly turns bonus rounds on. There's no admin UI toggle for this yet;
-- for now it's set directly (e.g. via SQL) until a settings control exists.
alter table public.events add column if not exists bonus_round_enabled boolean not null default false;

alter table public.event_progress add column if not exists is_bonus_round boolean not null default false;

alter table public.event_table_assignments add column if not exists is_bonus boolean not null default false;

-- compute_mutual_ratings' pairs should stay scoped to real regular-round
-- matches (its stated purpose is "보너스 매칭 전 정규 라운드 상호 호감도
-- 순위") - once a bonus pairing exists it lands in event_table_assignments
-- too, so it must be excluded explicitly rather than accidentally treated
-- as another "met" pair.
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
      and not eta.is_bonus
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

-- Greedy mutual-affinity-first 1:1 pairing: highest confirmed mutual total
-- first, each participant used at most once. Anyone left over (no mutual
-- rating pointing back at them, or their preferred matches were already
-- taken) is still paired off arbitrarily among the remaining checked-in
-- participants, so every checked-in male/female gets a bonus match.
-- Idempotent - a second call is a no-op once bonus rows exist.
create or replace function public.generate_bonus_round_assignments(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  total_rounds integer;
  bonus_round_number integer;
  rec record;
  used_males uuid[] := '{}';
  used_females uuid[] := '{}';
  remaining_males uuid[];
  remaining_females uuid[];
  table_counter integer := 1;
  i integer;
begin
  if exists (select 1 from public.event_table_assignments where event_id = event_id_value and is_bonus) then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));
  bonus_round_number := total_rounds + 1;

  for rec in
    select c.male_application_id, c.female_application_id
    from public.compute_mutual_ratings(event_id_value) c
    where c.male_to_female_score is not null and c.female_to_male_score is not null
    order by (c.male_to_female_score + c.female_to_male_score) desc
  loop
    if not (rec.male_application_id = any(used_males)) and not (rec.female_application_id = any(used_females)) then
      insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
      values (event_id_value, table_counter, bonus_round_number, rec.male_application_id, rec.female_application_id, true);
      used_males := used_males || rec.male_application_id;
      used_females := used_females || rec.female_application_id;
      table_counter := table_counter + 1;
    end if;
  end loop;

  select array_agg(a.id) into remaining_males
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.gender = '남성'
    and not (a.id = any(used_males));

  select array_agg(a.id) into remaining_females
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.gender = '여성'
    and not (a.id = any(used_females));

  for i in 1..least(coalesce(array_length(remaining_males, 1), 0), coalesce(array_length(remaining_females, 1), 0)) loop
    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
    values (event_id_value, table_counter, bonus_round_number, remaining_males[i], remaining_females[i], true);
    table_counter := table_counter + 1;
  end loop;
end;
$$;

revoke all on function public.generate_bonus_round_assignments(text) from public, anon, authenticated;

-- Extends the round/phase clock to also drive: round_complete -> bonus_matching
-- (only if the event opted in) -> bonus_seat_guide (2 min, computes the
-- pairing on entry) -> round_active/conversation as a single 7-minute bonus
-- round -> ended. Regular-round behavior is unchanged.
create or replace function public.advance_round_state_if_needed(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
  conversation_seconds constant integer := 600;
  bonus_conversation_seconds constant integer := 420;
  transition_seconds constant integer := 120;
  live_elapsed numeric;
  phase_duration integer;
  loop_guard integer := 0;
begin
  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  if target.stage = 'round_complete' then
    if coalesce(target_event.bonus_round_enabled, false) then
      update public.event_progress ep set stage = 'bonus_matching', updated_at = now() where ep.event_id = event_id_value;
    end if;
    return;
  end if;

  if target.stage = 'bonus_matching' then
    perform public.generate_bonus_round_assignments(event_id_value);
    update public.event_progress ep
    set stage = 'bonus_seat_guide',
        round_phase = 'transition',
        round_timer_status = 'running',
        round_timer_position_seconds = 0,
        round_timer_updated_at = now(),
        updated_at = now()
    where ep.event_id = event_id_value;
    return;
  end if;

  if target.stage = 'bonus_seat_guide' then
    if target.round_timer_status <> 'running' then
      return;
    end if;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    if live_elapsed >= transition_seconds then
      update public.event_progress ep
      set stage = 'round_active',
          is_bonus_round = true,
          current_round = total_rounds + 1,
          round_phase = 'conversation',
          round_timer_status = 'running',
          round_timer_position_seconds = 0,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value;
    end if;
    return;
  end if;

  if target.stage <> 'round_active' then
    return;
  end if;

  if not target.is_bonus_round then
    perform public.generate_round_schedule_if_missing(event_id_value);
    if target.round_phase is null or target.round_timer_updated_at is null then
      update public.event_progress ep
      set round_phase = 'conversation',
          round_timer_status = 'running',
          round_timer_position_seconds = 0,
          round_timer_updated_at = now(),
          current_round = coalesce(ep.current_round, 1),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
    end if;
  end if;

  if target.round_timer_status <> 'running' then
    return;
  end if;

  loop
    loop_guard := loop_guard + 1;
    exit when loop_guard > 200;

    phase_duration := case
      when target.round_phase = 'conversation' and target.is_bonus_round then bonus_conversation_seconds
      when target.round_phase = 'conversation' then conversation_seconds
      else transition_seconds
    end;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    exit when live_elapsed < phase_duration;

    if target.is_bonus_round then
      -- Single bonus round only - no post-bonus rating/transition phase was
      -- asked for, so the event simply ends once it's done.
      update public.event_progress ep
      set stage = 'ended',
          round_timer_status = 'paused',
          round_timer_position_seconds = 0,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
      exit;
    elsif target.round_phase = 'conversation' then
      update public.event_progress ep
      set round_phase = 'transition',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
    elsif target.current_round >= total_rounds then
      update public.event_progress ep
      set stage = 'round_complete',
          round_timer_status = 'paused',
          round_timer_position_seconds = 0,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
      exit;
    else
      update public.event_progress ep
      set current_round = target.current_round + 1,
          round_phase = 'conversation',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value
      returning ep.* into target;
    end if;
  end loop;
end;
$$;
