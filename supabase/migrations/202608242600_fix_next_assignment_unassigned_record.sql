-- 실제 운영 중 발견된 심각한 버그: get_round_progress_for_participant의
-- next_assignment(record 타입)는 stage가 'bonus_seat_guide'일 때만
-- select into로 대입됐는데, 그 외의(거의 모든) stage에서는 함수 끝의
-- jsonb_build_object가 next_assignment.table_number 등 필드에 무조건
-- 접근하면서 "record next_assignment is not assigned yet" 예외가 났다.
-- 즉 참가자가 행사에 입장한 뒤 bonus_seat_guide 단계가 아닌 동안에는
-- 이 RPC가 매번 에러를 던졌고, 클라이언트 폴링은 이 에러를 조용히
-- 삼키기만 해서 화면이 "불러오는 중"에서 영원히 멈춰 보였다.
--
-- 고침: if로 감싸는 대신 select into 자체를 항상 실행하고 stage 조건을
-- where절 안으로 넣는다 - 조건에 안 맞으면 0행이 매치되어 필드가 모두
-- null로 안전하게 초기화된다(이미 정상 동작하던 assignment 변수와 같은
-- 패턴). 다른 로직은 전혀 바꾸지 않았다.
create or replace function public.get_round_progress_for_participant(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  assignment record;
  next_assignment record;
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

  -- 조건을 where절 안으로 옮겨 이 select into가 항상 실행되게 한다(예전
  -- if-wrapped 버전은 stage가 bonus_seat_guide가 아니면 이 블록 자체를
  -- 건너뛰어 next_assignment가 끝까지 미대입 상태로 남았다).
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
    'serverNow', now()
  );
end;
$$;

grant execute on function public.get_round_progress_for_participant(text, text) to anon, authenticated;
