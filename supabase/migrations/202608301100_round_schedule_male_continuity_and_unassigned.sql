-- 1) 지각 체크인으로 라운드 재계산(regenerate_round_schedule_from_round)이
-- 일어날 때, 남자 참가자의 테이블 번호가 매번 "체크인 시각" 기준으로 완전히
-- 새로 매겨져서 이미 진행 중이던 다른 남자 참가자들의 테이블이 라운드마다
-- 무작위로 크게 튀는 버그가 있었다(1라운드 테이블1 -> 2라운드 테이블3처럼).
-- 여자 쪽은 이미 "이전에 실제로 배정됐던 테이블을 최우선으로 유지"하는
-- coalesce 로직이 있는데 남자 쪽에는 빠져 있었다 - 동일하게 적용한다.
create or replace function public.generate_round_schedule_if_missing(
  event_id_value text,
  from_round_number integer default 1,
  max_rounds_value integer default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  plan record;
  ideal_n integer;
  round_count integer;
begin
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and not is_bonus and round_number >= from_round_number
  ) then
    return;
  end if;

  if from_round_number = 1 then
    perform public.ensure_preround_seats_for_event(event_id_value);

    select count(distinct table_number) into ideal_n
    from public.event_preround_seats
    where event_id = event_id_value
      and (male_application_id is not null or female_application_id is not null);

    round_count := coalesce(ideal_n, 0);
    if max_rounds_value is not null then
      round_count := least(round_count, greatest(0, max_rounds_value));
    end if;
    if coalesce(ideal_n, 0) <= 0 or round_count <= 0 then
      return;
    end if;

    with males as (
      select s.male_application_id as id, s.table_number as rn
      from public.event_preround_seats s
      join public.applications a on a.id = s.male_application_id
      where s.event_id = event_id_value and a.checked_in_at is not null
    ),
    females as (
      select s.female_application_id as id, s.table_number as rn
      from public.event_preround_seats s
      join public.applications a on a.id = s.female_application_id
      where s.event_id = event_id_value and a.checked_in_at is not null
    )
    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
    select event_id_value, f.rn, from_round_number + r - 1, m.id, f.id
    from generate_series(1, round_count) as r
    cross join females f
    left join males m on m.rn = (((f.rn - 1 + r - 1) % ideal_n) + 1);

    return;
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  ideal_n := plan.total_rounds;
  round_count := ideal_n;
  if max_rounds_value is not null then
    round_count := least(round_count, greatest(0, max_rounds_value));
  end if;
  if plan.active_male_count = 0 or plan.active_female_count = 0 or round_count <= 0 then
    return;
  end if;

  -- 이미 실제로 배정받은 적 있는 사람은 그 번호를 그대로 유지하고, 처음
  -- 합류하는 사람(지각 등)만 "아직 아무도 안 쓰는 번호" 중에서 체크인
  -- 순서대로 채운다. 이전엔 처음 합류하는 사람도 그냥
  -- row_number() over(전체 순서)를 그대로 번호로 썼는데, 이미 배정된
  -- 사람의 실제 번호와 우연히 겹칠 수 있어(예: 기존 인원이 테이블4를 쓰고
  -- 있는데 새로 합류한 사람이 전체 순서상 4번째라 똑같이 4를 받음)
  -- unique 제약 위반으로 재계산 자체가 실패할 수 있었다.
  with male_candidates as (
    select
      a.id,
      a.checked_in_at,
      (select eta.table_number from public.event_table_assignments eta
       where eta.event_id = event_id_value and not eta.is_bonus and eta.male_application_id = a.id
       order by eta.round_number asc limit 1) as existing_rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '남성'
      and a.checked_in_at is not null and a.attendance_status = 'active'
  ),
  male_available_slots as (
    select gs as slot, row_number() over (order by gs) as slot_rank
    from generate_series(1, ideal_n) as gs
    where gs not in (select existing_rn from male_candidates where existing_rn is not null)
  ),
  male_new_ranked as (
    select id, row_number() over (order by checked_in_at asc nulls last, id asc) as rnk
    from male_candidates
    where existing_rn is null
  ),
  males as (
    select id, existing_rn as rn from male_candidates where existing_rn is not null
    union all
    select mnr.id, mas.slot as rn from male_new_ranked mnr join male_available_slots mas on mas.slot_rank = mnr.rnk
  ),
  female_candidates as (
    select
      a.id,
      a.checked_in_at,
      (select eta.table_number from public.event_table_assignments eta
       where eta.event_id = event_id_value and not eta.is_bonus and eta.female_application_id = a.id
       order by eta.round_number asc limit 1) as existing_rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '여성'
      and a.checked_in_at is not null and a.attendance_status = 'active'
  ),
  female_available_slots as (
    select gs as slot, row_number() over (order by gs) as slot_rank
    from generate_series(1, ideal_n) as gs
    where gs not in (select existing_rn from female_candidates where existing_rn is not null)
  ),
  female_new_ranked as (
    select id, row_number() over (order by checked_in_at asc nulls last, id asc) as rnk
    from female_candidates
    where existing_rn is null
  ),
  females as (
    select id, existing_rn as rn from female_candidates where existing_rn is not null
    union all
    select fnr.id, fas.slot as rn from female_new_ranked fnr join female_available_slots fas on fas.slot_rank = fnr.rnk
  )
  insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
  select event_id_value, f.rn, from_round_number + r - 1, m.id, f.id
  from generate_series(1, round_count) as r
  cross join females f
  left join males m on m.rn = (((f.rn - 1 + r - 1) % ideal_n) + 1);
end;
$$;

-- 2) "테이블 현황"에서 지각자 등의 이유로 이번 라운드 배정 자체가 없는
-- 체크인된 활성 참가자가 있으면, 그 사람이 어느 테이블에도 안 나타나
-- 완전히 안 보이는 문제가 있었다(반대쪽 짝만 없는 경우는 이미 이름이 정상
-- 표시됨 - 이건 아예 배정 행 자체가 없는 경우). 관리자가 최소한 "이번
-- 라운드에 아직 배정 안 된 사람이 누구인지"는 볼 수 있게 목록을 추가한다.
create or replace function public.get_admin_round_progress(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  plan record;
  total_rounds integer;
  total_participants integer;
  active_tables integer;
  completed_rounds integer;
  pending_pause_count integer;
  pending_report_count integer;
  matches jsonb;
  unassigned_participants jsonb;
  profile_cards_total integer;
  profile_cards_submitted integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if not found then
    raise exception '행사 진행 상태가 없습니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select count(*) into total_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active';

  profile_cards_total := total_participants;

  select count(*) into profile_cards_submitted
  from public.applications a
  join public.event_profile_cards epc on epc.event_id = a.event_id and epc.application_id = a.id
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and epc.submitted_at is not null;

  select count(distinct eta.table_number) into active_tables
  from public.event_table_assignments eta
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1)
    and eta.male_application_id is not null;

  completed_rounds := case
    when target_progress.stage = 'round_complete' then total_rounds
    when coalesce(target_progress.current_round, 1) > total_rounds then total_rounds
    else greatest(0, coalesce(target_progress.current_round, 1) - 1)
  end;

  select count(*) into pending_pause_count
  from public.event_pause_requests
  where event_id = event_id_value and status = 'pending';

  select count(*) into pending_report_count
  from public.participant_reports
  where event_id = event_id_value and status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'tableNumber', eta.table_number,
    'maleApplicationId', eta.male_application_id,
    'maleNickname', ma.nickname,
    'femaleApplicationId', eta.female_application_id,
    'femaleNickname', fa.nickname
  ) order by eta.table_number), '[]'::jsonb)
  into matches
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationId', a.id,
    'nickname', a.nickname,
    'gender', a.gender
  ) order by a.nickname), '[]'::jsonb)
  into unassigned_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and not exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = event_id_value and not eta.is_bonus
        and eta.round_number = coalesce(target_progress.current_round, 1)
        and (eta.male_application_id = a.id or eta.female_application_id = a.id)
    );

  return jsonb_build_object(
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'totalParticipants', total_participants,
    'activeTables', active_tables,
    'completedRounds', completed_rounds,
    'pendingPauseCount', pending_pause_count,
    'pendingReportCount', pending_report_count,
    'matches', matches,
    'unassignedParticipants', unassigned_participants,
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case
      when target_progress.round_phase = 'reveal' then 1
      when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds
      else null
    end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'profileCardsSubmitted', profile_cards_submitted,
    'profileCardsTotal', profile_cards_total,
    'serverNow', now()
  );
end;
$function$;
