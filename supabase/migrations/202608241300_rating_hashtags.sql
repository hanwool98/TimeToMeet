-- 호감도 작성/수정 화면에 상대방 특징 해시태그(고정 19개 + 직접입력 1개)
-- 저장 기능을 추가한다. round_ratings 한 행에 hashtags text[]로 함께
-- 저장하고(태그별 row 분리 없음), 정규 라운드 제출과 최종선택 후보 조회에
-- 반영한다. 추가시간 쪽(submit_bonus_round_rating/get_my_bonus_rating)의
-- hashtags 반영은 흐름 개편과 함께 다음 migration에서 처리한다(같은 함수를
-- 두 번 겹쳐 쓰지 않기 위함).
alter table public.round_ratings add column if not exists hashtags text[];

-- Internal helper (not granted to anon/authenticated) - trims blanks,
-- de-dupes, and bounds count/length so a submit RPC can't be abused to
-- store an unbounded amount of text per rating.
create or replace function public.normalize_rating_hashtags(hashtags_value text[])
returns text[]
language plpgsql
immutable
set search_path = 'public'
as $$
declare
  cleaned text[] := '{}';
  tag text;
begin
  if hashtags_value is null then
    return null;
  end if;

  foreach tag in array hashtags_value loop
    tag := trim(tag);
    if tag = '' then
      continue;
    end if;
    if char_length(tag) > 16 then
      raise exception '해시태그는 16자 이내여야 합니다.';
    end if;
    if not (tag = any(cleaned)) then
      cleaned := cleaned || tag;
    end if;
  end loop;

  if coalesce(array_length(cleaned, 1), 0) > 20 then
    raise exception '해시태그는 최대 20개까지 선택할 수 있습니다.';
  end if;

  return case when array_length(cleaned, 1) is null then null else cleaned end;
end;
$$;

-- New trailing param registers a second overload unless the old signature
-- is dropped first (same pitfall as the earlier memo_value addition).
drop function if exists public.submit_round_rating(text, text, integer, numeric, text);

create or replace function public.submit_round_rating(
  session_token text,
  event_id_value text,
  round_number_value integer,
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
  assignment public.event_table_assignments%rowtype;
  ratee_id uuid;
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

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo, hashtags)
  values (event_id_value, round_number_value, target_application.id, ratee_id, score_value, clean_memo, clean_hashtags)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, hashtags = excluded.hashtags, updated_at = now();
end;
$$;

grant execute on function public.submit_round_rating(text, text, integer, numeric, text, text[]) to anon, authenticated;

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

  return jsonb_build_object('ok', true, 'score', existing.score, 'memo', existing.memo, 'hashtags', existing.hashtags);
end;
$$;

grant execute on function public.get_my_round_rating(text, text, integer) to anon, authenticated;

-- 최종선택 후보 카드에 "내가 남긴 평가"를 참고 정보로 보여주기 위해
-- hashtags를 추가한다 - score/memo는 이미 붙어 있었다.
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
      and not eta.is_bonus
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
    'hashtags', hashtags,
    'rank', case when score is not null then rnk end
  ) order by score desc nulls last, partner_id), '[]'::jsonb)
  into candidates
  from scored;

  select coalesce(jsonb_agg(fs.selected_application_id), '[]'::jsonb)
  into selected_ids
  from public.final_selections fs
  where fs.event_id = event_id_value and fs.selector_application_id = target_application.id;

  return jsonb_build_object(
    'ok', true,
    'finalSelectionLimit', coalesce(target_event.final_selection_limit, 3),
    'submitted', target_application.final_selection_submitted_at is not null,
    'selectedApplicationIds', selected_ids,
    'candidates', candidates
  );
end;
$$;

grant execute on function public.get_final_selection_candidates(text, text) to anon, authenticated;
