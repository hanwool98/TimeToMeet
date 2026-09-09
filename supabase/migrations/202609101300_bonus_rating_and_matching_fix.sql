-- Fix bonus-rating persistence races and make bonus matching round-aware.
-- This migration is additive/idempotent and does not reset production data.

alter table public.event_table_assignments
  add column if not exists conversation_completed_at timestamptz;

-- A schedule row is only an intended pairing. Record the encounter when the
-- server actually leaves its conversation phase and both people are active.
create or replace function public.mark_completed_round_encounters()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if old.stage = 'round_active'
     and old.round_phase = 'conversation'
     and (
       (new.stage = 'round_active' and new.round_phase = 'transition')
       or new.stage = 'bonus_seat_guide'
     ) then
    update public.event_table_assignments eta
    set conversation_completed_at = coalesce(eta.conversation_completed_at, now())
    where eta.event_id = old.event_id
      and eta.round_number = old.current_round
      and eta.male_application_id is not null
      and eta.female_application_id is not null
      and exists (
        select 1 from public.applications a
        where a.id = eta.male_application_id and a.attendance_status = 'active'
      )
      and exists (
        select 1 from public.applications a
        where a.id = eta.female_application_id and a.attendance_status = 'active'
      );
  end if;
  return new;
end;
$function$;

drop trigger if exists mark_completed_round_encounters_trigger on public.event_progress;
create trigger mark_completed_round_encounters_trigger
after update of stage, round_phase on public.event_progress
for each row execute function public.mark_completed_round_encounters();

-- Conservative backfill for rounds which have demonstrably passed. Future
-- rounds are never marked merely because they were pre-generated.
update public.event_table_assignments eta
set conversation_completed_at = coalesce(p.round_phase_started_at, p.updated_at, now())
from public.event_progress p
where p.event_id = eta.event_id
  and eta.conversation_completed_at is null
  and eta.male_application_id is not null
  and eta.female_application_id is not null
  and exists (
    select 1 from public.applications a
    where a.id = eta.male_application_id and a.checked_in_at is not null
  )
  and exists (
    select 1 from public.applications a
    where a.id = eta.female_application_id and a.checked_in_at is not null
  )
  and (
    eta.round_number < coalesce(p.current_round, 0)
    or (
      eta.round_number = p.current_round
      and p.round_phase is distinct from 'conversation'
    )
    or p.stage in ('round_complete', 'final_selection', 'completed')
  );

-- The client supplies the round and partner it was showing. That makes the
-- write immune to another device advancing event_progress at the same moment.
create or replace function public.get_my_bonus_rating(
  session_token text,
  event_id_value text,
  round_number_value integer,
  partner_application_id_value uuid
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  target_application_id uuid;
  existing public.round_ratings%rowtype;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();

  select a.id into target_application_id
  from public.applications a
  where a.event_id = event_id_value
    and a.user_id = session_user_id
    and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if target_application_id is null or not exists (
    select 1 from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = round_number_value
      and eta.is_bonus
      and (
        (eta.male_application_id = target_application_id and eta.female_application_id = partner_application_id_value)
        or (eta.female_application_id = target_application_id and eta.male_application_id = partner_application_id_value)
      )
  ) then
    return jsonb_build_object('ok', false);
  end if;

  select rr.* into existing
  from public.round_ratings rr
  where rr.event_id = event_id_value
    and rr.rater_application_id = target_application_id
    and rr.ratee_application_id = partner_application_id_value
  order by
    exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = rr.event_id
        and eta.round_number = rr.round_number
        and not eta.is_bonus
    ) desc,
    rr.updated_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'score', existing.score,
    'memo', existing.memo,
    'hashtags', existing.hashtags
  );
end;
$function$;

grant execute on function public.get_my_bonus_rating(text, text, integer, uuid) to anon, authenticated;

create or replace function public.submit_bonus_round_rating(
  session_token text,
  event_id_value text,
  round_number_value integer,
  partner_application_id_value uuid,
  score_value numeric,
  memo_value text default null,
  hashtags_value text[] default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  target_application_id uuid;
  target_progress public.event_progress%rowtype;
  existing_rating_id uuid;
  clean_memo text;
  clean_hashtags text[];
  submission_window_open boolean := false;
begin
  if score_value < 0 or score_value > 5 or mod((score_value * 10)::integer, 5) <> 0 then
    raise exception '호감도 점수는 0~5 사이 0.5 단위여야 합니다.';
  end if;

  clean_memo := nullif(trim(coalesce(memo_value, '')), '');
  if clean_memo is not null and char_length(clean_memo) > 200 then
    raise exception '메모는 200자 이내로 작성해주세요.';
  end if;
  clean_hashtags := public.normalize_rating_hashtags(hashtags_value);

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();
  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select a.id into target_application_id
  from public.applications a
  where a.event_id = event_id_value
    and a.user_id = session_user_id
    and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;
  if target_application_id is null then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  if not exists (
    select 1 from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = round_number_value
      and eta.is_bonus
      and (
        (eta.male_application_id = target_application_id and eta.female_application_id = partner_application_id_value)
        or (eta.female_application_id = target_application_id and eta.male_application_id = partner_application_id_value)
      )
  ) then
    raise exception '이번 추가시간 상대 정보가 일치하지 않습니다.';
  end if;

  select * into target_progress
  from public.event_progress
  where event_id = event_id_value;

  submission_window_open :=
    (target_progress.stage = 'bonus_seat_guide' and target_progress.current_round = round_number_value)
    or (
      target_progress.stage = 'round_active'
      and target_progress.is_bonus_round
      and target_progress.current_round = round_number_value + 1
      and target_progress.round_phase_started_at >= now() - interval '30 seconds'
    )
    or (
      target_progress.stage = 'final_selection'
      and target_progress.current_round = round_number_value
      and target_progress.round_phase_started_at >= now() - interval '30 seconds'
    );

  if not submission_window_open then
    raise exception '지금은 호감도를 수정할 수 있는 시점이 아닙니다.';
  end if;

  -- Prefer the original regular-round row. If the pair first met in bonus,
  -- there is no such row and a new row is inserted for this bonus round.
  select rr.id into existing_rating_id
  from public.round_ratings rr
  where rr.event_id = event_id_value
    and rr.rater_application_id = target_application_id
    and rr.ratee_application_id = partner_application_id_value
  order by
    exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = rr.event_id
        and eta.round_number = rr.round_number
        and not eta.is_bonus
    ) desc,
    rr.updated_at desc
  limit 1
  for update;

  if existing_rating_id is not null then
    update public.round_ratings
    set score = score_value,
        memo = clean_memo,
        hashtags = clean_hashtags,
        updated_at = now()
    where id = existing_rating_id;
  else
    insert into public.round_ratings (
      event_id, round_number, rater_application_id, ratee_application_id,
      score, memo, hashtags
    ) values (
      event_id_value, round_number_value, target_application_id,
      partner_application_id_value, score_value, clean_memo, clean_hashtags
    );
  end if;
end;
$function$;

grant execute on function public.submit_bonus_round_rating(text, text, integer, uuid, numeric, text, text[]) to anon, authenticated;

-- Global bonus matching. Dynamic programming keeps the best complete state
-- for each used-female set, avoiding the dead ends caused by per-person greedy
-- choices while remaining small for the service's normal 10x10 roster.
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  plan record;
  total_rounds integer;
  bonus_round_index integer;
  is_test boolean;
  male_ids uuid[];
  female_ids uuid[];
  male_count integer;
  female_count integer;
  expected_matches integer;
  male_index_value integer;
  best record;
  pair_index integer;
  table_number_value integer;
  selected_reason text;
  audit_row record;
begin
  -- Serialise generation for the same event/round even when an operator and
  -- a polling client happen to request the transition simultaneously.
  perform pg_catalog.pg_advisory_xact_lock(hashtext(event_id_value), target_round_number);

  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select coalesce(e.is_test_event, false) into is_test
  from public.events e where e.id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  bonus_round_index := target_round_number - total_rounds;

  select array_agg(a.id order by a.id) into male_ids
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active' and a.gender = '남성';
  select array_agg(a.id order by a.id) into female_ids
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active' and a.gender = '여성';

  male_count := coalesce(array_length(male_ids, 1), 0);
  female_count := coalesce(array_length(female_ids, 1), 0);
  expected_matches := least(male_count, female_count);
  if expected_matches = 0 then return; end if;
  if female_count > 60 then
    raise exception '추가시간 매칭은 여성 참가자 60명 이하에서 지원됩니다.';
  end if;

  drop table if exists tmp_bonus_pair_audit;
  create temporary table tmp_bonus_pair_audit on commit drop as
  select
    ma.id as male_application_id,
    fa.id as female_application_id,
    array_position(male_ids, ma.id) as male_index,
    array_position(female_ids, fa.id) as female_index,
    mf.score as male_score,
    fm.score as female_score,
    coalesce(mf.score, 0) + coalesce(fm.score, 0) as mutual_score,
    exists (
      select 1 from public.event_table_assignments met
      where met.event_id = event_id_value
        and not met.is_bonus
        and met.conversation_completed_at is not null
        and met.male_application_id = ma.id
        and met.female_application_id = fa.id
    ) as met_regular,
    case
      when exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.conversation_completed_at is not null
          and prev.male_application_id = ma.id
          and prev.female_application_id = fa.id
      ) then 'previous_round_pair'
      when exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number < target_round_number
          and prev.is_bonus
          and prev.male_application_id = ma.id
          and prev.female_application_id = fa.id
      ) then 'already_met_in_bonus'
      when bonus_round_index >= 2 and (mf.score = 0 or fm.score = 0) then 'disliked_pair'
      when bonus_round_index >= 2 and (mf.score is null or fm.score is null) then 'missing_rating'
      else null
    end as excluded_reason
  from public.applications ma
  cross join public.applications fa
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
    order by rr.updated_at desc limit 1
  ) mf on true
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
    order by rr.updated_at desc limit 1
  ) fm on true
  where ma.id = any(male_ids) and fa.id = any(female_ids);

  if is_test then
    raise notice '[BONUS_MATCH] eventId=% bonusRound=% candidates=%', event_id_value, bonus_round_index,
      (select count(*) from tmp_bonus_pair_audit where excluded_reason is null);
    for audit_row in
      select * from tmp_bonus_pair_audit where excluded_reason is not null
    loop
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% maleApplicationId=% femaleApplicationId=% mutualScore=% excludedReason=%',
        event_id_value, bonus_round_index, audit_row.male_application_id,
        audit_row.female_application_id, audit_row.mutual_score, audit_row.excluded_reason;
    end loop;
  end if;

  drop table if exists tmp_bonus_states;
  create temporary table tmp_bonus_states (
    used_female_mask bigint not null,
    matched_count integer not null,
    unmet_count integer not null,
    total_score numeric not null,
    selected_males uuid[] not null,
    selected_females uuid[] not null
  ) on commit drop;
  insert into tmp_bonus_states values (0, 0, 0, 0, '{}'::uuid[], '{}'::uuid[]);

  for male_index_value in 1..male_count loop
    drop table if exists tmp_bonus_next_states;
    create temporary table tmp_bonus_next_states on commit drop as
    select * from tmp_bonus_states where false;

    -- Leaving a participant unmatched is considered so the DP can still find
    -- maximum cardinality when the active roster is unbalanced.
    insert into tmp_bonus_next_states select * from tmp_bonus_states;
    insert into tmp_bonus_next_states
    select
      s.used_female_mask | (1::bigint << (c.female_index - 1)),
      s.matched_count + 1,
      s.unmet_count + case when c.met_regular then 0 else 1 end,
      s.total_score + c.mutual_score,
      array_append(s.selected_males, c.male_application_id),
      array_append(s.selected_females, c.female_application_id)
    from tmp_bonus_states s
    join tmp_bonus_pair_audit c on c.male_index = male_index_value and c.excluded_reason is null
    where (s.used_female_mask & (1::bigint << (c.female_index - 1))) = 0;

    truncate tmp_bonus_states;
    insert into tmp_bonus_states
    select used_female_mask, matched_count, unmet_count, total_score, selected_males, selected_females
    from (
      select distinct on (used_female_mask) *
      from tmp_bonus_next_states
      order by used_female_mask,
        matched_count desc,
        case when bonus_round_index = 1 then unmet_count else 0 end desc,
        case when bonus_round_index = 1 then total_score end desc nulls last,
        case when bonus_round_index >= 2 then total_score end asc nulls last,
        random()
    ) ranked;
  end loop;

  select * into best
  from tmp_bonus_states
  order by matched_count desc,
    case when bonus_round_index = 1 then unmet_count else 0 end desc,
    case when bonus_round_index = 1 then total_score end desc nulls last,
    case when bonus_round_index >= 2 then total_score end asc nulls last,
    random()
  limit 1;

  if best.matched_count < expected_matches then
    raise exception '중복되지 않는 추가시간 매칭을 생성할 수 없습니다. (가능 %/%쌍)', best.matched_count, expected_matches;
  end if;

  for pair_index in 1..best.matched_count loop
    select eta.table_number into table_number_value
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and not eta.is_bonus
      and eta.female_application_id = best.selected_females[pair_index]
    order by eta.round_number desc
    limit 1;

    insert into public.event_table_assignments (
      event_id, table_number, round_number, male_application_id, female_application_id, is_bonus
    ) values (
      event_id_value, coalesce(table_number_value, pair_index), target_round_number,
      best.selected_males[pair_index], best.selected_females[pair_index], true
    );

    select case
      when bonus_round_index = 1 and not audit.met_regular then 'unmet_regular_pair'
      when bonus_round_index = 1 then 'high_mutual_score'
      else 'low_mutual_score_bonus_2plus'
    end into selected_reason
    from tmp_bonus_pair_audit audit
    where audit.male_application_id = best.selected_males[pair_index]
      and audit.female_application_id = best.selected_females[pair_index];

    if is_test then
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% maleApplicationId=% femaleApplicationId=% mutualScore=% reason=%',
        event_id_value, bonus_round_index, best.selected_males[pair_index], best.selected_females[pair_index],
        (select mutual_score from tmp_bonus_pair_audit where male_application_id = best.selected_males[pair_index] and female_application_id = best.selected_females[pair_index]),
        selected_reason;
    end if;
  end loop;
end;
$function$;

revoke all on function public.generate_bonus_round_assignments(text, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
