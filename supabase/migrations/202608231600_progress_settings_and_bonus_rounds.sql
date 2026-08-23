-- 행사 진행 설정(기본 라운드 시간 / 추가시간 횟수 / 최종 선택 인원) +
-- 그 값에 따라 실제로 여러 번 반복되는 추가시간(구 "보너스 라운드") phase.
--
-- 기존 bonus_round_enabled(boolean, 이번 세션 앞부분에서 추가)는 "추가시간을
-- 켤지 말지"만 표현할 수 있었는데, 이제 운영자가 "몇 회"까지 직접 정할 수
-- 있어야 하므로 bonus_round_count(integer, 0~3)로 대체한다. 기존 컬럼은
-- 남겨두되(값 삭제는 하지 않음) 더 이상 어디에서도 참조하지 않는다.

alter table public.events add column if not exists conversation_duration_seconds integer not null default 600;
alter table public.events add column if not exists bonus_round_count integer not null default 3;
alter table public.events add column if not exists final_selection_limit integer not null default 3;

alter table public.events drop constraint if exists events_conversation_duration_seconds_check;
alter table public.events add constraint events_conversation_duration_seconds_check
  check (conversation_duration_seconds in (420, 480, 600));

alter table public.events drop constraint if exists events_bonus_round_count_check;
alter table public.events add constraint events_bonus_round_count_check
  check (bonus_round_count between 0 and 3);

alter table public.events drop constraint if exists events_final_selection_limit_check;
alter table public.events add constraint events_final_selection_limit_check
  check (final_selection_limit between 1 and 3);

-- 1) 진행 설정 조회/저장 (행사 준비 화면). started_at이 채워진 이후에는
--    update_admin_event_settings가 서버에서 거절한다 - 프론트 잠금은 UX용,
--    실제 방어선은 여기.
create or replace function public.get_admin_event_settings(session_token text, event_id_value text)
returns table (
  conversation_duration_seconds integer,
  bonus_round_count integer,
  final_selection_limit integer,
  started_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select e.conversation_duration_seconds, e.bonus_round_count, e.final_selection_limit, e.started_at
  from public.events e
  where e.id = event_id_value;
end;
$$;

grant execute on function public.get_admin_event_settings(text, text) to anon, authenticated;

create or replace function public.update_admin_event_settings(
  session_token text,
  event_id_value text,
  conversation_duration_seconds_value integer,
  bonus_round_count_value integer,
  final_selection_limit_value integer
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  if target_event.started_at is not null then
    raise exception '행사가 시작된 이후에는 진행 설정을 변경할 수 없습니다.';
  end if;

  if conversation_duration_seconds_value not in (420, 480, 600) then
    raise exception '기본 라운드 시간은 7분/8분/10분 중에서 선택해주세요.';
  end if;
  if bonus_round_count_value not between 0 and 3 then
    raise exception '추가시간 횟수는 0~3회 중에서 선택해주세요.';
  end if;
  if final_selection_limit_value not between 1 and 3 then
    raise exception '최종 선택 인원은 1~3명 중에서 선택해주세요.';
  end if;

  update public.events
  set conversation_duration_seconds = conversation_duration_seconds_value,
      bonus_round_count = bonus_round_count_value,
      final_selection_limit = final_selection_limit_value,
      updated_at = now()
  where id = event_id_value;
end;
$$;

grant execute on function public.update_admin_event_settings(text, text, integer, integer, integer) to anon, authenticated;

-- 2) generate_bonus_round_assignments: 이제 "몇 번째 추가시간인지"를 나타내는
--    target_round_number를 받는다(총 정규 라운드 수 + 추가시간 인덱스). 이전
--    호출부(1-arg)는 완전히 대체되므로 drop 후 재정의한다. 이미 만난 적
--    있는 조합(정규든, 이전 추가시간이든)은 다시 매칭하지 않도록
--    event_table_assignments 전체를 참조해 제외한다. 테이블 번호는 계속
--    "여성의 마지막 정규 라운드 테이블"을 그대로 사용한다(여성은 자리 고정,
--    남성이 이동하는 운영 방식과 일치).
drop function if exists public.generate_bonus_round_assignments(text);

create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  total_rounds integer;
  rec record;
  used_males uuid[] := '{}';
  used_females uuid[] := '{}';
  remaining_males uuid[];
  remaining_females uuid[];
  female_table integer;
  i integer;
begin
  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  for rec in
    select c.male_application_id, c.female_application_id
    from public.compute_mutual_ratings(event_id_value) c
    where c.male_to_female_score is not null and c.female_to_male_score is not null
      and not exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number < target_round_number
          and prev.is_bonus
          and prev.male_application_id = c.male_application_id
          and prev.female_application_id = c.female_application_id
      )
    order by (c.male_to_female_score + c.female_to_male_score) desc
  loop
    if not (rec.male_application_id = any(used_males)) and not (rec.female_application_id = any(used_females)) then
      select eta.table_number into female_table
      from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and eta.round_number = total_rounds
        and not eta.is_bonus
        and eta.female_application_id = rec.female_application_id
      limit 1;

      insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
      values (event_id_value, coalesce(female_table, 1), target_round_number, rec.male_application_id, rec.female_application_id, true);
      used_males := used_males || rec.male_application_id;
      used_females := used_females || rec.female_application_id;
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
    select eta.table_number into female_table
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = total_rounds
      and not eta.is_bonus
      and eta.female_application_id = remaining_females[i]
    limit 1;

    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
    values (event_id_value, coalesce(female_table, 1), target_round_number, remaining_males[i], remaining_females[i], true);
  end loop;
end;
$$;

revoke all on function public.generate_bonus_round_assignments(text, integer) from public, anon, authenticated;

-- 3) advance_round_state_if_needed: 정규 라운드 대화시간을
--    events.conversation_duration_seconds에서 읽고, 정규 종료 후
--    events.bonus_round_count 만큼 "매칭(가변) -> 상대공개/자리이동(2분
--    고정) -> 대화(7분 고정) -> 호감도 수정(1분 고정)"을 반복한 뒤
--    final_selection으로 넘어간다. current_round는 각 추가시간 매칭 시작
--    시점에 미리 증가시켜(total_rounds + 추가시간 인덱스) 그 값 하나로
--    "지금 몇 번째 추가시간인지"와 "그 라운드의 상대가 누구인지"를 동시에
--    가리키게 한다 - 참가자 진행 조회(get_round_progress_for_participant)와
--    파트너 사진 조회가 이 값을 그대로 event_table_assignments.round_number
--    로 사용할 수 있어 별도 분기가 필요 없어진다.
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
    if coalesce(target_event.bonus_round_count, 0) > 0 then
      update public.event_progress ep
      set stage = 'bonus_matching', current_round = total_rounds + 1, is_bonus_round = true, updated_at = now()
      where ep.event_id = event_id_value;
    else
      update public.event_progress ep
      set stage = 'final_selection', updated_at = now()
      where ep.event_id = event_id_value;
    end if;
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
      -- 7분 대화 종료 -> 1분 기존 호감도 수정 phase.
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

-- 4) get_round_progress_for_participant: current_round이 이제 매칭 시작
--    시점부터 이미 그 추가시간 라운드 번호를 가리키므로, bonus 단계별 특수
--    분기 없이 항상 current_round로 조회하면 된다(단순화 + 여러 번의
--    추가시간에도 그대로 맞음).
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
  total_rounds integer;
  assignment record;
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
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

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
    'gender', target_application.gender,
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600)
  );
end;
$$;

grant execute on function public.get_round_progress_for_participant(text, text) to anon, authenticated;

-- 5) 추가시간 호감도 "수정": 새 라운드용 rating row를 만들지 않고, 두 사람이
--    정규 라운드에서 실제로 만난 그 round_number의 기존 round_ratings 행을
--    그대로 upsert한다(라운드 번호는 클라이언트가 모르며, 서버가
--    event_table_assignments에서 직접 찾는다). 현재 stage가 bonus_rating일
--    때만 동작 - 참가자가 임의 시점에 과거 평가를 덮어쓸 수 없게 한다.
create or replace function public.get_my_bonus_rating(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  partner_id uuid;
  existing public.round_ratings%rowtype;
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

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if target_progress.stage is distinct from 'bonus_rating' then
    return jsonb_build_object('ok', false);
  end if;

  select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
  into partner_id
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.round_number = target_progress.current_round
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if partner_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into existing
  from public.round_ratings rr
  where rr.event_id = event_id_value and rr.rater_application_id = target_application.id and rr.ratee_application_id = partner_id;

  return jsonb_build_object('ok', true, 'score', existing.score, 'memo', existing.memo);
end;
$$;

grant execute on function public.get_my_bonus_rating(text, text) to anon, authenticated;

create or replace function public.submit_bonus_round_rating(
  session_token text,
  event_id_value text,
  score_value numeric,
  memo_value text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  partner_id uuid;
  original_round integer;
  clean_memo text;
begin
  if score_value < 0 or score_value > 5 or mod((score_value * 10)::integer, 5) <> 0 then
    raise exception '호감도 점수는 0~5 사이 0.5 단위여야 합니다.';
  end if;

  clean_memo := nullif(trim(coalesce(memo_value, '')), '');
  if clean_memo is not null and char_length(clean_memo) > 200 then
    raise exception '메모는 200자 이내로 작성해주세요.';
  end if;

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if target_progress.stage is distinct from 'bonus_rating' then
    raise exception '지금은 호감도를 수정할 수 있는 시점이 아닙니다.';
  end if;

  select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
  into partner_id
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.round_number = target_progress.current_round
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if partner_id is null then
    raise exception '이번 추가시간 상대 정보를 찾을 수 없습니다.';
  end if;

  select eta.round_number into original_round
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and not eta.is_bonus
    and ((eta.male_application_id = target_application.id and eta.female_application_id = partner_id)
      or (eta.female_application_id = target_application.id and eta.male_application_id = partner_id))
  limit 1;

  if original_round is null then
    raise exception '정규 라운드에서 만난 기록을 찾을 수 없습니다.';
  end if;

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo)
  values (event_id_value, original_round, target_application.id, partner_id, score_value, clean_memo)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, updated_at = now();
end;
$$;

grant execute on function public.submit_bonus_round_rating(text, text, numeric, text) to anon, authenticated;

-- 6) 운영자/태블릿 화면도 같은 서버 공통 타이머를 그대로 반영해야 하므로
--    conversationDurationSeconds/추가시간 인덱스 정보를 함께 내려준다.
--    matches 조회는 이미 round_number = current_round 기준이라 추가시간
--    라운드에도 변경 없이 그대로 맞는다.
drop function if exists public.get_admin_round_progress(text, text);

create or replace function public.get_admin_round_progress(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  total_rounds integer;
  total_participants integer;
  active_tables integer;
  completed_rounds integer;
  pending_pause_count integer;
  matches jsonb;
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

  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  select count(*) into total_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null;

  select count(distinct eta.table_number) into active_tables
  from public.event_table_assignments eta
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

  completed_rounds := case
    when target_progress.stage = 'round_complete' then total_rounds
    when coalesce(target_progress.current_round, 1) > total_rounds then total_rounds
    else greatest(0, coalesce(target_progress.current_round, 1) - 1)
  end;

  select count(*) into pending_pause_count
  from public.event_pause_requests
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
    'matches', matches,
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds else null end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0)
  );
end;
$$;

grant execute on function public.get_admin_round_progress(text, text) to anon, authenticated;

drop function if exists public.get_round_progress_for_tablet(text, integer, text);

create or replace function public.get_round_progress_for_tablet(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  tablet public.event_tablets%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
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
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

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
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds else null end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0)
  );
end;
$$;

grant execute on function public.get_round_progress_for_tablet(text, integer, text) to anon, authenticated;

-- 7) control_round_timer_for_session: 정규/추가시간 대화(10 또는 8/7분 설정값
--    vs 추가시간 7분 고정), 추가시간 자리안내(2분), 추가시간 호감도 수정
--    (1분) phase 모두에서 pause/resume(그리고 테스트 행사의 skip)이 동작
--    하도록 대상 stage와 duration 계산을 넓힌다.
create or replace function public.control_round_timer_for_session(session_token text, event_id_value text, action text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  live_elapsed numeric;
  phase_duration integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage not in ('round_active', 'bonus_seat_guide', 'bonus_rating') then
    raise exception '라운드 진행 중이 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;

  phase_duration := case
    when target.stage = 'bonus_rating' then 60
    when target.stage = 'bonus_seat_guide' then 120
    when target.round_phase = 'conversation' and target.is_bonus_round then 420
    when target.round_phase = 'conversation' then coalesce(target_event.conversation_duration_seconds, 600)
    else 120
  end;

  if target.round_timer_status = 'running' then
    live_elapsed := least(phase_duration::numeric, target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at)));
  else
    live_elapsed := target.round_timer_position_seconds;
  end if;

  if action = 'pause' then
    update public.event_progress ep
    set round_timer_status = 'paused', round_timer_position_seconds = live_elapsed, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
  elsif action = 'resume' then
    update public.event_progress ep
    set round_timer_status = 'running', round_timer_position_seconds = live_elapsed, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
  elsif action = 'skip' then
    if not coalesce(target_event.is_test_event, false) then
      raise exception '테스트 행사에서만 사용할 수 있습니다.';
    end if;
    update public.event_progress ep
    set round_timer_status = 'running', round_timer_position_seconds = phase_duration, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
    perform public.advance_round_state_if_needed(event_id_value);
  else
    raise exception '알 수 없는 동작입니다: %', action;
  end if;

  select * into target from public.event_progress where event_id = event_id_value;
  return jsonb_build_object(
    'currentRound', target.current_round,
    'roundPhase', target.round_phase,
    'stage', target.stage,
    'timerStatus', target.round_timer_status,
    'timerPositionSeconds', target.round_timer_position_seconds,
    'timerUpdatedAt', target.round_timer_updated_at
  );
end;
$$;

grant execute on function public.control_round_timer_for_session(text, text, text) to anon, authenticated;
