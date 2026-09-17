-- 참가자 리스트는 이미 "행사 시작 3일 전" 게이트(event_participant_list_
-- public_at / get_public_participant_previews)가 서버에 있었지만, 같은
-- 3일 게이트가 "참가자 수" 쪽에는 전혀 없었다 - 일반 공개 RPC
-- (get_public_event_summaries)가 현재 확정 인원/성별 인원/신청자 수를
-- 항상 그대로 내려주고 있어서, 캘린더 등 프론트가 숫자를 안 보여주기로
-- 해도 개발자도구로 API 응답을 직접 보면 그대로 노출돼 있었다.
--
-- 이번 수정: get_public_event_summaries에서 실제 참가 인원 관련 4개 컬럼
-- (current_participants, male_confirmed, female_confirmed, male_applications,
-- female_applications)을 이미 있는 event_participant_list_public_at(...)
-- 기준으로 공개 전에는 0으로 가린다. 정원(target_participants/male_capacity/
-- female_capacity)은 행사 자체의 규격 정보라 그대로 공개한다.
--
-- 문제는 여기서 currentParticipants를 그냥 0으로 가리면, 프론트가 지금까지
-- "모집중/마감" 상태를 current_participants < target_participants로
-- 직접 계산해 왔기 때문에 공개 전 행사가 실제로는 마감이어도 무조건
-- "모집중"으로 잘못 보이게 된다. 그래서 실제(가려지지 않은) 인원으로
-- 계산한 is_recruiting을 별도 컬럼으로 항상 정확하게 내려준다 - "모집
-- 가능 여부"와 "실제 인원 숫자"를 분리하는 것이 이번 정책의 핵심이다.
--
-- get_admin_event_summaries(관리자, 모든 행사 항상 실제 값)와
-- get_test_event_preview(유효한 미리보기 토큰이 있어야만 호출 가능 -
-- 접근 자체가 이미 "미리보기 허용됨"을 의미하므로 게이트 불필요)는
-- 인원 컬럼을 가리지 않는다. 다만 세 함수 모두 프론트에서 같은 타입
-- (PublicEventSummaryRow)과 매퍼(mapPublicEventSummaryRow)를 공유하므로,
-- is_recruiting 컬럼은 셋 다 동일하게 추가해 셰이프를 맞춘다.

-- (1) 참가자 공개 목록 - 인원 4개 컬럼 게이트 + is_recruiting 추가.
drop function if exists public.get_public_event_summaries();

create function public.get_public_event_summaries()
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  nickname_instruction text, discount_note text, is_recruiting boolean
)
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_booked,
    e.male_price, e.female_price,
    case when now() >= public.event_participant_list_public_at(e.id)
      then count(a.id) filter (where a.status = '참가 확정')::integer
      else 0
    end,
    (e.male_capacity + e.female_capacity)::integer,
    case when now() >= public.event_participant_list_public_at(e.id)
      then count(a.id) filter (where a.gender = '남성')::integer
      else 0
    end,
    case when now() >= public.event_participant_list_public_at(e.id)
      then count(a.id) filter (where a.gender = '여성')::integer
      else 0
    end,
    case when now() >= public.event_participant_list_public_at(e.id)
      then count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer
      else 0
    end,
    case when now() >= public.event_participant_list_public_at(e.id)
      then count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer
      else 0
    end,
    e.application_deadline, e.male_capacity, e.female_capacity,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female,
    e.is_test_event, e.nickname_instruction, e.discount_note,
    count(a.id) filter (where a.status = '참가 확정') < (e.male_capacity + e.female_capacity)
  from public.events e
  left join public.applications a on a.event_id = e.id
  where coalesce(e.is_test_event, false) = false
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

-- (2) 관리자 목록 - 게이트 없이 실제 값 그대로, is_recruiting만 추가해
-- 프론트 공유 타입 셰이프를 맞춘다.
drop function if exists public.get_admin_event_summaries(text);

create function public.get_admin_event_summaries(session_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  ended_at timestamptz, is_locked boolean, nickname_instruction text, is_recruiting boolean
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
  select
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_booked,
    e.male_price, e.female_price,
    count(a.id) filter (where a.status = '참가 확정')::integer,
    (e.male_capacity + e.female_capacity)::integer,
    count(a.id) filter (where a.gender = '남성')::integer,
    count(a.id) filter (where a.gender = '여성')::integer,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer,
    e.application_deadline, e.male_capacity, e.female_capacity,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female,
    e.is_test_event, e.ended_at, e.is_locked, e.nickname_instruction,
    count(a.id) filter (where a.status = '참가 확정') < (e.male_capacity + e.female_capacity)
  from public.events e
  left join public.applications a on a.event_id = e.id
  group by e.id;
end;
$$;

grant execute on function public.get_admin_event_summaries(text) to anon, authenticated;

-- (3) 테스트 행사 미리보기 - 유효한 토큰으로만 호출 가능(이미 게이트),
-- is_recruiting만 추가.
drop function if exists public.get_test_event_preview(text, text);

create function public.get_test_event_preview(event_id_value text, preview_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, nickname_instruction text,
  discount_note text, is_recruiting boolean
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_test_event_preview_token_valid(event_id_value, preview_token) then
    return;
  end if;

  return query
  select
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_booked,
    e.male_price, e.female_price,
    count(a.id) filter (where a.status = '참가 확정')::integer,
    (e.male_capacity + e.female_capacity)::integer,
    count(a.id) filter (where a.gender = '남성')::integer,
    count(a.id) filter (where a.gender = '여성')::integer,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer,
    e.application_deadline, e.male_capacity, e.female_capacity,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female,
    e.nickname_instruction, e.discount_note,
    count(a.id) filter (where a.status = '참가 확정') < (e.male_capacity + e.female_capacity)
  from public.events e
  left join public.applications a on a.event_id = e.id
  where e.id = event_id_value
  group by e.id;
end;
$$;

grant execute on function public.get_test_event_preview(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
