-- save_event_profile_card_for_session의 "체크인된 참가자만 프로필 카드를
-- 작성할 수 있습니다" 예외 메시지는 있었지만, 실제 조회 조건에는
-- checked_in_at 필터가 빠져 있어 체크인 전에도 카드 저장이 가능했다
-- (order by checked_in_at desc nulls last + limit 1이 null인 행도 그대로
-- 찾아버림). WHERE 절에 checked_in_at is not null을 추가해 이름 그대로
-- 동작하게 한다.
create or replace function public.save_event_profile_card_for_session(session_token text, event_id_value text, hobby_value text, mbti_value text, ideal_type_value text, contact_style_value text, date_style_value text, smoking_value text, drinking_value text, keywords_value text[], photo_path_value text default null::text, photo_crop_value jsonb default null::jsonb, submit_value boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
