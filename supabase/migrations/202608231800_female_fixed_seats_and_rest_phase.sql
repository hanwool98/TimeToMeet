-- 1) 좌석 이동 규칙 수정: 여성 고정 / 남성 이동.
--
-- generate_round_schedule_if_missing이 지금까지 table_number = 남성의
-- 순번(고정), round마다 여성이 회전하는 방식으로 배정하고 있었다 - 실제
-- 운영 방식(여성은 자리 고정, 남성이 라운드마다 상대 여성의 테이블로
-- 이동)과 반대였다. 원 안의 남/여 두 그룹을 서로 상대적으로 회전시켜
-- "모든 남성이 모든 여성을 정확히 한 번씩 만난다"는 circle method의
-- 핵심 성질은 어느 쪽을 고정하고 어느 쪽을 회전시키든 대칭적으로
-- 성립하므로, table_number를 여성 순번으로 고정하고 남성만 라운드마다
-- 회전시키도록 두 변수의 역할만 맞바꾼다. 이미 라운드가 생성된(진행
-- 중인) 행사는 이 함수가 "테이블 배정이 비어있을 때만" 실행되므로 영향받지
-- 않고, 앞으로 새로 시작하는 행사부터 바로잡힌 방식으로 배정된다.
create or replace function public.generate_round_schedule_if_missing(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if exists (select 1 from public.event_table_assignments eta where eta.event_id = event_id_value) then
    return;
  end if;

  with males as (
    select a.id, row_number() over (order by a.checked_in_at asc nulls last, a.id asc) as rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '남성' and a.checked_in_at is not null
  ),
  females as (
    select a.id, row_number() over (order by a.checked_in_at asc nulls last, a.id asc) as rn
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.gender = '여성' and a.checked_in_at is not null
  ),
  n as (
    select least((select count(*) from males), (select count(*) from females))::integer as n_count
  )
  insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id)
  select event_id_value, t, r, m.id, f.id
  from n, generate_series(1, n.n_count) as t, generate_series(1, n.n_count) as r, males m, females f
  where n.n_count > 0 and f.rn = t and m.rn = (((t - 1 + r - 1) % n.n_count) + 1);
end;
$$;

-- 2) 정규 라운드 종료 후 휴식 phase.
--
-- round_complete는 지금까지 advance_round_state_if_needed가 매 poll마다
-- 자동으로 다음 phase(추가시간 또는 최종선택)로 넘겨버리는 "찰나의"
-- 상태였다. 추가시간이 설정된 행사(bonus_round_count > 0)는 이제
-- round_complete에서 자동으로 넘어가지 않고, 운영자가
-- resume_after_regular_rounds_for_session을 명시적으로 호출해야만
-- 추가시간 매칭이 시작된다 - 그 전까지는 어떤 timer도 새로 시작되지
-- 않고 참가자에게 추가시간 상대도 공개되지 않는다(round_complete
-- 진입 시 이미 round_timer_status='paused'로 저장되어 있어 자연히
-- 멈춰 있음). 추가시간이 0회인 행사는 애초에 넘어갈 추가시간이 없으므로
-- 기존과 동일하게 바로 최종 선택으로 자동 진행한다.
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
  bonus_index integer;
  conversation_seconds integer;
  bonus_conversation_seconds constant integer := 420;
  transition_seconds constant integer := 120;
  bonus_rating_seconds constant integer := 60;
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
  conversation_seconds := coalesce(target_event.conversation_duration_seconds, 600);

  if target.stage = 'round_complete' then
    if coalesce(target_event.bonus_round_count, 0) <= 0 then
      update public.event_progress ep
      set stage = 'final_selection', updated_at = now()
      where ep.event_id = event_id_value;
    end if;
    -- bonus_round_count > 0: 휴식 상태 그대로 유지 - 운영자의 명시적
    -- 재개(resume_after_regular_rounds_for_session)를 기다린다.
    return;
  end if;

  if target.stage = 'bonus_matching' then
    perform public.generate_bonus_round_assignments(event_id_value, target.current_round);
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
          round_phase = 'conversation',
          round_timer_status = 'running',
          round_timer_position_seconds = 0,
          round_timer_updated_at = now(),
          updated_at = now()
      where ep.event_id = event_id_value;
    end if;
    return;
  end if;

  if target.stage = 'bonus_rating' then
    if target.round_timer_status <> 'running' then
      return;
    end if;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    if live_elapsed >= bonus_rating_seconds then
      bonus_index := target.current_round - total_rounds;
      if bonus_index >= coalesce(target_event.bonus_round_count, 0) then
        update public.event_progress ep
        set stage = 'final_selection',
            round_timer_status = 'paused',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      else
        update public.event_progress ep
        set stage = 'bonus_matching',
            current_round = target.current_round + 1,
            round_timer_status = 'paused',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
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
      update public.event_progress ep
      set stage = 'bonus_rating',
          round_timer_status = 'running',
          round_timer_position_seconds = live_elapsed - phase_duration,
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

-- 3) 운영자 "재개" - round_complete(휴식) 상태에서만 호출 가능하며, 이전에
-- advance_round_state_if_needed가 자동으로 하던 round_complete -> bonus_matching
-- 전환을 그대로 수행한다. 개념적으로 대화 중 일시정지/재개(control_round_timer_for_session)
-- 와는 분리된 별도 액션 - 저기는 "이미 도는 timer를 멈췄다 이어감",
-- 여기는 "다음 단계 자체를 시작할지 결정".
create or replace function public.resume_after_regular_rounds_for_session(session_token text, event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
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

  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  update public.event_progress ep
  set stage = 'bonus_matching',
      current_round = total_rounds + 1,
      is_bonus_round = true,
      updated_at = now()
  where ep.event_id = event_id_value;
end;
$$;

grant execute on function public.resume_after_regular_rounds_for_session(text, text) to anon, authenticated;
