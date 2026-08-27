-- 추가시간 흐름 재작업.
--
-- 1) 쉬는시간 재개 직후 곧장 대화로 들어가지 않고, 1분짜리 "다시 만나게
--    된 행운의 상대 + 자리이동 안내" 전용 phase(round_phase='reveal')를
--    새로 거친다. 이 phase에는 호감도 수정 UI가 절대 나오지 않는다.
-- 2) 추가시간 사이 2분(round_phase='transition')은 그대로 두되, 참가자
--    화면에서 호감도 수정 폼과 "행운의 상대" 리빌을 더 이상 동시에
--    보여주지 않는다(제출 여부 기준으로 배타적 렌더링) - 이 판정을
--    새로고침에도 살아남게 서버에서 계산해 내려준다.
-- 3) 다음 추가시간이 없는 마지막 transition은 이동할 다음 자리가 없으므로
--    2분이 아니라 1분으로 줄인다.
-- 4) 추가시간 매칭(generate_bonus_round_assignments)을 다시 짠다 - 정규
--    라운드 이력은 더 이상 제외 조건으로 쓰지 않고(추가시간의 목적 자체가
--    정규에서 만난 사람과 다시 만나는 것), 오직 "이전 추가시간에서 이미
--    짝지어졌던 조합"만 제외한다. 상호 호감도가 있는 쌍을 우선 배정하되
--    나머지 인원도 최대한 전원 매칭하고, 중복 없는 매칭을 만들 수 없으면
--    조용히 반복 배정하는 대신 명확히 실패시킨다.

alter table public.event_progress add column if not exists round_phase_started_at timestamptz;

-- 재개: 곧장 conversation으로 가지 않고 1분 reveal phase로 먼저 진입.
create or replace function public.resume_after_regular_rounds_for_session(session_token text, event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  first_bonus_round integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_complete' then
    raise exception '지금은 재개할 수 있는 상태가 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if coalesce(target_event.bonus_round_count, 0) <= 0 then
    raise exception '추가시간이 설정되지 않은 행사입니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  first_bonus_round := total_rounds + 1;

  perform public.generate_bonus_round_assignments(event_id_value, first_bonus_round);

  -- current_round는 아직 total_rounds(마지막 정규 라운드)로 둔다 -
  -- get_round_progress_for_participant의 next_assignment 조회가
  -- current_round+1을 보므로, 이렇게 해야 정확히 1번째 추가시간 짝을
  -- "다음 상대"로 보여줄 수 있다. reveal이 끝나 conversation으로 넘어갈
  -- 때 비로소 current_round가 first_bonus_round로 올라간다.
  update public.event_progress ep
  set stage = 'bonus_seat_guide',
      current_round = total_rounds,
      is_bonus_round = true,
      round_phase = 'reveal',
      round_timer_status = 'running',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      round_phase_started_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;
end;
$function$;

-- reveal(1분)/마지막 transition(1분) duration 분기 + round_phase_started_at
-- 유지. 그 외 로직(정규 라운드 진행, 지각 합류 등)은 전혀 바꾸지 않았다.
create or replace function public.advance_round_state_if_needed(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  bonus_index integer;
  next_bonus_index integer;
  has_next_bonus boolean;
  conversation_seconds integer;
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
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  conversation_seconds := coalesce(target_event.conversation_duration_seconds, 600);

  if target.stage = 'round_complete' then
    if coalesce(target_event.bonus_round_count, 0) <= 0 then
      update public.event_progress ep
      set stage = 'final_selection', updated_at = now()
      where ep.event_id = event_id_value;
    end if;
    return;
  end if;

  if target.stage = 'bonus_seat_guide' then
    if target.round_timer_status <> 'running' then
      return;
    end if;

    bonus_index := target.current_round - total_rounds;
    next_bonus_index := bonus_index + 1;
    has_next_bonus := next_bonus_index <= coalesce(target_event.bonus_round_count, 0);

    -- reveal(자리이동 안내 전용)은 항상 1분. transition(호감도 수정 +
    -- 다음 자리이동, 평소 2분)은 다음 추가시간이 없는 마지막 한 번만
    -- 1분으로 줄어든다 - 이동할 다음 자리가 없기 때문.
    phase_duration := case
      when target.round_phase = 'reveal' then 60
      when has_next_bonus then transition_seconds
      else 60
    end;

    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    if live_elapsed >= phase_duration then
      if has_next_bonus then
        update public.event_progress ep
        set stage = 'round_active',
            current_round = target.current_round + 1,
            round_phase = 'conversation',
            round_timer_status = 'running',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            round_phase_started_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      else
        update public.event_progress ep
        set stage = 'final_selection',
            round_timer_status = 'paused',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            round_phase_started_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      end if;
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
      bonus_index := target.current_round - total_rounds;
      next_bonus_index := bonus_index + 1;
      has_next_bonus := next_bonus_index <= coalesce(target_event.bonus_round_count, 0);
      if has_next_bonus then
        perform public.generate_bonus_round_assignments(event_id_value, target.current_round + 1);
      end if;
      update public.event_progress ep
      set stage = 'bonus_seat_guide',
          round_phase = 'transition',
          round_timer_status = 'running',
          round_timer_position_seconds = live_elapsed - phase_duration,
          round_timer_updated_at = now(),
          round_phase_started_at = now(),
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
$function$;

-- 참가자 진행 상태: hasSubmittedBonusRating 추가(2분 transition 동안만
-- 의미 있음). round_phase_started_at 이후에 갱신된 round_ratings가
-- 있으면 "이번 phase에서 제출 완료"로 본다 - 타이머 일시정지/재개로
-- round_timer_updated_at이 움직여도 영향받지 않도록 별도 컬럼을 쓴다.
create or replace function public.get_round_progress_for_participant(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  assignment record;
  next_assignment record;
  has_submitted_profile_card boolean;
  bonus_partner_id uuid;
  bonus_original_round integer;
  has_submitted_bonus_rating boolean := false;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_application_id,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname,
    case when eta.male_application_id = target_application.id
      then extract(year from age(target_event.event_date::timestamp, fa.birth_date::timestamp))::integer
      else extract(year from age(target_event.event_date::timestamp, ma.birth_date::timestamp))::integer
    end as partner_age,
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job
  into assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.round_number = coalesce(target_progress.current_round, 1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_application_id,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname,
    case when eta.male_application_id = target_application.id
      then extract(year from age(target_event.event_date::timestamp, fa.birth_date::timestamp))::integer
      else extract(year from age(target_event.event_date::timestamp, ma.birth_date::timestamp))::integer
    end as partner_age,
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job
  into next_assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where target_progress.stage = 'bonus_seat_guide'
    and eta.event_id = event_id_value
    and eta.round_number = coalesce(target_progress.current_round, 1) + 1
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  select exists (
    select 1 from public.event_profile_cards
    where event_id = event_id_value and application_id = target_application.id and submitted_at is not null
  ) into has_submitted_profile_card;

  if target_progress.stage = 'bonus_seat_guide' and target_progress.round_phase = 'transition' then
    select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
    into bonus_partner_id
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = target_progress.current_round
      and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

    if bonus_partner_id is not null then
      select eta.round_number into bonus_original_round
      from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and not eta.is_bonus
        and ((eta.male_application_id = target_application.id and eta.female_application_id = bonus_partner_id)
          or (eta.female_application_id = target_application.id and eta.male_application_id = bonus_partner_id))
      limit 1;

      if bonus_original_round is not null and target_progress.round_phase_started_at is not null then
        select exists (
          select 1 from public.round_ratings rr
          where rr.event_id = event_id_value
            and rr.round_number = bonus_original_round
            and rr.rater_application_id = target_application.id
            and rr.updated_at >= target_progress.round_phase_started_at
        ) into has_submitted_bonus_rating;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'tableNumber', assignment.table_number,
    'partnerApplicationId', assignment.partner_application_id,
    'partnerNickname', assignment.partner_nickname,
    'partnerAge', assignment.partner_age,
    'partnerJob', assignment.partner_job,
    'isResting', target_progress.stage = 'round_active' and assignment.partner_application_id is null,
    'nextTableNumber', next_assignment.table_number,
    'nextPartnerNickname', next_assignment.partner_nickname,
    'nextPartnerAge', next_assignment.partner_age,
    'nextPartnerJob', next_assignment.partner_job,
    'gender', target_application.gender,
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'hasSubmittedProfileCard', has_submitted_profile_card,
    'hasSubmittedBonusRating', has_submitted_bonus_rating,
    'serverNow', now()
  );
end;
$function$;

-- 관리자 화면: reveal 단계에서도 "추가시간 1"로 정확히 보이도록
-- bonusRoundIndex를 보정.
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

-- 태블릿: 동일하게 reveal 단계에서 bonusRoundIndex 보정.
create or replace function public.get_round_progress_for_tablet(event_id_value text, table_number_value integer, connection_token text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  tablet public.event_tablets%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  match_row record;
begin
  select et.* into tablet
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.event_tablets et set last_seen_at = now(), updated_at = now() where et.id = tablet.id;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select ma.nickname as male_nickname, fa.nickname as female_nickname
  into match_row
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.table_number = table_number_value
    and eta.round_number = coalesce(target_progress.current_round, 1);

  return jsonb_build_object(
    'ok', true,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'maleNickname', match_row.male_nickname,
    'femaleNickname', match_row.female_nickname,
    'isResting', target_progress.stage = 'round_active' and (match_row.male_nickname is null or match_row.female_nickname is null),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case
      when target_progress.round_phase = 'reveal' then 1
      when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds
      else null
    end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'serverNow', now()
  );
end;
$function$;

-- 추가시간 매칭 재작성: 정규 라운드 이력은 제외 조건에서 뺀다(추가시간의
-- 목적 자체가 정규에서 만난 사람과 다시 만나는 것). 오직 "이전
-- 추가시간에서 이미 짝지어졌던 조합"만 제외한다. 상호 호감도 쌍을 먼저
-- 배정하고, 남은 인원도 전원 매칭을 시도한다. 중복 없이 전원을 매칭할
-- 수 없으면 조용히 반복 배정하는 대신 명확히 실패시킨다.
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  plan record;
  total_rounds integer;
  remaining_males uuid[];
  remaining_females uuid[];
  matched_count integer := 0;
  expected_matches integer;
  pick_side text;
  pick_id uuid;
  pick_count integer;
  partner_id uuid;
  female_table integer;
  loop_guard integer := 0;
begin
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select array_agg(a.id) into remaining_males
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
    and a.attendance_status = 'active' and a.gender = '남성';

  select array_agg(a.id) into remaining_females
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
    and a.attendance_status = 'active' and a.gender = '여성';

  expected_matches := least(coalesce(array_length(remaining_males, 1), 0), coalesce(array_length(remaining_females, 1), 0));
  if expected_matches <= 0 then
    return;
  end if;

  -- 이전 추가시간에서 이미 짝지어졌던 조합만 제외한 후보 쌍 전체(정규
  -- 라운드 이력은 보지 않는다). 이후 루프에서 이 임시 테이블을 계속
  -- 소비한다.
  drop table if exists tmp_bonus_candidates;
  create temporary table tmp_bonus_candidates on commit drop as
  select
    ma.id as male_application_id,
    fa.id as female_application_id,
    (mf.score is not null and fm.score is not null) as has_mutual,
    coalesce(mf.score, 0) + coalesce(fm.score, 0) as weight
  from public.applications ma
  cross join public.applications fa
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
    order by rr.round_number asc limit 1
  ) mf on true
  left join lateral (
    select rr.score from public.round_ratings rr
    where rr.event_id = event_id_value and rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
    order by rr.round_number asc limit 1
  ) fm on true
  where ma.id = any(remaining_males) and fa.id = any(remaining_females)
    and not exists (
      select 1 from public.event_table_assignments prev
      where prev.event_id = event_id_value
        and prev.round_number < target_round_number
        and prev.is_bonus
        and prev.male_application_id = ma.id
        and prev.female_application_id = fa.id
    );

  -- 매 단계마다 "남은 후보가 가장 적은 사람"을 먼저 확정한다(최소 잔여값
  -- 우선 - constraint satisfaction의 표준 기법). 고정된 순서로 그냥 앞에서
  -- 부터 배정하면, 운 나쁘게 먼저 고른 짝이 다른 사람의 유일한 남은
  -- 선택지를 가로채 매칭 전체가 실패할 수 있다(실제 테스트에서 확인됨).
  -- 가장 궁한 사람부터 확정하면 이런 잠금 실패를 사실상 방지할 수 있다.
  loop
    loop_guard := loop_guard + 1;
    exit when loop_guard > 200;
    exit when coalesce(array_length(remaining_males, 1), 0) = 0 or coalesce(array_length(remaining_females, 1), 0) = 0;

    select side, id, cnt into pick_side, pick_id, pick_count
    from (
      select 'male' as side, male_application_id as id, count(*) as cnt
      from tmp_bonus_candidates
      where male_application_id = any(remaining_males) and female_application_id = any(remaining_females)
      group by male_application_id
      union all
      select 'female' as side, female_application_id as id, count(*) as cnt
      from tmp_bonus_candidates
      where male_application_id = any(remaining_males) and female_application_id = any(remaining_females)
      group by female_application_id
    ) combined
    order by cnt asc, side, id
    limit 1;

    -- 후보가 아예 없는 사람이 나오면 더 이상 전원 매칭이 불가능하다 -
    -- 루프를 끝내고 아래에서 matched_count < expected_matches로 실패
    -- 처리한다.
    exit when pick_side is null or pick_count = 0;

    if pick_side = 'male' then
      select female_application_id into partner_id
      from tmp_bonus_candidates
      where male_application_id = pick_id and female_application_id = any(remaining_females)
      order by has_mutual desc, weight desc, female_application_id
      limit 1;

      select eta.table_number into female_table
      from public.event_table_assignments eta
      where eta.event_id = event_id_value and eta.round_number = total_rounds
        and not eta.is_bonus and eta.female_application_id = partner_id
      limit 1;

      insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
      values (event_id_value, coalesce(female_table, 1), target_round_number, pick_id, partner_id, true);

      remaining_males := array_remove(remaining_males, pick_id);
      remaining_females := array_remove(remaining_females, partner_id);
    else
      select male_application_id into partner_id
      from tmp_bonus_candidates
      where female_application_id = pick_id and male_application_id = any(remaining_males)
      order by has_mutual desc, weight desc, male_application_id
      limit 1;

      select eta.table_number into female_table
      from public.event_table_assignments eta
      where eta.event_id = event_id_value and eta.round_number = total_rounds
        and not eta.is_bonus and eta.female_application_id = pick_id
      limit 1;

      insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
      values (event_id_value, coalesce(female_table, 1), target_round_number, partner_id, pick_id, true);

      remaining_females := array_remove(remaining_females, pick_id);
      remaining_males := array_remove(remaining_males, partner_id);
    end if;

    matched_count := matched_count + 1;
  end loop;

  if matched_count < expected_matches then
    raise exception '중복되지 않는 추가시간 매칭을 생성할 수 없습니다.';
  end if;
end;
$function$;
