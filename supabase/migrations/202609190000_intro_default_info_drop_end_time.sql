-- 기본 행사 정보의 종료 시간은 불필요하다는 요청 - 시작 시간만 남긴다.
drop function if exists public.update_intro_default_info_for_session(
  text, text, text, time, time, text, integer, integer, integer, integer, text
);

alter table public.intro_default_info drop column end_time;

create or replace function public.update_intro_default_info_for_session(
  session_token text,
  title_value text,
  date_label_value text,
  start_time_value time,
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
      location = nullif(trim(coalesce(location_value, '')), ''),
      male_price = male_price_value,
      female_price = female_price_value,
      male_capacity = male_capacity_value,
      female_capacity = female_capacity_value,
      discount_note = nullif(trim(coalesce(discount_note_value, '')), '')
  where id = 1;

  if not found then
    insert into public.intro_default_info (
      id, title, date_label, start_time, location,
      male_price, female_price, male_capacity, female_capacity, discount_note
    ) values (
      1,
      nullif(trim(coalesce(title_value, '')), ''),
      nullif(trim(coalesce(date_label_value, '')), ''),
      start_time_value,
      nullif(trim(coalesce(location_value, '')), ''),
      male_price_value, female_price_value, male_capacity_value, female_capacity_value,
      nullif(trim(coalesce(discount_note_value, '')), '')
    );
  end if;
end;
$$;

grant execute on function public.update_intro_default_info_for_session(
  text, text, text, time, text, integer, integer, integer, integer, text
) to anon, authenticated;
