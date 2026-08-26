-- 지각 체크인 자동 합류. 이 행사는 전원 체크인을 요구하지 않고, 노쇼·지각이
-- 정상 상황이다 - 성비 불균형("쉬어가는 시간")은 이미 구현돼 있었지만,
-- 라운드가 이미 시작된 뒤에 체크인하는 지각자를 향후 라운드에 끼워 넣는
-- 로직은 어디에도 없었다(체크인은 시간만 기록, 배정표는 관리자가 명시적으로
-- 불참/복귀 처리를 눌러야만 재계산됨). 그리고 프로필 카드는 라운드 시작
-- 이후 무조건 잠겨 있어 지각자가 화면에 진입도 못 했다.

-- 1) 체크인 공용 로직(QR/수동 체크인이 둘 다 이 함수를 통해서만 저장한다) -
-- 이미 배정표가 있는 상태(=행사가 이미 시작됨)에서 체크인하는데 이 사람이
-- 향후 어느 라운드에도 없으면, "진행 중이거나 이미 끝난 라운드는 절대
-- 건드리지 않고" 다음 라운드부터 자동으로 다시 계산한다.
-- set_participant_attendance_status_for_session이 쓰는 것과 동일한
-- regenerate_round_schedule_from_round + 원래 마지막 라운드 상한 로직을
-- 그대로 재사용한다.
create or replace function public.finalize_application_check_in(admin_user_id uuid, target_application_id uuid)
returns table (checked_in_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result_checked_in_at timestamptz;
  target_event_id text;
  already_scheduled boolean;
  boundary_round integer;
  original_last_round integer;
  max_rounds_value integer;
begin
  update public.application_tickets t
  set checked_in_at = coalesce(t.checked_in_at, now()),
      checked_in_by = coalesce(t.checked_in_by, admin_user_id),
      updated_at = now()
  where t.application_id = target_application_id
  returning t.checked_in_at into result_checked_in_at;

  update public.applications a
  set checked_in_at = result_checked_in_at,
      checked_in_by = coalesce(a.checked_in_by, admin_user_id),
      updated_at = now()
  where a.id = target_application_id
  returning a.event_id into target_event_id;

  select exists (
    select 1 from public.event_table_assignments where event_id = target_event_id and not is_bonus
  ) into already_scheduled;

  if already_scheduled then
    select coalesce(ep.current_round, 0) + 1 into boundary_round
    from public.event_progress ep where ep.event_id = target_event_id;
    boundary_round := coalesce(boundary_round, 1);

    if not exists (
      select 1 from public.event_table_assignments
      where event_id = target_event_id and not is_bonus and round_number >= boundary_round
        and (male_application_id = target_application_id or female_application_id = target_application_id)
    ) then
      select max(round_number) into original_last_round
      from public.event_table_assignments where event_id = target_event_id and not is_bonus;

      if original_last_round is not null then
        max_rounds_value := greatest(0, original_last_round - boundary_round + 1);
      else
        max_rounds_value := null;
      end if;

      perform public.regenerate_round_schedule_from_round(target_event_id, boundary_round, max_rounds_value);
    end if;
  end if;

  return query select result_checked_in_at;
end;
$$;

-- 2) 프로필 카드 잠금 조건 완화: "라운드 시작 후 무조건 잠금"이 아니라
-- "이미 제출한 적 있는 카드만(=상대가 봤을 수 있음) 라운드 시작 후 잠금".
-- 한 번도 제출한 적 없는 지각자는 라운드가 진행 중이어도 최초 제출이
-- 가능해야 한다 - 아직 아무도 이 카드를 본 적이 없으므로 공정성 문제가
-- 없다.
create or replace function public.save_event_profile_card_for_session(
  session_token text,
  event_id_value text,
  hobby_value text,
  mbti_value text,
  ideal_type_value text,
  contact_style_value text,
  date_style_value text,
  smoking_value text,
  drinking_value text,
  keywords_value text[],
  photo_path_value text default null,
  photo_crop_value jsonb default null,
  submit_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  result_submitted_at timestamptz;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '체크인된 참가자만 프로필 카드를 작성할 수 있습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if found and target_progress.stage not in ('seat_guide', 'intro_video', 'round_waiting') then
    if exists (
      select 1 from public.event_profile_cards
      where event_id = event_id_value and application_id = target_application.id and submitted_at is not null
    ) then
      raise exception '라운드가 시작된 이후에는 프로필 카드를 수정할 수 없습니다.';
    end if;
  end if;

  if photo_path_value is not null
    and not (photo_path_value = any(coalesce(target_application.profile_photo_paths, '{}')))
    and photo_path_value not like (session_user_id::text || '/%')
  then
    raise exception '본인이 등록한 사진만 사용할 수 있습니다.';
  end if;

  insert into public.event_profile_cards (
    event_id, application_id, photo_path, photo_crop, hobby, mbti, ideal_type,
    contact_style, date_style, smoking, drinking, keywords, submitted_at, updated_at
  )
  values (
    event_id_value, target_application.id, photo_path_value, photo_crop_value,
    coalesce(hobby_value, ''), coalesce(mbti_value, ''), coalesce(ideal_type_value, ''),
    coalesce(contact_style_value, ''), coalesce(date_style_value, ''),
    coalesce(smoking_value, ''), coalesce(drinking_value, ''), coalesce(keywords_value, '{}'),
    case when submit_value then now() else null end,
    now()
  )
  on conflict (event_id, application_id) do update set
    photo_path = excluded.photo_path,
    photo_crop = excluded.photo_crop,
    hobby = excluded.hobby,
    mbti = excluded.mbti,
    ideal_type = excluded.ideal_type,
    contact_style = excluded.contact_style,
    date_style = excluded.date_style,
    smoking = excluded.smoking,
    drinking = excluded.drinking,
    keywords = excluded.keywords,
    submitted_at = case when submit_value then now() else public.event_profile_cards.submitted_at end,
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at);
end;
$$;

-- 3) 참가자 본인 화면이 "나는 카드를 제출한 적이 있는가"를 알아야 라운드가
-- 진행 중이어도 카드 작성 화면을 계속 보여줄지 판단할 수 있다.
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
  has_submitted_profile_card boolean;
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
    'serverNow', now()
  );
end;
$$;
