-- 운영자 홈 대시보드의 "다가오는 행사" 카드(AdminPage.tsx)는
-- get_admin_event_summaries가 내려주는 events 목록을 순수 날짜 범위로만
-- 걸러서 보여주고 있었다 - events.ended_at(운영자가 "행사 종료"를 눌러
-- 세팅하는, 실제 종료를 의미하는 유일한 컬럼)을 아예 조회하지 않았기
-- 때문에, 당일 행사를 종료 처리해도 그날 안에는 계속 노출되는 문제가
-- 있었다. 같은 문제가 행사모드 목록(get_admin_event_mode_summaries)에는
-- 이미 202608241200 마이그레이션에서 고쳐져 있었지만 이 함수는 빠져있었다.
--
-- 이 함수는 AdminEventManagementPage(행사 관리 전체 목록)와
-- AdminEventParticipantsPage(개별 행사 조회, 종료된 행사도 계속 열람 가능
-- 해야 함) 등 여러 화면이 공유하므로, 여기서 ended_at을 필터링하지 않고
-- 컬럼으로만 추가한다 - 실제 "다가오는 행사에서 제외" 판단은 그 값을
-- 받는 AdminPage.tsx 쪽에서 한다. 반환 컬럼이 늘어나므로 drop 후 재생성.
drop function if exists public.get_admin_event_summaries(text);

create or replace function public.get_admin_event_summaries(session_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  ended_at timestamptz
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
    count(a.id) filter (where a.status = '참가 확정')::integer as current_participants,
    (e.male_capacity + e.female_capacity)::integer as target_participants,
    count(a.id) filter (where a.gender = '남성')::integer as male_applications,
    count(a.id) filter (where a.gender = '여성')::integer as female_applications,
    count(a.id) filter (where a.gender = '남성' and a.status = '참가 확정')::integer as male_confirmed,
    count(a.id) filter (where a.gender = '여성' and a.status = '참가 확정')::integer as female_confirmed,
    e.application_deadline, e.male_capacity, e.female_capacity,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event,
    e.ended_at
  from public.events e
  left join public.applications a on a.event_id = e.id
  group by e.id;
end;
$$;

grant execute on function public.get_admin_event_summaries(text) to anon, authenticated;
