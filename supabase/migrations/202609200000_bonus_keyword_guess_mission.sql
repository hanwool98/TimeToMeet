-- "나를 맞혀봐" - 추가라운드 전용 아이스브레이킹. 일반 라운드에는 절대
-- 노출되지 않고, 추가라운드가 시작될 때마다(상대가 바뀔 때마다) 새로
-- 진행된다. 정답 키워드(상대가 실제로 고른 키워드)는 event_profile_cards
-- 에 이미 있으므로 새로 저장하지 않고, "누가 어떤 키워드를 추측했는지"만
-- 이 미션 전용 테이블에 append-only로 쌓는다 - 정답 판정은 매번 서버가
-- event_profile_cards와 대조해서 계산하므로(19번 요청: 정답을 미리
-- 클라이언트에 내려주지 않음) 이 테이블 자체에는 정답 여부를 저장하지
-- 않는다.

-- (1) 프로필 카드 특징 키워드 최소 3개 - 최종 제출(submit_value=true) 시에만
-- 강제한다(초안 저장 개념은 현재 프론트에 없지만 혹시 생기더라도 막지
-- 않기 위해 조건을 submit_value로 한정).
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
  submit_value boolean default false,
  drinking_frequency_value text default null,
  drinking_amount_value text default null,
  date_destination_value text default ''
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
  composed_drinking text;
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
    and a.checked_in_at is not null
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

  if submit_value and coalesce(array_length(keywords_value, 1), 0) < 3 then
    raise exception '특징 키워드를 최소 3개 이상 선택해주세요.';
  end if;

  composed_drinking := case
    when coalesce(drinking_frequency_value, '') <> '' and coalesce(drinking_amount_value, '') <> ''
      then drinking_frequency_value || ' / 주량 ' || drinking_amount_value
    when coalesce(drinking_frequency_value, '') <> '' then drinking_frequency_value
    when coalesce(drinking_amount_value, '') <> '' then '주량 ' || drinking_amount_value
    else coalesce(drinking_value, '')
  end;

  insert into public.event_profile_cards (
    event_id, application_id, photo_path, photo_crop, hobby, mbti, ideal_type,
    contact_style, date_style, smoking, drinking, drinking_frequency, drinking_amount,
    keywords, date_destination, submitted_at, updated_at
  )
  values (
    event_id_value, target_application.id, photo_path_value, photo_crop_value,
    coalesce(hobby_value, ''), coalesce(mbti_value, ''), coalesce(ideal_type_value, ''),
    coalesce(contact_style_value, ''), coalesce(date_style_value, ''),
    coalesce(smoking_value, ''), composed_drinking,
    coalesce(drinking_frequency_value, ''), coalesce(drinking_amount_value, ''),
    coalesce(keywords_value, '{}'), coalesce(date_destination_value, ''),
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
    drinking_frequency = excluded.drinking_frequency,
    drinking_amount = excluded.drinking_amount,
    keywords = excluded.keywords,
    date_destination = excluded.date_destination,
    submitted_at = case when submit_value then now() else public.event_profile_cards.submitted_at end,
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at);
end;
$$;

-- (2) 태블릿 미션카드 중복 방지 플래그 - (event, 추가라운드, 테이블) 단위로
-- 이미 있는 event_table_assignments 행에 얹는다(round_table_unique 제약이
-- 이미 이 조합의 유일성을 보장).
alter table public.event_table_assignments add column if not exists bonus_mission_shown_at timestamptz;

-- (3) 참가자별 추측 진행 상태 - event/추가라운드/participant/opponent 단위로
-- 분리 저장(요청 12). 정답 키워드 자체는 저장하지 않고(= event_profile_cards
-- 를 매번 대조), "무엇을 추측했는지"만 순서대로 append한다.
create table if not exists public.bonus_keyword_missions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  round_number integer not null,
  participant_application_id uuid not null references public.applications(id) on delete cascade,
  opponent_application_id uuid not null references public.applications(id) on delete cascade,
  guessed_keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, round_number, participant_application_id)
);

create index if not exists bonus_keyword_missions_event_round_idx
  on public.bonus_keyword_missions (event_id, round_number);

alter table public.bonus_keyword_missions enable row level security;
drop policy if exists "No direct bonus keyword mission access" on public.bonus_keyword_missions;
create policy "No direct bonus keyword mission access"
on public.bonus_keyword_missions
for all
using (false)
with check (false);

-- 참가자 본인의 현재 추가라운드 상대 + 미션 상태를 반환한다. 완료 전에는
-- 실제 정답 목록(revealKeywords)을 절대 내려주지 않고, 이미 제출된 개별
-- guess들의 정답 여부만 매번 event_profile_cards와 대조해서 계산한다.
create or replace function public.get_bonus_keyword_mission_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  opponent_id uuid;
  opponent_keywords text[];
  target_count integer;
  mission public.bonus_keyword_missions%rowtype;
  guesses jsonb;
  is_completed boolean;
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

  if not found or coalesce(target_progress.is_bonus_round, false) is not true then
    return jsonb_build_object('ok', true, 'active', false);
  end if;

  select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
  into opponent_id
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.is_bonus = true
    and eta.round_number = coalesce(target_progress.current_round, -1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if opponent_id is null then
    return jsonb_build_object('ok', true, 'active', false);
  end if;

  select coalesce(array_agg(k), '{}')
  into opponent_keywords
  from public.event_profile_cards epc, unnest(epc.keywords) as k
  where epc.event_id = event_id_value and epc.application_id = opponent_id and k not like '#%';

  target_count := coalesce(array_length(opponent_keywords, 1), 0);
  if target_count = 0 then
    return jsonb_build_object('ok', true, 'active', false);
  end if;

  select * into mission
  from public.bonus_keyword_missions
  where event_id = event_id_value and round_number = target_progress.current_round
    and participant_application_id = target_application.id;

  if not found then
    return jsonb_build_object('ok', true, 'active', true, 'targetCount', target_count, 'guesses', '[]'::jsonb, 'completed', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('keyword', g, 'correct', g = any(opponent_keywords)) order by ord), '[]'::jsonb)
  into guesses
  from unnest(mission.guessed_keywords) with ordinality as t(g, ord);

  is_completed := coalesce(array_length(mission.guessed_keywords, 1), 0) >= target_count;

  return jsonb_build_object(
    'ok', true,
    'active', true,
    'targetCount', target_count,
    'guesses', guesses,
    'completed', is_completed,
    'revealKeywords', case when is_completed then to_jsonb(opponent_keywords) else null end
  );
end;
$$;

grant execute on function public.get_bonus_keyword_mission_for_session(text, text) to anon, authenticated;

-- 키워드 하나를 확정 추측한다(취소/변경 불가 - append만 가능). 이미
-- 완료됐거나, 이미 같은 키워드를 골랐거나, 추가라운드가 아니면 거부한다.
create or replace function public.submit_bonus_keyword_guess_for_session(
  session_token text,
  event_id_value text,
  keyword_value text
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
  opponent_id uuid;
  opponent_keywords text[];
  target_count integer;
  clean_keyword text;
  current_guesses text[];
  is_correct boolean;
  guesses jsonb;
  is_completed boolean;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  clean_keyword := trim(coalesce(keyword_value, ''));
  if clean_keyword = '' or char_length(clean_keyword) > 50 then
    raise exception '유효하지 않은 키워드입니다.';
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

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if not found or coalesce(target_progress.is_bonus_round, false) is not true then
    raise exception '지금은 추가라운드가 아닙니다.';
  end if;

  select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
  into opponent_id
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.is_bonus = true
    and eta.round_number = coalesce(target_progress.current_round, -1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if opponent_id is null then
    raise exception '이번 추가라운드에는 진행할 상대가 없습니다.';
  end if;

  select coalesce(array_agg(k), '{}')
  into opponent_keywords
  from public.event_profile_cards epc, unnest(epc.keywords) as k
  where epc.event_id = event_id_value and epc.application_id = opponent_id and k not like '#%';

  target_count := coalesce(array_length(opponent_keywords, 1), 0);
  if target_count = 0 then
    raise exception '이번 라운드는 맞혀봐 미션 대상이 아닙니다.';
  end if;

  insert into public.bonus_keyword_missions (event_id, round_number, participant_application_id, opponent_application_id)
  values (event_id_value, target_progress.current_round, target_application.id, opponent_id)
  on conflict (event_id, round_number, participant_application_id) do nothing;

  select guessed_keywords into current_guesses
  from public.bonus_keyword_missions
  where event_id = event_id_value and round_number = target_progress.current_round
    and participant_application_id = target_application.id
  for update;

  if coalesce(array_length(current_guesses, 1), 0) >= target_count then
    raise exception '이미 모든 선택을 마쳤습니다.';
  end if;

  if clean_keyword = any(coalesce(current_guesses, '{}')) then
    raise exception '이미 선택한 키워드입니다.';
  end if;

  is_correct := clean_keyword = any(opponent_keywords);

  update public.bonus_keyword_missions
  set guessed_keywords = array_append(coalesce(current_guesses, '{}'), clean_keyword), updated_at = now()
  where event_id = event_id_value and round_number = target_progress.current_round
    and participant_application_id = target_application.id
  returning guessed_keywords into current_guesses;

  is_completed := array_length(current_guesses, 1) >= target_count;

  select coalesce(jsonb_agg(jsonb_build_object('keyword', g, 'correct', g = any(opponent_keywords)) order by ord), '[]'::jsonb)
  into guesses
  from unnest(current_guesses) with ordinality as t(g, ord);

  return jsonb_build_object(
    'ok', true,
    'correct', is_correct,
    'targetCount', target_count,
    'guesses', guesses,
    'completed', is_completed,
    'revealKeywords', case when is_completed then to_jsonb(opponent_keywords) else null end
  );
end;
$$;

grant execute on function public.submit_bonus_keyword_guess_for_session(text, text, text) to anon, authenticated;

-- (4) 태블릿 미션카드 - 라운드 진행 응답에 "이번 추가라운드에서 이미
-- 카드가 노출됐는지"를 얹는다(시그니처는 그대로라 create or replace로 충분).
create or replace function public.get_round_progress_for_tablet(event_id_value text, table_number_value integer, connection_token text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  tablet public.event_tablets%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
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
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );

  select ma.nickname as male_nickname, fa.nickname as female_nickname, eta.bonus_mission_shown_at is not null as bonus_mission_shown
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
    'isResting', target_progress.stage = 'round_active' and (match_row.male_nickname is null or match_row.female_nickname is null),
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusMissionShown', coalesce(match_row.bonus_mission_shown, false),
    'bonusRoundIndex', case
      when target_progress.round_phase = 'reveal' then 1
      when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds
      else null
    end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'serverNow', now()
  );
end;
$function$;

-- 태블릿이 미션카드를 실제로 띄운 시점에 딱 1번만 호출 - 이후 같은
-- 추가라운드에서는 다시 호출되지 않으므로(프론트가 bonusMissionShown이
-- true가 되는 순간부터 카드를 다시 열지 않음) coalesce로 멱등하게 둔다.
create or replace function public.mark_bonus_mission_shown_for_tablet(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  tablet public.event_tablets%rowtype;
  target_progress public.event_progress%rowtype;
begin
  select et.* into tablet
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    raise exception 'Tablet session required.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if not found or coalesce(target_progress.is_bonus_round, false) is not true then
    return;
  end if;

  update public.event_table_assignments
  set bonus_mission_shown_at = coalesce(bonus_mission_shown_at, now())
  where event_id = event_id_value
    and table_number = table_number_value
    and round_number = target_progress.current_round
    and is_bonus = true;
end;
$$;

grant execute on function public.mark_bonus_mission_shown_for_tablet(text, integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
