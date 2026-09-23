-- 행사 소프트 삭제(72시간 유예) 도입.
--
-- 지금까지 admin-delete-event는 applications/events를 즉시 영구 삭제했다.
-- FK는 전부 정상(applications->events는 ON DELETE RESTRICT, 나머지는 전부
-- CASCADE)이라 DB 레벨 orphan은 실제로 없었지만(라이브로 확인: 0건), 실수로
-- 삭제한 행사를 되돌릴 방법이 없었고 참가자 화면도 "삭제됨"을 구분해서
-- 보여주지 못했다. 이제 삭제 요청은 즉시 삭제 대신 deleted_at/
-- scheduled_purge_at만 기록하고, 실제 영구 삭제는 72시간 뒤 별도 cron
-- Edge Function이 처리한다.

alter table public.events
  add column if not exists deleted_at timestamptz,
  add column if not exists scheduled_purge_at timestamptz,
  add column if not exists purge_claimed_at timestamptz;

comment on column public.events.deleted_at is '관리자가 삭제를 요청한 시각. null이 아니면 이 행사는 삭제 대기 상태.';
comment on column public.events.scheduled_purge_at is 'deleted_at + 72시간. 이 시각이 지나면 자동 영구 삭제 대상.';
comment on column public.events.purge_claimed_at is '영구 삭제 cron이 이 행사를 실제로 처리하기 시작한 시각. 이 값이 설정된 뒤에는 복구할 수 없다(진행 중인 삭제를 되돌리면 데이터 정합성이 깨지기 때문).';

-- ---------------------------------------------------------------------------
-- 1) 공개/일반 조회 RPC에서 삭제 대기 행사 제외
-- ---------------------------------------------------------------------------

create or replace function public.get_public_event_summaries()
 returns table(id text, title text, short_name text, event_date date, start_time time without time zone, end_time time without time zone, location text, venue_booked boolean, male_price integer, female_price integer, current_participants integer, target_participants integer, male_applications integer, female_applications integer, male_confirmed integer, female_confirmed integer, application_deadline timestamp with time zone, male_capacity integer, female_capacity integer, early_bird_deadline timestamp with time zone, early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean, nickname_instruction text, discount_note text, is_recruiting boolean)
 language sql
 stable security definer
 set search_path to 'public'
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
    and e.deleted_at is null
  group by e.id;
$$;

create or replace function public.get_test_event_preview(event_id_value text, preview_token text)
 returns table(id text, title text, short_name text, event_date date, start_time time without time zone, end_time time without time zone, location text, venue_booked boolean, male_price integer, female_price integer, current_participants integer, target_participants integer, male_applications integer, female_applications integer, male_confirmed integer, female_confirmed integer, application_deadline timestamp with time zone, male_capacity integer, female_capacity integer, early_bird_deadline timestamp with time zone, early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean, nickname_instruction text, discount_note text, is_recruiting boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
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
    and e.deleted_at is null
  group by e.id;
end;
$$;

create or replace function public.get_public_participant_previews(target_event_id text, preview_token text default null::text)
 returns table(id text, gender text, nickname text, age integer, job text, avatar_index integer)
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select
    a.id::text,
    a.gender,
    coalesce(nullif(a.nickname, '삭제된 프로필'), s.nickname, a.nickname) as nickname,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer as age,
    coalesce(nullif(a.job, ''), s.job, a.job) as job,
    (((row_number() over (partition by a.gender order by a.submitted_at asc, a.id asc)) - 1) % 6 + 1)::integer as avatar_index
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.event_participant_snapshots s on s.application_id = a.id
  where a.event_id = target_event_id
    and e.deleted_at is null
    and (e.is_test_event = false or public.is_test_event_preview_token_valid(target_event_id, preview_token))
    and a.status = '참가 확정'
    and (
      public.is_test_event_preview_token_valid(target_event_id, preview_token)
      or now() >= ((e.event_date + e.start_time) at time zone 'Asia/Seoul') - interval '3 days'
    )
  order by a.gender, a.submitted_at asc, a.id asc;
$$;

-- ---------------------------------------------------------------------------
-- 2) 관리자 조회 RPC
-- ---------------------------------------------------------------------------

-- 일반 행사 관리 목록(캘린더)에서는 삭제 대기 행사를 제외한다 - 삭제된
-- 행사는 오직 아래 get_admin_deleted_event_summaries에서만 보인다.
create or replace function public.get_admin_event_summaries(session_token text)
 returns table(id text, title text, short_name text, event_date date, start_time time without time zone, end_time time without time zone, location text, venue_booked boolean, male_price integer, female_price integer, current_participants integer, target_participants integer, male_applications integer, female_applications integer, male_confirmed integer, female_confirmed integer, application_deadline timestamp with time zone, male_capacity integer, female_capacity integer, early_bird_deadline timestamp with time zone, early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean, ended_at timestamp with time zone, is_locked boolean, nickname_instruction text, is_recruiting boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
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
  where e.deleted_at is null
  group by e.id;
end;
$$;

-- 행사모드 홈(오늘 진행/진행 예정)에서도 삭제 대기 행사는 제외 - "행사모드
-- 진행"을 삭제된 행사에서 시작할 수 없어야 한다는 요구사항의 실제 방어선.
create or replace function public.get_admin_event_mode_summaries(session_token text)
 returns table(id text, title text, event_date date, start_time time without time zone, end_time time without time zone, location text, confirmed_count integer, male_confirmed_count integer, female_confirmed_count integer, checkin_count integer, male_checkin_count integer, female_checkin_count integer, tablet_count integer, required_tablets integer, is_test_event boolean, started_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    e.id,
    e.title,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    count(distinct a.id) filter (where a.status = '참가 확정')::integer as confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '남성')::integer as male_confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '여성')::integer as female_confirmed_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as checkin_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '남성' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as male_checkin_count,
    count(distinct a.id) filter (where a.status = '참가 확정' and a.gender = '여성' and coalesce(t.checked_in_at, a.checked_in_at) is not null)::integer as female_checkin_count,
    count(distinct et.id) filter (
      where et.connection_status = 'online'
        and et.last_seen_at is not null
        and et.last_seen_at > now() - interval '90 seconds'
    )::integer as tablet_count,
    greatest(1, least(e.male_capacity, e.female_capacity))::integer as required_tablets,
    e.is_test_event,
    e.started_at
  from public.events e
  left join public.applications a on a.event_id = e.id
  left join public.application_tickets t on t.application_id = a.id
  left join public.event_tablets et on et.event_id = e.id
  where e.ended_at is null
    and e.deleted_at is null
    and (
      e.is_test_event
      or (e.event_date + e.end_time) >= ((now() at time zone 'Asia/Seoul')::timestamp)
      or exists (
        select 1 from public.event_progress ep
        where ep.event_id = e.id and ep.stage is distinct from 'ended'
      )
    )
  group by e.id
  order by e.event_date asc, e.start_time asc;
end;
$$;

-- get_admin_event_for_session은 반환 컬럼이 늘어나므로 drop 후 재생성.
-- 이 함수는 (목록이 아니라) id로 직접 조회하는 용도라 일부러 deleted_at으로
-- 걸러내지 않는다 - AdminEventParticipantsPage가 "삭제된 행사입니다" 안내를
-- 보여주려면 삭제된 행사라도 기본 정보(제목 등)는 읽을 수 있어야 한다.
drop function if exists public.get_admin_event_for_session(text, text);

create function public.get_admin_event_for_session(session_token text, event_id_value text)
 returns table(id text, title text, short_name text, event_date date, start_time time without time zone, end_time time without time zone, location text, venue_detail text, application_deadline timestamp with time zone, venue_booked boolean, male_capacity integer, female_capacity integer, male_price integer, female_price integer, early_bird_deadline timestamp with time zone, early_bird_discount_male integer, early_bird_discount_female integer, is_test_event boolean, is_locked boolean, nickname_instruction text, discount_note text, deleted_at timestamp with time zone, scheduled_purge_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
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
    e.is_test_event, e.is_locked, e.nickname_instruction, e.discount_note,
    e.deleted_at, e.scheduled_purge_at
  from public.events e
  where e.id = event_id_value
  limit 1;
end;
$$;

grant execute on function public.get_admin_event_for_session(text, text) to anon, authenticated;

-- 관리자 '삭제된 행사' 목록 전용 조회.
create or replace function public.get_admin_deleted_event_summaries(session_token text)
 returns table(
   id text, title text, event_date date, start_time time without time zone,
   is_test_event boolean, deleted_at timestamp with time zone, scheduled_purge_at timestamp with time zone
 )
 language plpgsql
 stable security definer
 set search_path to 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select e.id, e.title, e.event_date, e.start_time, e.is_test_event, e.deleted_at, e.scheduled_purge_at
  from public.events e
  where e.deleted_at is not null
  order by e.deleted_at desc;
end;
$$;

grant execute on function public.get_admin_deleted_event_summaries(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) 행사 복구
-- ---------------------------------------------------------------------------

create or replace function public.restore_deleted_event_for_admin_session(session_token text, event_id_value text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  target public.events%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target from public.events where id = event_id_value for update;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  if target.deleted_at is null then
    raise exception '삭제 대기 상태가 아닌 행사입니다.';
  end if;

  -- 영구 삭제 cron이 이미 이 행사를 처리하기 시작했다면(claim 완료) 그
  -- 시점부터는 Storage 파일 등이 이미 지워지기 시작했을 수 있어 복구가
  -- 데이터 정합성을 깨뜨린다 - 서버에서도 반드시 막는다.
  if target.purge_claimed_at is not null then
    raise exception '이미 영구 삭제가 진행 중이라 복구할 수 없습니다.';
  end if;

  if target.scheduled_purge_at is not null and target.scheduled_purge_at <= now() then
    raise exception '유예기간이 지나 복구할 수 없습니다.';
  end if;

  update public.events
  set deleted_at = null, scheduled_purge_at = null, updated_at = now()
  where id = event_id_value;
end;
$$;

grant execute on function public.restore_deleted_event_for_admin_session(text, text) to anon, authenticated;

-- 영구 삭제 cron 전용 원자적 claim - service_role만 호출한다(client에는
-- grant하지 않음). meta_lead_dispatches의 claim_meta_lead_dispatch_retry와
-- 동일한 "단일 UPDATE로 원자적으로 선점" 패턴.
create or replace function public.claim_event_for_purge(event_id_value text)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $$
  update public.events
  set purge_claimed_at = now()
  where id = event_id_value
    and deleted_at is not null
    and scheduled_purge_at is not null
    and scheduled_purge_at <= now()
    and (purge_claimed_at is null or purge_claimed_at < now() - interval '30 minutes')
  returning true;
$$;

-- Supabase 프로젝트는 기본적으로 새로 만든 함수에 anon/authenticated
-- execute 권한을 자동으로 부여하는 default privilege가 걸려 있어(schema
-- public 대상), "from public"만 revoke해서는 이 두 role의 실행 권한이
-- 남는다 - 이 함수는 purge cron(service_role)만 호출해야 하므로 명시적으로
-- anon/authenticated에서도 회수한다.
revoke all on function public.claim_event_for_purge(text) from public, anon, authenticated;
grant execute on function public.claim_event_for_purge(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4) 참가자 티켓 조회에 삭제 상태 노출
-- ---------------------------------------------------------------------------

drop function if exists public.get_my_event_tickets(text);

create function public.get_my_event_tickets(session_token text)
returns table(
  application_id uuid, application_no text, status application_status, event_id text, event_title text,
  event_date date, start_time time without time zone, end_time time without time zone, location text,
  nickname text, job text, age integer, gender text, applicant_name text,
  payment_deadline timestamp with time zone, payment_amount integer, review_reason text,
  deposit_requested_at timestamp with time zone, deposit_failed_at timestamp with time zone,
  deposit_failure_reason text, depositor_name text, payment_method text, refund_policy_confirmed boolean,
  refund_policy_confirmed_at timestamp with time zone, transfer_guide_confirmed_at timestamp with time zone,
  transfer_intent_confirmed boolean, payment_completed_at timestamp with time zone, qr_token text,
  qr_issued_at timestamp with time zone, checked_in_at timestamp with time zone, bank_name text,
  bank_account_number text, bank_account_holder text, event_review_submitted_at timestamp with time zone,
  event_ended_at timestamp with time zone, event_deleted_at timestamp with time zone,
  event_scheduled_purge_at timestamp with time zone
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  session_user_id uuid;
begin
  select s.user_id
  into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest');

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  return query
  select
    a.id,
    a.application_no,
    a.status,
    e.id,
    e.title,
    e.event_date,
    e.start_time,
    e.end_time,
    case
      when a.status = '참가 확정' and trim(coalesce(e.venue_detail, '')) <> '' then e.venue_detail
      else e.location
    end,
    a.nickname,
    a.job,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer,
    a.gender,
    a.name,
    a.payment_deadline,
    a.payment_amount,
    a.review_reason,
    a.deposit_requested_at,
    a.deposit_failed_at,
    a.deposit_failure_reason,
    a.depositor_name,
    a.payment_method,
    a.refund_policy_confirmed,
    a.refund_policy_confirmed_at,
    a.transfer_guide_confirmed_at,
    a.transfer_intent_confirmed,
    a.payment_completed_at,
    case when a.status = '참가 확정' and t.revoked_at is null and e.deleted_at is null then t.qr_token else null end,
    t.issued_at,
    coalesce(t.checked_in_at, a.checked_in_at),
    ps.bank_name,
    ps.account_number,
    ps.account_holder,
    er.submitted_at,
    e.ended_at,
    e.deleted_at,
    e.scheduled_purge_at
  from public.applications a
  join public.events e on e.id = a.event_id
  cross join public.payment_settings ps
  left join public.application_tickets t on t.application_id = a.id
  left join public.event_reviews er on er.event_id = a.event_id and er.application_id = a.id
  where a.user_id = session_user_id
    and ps.is_active = true
    and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정', '참여 보류', '반려')
  order by e.event_date asc, e.start_time asc;
end;
$$;

grant execute on function public.get_my_event_tickets(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) 삭제 대기 행사에서 차단할 admin/참가자 쓰기 작업들
--    (프론트 버튼 비활성화와 별개로 서버에서도 실제로 막는다)
-- ---------------------------------------------------------------------------

-- 행사 정보 수정 - 기존 잠금(is_locked) 검사와 나란히 추가.
create or replace function public.upsert_event_for_admin_session(
  session_token text, event_id_value text, event_title text, event_short_name text, event_date_value date,
  event_start_time time without time zone, event_end_time time without time zone, event_location text,
  event_venue_detail text, event_application_deadline timestamp with time zone, event_male_price integer,
  event_female_price integer, event_venue_booked boolean, male_capacity_value integer, female_capacity_value integer,
  event_early_bird_deadline timestamp with time zone, event_early_bird_discount_male integer,
  event_early_bird_discount_female integer, event_is_test_event boolean, event_nickname_instruction text,
  event_discount_note text default null::text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  event_exists boolean;
  event_locked boolean;
  event_deleted timestamptz;
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
    select is_locked, deleted_at into event_locked, event_deleted from public.events where id = event_id_value;
    if event_locked then
      raise exception '잠긴 행사는 수정할 수 없습니다.';
    end if;
    if event_deleted is not null then
      raise exception '삭제된 행사는 수정할 수 없습니다.';
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
    nickname_instruction, discount_note
  ) values (
    event_id_value, trim(event_title), trim(event_short_name), event_date_value, event_start_time, event_end_time,
    trim(event_location), trim(coalesce(event_venue_detail, '')), event_application_deadline,
    event_male_price, event_female_price, event_venue_booked, male_capacity_value, female_capacity_value,
    event_early_bird_deadline, coalesce(event_early_bird_discount_male, 0), coalesce(event_early_bird_discount_female, 0),
    coalesce(event_is_test_event, false), nullif(trim(coalesce(event_nickname_instruction, '')), ''),
    nullif(trim(coalesce(event_discount_note, '')), '')
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
    discount_note = excluded.discount_note,
    updated_at = now();
end;
$$;

-- 행사 시작
create or replace function public.start_admin_event_for_session(session_token text, event_id_value text)
 returns timestamp with time zone
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  target_event public.events%rowtype;
  today_kst date;
  result_started_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception 'Event not found.';
  end if;
  if target_event.deleted_at is not null then
    raise exception '삭제된 행사입니다.';
  end if;

  today_kst := (now() at time zone 'Asia/Seoul')::date;
  if not target_event.is_test_event and target_event.event_date <> today_kst then
    raise exception 'Event can only be started on its event date.';
  end if;

  update public.events
  set started_at = coalesce(started_at, now())
  where id = event_id_value
  returning started_at into result_started_at;

  insert into public.event_progress (event_id, stage, intro_video_status, intro_video_position_seconds, intro_video_updated_at, intro_slide_index)
  values (event_id_value, 'intro_video', 'playing', 0, now(), 0)
  on conflict (event_id) do update
    set stage = 'intro_video',
        intro_video_status = 'playing',
        intro_video_position_seconds = 0,
        intro_video_updated_at = now(),
        intro_slide_index = 0
    where public.event_progress.stage = 'seat_guide';

  perform public.generate_round_schedule_if_missing(event_id_value);

  return result_started_at;
end;
$$;

-- 참가자 추가(긴급 대체 승인)
create or replace function public.approve_emergency_participant_for_session(session_token text, application_id_value uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  admin_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id into admin_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role = 'admin';

  select * into target_application from public.applications where id = application_id_value;
  if not found then
    raise exception '참가자를 찾을 수 없습니다.';
  end if;
  if not target_application.is_emergency_walkin then
    raise exception '긴급 대체 참가 신청이 아닙니다.';
  end if;
  if target_application.status <> '심사 대기' then
    raise exception '이미 처리된 신청입니다.';
  end if;

  select * into target_event from public.events where id = target_application.event_id;
  if target_event.deleted_at is not null then
    raise exception '삭제된 행사입니다.';
  end if;
  if target_event.started_at is not null then
    raise exception '행사가 시작된 이후에는 긴급 대체 참가자를 승인할 수 없습니다.';
  end if;

  update public.applications
  set
    status = '참가 확정',
    is_new = false,
    reviewed_at = now(),
    payment_method = coalesce(payment_method, 'free'),
    payment_completed_at = coalesce(payment_completed_at, now()),
    payment_confirmed_by = coalesce(payment_confirmed_by, admin_user_id),
    checked_in_at = coalesce(checked_in_at, now()),
    checked_in_by = coalesce(checked_in_by, admin_user_id),
    updated_at = now()
  where id = application_id_value;

  insert into public.application_tickets (application_id, user_id, event_id)
  select a.id, a.user_id, a.event_id
  from public.applications a
  where a.id = application_id_value
  on conflict (application_id) do update set
    revoked_at = null,
    updated_at = now();

  perform public.regenerate_round_schedule_from_round(target_application.event_id, 1);
end;
$$;

-- 신규 신청 승인/보류/반려 등 상태 변경 전체
create or replace function public.update_application_review_for_session(
  session_token text, target_application_id uuid, next_status application_status,
  next_payment_deadline timestamp with time zone, next_payment_notice_sent_at timestamp with time zone,
  next_reviewed_at timestamp with time zone, next_review_reason text default null::text
)
 returns application_status
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  admin_user_id uuid;
  target_payment_amount integer;
  target_event_id text;
  target_gender text;
  target_capacity integer;
  occupied_count integer;
  applied_status application_status;
  is_free_confirmation boolean;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role = 'admin';

  select a.payment_amount, a.event_id, a.gender
  into target_payment_amount, target_event_id, target_gender
  from public.applications a
  where a.id = target_application_id
    and a.status in ('심사 대기', '참여 보류', '참가 확정')
  for update;

  if not found then
    raise exception 'Only applications currently under review, on hold, or already confirmed can be updated.';
  end if;

  if exists (select 1 from public.events where id = target_event_id and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  if next_status = '결제 대기' then
    perform 1 from public.events where id = target_event_id for update;

    select case when target_gender = '남성' then e.male_capacity else e.female_capacity end
    into target_capacity
    from public.events e
    where e.id = target_event_id;

    select count(*)
    into occupied_count
    from public.applications a
    where a.event_id = target_event_id
      and a.gender = target_gender
      and a.id <> target_application_id
      and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정');

    if target_capacity is not null and occupied_count >= target_capacity then
      raise exception '% 정원이 모두 찼습니다 (%/%)', target_gender, occupied_count, target_capacity;
    end if;
  end if;

  is_free_confirmation := next_status = '결제 대기' and target_payment_amount = 0;
  applied_status := case when is_free_confirmation then '참가 확정'::application_status else next_status end;

  update public.applications
  set
    is_new = false,
    payment_deadline = case when is_free_confirmation then null else next_payment_deadline end,
    payment_notice_sent_at = case when is_free_confirmation then null else next_payment_notice_sent_at end,
    reviewed_at = coalesce(next_reviewed_at, now()),
    status = applied_status,
    review_reason = next_review_reason,
    payment_method = case when is_free_confirmation then coalesce(payment_method, 'free') else payment_method end,
    payment_completed_at = case when is_free_confirmation then coalesce(payment_completed_at, now()) else payment_completed_at end,
    payment_confirmed_by = case when is_free_confirmation then coalesce(payment_confirmed_by, admin_user_id) else payment_confirmed_by end,
    updated_at = now()
  where id = target_application_id;

  if is_free_confirmation then
    insert into public.application_tickets (application_id, user_id, event_id)
    select a.id, a.user_id, a.event_id
    from public.applications a
    where a.id = target_application_id
    on conflict (application_id) do update set
      revoked_at = null,
      updated_at = now();
  end if;

  if applied_status = '결제 대기' then
    insert into public.payment_invitations (application_id, user_id)
    select a.id, a.user_id
    from public.applications a
    where a.id = target_application_id
      and a.payment_deadline is not null
      and a.payment_deadline > now()
    on conflict (application_id) do update set
      read_at = null, dismissed_at = null, updated_at = now();
  else
    update public.payment_invitations
    set dismissed_at = coalesce(dismissed_at, now()), read_at = coalesce(read_at, now()), updated_at = now()
    where payment_invitations.application_id = target_application_id
      and applied_status in ('참여 보류', '반려', '참가 확정', '환불 완료', '자동 취소');
  end if;

  return applied_status;
end;
$$;

-- 결제 확정(관리자)
create or replace function public.confirm_bank_transfer_for_session(session_token text, p_application_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  admin_user_id uuid;
  target_application public.applications%rowtype;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role = 'admin';

  select *
  into target_application
  from public.applications
  where public.applications.id = p_application_id
  for update;

  if target_application.id is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if exists (select 1 from public.events where id = target_application.event_id and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  if target_application.status = '참가 확정' then
    return;
  end if;

  if target_application.status not in ('결제중', '입금 확인 중') then
    raise exception '입금 확인 처리할 수 없는 상태입니다.';
  end if;

  update public.applications
  set
    status = '참가 확정',
    payment_method = coalesce(payment_method, 'bank_transfer'),
    payment_completed_at = coalesce(payment_completed_at, now()),
    payment_confirmed_by = admin_user_id,
    reviewed_at = coalesce(reviewed_at, now()),
    updated_at = now()
  where public.applications.id = p_application_id;

  insert into public.application_tickets (application_id, user_id, event_id)
  values (target_application.id, target_application.user_id, target_application.event_id)
  on conflict (application_id) do update set
    revoked_at = null,
    updated_at = now();

  update public.payment_invitations
  set read_at = coalesce(read_at, now()), dismissed_at = coalesce(dismissed_at, now()), updated_at = now()
  where public.payment_invitations.application_id = p_application_id;
end;
$$;

-- 결제 확정 요청(참가자가 입금했다고 알리는 단계)
create or replace function public.request_bank_transfer_confirmation(session_token text, p_application_id uuid, depositor_name_value text, refund_policy_confirmed_value boolean default true)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  session_user_id uuid;
  current_status public.application_status;
  current_deadline timestamptz;
  current_event_id text;
begin
  select s.user_id
  into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest');

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  select a.status, a.payment_deadline, a.event_id
  into current_status, current_deadline, current_event_id
  from public.applications a
  where a.id = p_application_id
    and a.user_id = session_user_id
  for update;

  if current_status is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if exists (select 1 from public.events where id = current_event_id and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  if current_status = '참가 확정' then
    return;
  end if;

  if current_status not in ('결제 대기', '결제중', '입금 확인 중') then
    raise exception '계좌이체 확인을 저장할 수 없는 상태입니다.';
  end if;

  if current_status = '결제 대기' and current_deadline is not null and current_deadline < now() then
    raise exception '결제 기한이 지났습니다.';
  end if;

  if nullif(trim(depositor_name_value), '') is null then
    raise exception '입금자명을 입력해주세요.';
  end if;

  if refund_policy_confirmed_value is not true then
    raise exception '환불 규정 확인이 필요합니다.';
  end if;

  update public.applications
  set
    depositor_name = trim(depositor_name_value),
    payment_method = 'bank_transfer',
    refund_policy_confirmed = true,
    refund_policy_confirmed_at = coalesce(refund_policy_confirmed_at, now()),
    transfer_guide_confirmed_at = coalesce(transfer_guide_confirmed_at, now()),
    transfer_intent_confirmed = true,
    deposit_requested_at = coalesce(deposit_requested_at, now()),
    deposit_failed_at = null,
    deposit_failure_reason = null,
    status = '결제중',
    updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.user_id = session_user_id;
end;
$$;

-- QR 체크인
create or replace function public.check_in_ticket_for_session(session_token text, event_id_value text, qr_token_value text)
 returns table(ok boolean, already_checked_in boolean, message text, application_no text, nickname text, checked_in_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  admin_user_id uuid;
  target_ticket public.application_tickets%rowtype;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  result_checked_in_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role = 'admin';

  select *
  into target_ticket
  from public.application_tickets
  where qr_token = regexp_replace(qr_token_value, '^t2m:', '', 'i')
  for update;

  if target_ticket.application_id is null then
    return query select false, false, '유효하지 않은 QR입니다.', ''::text, ''::text, null::timestamptz;
    return;
  end if;

  select * into target_application from public.applications where id = target_ticket.application_id;
  select * into target_event from public.events where id = target_ticket.event_id;

  if target_ticket.event_id <> event_id_value then
    return query select false, false, '이 행사의 참가자가 아닙니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_event.deleted_at is not null then
    return query select false, false, '삭제된 행사입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.revoked_at is not null or target_application.status <> '참가 확정' then
    return query select false, false, '취소되었거나 확정되지 않은 티켓입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if not target_event.is_test_event and (now() at time zone 'Asia/Seoul')::date <> target_event.event_date then
    return query select false, false, '행사 당일에만 입장 확인할 수 있습니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.checked_in_at is not null then
    return query select true, true, '이미 체크인한 참가자입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  select f.checked_in_at into result_checked_in_at from public.finalize_application_check_in(admin_user_id, target_ticket.application_id) f;

  return query select true, false, '입장 확인이 완료되었습니다.', target_application.application_no, target_application.nickname, result_checked_in_at;
end;
$$;

-- 수동 체크인
create or replace function public.check_in_application_for_session(session_token text, event_id_value text, application_id_value uuid)
 returns table(ok boolean, already_checked_in boolean, message text, application_no text, nickname text, checked_in_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  admin_user_id uuid;
  target_application public.applications%rowtype;
  target_ticket public.application_tickets%rowtype;
  target_event public.events%rowtype;
  result_checked_in_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role = 'admin';

  select * into target_application from public.applications where id = application_id_value for update;
  if not found then
    return query select false, false, '참가자를 찾을 수 없습니다.', ''::text, ''::text, null::timestamptz;
    return;
  end if;

  if target_application.event_id <> event_id_value then
    return query select false, false, '이 행사의 참가자가 아닙니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;

  if target_event.deleted_at is not null then
    return query select false, false, '삭제된 행사입니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  if target_application.status <> '참가 확정' then
    return query select false, false, '참가 확정 상태가 아닌 참가자입니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  if not target_event.is_test_event and (now() at time zone 'Asia/Seoul')::date <> target_event.event_date then
    return query select false, false, '행사 당일에만 입장 확인할 수 있습니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  select * into target_ticket from public.application_tickets where application_id = application_id_value;

  if not found then
    return query select false, false, '체크인 정보를 찾을 수 없습니다.', target_application.application_no, target_application.nickname, null::timestamptz;
    return;
  end if;

  if target_ticket.checked_in_at is not null then
    return query select true, true, '이미 체크인한 참가자입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  select f.checked_in_at into result_checked_in_at from public.finalize_application_check_in(admin_user_id, application_id_value) f;

  return query select true, false, '입장 확인이 완료되었습니다.', target_application.application_no, target_application.nickname, result_checked_in_at;
end;
$$;

-- 행사모드 진행(라운드 관련) - 4개
create or replace function public.start_first_round_for_session(session_token text, event_id_value text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  target public.event_progress%rowtype;
  table_count integer;
  active_count integer;
  submitted_count integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_waiting' then
    raise exception '행사 소개가 끝난 후에만 라운드를 시작할 수 있습니다.';
  end if;

  select count(*) into active_count
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active';

  select count(*) into submitted_count
  from public.applications a
  join public.event_profile_cards epc on epc.event_id = a.event_id and epc.application_id = a.id
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.attendance_status = 'active'
    and epc.submitted_at is not null;

  if submitted_count < active_count then
    raise exception '프로필 카드를 아직 제출하지 않은 참가자가 있습니다 (%/%명 제출).', submitted_count, active_count;
  end if;

  delete from public.event_table_assignments where event_id = event_id_value;
  perform public.generate_round_schedule_if_missing(event_id_value);

  select count(distinct table_number) into table_count from public.event_table_assignments where event_id = event_id_value;

  update public.event_progress ep
  set stage = 'round_active', current_round = 1, round_phase = 'conversation',
      round_timer_status = 'running', round_timer_position_seconds = 0,
      round_timer_updated_at = now(), updated_at = now()
  where ep.event_id = event_id_value;

  return table_count;
end;
$$;

create or replace function public.control_round_timer_for_session(session_token text, event_id_value text, action text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  live_elapsed numeric;
  phase_duration integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage not in ('round_active', 'bonus_seat_guide', 'bonus_rating') then
    raise exception '라운드 진행 중이 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;

  phase_duration := case
    when target.stage = 'bonus_rating' then 60
    when target.stage = 'bonus_seat_guide' then 60
    when target.round_phase = 'conversation' and target.is_bonus_round then 420
    when target.round_phase = 'conversation' then coalesce(target_event.conversation_duration_seconds, 600)
    else 60
  end;

  if target.round_timer_status = 'running' then
    live_elapsed := least(phase_duration::numeric, target.round_timer_position_seconds + extract(epoch from (now() - target.round_timer_updated_at)));
  else
    live_elapsed := target.round_timer_position_seconds;
  end if;

  if action = 'pause' then
    update public.event_progress ep
    set round_timer_status = 'paused', round_timer_position_seconds = live_elapsed, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
  elsif action = 'resume' then
    update public.event_progress ep
    set round_timer_status = 'running', round_timer_position_seconds = live_elapsed, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
  elsif action = 'skip' then
    if not coalesce(target_event.is_test_event, false) then
      raise exception '테스트 행사에서만 사용할 수 있습니다.';
    end if;
    update public.event_progress ep
    set round_timer_status = 'running', round_timer_position_seconds = phase_duration, round_timer_updated_at = now(), updated_at = now()
    where ep.event_id = event_id_value;
    perform public.advance_round_state_if_needed(event_id_value);
  else
    raise exception '알 수 없는 동작입니다: %', action;
  end if;

  select * into target from public.event_progress where event_id = event_id_value;
  return jsonb_build_object(
    'currentRound', target.current_round,
    'roundPhase', target.round_phase,
    'stage', target.stage,
    'timerStatus', target.round_timer_status,
    'timerPositionSeconds', target.round_timer_position_seconds,
    'timerUpdatedAt', target.round_timer_updated_at
  );
end;
$$;

create or replace function public.resume_after_regular_rounds_for_session(session_token text, event_id_value text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  first_bonus_round integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_complete' then
    raise exception '지금은 재개할 수 있는 상태가 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if coalesce(target_event.bonus_round_count, 0) <= 0 then
    raise exception '추가시간이 설정되지 않은 행사입니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  first_bonus_round := total_rounds + 1;

  begin
    perform public.generate_bonus_round_assignments(event_id_value, first_bonus_round);
  exception when others then
    raise log '[BONUS_MATCH] generate_bonus_round_assignments raised unexpectedly on resume - event=% round=% error=%',
      event_id_value, first_bonus_round, sqlerrm;
  end;

  if not exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = first_bonus_round
  ) then
    raise log '[BONUS_MATCH] 추가시간 매칭 생성 실패 - 최종선택 단계로 전환됨 (event=% failedRound=%)',
      event_id_value, first_bonus_round;
  end if;

  update public.event_progress ep
  set stage = 'bonus_seat_guide',
      current_round = total_rounds,
      is_bonus_round = true,
      round_phase = 'reveal',
      round_timer_status = 'running',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      round_phase_started_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;
end;
$$;

create or replace function public.set_current_round_for_session(session_token text, event_id_value text, round_number_value integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage not in ('round_active', 'round_complete') then
    raise exception '라운드가 시작된 이후에만 라운드를 이동할 수 있습니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  if round_number_value < 1 or round_number_value > total_rounds then
    raise exception '올바른 라운드 번호가 아닙니다. (1~%)', total_rounds;
  end if;

  update public.event_progress ep
  set stage = 'round_active',
      current_round = round_number_value,
      round_phase = 'conversation',
      round_timer_status = 'paused',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;

  return jsonb_build_object('ok', true, 'currentRound', round_number_value, 'totalRounds', total_rounds);
end;
$$;

-- 최종선택
create or replace function public.submit_final_selection(session_token text, event_id_value text, selected_application_ids uuid[], heart_note_target_id uuid default null::uuid, heart_note_message text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  submitted_count integer;
  valid_count integer;
  distinct_count integer;
  submitted_time timestamptz := now();
  clean_heart_note_message text;
  heart_note_target_valid boolean;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  if exists (
    select 1 from public.final_selection_submissions fss
    where fss.event_id = event_id_value and fss.participant_id = target_application.id
  ) then
    raise exception '이미 최종 선택을 제출했습니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  submitted_count := coalesce(array_length(selected_application_ids, 1), 0);

  select count(distinct x) into distinct_count
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as x;
  if distinct_count <> submitted_count then
    raise exception '선택 목록에 중복된 참가자가 있습니다.';
  end if;

  if submitted_count > coalesce(target_event.final_selection_limit, 3) then
    raise exception '최대 선택 가능 인원을 초과했습니다.';
  end if;

  select count(*) into valid_count
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel(id)
  where exists (
    select 1 from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and ((eta.male_application_id = target_application.id and eta.female_application_id = sel.id)
        or (eta.female_application_id = target_application.id and eta.male_application_id = sel.id))
  );

  if valid_count <> submitted_count then
    raise exception '유효하지 않은 선택 대상이 포함되어 있습니다.';
  end if;

  if heart_note_target_id is not null then
    if heart_note_target_id = target_application.id then
      raise exception '본인에게는 마음 한 줄을 보낼 수 없습니다.';
    end if;

    select exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and ((eta.male_application_id = target_application.id and eta.female_application_id = heart_note_target_id)
          or (eta.female_application_id = target_application.id and eta.male_application_id = heart_note_target_id))
    ) into heart_note_target_valid;

    if not heart_note_target_valid then
      raise exception '유효하지 않은 마음 한 줄 대상입니다.';
    end if;

    clean_heart_note_message := nullif(trim(coalesce(heart_note_message, '')), '');
    if clean_heart_note_message is not null and char_length(clean_heart_note_message) > 200 then
      raise exception '마음 한 줄은 200자 이내로 작성해주세요.';
    end if;
  end if;

  insert into public.final_selections (event_id, selector_application_id, selected_application_id)
  select event_id_value, target_application.id, sel
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel
  on conflict (event_id, selector_application_id, selected_application_id) do nothing;

  insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
  values (event_id_value, target_application.id, submitted_time);

  update public.applications
  set final_selection_submitted_at = submitted_time
  where id = target_application.id;

  if heart_note_target_id is not null then
    insert into public.heart_notes (event_id, sender_application_id, target_application_id, message, created_at)
    values (event_id_value, target_application.id, heart_note_target_id, clean_heart_note_message, submitted_time)
    on conflict (event_id, sender_application_id) do nothing;
  end if;
end;
$$;

-- 라운드 호감도 평가(정규/추가시간)
create or replace function public.submit_round_rating(session_token text, event_id_value text, round_number_value integer, score_value numeric, memo_value text default null::text, hashtags_value text[] default null::text[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  assignment public.event_table_assignments%rowtype;
  ratee_id uuid;
  clean_memo text;
  clean_hashtags text[];
begin
  if score_value < 0 or score_value > 5 or mod((score_value * 10)::integer, 5) <> 0 then
    raise exception '호감도 점수는 0~5 사이 0.5 단위여야 합니다.';
  end if;

  clean_memo := nullif(trim(coalesce(memo_value, '')), '');
  if clean_memo is not null and char_length(clean_memo) > 200 then
    raise exception '메모는 200자 이내로 작성해주세요.';
  end if;

  clean_hashtags := public.normalize_rating_hashtags(hashtags_value);

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if target_progress.current_round is distinct from round_number_value then
    raise exception '이미 다음 라운드로 진행되어 이 평가는 더 이상 수정할 수 없습니다.';
  end if;

  select * into assignment
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.round_number = round_number_value
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if not found then
    raise exception '해당 라운드의 매칭 정보를 찾을 수 없습니다.';
  end if;

  ratee_id := case when assignment.male_application_id = target_application.id then assignment.female_application_id else assignment.male_application_id end;

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo, hashtags)
  values (event_id_value, round_number_value, target_application.id, ratee_id, score_value, clean_memo, clean_hashtags)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, hashtags = excluded.hashtags, updated_at = now();
end;
$$;

create or replace function public.submit_bonus_round_rating(session_token text, event_id_value text, score_value numeric, memo_value text default null::text, hashtags_value text[] default null::text[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  partner_id uuid;
  original_round integer;
  clean_memo text;
  clean_hashtags text[];
begin
  if score_value < 0 or score_value > 5 or mod((score_value * 10)::integer, 5) <> 0 then
    raise exception '호감도 점수는 0~5 사이 0.5 단위여야 합니다.';
  end if;

  clean_memo := nullif(trim(coalesce(memo_value, '')), '');
  if clean_memo is not null and char_length(clean_memo) > 200 then
    raise exception '메모는 200자 이내로 작성해주세요.';
  end if;

  clean_hashtags := public.normalize_rating_hashtags(hashtags_value);

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if target_progress.stage is distinct from 'bonus_seat_guide' then
    raise exception '지금은 호감도를 수정할 수 있는 시점이 아닙니다.';
  end if;

  select case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end
  into partner_id
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and eta.round_number = target_progress.current_round
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  if partner_id is null then
    raise exception '이번 추가시간 상대 정보를 찾을 수 없습니다.';
  end if;

  select eta.round_number into original_round
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and not eta.is_bonus
    and ((eta.male_application_id = target_application.id and eta.female_application_id = partner_id)
      or (eta.female_application_id = target_application.id and eta.male_application_id = partner_id))
  limit 1;

  original_round := coalesce(original_round, target_progress.current_round);

  insert into public.round_ratings (event_id, round_number, rater_application_id, ratee_application_id, score, memo, hashtags)
  values (event_id_value, original_round, target_application.id, partner_id, score_value, clean_memo, clean_hashtags)
  on conflict (event_id, round_number, rater_application_id)
  do update set score = excluded.score, memo = excluded.memo, hashtags = excluded.hashtags, updated_at = now();
end;
$$;

create or replace function public.submit_bonus_round_rating(session_token text, event_id_value text, round_number_value integer, partner_application_id_value uuid, score_value numeric, memo_value text default null::text, hashtags_value text[] default null::text[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  session_user_id uuid;
  target_application_id uuid;
  target_progress public.event_progress%rowtype;
  existing_rating_id uuid;
  clean_memo text;
  clean_hashtags text[];
  submission_window_open boolean := false;
begin
  if score_value < 0 or score_value > 5 or mod((score_value * 10)::integer, 5) <> 0 then
    raise exception '호감도 점수는 0~5 사이 0.5 단위여야 합니다.';
  end if;

  clean_memo := nullif(trim(coalesce(memo_value, '')), '');
  if clean_memo is not null and char_length(clean_memo) > 200 then
    raise exception '메모는 200자 이내로 작성해주세요.';
  end if;
  clean_hashtags := public.normalize_rating_hashtags(hashtags_value);

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
    and s.expires_at > now();
  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select a.id into target_application_id
  from public.applications a
  where a.event_id = event_id_value
    and a.user_id = session_user_id
    and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;
  if target_application_id is null then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  if not exists (
    select 1 from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = round_number_value
      and eta.is_bonus
      and (
        (eta.male_application_id = target_application_id and eta.female_application_id = partner_application_id_value)
        or (eta.female_application_id = target_application_id and eta.male_application_id = partner_application_id_value)
      )
  ) then
    raise exception '이번 추가시간 상대 정보가 일치하지 않습니다.';
  end if;

  select * into target_progress
  from public.event_progress
  where event_id = event_id_value;

  submission_window_open :=
    (target_progress.stage = 'bonus_seat_guide' and target_progress.current_round = round_number_value)
    or (
      target_progress.stage = 'round_active'
      and target_progress.is_bonus_round
      and target_progress.current_round = round_number_value + 1
      and target_progress.round_phase_started_at >= now() - interval '30 seconds'
    )
    or (
      target_progress.stage = 'final_selection'
      and target_progress.current_round = round_number_value
      and target_progress.round_phase_started_at >= now() - interval '30 seconds'
    );

  if not submission_window_open then
    raise exception '지금은 호감도를 수정할 수 있는 시점이 아닙니다.';
  end if;

  select rr.id into existing_rating_id
  from public.round_ratings rr
  where rr.event_id = event_id_value
    and rr.rater_application_id = target_application_id
    and rr.ratee_application_id = partner_application_id_value
  order by
    exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = rr.event_id
        and eta.round_number = rr.round_number
        and not eta.is_bonus
    ) desc,
    rr.updated_at desc
  limit 1
  for update;

  if existing_rating_id is not null then
    update public.round_ratings
    set score = score_value,
        memo = clean_memo,
        hashtags = clean_hashtags,
        updated_at = now()
    where id = existing_rating_id;
  else
    insert into public.round_ratings (
      event_id, round_number, rater_application_id, ratee_application_id,
      score, memo, hashtags
    ) values (
      event_id_value, round_number_value, target_application_id,
      partner_application_id_value, score_value, clean_memo, clean_hashtags
    );
  end if;
end;
$$;
