-- 행사모드 "현재 대화 중"/호감도 작성/추가시간 안내 화면에서 상대의 키도
-- 나이/직업과 같은 방식으로 보여준다 - 새 입력이 아니라 이미 프로필에
-- 저장된 applications.height를 그대로 노출(고정, 편집 불가)한다.
-- 함수 시그니처는 그대로라 create or replace로 충분(202608301500의
-- 전체 정의에 partner_height/next_partner_height만 추가).
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
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job,
    case when eta.male_application_id = target_application.id then fa.height else ma.height end as partner_height
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
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job,
    case when eta.male_application_id = target_application.id then fa.height else ma.height end as partner_height
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

      -- 정규 이력이 없으면(이번에 새로 가능해진, 정규에서 못 만난 채
      -- 추가시간에서 처음 만난 케이스) submit_bonus_round_rating과 동일하게
      -- 지금 이 추가시간 라운드 번호 자체를 기준으로 제출 여부를 본다.
      if target_progress.round_phase_started_at is not null then
        select exists (
          select 1 from public.round_ratings rr
          where rr.event_id = event_id_value
            and rr.round_number = coalesce(bonus_original_round, target_progress.current_round)
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
    'partnerHeight', assignment.partner_height,
    'isResting', target_progress.stage = 'round_active' and assignment.partner_application_id is null,
    'nextTableNumber', next_assignment.table_number,
    'nextPartnerNickname', next_assignment.partner_nickname,
    'nextPartnerAge', next_assignment.partner_age,
    'nextPartnerJob', next_assignment.partner_job,
    'nextPartnerHeight', next_assignment.partner_height,
    'gender', target_application.gender,
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'hasSubmittedProfileCard', has_submitted_profile_card,
    'hasSubmittedBonusRating', has_submitted_bonus_rating,
    'serverNow', now()
  );
end;
$function$;
