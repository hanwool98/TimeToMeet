-- get_test_event_preview()가 반환하는 행에 is_test_event 컬럼이 아예
-- 빠져있었다. 프론트(mapPublicEventSummaryRow)는 `event.is_test_event ??
-- false`로 매핑하므로, 이 컬럼이 없으면 미리보기로 불러온 테스트 행사도
-- 항상 isTestEvent=false로 취급된다.
--
-- 그 결과 EventDetailPage의 "테스트 행사면 previewToken을 캐시해둔다"
-- effect(`event?.isTestEvent && previewToken`)가 절대 참이 되지 않아서
-- localStorage에 previewToken이 저장되지 않았고, 그 다음 화면들
-- (EventInfoPage, ProfileFormPage 등은 URL을 안 보고 캐시만 읽음)에서는
-- previewToken이 없는 채로 조회되어 이 행사가 아예 "찾을 수 없는 행사"로
-- 보였다 - 지난 날짜 테스트 행사를 만들어 참가자 화면(프로필 작성)까지
-- 테스트하려 할 때 막히던 진짜 원인.
--
-- is_test_event_preview_token_valid()가 이미 e.is_test_event = true인
-- 행사만 통과시키므로 이 함수가 정상적으로 행을 반환한 시점엔 값이 항상
-- true지만, 실제 컬럼 값을 그대로 select해서(get_public_event_summaries와
-- 동일 패턴) 계약을 명확히 한다. 파라미터 시그니처는 그대로이므로 기존
-- 호출부(fetchTestEventPreview)는 수정할 필요 없음.
drop function if exists public.get_test_event_preview(text, text);

create function public.get_test_event_preview(event_id_value text, preview_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  nickname_instruction text
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
    e.is_test_event, e.nickname_instruction
  from public.events e
  left join public.applications a on a.event_id = e.id
  where e.id = event_id_value
  group by e.id;
end;
$$;

grant execute on function public.get_test_event_preview(text, text) to anon, authenticated;
