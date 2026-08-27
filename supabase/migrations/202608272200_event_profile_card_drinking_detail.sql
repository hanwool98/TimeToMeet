-- 프로필카드 "흡연 및 주량"의 주량을 자유 입력 한 줄 대신 음주 빈도 +
-- 주량 두 개의 선택형 값으로 받는다. 기존 drinking(자유 입력 텍스트)
-- 컬럼은 그대로 두고(추가 전용 원칙, 과거 저장된 자유 입력 값 보존)
-- drinking_frequency/drinking_amount 두 컬럼을 새로 추가한다 - drinking은
-- 이제 "빈도 / 주량 N병" 형태로 서버가 합성해서 채워주는 legacy 호환용
-- 표시 컬럼이 된다(다른 곳에서 원시 drinking 컬럼을 그대로 읽어도 여전히
-- 사람이 읽을 수 있는 문자열이 들어있도록).
alter table public.event_profile_cards
  add column if not exists drinking_frequency text not null default '',
  add column if not exists drinking_amount text not null default '';

-- create or replace는 매개변수 목록이 같을 때만 진짜 "교체"가 된다 - 뒤에
-- 매개변수 2개를 추가하면 시그니처가 달라져서 기존 13개짜리 함수가
-- 남아있는 채로 새 15개짜리 오버로드가 하나 더 생겨버린다(모호한 호출
-- 위험). 기존 시그니처를 먼저 명시적으로 지워서 하나만 남긴다.
drop function if exists public.save_event_profile_card_for_session(
  text, text, text, text, text, text, text, text, text, text[], text, jsonb, boolean
);

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
  photo_path_value text default null::text,
  photo_crop_value jsonb default null::jsonb,
  submit_value boolean default false,
  drinking_frequency_value text default null,
  drinking_amount_value text default null
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
    keywords, submitted_at, updated_at
  )
  values (
    event_id_value, target_application.id, photo_path_value, photo_crop_value,
    coalesce(hobby_value, ''), coalesce(mbti_value, ''), coalesce(ideal_type_value, ''),
    coalesce(contact_style_value, ''), coalesce(date_style_value, ''),
    coalesce(smoking_value, ''), composed_drinking,
    coalesce(drinking_frequency_value, ''), coalesce(drinking_amount_value, ''),
    coalesce(keywords_value, '{}'),
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
    submitted_at = case when submit_value then now() else public.event_profile_cards.submitted_at end,
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at);
end;
$$;

grant execute on function public.save_event_profile_card_for_session(
  text, text, text, text, text, text, text, text, text, text[], text, jsonb, boolean, text, text
) to anon, authenticated;

-- 테스트 프로필카드 자동 제출도 새 필드를 채워야 실제 화면과 동일하게
-- "빈도 / 주량 N병" 형태가 보인다.
create or replace function public.simulate_test_event_profile_cards(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  rec record;
  simulated_count integer := 0;
  sample_hobbies text[] := array['독서', '영화감상', '요가', '등산', '카페투어', '헬스'];
  sample_mbtis text[] := array['ENFP', 'INTJ', 'ISFJ', 'ESTP', 'INFP', 'ESFJ'];
  sample_ideal_types text[] := array['유머있는 사람', '배려심 많은 사람', '대화가 잘 통하는 사람'];
  sample_contact_styles text[] := array['바쁘면 가끔, 연락은 자주', '용건 있을 때만'];
  sample_date_styles text[] := array['맛집 탐방', '영화 데이트', '드라이브'];
  sample_smokings text[] := array['비흡연', '흡연'];
  sample_drinking_frequencies text[] := array['안 마심', '월 1~2회', '주 1회', '주 2~3회'];
  sample_drinking_amounts text[] := array['거의 안 마심', '0.5병', '1병', '2병'];
  sample_keywords text[] := array['lively', 'likes_movies', 'likes_travel', 'calm', 'likes_food'];
  picked_frequency text;
  picked_amount text;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if target_event.id is null then
    raise exception '행사를 찾을 수 없습니다.';
  end if;
  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 사용할 수 있습니다.';
  end if;

  for rec in
    select a.id as application_id
    from public.applications a
    where a.event_id = event_id_value
      and a.status = '참가 확정'
      and a.checked_in_at is not null
      and a.attendance_status = 'active'
  loop
    picked_frequency := sample_drinking_frequencies[1 + (floor(random() * array_length(sample_drinking_frequencies, 1)))::integer];
    picked_amount := sample_drinking_amounts[1 + (floor(random() * array_length(sample_drinking_amounts, 1)))::integer];

    insert into public.event_profile_cards (
      event_id, application_id, hobby, mbti, ideal_type, contact_style, date_style,
      smoking, drinking, drinking_frequency, drinking_amount, keywords, submitted_at, updated_at
    )
    values (
      event_id_value, rec.application_id,
      sample_hobbies[1 + (floor(random() * array_length(sample_hobbies, 1)))::integer],
      sample_mbtis[1 + (floor(random() * array_length(sample_mbtis, 1)))::integer],
      sample_ideal_types[1 + (floor(random() * array_length(sample_ideal_types, 1)))::integer],
      sample_contact_styles[1 + (floor(random() * array_length(sample_contact_styles, 1)))::integer],
      sample_date_styles[1 + (floor(random() * array_length(sample_date_styles, 1)))::integer],
      sample_smokings[1 + (floor(random() * array_length(sample_smokings, 1)))::integer],
      picked_frequency || ' / 주량 ' || picked_amount,
      picked_frequency,
      picked_amount,
      sample_keywords,
      now(),
      now()
    )
    on conflict (event_id, application_id) do update set
      submitted_at = coalesce(public.event_profile_cards.submitted_at, now()),
      updated_at = now();

    simulated_count := simulated_count + 1;
  end loop;

  return simulated_count;
end;
$$;

notify pgrst, 'reload schema';
