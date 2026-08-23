-- 추가시간 진행 흐름 개편: "대화 7분 -> 호감도 수정 1분 -> 매칭 -> 자리이동
-- 2분 -> 다음 대화" 였던 것을 "대화 7분 -> 호감도 수정+자리이동 통합 2분 ->
-- 다음 대화"로 합친다. bonus_matching/bonus_rating 스테이지는 더 이상
-- 살아있는 전환 목적지가 아니게 된다(테이블/RPC 자체는 남겨둠, 도달만 안
-- 함).
--
-- 핵심 설계: 직전 대화가 끝나는 시점에 (다음 라운드가 있다면) 그 라운드의
-- 매칭을 미리 계산해두되 current_round는 아직 올리지 않는다. 그래서
-- 통합된 bonus_seat_guide 화면 동안 "호감도 수정" 파트는 여전히
-- current_round(=방금 끝난 라운드)를 그대로 봐서 submit_bonus_round_rating/
-- get_my_bonus_rating이 완전히 그대로(스테이지 게이트 문자열만 교체) 동작
-- 하고, "다음 상대 안내" 파트만 current_round+1을 미리 조회한다.
-- current_round는 통합 화면이 끝나 다음 대화로 넘어갈 때 비로소 올라간다.

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

  -- 통합된 "호감도 수정 + 다음 자리 이동" 2분 phase. current_round는 여기서
  -- 아직 방금 끝난 라운드를 가리킨다 - round_active(bonus 대화) 종료 시점에
  -- 이미 다음 라운드 매칭을 미리 계산해뒀다면(has_next_bonus) 이 phase
  -- 동안 그 매칭이 "다음 상대 안내" 데이터로 조회된다.
  if target.stage = 'bonus_seat_guide' then
    if target.round_timer_status <> 'running' then
      return;
    end if;
    live_elapsed := target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at));
    if live_elapsed >= transition_seconds then
      bonus_index := target.current_round - total_rounds;
      next_bonus_index := bonus_index + 1;
      if next_bonus_index <= coalesce(target_event.bonus_round_count, 0) then
        update public.event_progress ep
        set stage = 'round_active',
            current_round = target.current_round + 1,
            round_phase = 'conversation',
            round_timer_status = 'running',
            round_timer_position_seconds = 0,
            round_timer_updated_at = now(),
            updated_at = now()
        where ep.event_id = event_id_value;
      else
        update public.event_progress ep
        set stage = 'final_selection',
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
      -- 대화 종료: 다음 추가시간이 남아있다면 그 매칭을 미리 계산해두고
      -- (current_round는 아직 그대로) 통합 2분 phase로 바로 넘어간다 -
      -- bonus_matching/bonus_rating 단계를 거치지 않는다.
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

-- 참가자 진행 화면: 기본 partner* 필드는 그대로 current_round 기준(방금
-- 끝난/현재 상대) - RatingScreen이 "누구를 평가 중인지" 표시하는 데 계속
-- 이 값을 쓴다. bonus_seat_guide 단계에서만 별도로 next* 필드를 추가
-- 조회해서(round_number = current_round+1) 자리 이동 안내용으로 얹는다 -
-- 다음 라운드 매칭이 없으면(마지막 추가시간) 전부 null로 내려가고 프론트가
-- 이를 "다음 상대 없음"으로 해석한다.
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

  if target_progress.stage = 'bonus_seat_guide' then
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
    where eta.event_id = event_id_value
      and eta.round_number = coalesce(target_progress.current_round, 1) + 1
      and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);
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

-- 태블릿은 bonus_seat_guide에서도 여전히 일반 안내 문구만 보여주고(참가자
-- 폰과 달리 원래 상대 이름을 노출하지 않던 화면), "다음 추가시간이 있는지"
-- 여부는 이미 있는 bonusRoundIndex/bonusRoundCount로 프론트가 판단할 수
-- 있어 조회 로직 자체는 바꿀 필요가 없다 - serverNow만 추가한다.
create or replace function public.get_round_progress_for_tablet(event_id_value text, table_number_value integer, connection_token text)
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
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'serverNow', now()
  );
end;
$$;

grant execute on function public.get_round_progress_for_tablet(text, integer, text) to anon, authenticated;

-- 호감도 "수정" 자체 로직은 완전히 그대로다(원래 정규 라운드 행을 찾아
-- upsert) - 게이트 스테이지 문자열만 bonus_rating -> bonus_seat_guide로
-- 바뀌고, hashtags가 추가된다.
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
  if target_progress.stage is distinct from 'bonus_seat_guide' then
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

  return jsonb_build_object('ok', true, 'score', existing.score, 'memo', existing.memo, 'hashtags', existing.hashtags);
end;
$$;

grant execute on function public.get_my_bonus_rating(text, text) to anon, authenticated;

drop function if exists public.submit_bonus_round_rating(text, text, numeric, text);

create or replace function public.submit_bonus_round_rating(
  session_token text,
  event_id_value text,
  score_value numeric,
  memo_value text default null,
  hashtags_value text[] default null
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
  clean_hashtags text[];
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
  if target_progress.stage is distinct from 'bonus_seat_guide' then
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

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo, hashtags)
  values (event_id_value, original_round, target_application.id, partner_id, score_value, clean_memo, clean_hashtags)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, hashtags = excluded.hashtags, updated_at = now();
end;
$$;

grant execute on function public.submit_bonus_round_rating(text, text, numeric, text, text[]) to anon, authenticated;
