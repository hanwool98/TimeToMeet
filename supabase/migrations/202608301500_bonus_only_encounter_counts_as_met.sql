-- 추가시간 미팅 누락 쌍 최우선 배정(202608301200)이 실제로 효과를 내면서,
-- "정규라운드에서는 못 만났지만 추가시간에서는 실제로 만난" 케이스가
-- 처음으로 발생했다. 그런데 아래 세 곳이 전부 "정규라운드에서 만난
-- 적이 있어야만 유효한 만남"이라는, 지금까지는 항상 참이었지만 이제는
-- 깨지는 전제를 깔고 있었다:
--
--  1) get_final_selection_candidates: 최종선택 후보 목록을 정규라운드
--     이력(not eta.is_bonus)에서만 뽑아서, 추가시간에서만 만난 사람은
--     후보 자체에 안 뜬다.
--  2) submit_final_selection: 마찬가지로 정규라운드 이력만 유효한
--     선택으로 인정해서, 후보 목록이 고쳐져도 실제 제출은 거부된다.
--  3) submit_bonus_round_rating: 정규라운드 이력이 없으면
--     "정규 라운드에서 만난 기록을 찾을 수 없습니다" 예외를 던져서,
--     추가시간에서 처음 만난 상대에게는 호감도 평가 자체가 실패한다.
--
-- 셋 다 "추가시간에서 만난 것도 정규만큼 유효한 만남"으로 인정하도록
-- 고친다.
create or replace function public.get_final_selection_candidates(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  candidates jsonb;
  selected_ids jsonb;
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

  select * into target_event from public.events where id = event_id_value;

  with met as (
    select distinct
      case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_id
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id)
  ),
  scored as (
    select
      met.partner_id,
      pa.nickname,
      extract(year from age(target_event.event_date::timestamp, pa.birth_date::timestamp))::integer as age,
      pa.job,
      rr.score,
      rr.memo,
      rr.hashtags,
      rank() over (order by rr.score desc nulls last, met.partner_id asc) as rnk
    from met
    join public.applications pa on pa.id = met.partner_id
    left join public.round_ratings rr
      on rr.event_id = event_id_value
      and rr.rater_application_id = target_application.id
      and rr.ratee_application_id = met.partner_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationId', partner_id,
    'nickname', nickname,
    'age', age,
    'job', job,
    'score', score,
    'memo', memo,
    'hashtags', hashtags
  ) order by rnk, nickname), '[]'::jsonb)
  into candidates
  from scored;

  select coalesce(jsonb_agg(fs.selected_application_id), '[]'::jsonb)
  into selected_ids
  from public.final_selections fs
  where fs.event_id = event_id_value and fs.selector_application_id = target_application.id;

  return jsonb_build_object('ok', true, 'candidates', candidates, 'selectedIds', selected_ids);
end;
$$;

-- submit_final_selection도 후보 검증 조건을 동일하게 맞춘다(위와 not
-- eta.is_bonus 제거 외 전부 동일).
create or replace function public.submit_final_selection(
  session_token text,
  event_id_value text,
  selected_application_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  submitted_count integer;
  valid_count integer;
  distinct_count integer;
  submitted_time timestamptz := now();
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  if exists (
    select 1 from public.final_selection_submissions fss
    where fss.event_id = event_id_value and fss.participant_id = target_application.id
  ) then
    raise exception '이미 최종 선택을 제출했습니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  submitted_count := coalesce(array_length(selected_application_ids, 1), 0);

  select count(distinct x) into distinct_count
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as x;
  if distinct_count <> submitted_count then
    raise exception '선택 목록에 중복된 참가자가 있습니다.';
  end if;

  if submitted_count > coalesce(target_event.final_selection_limit, 3) then
    raise exception '최대 선택 가능 인원을 초과했습니다.';
  end if;

  select count(*) into valid_count
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel(id)
  where exists (
    select 1 from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and ((eta.male_application_id = target_application.id and eta.female_application_id = sel.id)
        or (eta.female_application_id = target_application.id and eta.male_application_id = sel.id))
  );

  if valid_count <> submitted_count then
    raise exception '유효하지 않은 선택 대상이 포함되어 있습니다.';
  end if;

  insert into public.final_selections (event_id, selector_application_id, selected_application_id)
  select event_id_value, target_application.id, sel
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel
  on conflict (event_id, selector_application_id, selected_application_id) do nothing;

  insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
  values (event_id_value, target_application.id, submitted_time);

  update public.applications
  set final_selection_submitted_at = submitted_time
  where id = target_application.id;
end;
$$;

-- submit_bonus_round_rating: 정규라운드 이력이 없으면 예외를 던지는 대신,
-- 지금 이 추가시간 라운드 번호 자체를 round_ratings의 round_number로
-- 써서 저장한다. round_ratings에는 애초에 "정규/추가시간" 구분 컬럼이
-- 없고 unique(event_id, round_number, rater_application_id)만 있으므로,
-- 스키마 변경 없이 안전하게 해결된다(이 라운드 번호로 다른 평가가 이미
-- 저장돼 있을 수 없다 - partner_id가 이미 이 라운드의 유일한 상대로
-- 확인됐기 때문).
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

  -- 정규라운드에서 만난 적 없는 추가시간 상대(이번 우선배정 개선으로
  -- 새로 가능해진 케이스) - 정규 이력에 억지로 끼워넣지 않고, 지금 이
  -- 추가시간 라운드 번호 자체를 키로 써서 저장한다.
  original_round := coalesce(original_round, target_progress.current_round);

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo, hashtags)
  values (event_id_value, original_round, target_application.id, partner_id, score_value, clean_memo, clean_hashtags)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, hashtags = excluded.hashtags, updated_at = now();
end;
$$;

-- get_round_progress_for_participant(참가자 화면 폴링)도 위와 정확히
-- 같은 fallback(정규 이력 없으면 현재 추가시간 라운드 번호 사용)을 써서
-- "제출했는지" 여부를 확인해야 한다 - 안 그러면 submit_bonus_round_rating
-- 으로 실제로는 저장에 성공했는데도 화면에는 "아직 제출 안 함"으로 계속
-- 남아있게 된다.
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
