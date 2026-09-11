-- 기본 행사 정보의 "날짜"는 특정 하루가 아니라 "매주 일요일"처럼 반복되는
-- 일정을 설명하는 문구인 경우가 많다. date 타입으로 입력받으면 관리자가
-- 특정 하루만 고를 수 있어 요청과 맞지 않으므로 자유 텍스트로 바꾼다.
-- 참가비 아래에 표시할 할인/얼리버드 안내도 관리자가 자유 텍스트로 직접
-- 작성할 수 있게 추가한다(실제 행사의 구조화된 얼리버드 로직과는 별개 -
-- 기본값 화면에서는 그냥 안내 문구 한 줄).
alter table public.intro_default_info add column date_label text;
update public.intro_default_info set date_label = to_char(event_date, 'YYYY-MM-DD') where event_date is not null;
alter table public.intro_default_info drop column event_date;
alter table public.intro_default_info add column discount_note text;
-- 기본 행사소개(연결된 실제 행사가 없을 때)의 대표 이미지. 실제 행사의
-- cover_image_path와 완전히 별개의 값으로, upload-event-cover와 동일한
-- "고정 경로 하나에 업로드/교체" 패턴을 그대로 따른다.
alter table public.intro_default_info add column default_cover_path text;

drop function if exists public.update_intro_default_info_for_session(text, text, date, time, time, text, integer, integer, integer, integer);

create or replace function public.update_intro_default_info_for_session(
  session_token text,
  title_value text,
  date_label_value text,
  start_time_value time,
  end_time_value time,
  location_value text,
  male_price_value integer,
  female_price_value integer,
  male_capacity_value integer,
  female_capacity_value integer,
  discount_note_value text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  update public.intro_default_info
  set title = nullif(trim(coalesce(title_value, '')), ''),
      date_label = nullif(trim(coalesce(date_label_value, '')), ''),
      start_time = start_time_value,
      end_time = end_time_value,
      location = nullif(trim(coalesce(location_value, '')), ''),
      male_price = male_price_value,
      female_price = female_price_value,
      male_capacity = male_capacity_value,
      female_capacity = female_capacity_value,
      discount_note = nullif(trim(coalesce(discount_note_value, '')), '')
  where id = 1;

  if not found then
    insert into public.intro_default_info (
      id, title, date_label, start_time, end_time, location,
      male_price, female_price, male_capacity, female_capacity, discount_note
    ) values (
      1,
      nullif(trim(coalesce(title_value, '')), ''),
      nullif(trim(coalesce(date_label_value, '')), ''),
      start_time_value, end_time_value,
      nullif(trim(coalesce(location_value, '')), ''),
      male_price_value, female_price_value, male_capacity_value, female_capacity_value,
      nullif(trim(coalesce(discount_note_value, '')), '')
    );
  end if;
end;
$$;

grant execute on function public.update_intro_default_info_for_session(
  text, text, text, time, time, text, integer, integer, integer, integer, text
) to anon, authenticated;
