-- 테스트 행사를 지난 날짜로 만들 때, "신청 마감은 행사 시작 전이어야
-- 한다" 검사도 함께 막힌다 - 신청 마감 기본값이 화면에서 행사 날짜를
-- 나중에 바꿔도 자동으로 따라가지 않아(기존 동작), 과거 날짜를 고르면
-- 마감 시각이 행사 시작보다 뒤에 남아 있는 채로 제출되기 때문이다.
-- 테스트 행사는 실제 모집 일정 정합성이 필요 없으므로 이 검사도 함께
-- 건너뛴다(과거 날짜 허용과 같은 취지). 나머지 검증/로직은 동일.
create or replace function public.upsert_event_for_admin_session(
  session_token text,
  event_id_value text,
  event_title text,
  event_short_name text,
  event_date_value date,
  event_start_time time,
  event_end_time time,
  event_location text,
  event_venue_detail text,
  event_application_deadline timestamptz,
  event_male_price integer,
  event_female_price integer,
  event_venue_booked boolean,
  male_capacity_value integer,
  female_capacity_value integer,
  event_early_bird_deadline timestamptz,
  event_early_bird_discount_male integer,
  event_early_bird_discount_female integer,
  event_is_test_event boolean,
  event_nickname_instruction text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  event_exists boolean;
  event_locked boolean;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if trim(coalesce(event_id_value, '')) = '' or trim(coalesce(event_title, '')) = '' then
    raise exception 'Event id and title are required.';
  end if;
  if event_end_time <= event_start_time then
    raise exception 'Event end time must be later than start time.';
  end if;
  if event_application_deadline is not null
     and not coalesce(event_is_test_event, false)
     and event_application_deadline >= ((event_date_value + event_start_time) at time zone 'Asia/Seoul') then
    raise exception 'Application deadline must be before the event starts.';
  end if;
  if male_capacity_value < 1 or female_capacity_value < 1 then
    raise exception 'Event capacity must be positive.';
  end if;
  if event_male_price < 0 or event_female_price < 0 then
    raise exception 'Event price cannot be negative.';
  end if;
  if coalesce(event_early_bird_discount_male, 0) < 0 or coalesce(event_early_bird_discount_female, 0) < 0 then
    raise exception 'Early-bird discount cannot be negative.';
  end if;

  select exists(select 1 from public.events where id = event_id_value) into event_exists;
  if event_exists then
    select is_locked into event_locked from public.events where id = event_id_value;
    if event_locked then
      raise exception '잠긴 행사는 수정할 수 없습니다.';
    end if;
  end if;
  if not event_exists and not coalesce(event_is_test_event, false)
     and event_date_value < ((now() at time zone 'Asia/Seoul')::date) then
    raise exception 'Event date cannot be in the past.';
  end if;

  insert into public.events (
    id, title, short_name, event_date, start_time, end_time, location, venue_detail,
    application_deadline, male_price, female_price, venue_booked, male_capacity, female_capacity,
    early_bird_deadline, early_bird_discount_male, early_bird_discount_female, is_test_event,
    nickname_instruction
  ) values (
    event_id_value, trim(event_title), trim(event_short_name), event_date_value, event_start_time, event_end_time,
    trim(event_location), trim(coalesce(event_venue_detail, '')), event_application_deadline,
    event_male_price, event_female_price, event_venue_booked, male_capacity_value, female_capacity_value,
    event_early_bird_deadline, coalesce(event_early_bird_discount_male, 0), coalesce(event_early_bird_discount_female, 0),
    coalesce(event_is_test_event, false), nullif(trim(coalesce(event_nickname_instruction, '')), '')
  )
  on conflict (id) do update set
    title = excluded.title,
    short_name = excluded.short_name,
    event_date = excluded.event_date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    location = excluded.location,
    venue_detail = excluded.venue_detail,
    application_deadline = excluded.application_deadline,
    male_price = excluded.male_price,
    female_price = excluded.female_price,
    venue_booked = excluded.venue_booked,
    male_capacity = excluded.male_capacity,
    female_capacity = excluded.female_capacity,
    early_bird_deadline = excluded.early_bird_deadline,
    early_bird_discount_male = excluded.early_bird_discount_male,
    early_bird_discount_female = excluded.early_bird_discount_female,
    is_test_event = excluded.is_test_event,
    nickname_instruction = excluded.nickname_instruction,
    updated_at = now();
end;
$$;
