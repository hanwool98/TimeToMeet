-- Participant-facing 호감도 작성 screen support. round_ratings/submit_round_rating
-- already existed (built ahead of the UI) - this adds: a memo field, a
-- round-locked edit window (can't touch a rating once the event has moved
-- past that round), a self-read RPC for refresh-recovery/prefill, richer
-- partner info (age/job/application id) on the existing participant round
-- progress RPC, and memo exposure on the existing admin ratings RPC.
alter table public.round_ratings add column if not exists memo text;

alter table public.round_ratings drop constraint if exists round_ratings_memo_length_check;
alter table public.round_ratings
  add constraint round_ratings_memo_length_check check (memo is null or char_length(memo) <= 200);

-- Adding memo_value as a new trailing parameter registers a second overload
-- rather than replacing the old one (same pitfall hit earlier with
-- create_event_pause_request) - drop the old 4-arg signature explicitly.
drop function if exists public.submit_round_rating(text, text, integer, numeric);

create or replace function public.submit_round_rating(
  session_token text,
  event_id_value text,
  round_number_value integer,
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
  assignment public.event_table_assignments%rowtype;
  ratee_id uuid;
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
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  -- Editable only for the round currently in progress - once the event
  -- advances past it (current_round moves on), the rating is locked from
  -- further participant-side edits.
  select * into target_progress from public.event_progress where event_id = event_id_value;
  if target_progress.current_round is distinct from round_number_value then
    raise exception '이미 다음 라운드로 진행되어 이 평가는 더 이상 수정할 수 없습니다.';
  end if;

  select * into assignment
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.round_number = round_number_value
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if not found then
    raise exception '해당 라운드의 매칭 정보를 찾을 수 없습니다.';
  end if;

  ratee_id := case when assignment.male_application_id = target_application.id then assignment.female_application_id else assignment.male_application_id end;

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo)
  values (event_id_value, round_number_value, target_application.id, ratee_id, score_value, clean_memo)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, updated_at = now();
end;
$$;

grant execute on function public.submit_round_rating(text, text, integer, numeric, text) to anon, authenticated;

-- Refresh/re-entry recovery: the participant's own existing rating (if any)
-- for a round, so the screen can prefill instead of showing a blank form.
create or replace function public.get_my_round_rating(session_token text, event_id_value text, round_number_value integer)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
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
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select * into existing
  from public.round_ratings rr
  where rr.event_id = event_id_value and rr.round_number = round_number_value and rr.rater_application_id = target_application.id;

  return jsonb_build_object('ok', true, 'score', existing.score, 'memo', existing.memo);
end;
$$;

grant execute on function public.get_my_round_rating(text, text, integer) to anon, authenticated;

-- get_round_progress_for_participant gains partner application id/age/job
-- so the rating screen can show "김서준 / 28세 / 서비스 기획자" and request
-- that partner's real (unmosaicked) photo via the new
-- participant-partner-photo Edge Function.
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
    'partnerJob', assignment.partner_job
  );
end;
$$;

grant execute on function public.get_round_progress_for_participant(text, text) to anon, authenticated;

-- Admin ratings list gains memo (it's already framed to participants as
-- "본인 기록 및 운영 관리 목적" - operators are the other legitimate viewer).
drop function if exists public.get_admin_participant_ratings(text, text, uuid);

create or replace function public.get_admin_participant_ratings(session_token text, event_id_value text, application_id_value uuid)
returns table (round_number integer, partner_application_id uuid, partner_nickname text, score numeric, memo text)
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
  select rr.round_number, rr.ratee_application_id, a.nickname, rr.score, rr.memo
  from public.round_ratings rr
  join public.applications a on a.id = rr.ratee_application_id
  where rr.event_id = event_id_value and rr.rater_application_id = application_id_value
  order by rr.round_number asc;
end;
$$;

grant execute on function public.get_admin_participant_ratings(text, text, uuid) to anon, authenticated;
