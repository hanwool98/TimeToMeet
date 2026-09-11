-- 행사소개 페이지(참가자 /event-info)에 연결된 실제 행사가 없을 때 쓰는
-- "기본 행사 정보" - 관리자 "행사소개 관리"에서 직접 설정하는 fallback
-- 값이다. 특정 행사에 연결된 상태(/events/:eventId/info)에서는 항상 그
-- 행사의 실제 데이터가 우선이며, 이 값들은 그 경우엔 전혀 쓰이지 않는다.
-- 싱글턴 테이블(id는 항상 1) - 행사별 데이터가 아니라 앱 전체에서 공유하는
-- 값 하나뿐이라 event_id 같은 키가 필요 없다.
create table public.intro_default_info (
  id integer primary key default 1 check (id = 1),
  title text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  male_price integer,
  female_price integer,
  male_capacity integer,
  female_capacity integer,
  updated_at timestamptz not null default now()
);

insert into public.intro_default_info (id) values (1);

alter table public.intro_default_info enable row level security;

create policy "intro_default_info no direct access" on public.intro_default_info for all using (false);

create trigger intro_default_info_touch_updated_at
before update on public.intro_default_info
for each row execute function public.touch_updated_at();

create or replace function public.update_intro_default_info_for_session(
  session_token text,
  title_value text,
  event_date_value date,
  start_time_value time,
  end_time_value time,
  location_value text,
  male_price_value integer,
  female_price_value integer,
  male_capacity_value integer,
  female_capacity_value integer
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
      event_date = event_date_value,
      start_time = start_time_value,
      end_time = end_time_value,
      location = nullif(trim(coalesce(location_value, '')), ''),
      male_price = male_price_value,
      female_price = female_price_value,
      male_capacity = male_capacity_value,
      female_capacity = female_capacity_value
  where id = 1;

  if not found then
    insert into public.intro_default_info (
      id, title, event_date, start_time, end_time, location,
      male_price, female_price, male_capacity, female_capacity
    ) values (
      1,
      nullif(trim(coalesce(title_value, '')), ''),
      event_date_value, start_time_value, end_time_value,
      nullif(trim(coalesce(location_value, '')), ''),
      male_price_value, female_price_value, male_capacity_value, female_capacity_value
    );
  end if;
end;
$$;

grant execute on function public.update_intro_default_info_for_session(
  text, text, date, time, time, text, integer, integer, integer, integer
) to anon, authenticated;
