-- 실제 사고: get_test_event_preview()에 is_test_event 컬럼이 다시
-- 빠져있었다. 이 문제는 원래 202609220000_test_event_preview_expose_
-- is_test_event.sql에서 이미 한 번 고쳤던 것인데, 그 뒤에 나온
-- 202609300000(할인정보 추가)와 202609300100(is_recruiting 추가)에서
-- 이 함수를 drop+재생성하면서 그보다 더 오래된 버전을 베이스로 삼는
-- 바람에 실수로 그 컬럼을 다시 빠뜨렸다.
--
-- 이 컬럼이 없으면 프론트(mapPublicEventSummaryRow)가
-- `event.is_test_event ?? false`로 매핑해 미리보기로 불러온 테스트
-- 행사도 항상 isTestEvent=false로 취급된다. 그러면 EventDetailPage의
-- "테스트 행사면 previewToken을 캐시해둔다" effect(`event?.isTestEvent
-- && previewToken`)가 절대 참이 안 돼 localStorage에 토큰이 저장되지
-- 않고, 그 다음 화면(EventInfoPage, ProfileFormPage - 둘 다 URL은 안
-- 보고 캐시만 읽음)에서 이 행사를 "찾을 수 없는 행사"로 취급한다 -
-- 실제로 "9월 26일 테스트행사" 참가자 화면 테스트가 막혔던 원인.
--
-- 이번엔 재발 방지를 위해 202609220000의 select 목록을 그대로 두고
-- discount_note/is_recruiting"만" 그 뒤에 덧붙이는 방식으로 고친다.
drop function if exists public.get_test_event_preview(text, text);

create function public.get_test_event_preview(event_id_value text, preview_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  nickname_instruction text, discount_note text, is_recruiting boolean
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
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female, e.is_test_event,
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
