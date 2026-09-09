-- 행사별 자유 닉네임 안내 + 관리자 승인 전 행사 닉네임 정리.
-- 기존 행사/application 데이터는 수정하지 않는 additive migration이다.
alter table public.events
  add column if not exists nickname_instruction text;

drop function if exists public.get_public_event_summaries();

create function public.get_public_event_summaries()
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  nickname_instruction text
)
language sql
stable
security definer
set search_path = 'public'
as $$
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
  where coalesce(e.is_test_event, false) = false
  group by e.id;
$$;

grant execute on function public.get_public_event_summaries() to anon, authenticated;

drop function if exists public.get_admin_event_summaries(text);

create function public.get_admin_event_summaries(session_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean,
  ended_at timestamptz, is_locked boolean, nickname_instruction text
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
    e.is_test_event, e.ended_at, e.is_locked, e.nickname_instruction
  from public.events e
  left join public.applications a on a.event_id = e.id
  group by e.id;
end;
$$;

grant execute on function public.get_admin_event_summaries(text) to anon, authenticated;

drop function if exists public.get_admin_event_for_session(text, text);

create function public.get_admin_event_for_session(session_token text, event_id_value text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time,
  location text, venue_detail text, application_deadline timestamptz, venue_booked boolean,
  male_capacity integer, female_capacity integer, male_price integer, female_price integer,
  early_bird_deadline timestamptz, early_bird_discount_male integer, early_bird_discount_female integer,
  is_test_event boolean, is_locked boolean, nickname_instruction text
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
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.end_time, e.location, e.venue_detail,
    e.application_deadline, e.venue_booked, e.male_capacity, e.female_capacity, e.male_price, e.female_price,
    e.early_bird_deadline, e.early_bird_discount_male, e.early_bird_discount_female,
    e.is_test_event, e.is_locked, e.nickname_instruction
  from public.events e
  where e.id = event_id_value
  limit 1;
end;
$$;

grant execute on function public.get_admin_event_for_session(text, text) to anon, authenticated;

drop function if exists public.get_test_event_preview(text, text);

create function public.get_test_event_preview(event_id_value text, preview_token text)
returns table (
  id text, title text, short_name text, event_date date, start_time time, end_time time, location text,
  venue_booked boolean, male_price integer, female_price integer, current_participants integer,
  target_participants integer, male_applications integer, female_applications integer,
  male_confirmed integer, female_confirmed integer, application_deadline timestamptz,
  male_capacity integer, female_capacity integer, early_bird_deadline timestamptz,
  early_bird_discount_male integer, early_bird_discount_female integer, nickname_instruction text
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
    e.nickname_instruction
  from public.events e
  left join public.applications a on a.event_id = e.id
  where e.id = event_id_value
  group by e.id;
end;
$$;

grant execute on function public.get_test_event_preview(text, text) to anon, authenticated;

drop function if exists public.upsert_event_for_admin_session(
  text, text, text, text, date, time, time, text, text, timestamptz,
  integer, integer, boolean, integer, integer, timestamptz, integer, integer, boolean
);

create function public.upsert_event_for_admin_session(
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
  if not event_exists and event_date_value < ((now() at time zone 'Asia/Seoul')::date) then
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

grant execute on function public.upsert_event_for_admin_session(
  text, text, text, text, date, time, time, text, text, timestamptz,
  integer, integer, boolean, integer, integer, timestamptz, integer, integer, boolean, text
) to anon, authenticated;

create or replace function public.update_application_nickname_for_session(
  session_token text,
  target_application_id uuid,
  nickname_value text,
  allow_duplicate boolean default false
)
returns table (nickname text, has_duplicate boolean, updated boolean)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event_id text;
  target_event_date date;
  target_start_time time;
  normalized_nickname text;
  duplicate_found boolean;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  normalized_nickname := trim(coalesce(nickname_value, ''));
  if normalized_nickname = '' then
    raise exception '닉네임을 입력해주세요.';
  end if;

  select a.event_id, e.event_date, e.start_time
  into target_event_id, target_event_date, target_start_time
  from public.applications a
  join public.events e on e.id = a.event_id
  where a.id = target_application_id
    and a.status in ('심사 대기', '참여 보류')
  for update of a;

  if not found then
    raise exception '수정할 수 있는 신청서를 찾지 못했습니다.';
  end if;
  if ((target_event_date + target_start_time) at time zone 'Asia/Seoul') <= now() then
    raise exception '행사가 시작된 이후에는 닉네임을 수정할 수 없습니다.';
  end if;

  select exists (
    select 1
    from public.applications a
    where a.event_id = target_event_id
      and a.id <> target_application_id
      and a.status in ('심사 대기', '참여 보류', '결제 대기', '결제중', '입금 확인 중', '참가 확정')
      and lower(trim(a.nickname)) = lower(normalized_nickname)
  ) into duplicate_found;

  if duplicate_found and not allow_duplicate then
    return query select normalized_nickname, true, false;
    return;
  end if;

  update public.applications
  set nickname = normalized_nickname, updated_at = now()
  where id = target_application_id;

  -- 비정상적으로 행사 전에 snapshot이 생성된 경우에만 stale 값을 맞춘다.
  -- 행사 시작 뒤의 역사 snapshot은 위 시간 검증 때문에 절대 바뀌지 않는다.
  update public.event_participant_snapshots
  set nickname = normalized_nickname
  where event_id = target_event_id
    and application_id = target_application_id;

  return query select normalized_nickname, duplicate_found, true;
end;
$$;

revoke all on function public.update_application_nickname_for_session(text, uuid, text, boolean) from public;
grant execute on function public.update_application_nickname_for_session(text, uuid, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
