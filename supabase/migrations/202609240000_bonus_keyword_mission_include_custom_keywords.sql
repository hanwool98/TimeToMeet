-- "나를 맞혀봐"에서 프로필 소유자가 "+ 직접 입력"으로 추가한 custom
-- keyword(정규화된 형태: "#"로 시작하는 자유 문구, ProfileKeywordPicker.tsx
-- 참고)가 정답 후보에서 통째로 빠져 있었다.
--
-- 원인: opponent_keywords(정답 판정 기준이 되는 상대의 실제 키워드 배열)를
-- 계산할 때 `k not like '#%'` 조건으로 "#"로 시작하는 값을 전부 걸러내고
-- 있었다. 고정 카탈로그 키워드는 key가 "lively"/"humorous"처럼 해시 없는
-- 내부 식별자라 이 필터에 안 걸리지만, custom keyword는 저장 형태 자체가
-- "#야구덕후"라서 이 필터에 걸려 target_count/정답 판정/추측 옵션 어디에도
-- 반영되지 않았다.
--
-- 수정:
--   1) opponent_keywords 계산에서 "#%" 필터를 제거 - custom keyword도
--      target_count에 포함되고 정답 판정 대상이 된다(trim + 빈 문자열
--      제외 + 중복 제거는 유지/추가).
--   2) 응답에 customKeywordOptions(상대의 custom keyword 원문 목록)를
--      새로 추가한다 - 정답이 이미 완료됐는지와 무관하게 항상 내려준다.
--      기존 revealKeywords와 달리 "이 옵션이 정답이다"를 알려주는 게
--      아니라 "이 옵션도 추측 가능한 버튼으로 존재한다"만 알려주는
--      것이므로, 고정 카탈로그 30개를 처음부터 전부 보여주는 것과 같은
--      선상에서 안전하다(어떤 키워드가 실제 정답인지는 여전히 완료 전엔
--      노출하지 않음).
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
  custom_keyword_options text[];
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

  select coalesce(array_agg(distinct trim(k)) filter (where trim(k) <> ''), '{}')
  into opponent_keywords
  from public.event_profile_cards epc, unnest(epc.keywords) as k
  where epc.event_id = event_id_value and epc.application_id = opponent_id;

  select coalesce(array_agg(x order by x), '{}')
  into custom_keyword_options
  from unnest(opponent_keywords) as x
  where x like '#%';

  target_count := coalesce(array_length(opponent_keywords, 1), 0);
  if target_count = 0 then
    return jsonb_build_object('ok', true, 'active', false);
  end if;

  select * into mission
  from public.bonus_keyword_missions
  where event_id = event_id_value and round_number = target_progress.current_round
    and participant_application_id = target_application.id;

  if not found then
    return jsonb_build_object(
      'ok', true, 'active', true, 'targetCount', target_count, 'guesses', '[]'::jsonb,
      'completed', false, 'customKeywordOptions', to_jsonb(custom_keyword_options)
    );
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
    'revealKeywords', case when is_completed then to_jsonb(opponent_keywords) else null end,
    'customKeywordOptions', to_jsonb(custom_keyword_options)
  );
end;
$$;

grant execute on function public.get_bonus_keyword_mission_for_session(text, text) to anon, authenticated;

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
  custom_keyword_options text[];
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

  select coalesce(array_agg(distinct trim(k)) filter (where trim(k) <> ''), '{}')
  into opponent_keywords
  from public.event_profile_cards epc, unnest(epc.keywords) as k
  where epc.event_id = event_id_value and epc.application_id = opponent_id;

  select coalesce(array_agg(x order by x), '{}')
  into custom_keyword_options
  from unnest(opponent_keywords) as x
  where x like '#%';

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
    'revealKeywords', case when is_completed then to_jsonb(opponent_keywords) else null end,
    'customKeywordOptions', to_jsonb(custom_keyword_options)
  );
end;
$$;

grant execute on function public.submit_bonus_keyword_guess_for_session(text, text, text) to anon, authenticated;
