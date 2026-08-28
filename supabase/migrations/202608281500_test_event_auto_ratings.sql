-- 테스트 행사에서 시스템이 생성한 임시 test participant(applications.
-- is_test_participant=true)가 정규 호감도 phase에 들어가면 자동으로
-- 랜덤 호감도를 제출하고, 추가시간이 끝나면 원래 정규 라운드 점수를
-- 자동으로 수정(UPDATE)한다. 반드시 events.is_test_event=true +
-- applications.is_test_participant=true 두 조건을 서버에서 모두 확인하고,
-- 헬퍼 함수 자체에도 동일한 is_test_event 가드를 넣어(벨트+서스펜더)
-- 실제 행사에는 절대 적용되지 않게 한다. 실제 참가자는 is_test_participant
-- 가 false이므로 어떤 경로로도 자동 제출 대상이 되지 않는다.

create or replace function public.seed_test_round_ratings(event_id_value text, round_number_value integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not exists (select 1 from public.events where id = event_id_value and is_test_event = true) then
    return;
  end if;

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score)
  select
    event_id_value,
    round_number_value,
    a.id,
    case when eta.male_application_id = a.id then eta.female_application_id else eta.male_application_id end,
    (floor(random() * 11)::numeric) / 2.0
  from public.event_table_assignments eta
  join public.applications a on a.id in (eta.male_application_id, eta.female_application_id)
  where eta.event_id = event_id_value
    and eta.round_number = round_number_value
    and not eta.is_bonus
    and eta.male_application_id is not null
    and eta.female_application_id is not null
    and a.is_test_participant = true
  on conflict (event_id, round_number, rater_application_id) do nothing;
end;
$$;

revoke all on function public.seed_test_round_ratings(text, integer) from public;

create or replace function public.revise_test_bonus_round_ratings(event_id_value text, bonus_round_number_value integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  rec record;
  original_round integer;
begin
  if not exists (select 1 from public.events where id = event_id_value and is_test_event = true) then
    return;
  end if;

  for rec in
    select
      a.id as rater_id,
      case when eta.male_application_id = a.id then eta.female_application_id else eta.male_application_id end as partner_id
    from public.event_table_assignments eta
    join public.applications a on a.id in (eta.male_application_id, eta.female_application_id)
    where eta.event_id = event_id_value
      and eta.round_number = bonus_round_number_value
      and eta.is_bonus
      and eta.male_application_id is not null
      and eta.female_application_id is not null
      and a.is_test_participant = true
  loop
    select eta2.round_number into original_round
    from public.event_table_assignments eta2
    where eta2.event_id = event_id_value
      and not eta2.is_bonus
      and ((eta2.male_application_id = rec.rater_id and eta2.female_application_id = rec.partner_id)
        or (eta2.female_application_id = rec.rater_id and eta2.male_application_id = rec.partner_id))
    limit 1;

    if original_round is not null then
      update public.round_ratings
      set score = (floor(random() * 11)::numeric) / 2.0, updated_at = now()
      where event_id = event_id_value and round_number = original_round and rater_application_id = rec.rater_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.revise_test_bonus_round_ratings(text, integer) from public;

-- advance_round_state_if_needed: 기존 로직은 전혀 바꾸지 않고, "라운드가
-- 방금 conversation phase로 진입"/"추가시간이 방금 끝나 bonus_seat_guide로
-- 전환" 두 시점에만 위 헬퍼 호출을 끼워넣는다(둘 다 target_event.
-- is_test_event일 때만 아무 값도 바뀌지 않던 실제 이벤트 경로는 완전히
-- 그대로).
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

      if target_event.is_test_event then
        perform public.seed_test_round_ratings(event_id_value, target.current_round);
      end if;
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

      if target_event.is_test_event then
        perform public.revise_test_bonus_round_ratings(event_id_value, target.current_round);
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

      if target_event.is_test_event then
        perform public.seed_test_round_ratings(event_id_value, target.current_round);
      end if;
    end if;
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
