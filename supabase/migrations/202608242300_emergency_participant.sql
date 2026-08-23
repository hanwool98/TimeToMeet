-- 행사 시작 전에만 사용 가능한 긴급 대체 참가자 등록: 노쇼/불참으로 빈
-- 자리를 일반 모집(심사대기/결제대기/24시간 결제제한)을 거치지 않고 즉시
-- 채우기 위한 기능. events.started_at is null인 동안에만 토큰 발급/승인이
-- 가능하고, 행사가 시작되면 서버 쪽에서 완전히 차단된다(요청의 명시적
-- 방향성: 시작 이후에는 신규 참가자 긴급 추가 기능 자체를 제공하지 않음).

-- 1) applications에 긴급 도보 참가 여부 플래그 추가 -------------------------
alter table public.applications add column if not exists is_emergency_walkin boolean not null default false;

-- enforce_event_application_deadline은 이 저장소의 로컬 migration이 생기기
-- 전부터 존재하던 트리거 함수(라이브 DB에서 pg_get_functiondef로 확인한
-- 원본 그대로) - 긴급 대체 참가자는 정의상 이미 지난 신청 마감일 이후에
-- 등록되므로, is_emergency_walkin 행에 한해서만 마감일 검사를 건너뛰도록
-- 조건 하나를 추가한다. 그 외 동작은 원본과 완전히 동일하다.
create or replace function public.enforce_event_application_deadline()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare
  deadline_value timestamptz;
  event_is_test boolean;
begin
  select e.application_deadline, e.is_test_event
    into deadline_value, event_is_test
  from public.events e
  where e.id = new.event_id;

  if not coalesce(event_is_test, false)
     and not coalesce(new.is_emergency_walkin, false)
     and deadline_value is not null
     and now() >= deadline_value
  then
    raise exception 'Application deadline has passed.';
  end if;

  return new;
end;
$$;

-- 2) 긴급 참가 토큰 --------------------------------------------------------
-- create_test_event_preview_token/event_preview_tokens와 동일한 패턴:
-- 해시만 저장, 이벤트 바인딩, 만료시간, 그리고 여기서는 1회성 사용을 위한
-- used_at까지 추가.
create table if not exists public.emergency_participant_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists emergency_participant_tokens_event_id_idx on public.emergency_participant_tokens (event_id);

alter table public.emergency_participant_tokens enable row level security;

drop policy if exists "No direct emergency token access" on public.emergency_participant_tokens;
create policy "No direct emergency token access"
on public.emergency_participant_tokens
for all
using (false)
with check (false);

create or replace function public.create_emergency_participant_token(session_token text, event_id_value text, ttl_hours integer default 6)
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  new_token text;
  new_expires_at timestamptz;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  if target_event.started_at is not null then
    raise exception '행사가 시작된 이후에는 긴급 대체 참가자를 추가할 수 없습니다.';
  end if;

  new_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_expires_at := now() + make_interval(hours => greatest(1, least(coalesce(ttl_hours, 6), 24)));

  insert into public.emergency_participant_tokens (event_id, token_hash, expires_at)
  values (event_id_value, encode(extensions.digest(new_token, 'sha256'), 'hex'), new_expires_at);

  return query select new_token, new_expires_at;
end;
$$;

grant execute on function public.create_emergency_participant_token(text, text, integer) to anon, authenticated;

-- submit-emergency-application(Edge Function)의 토큰 검증과, 참가자가 폼을
-- 열기 전 이벤트 정보를 보기 위한 조회 양쪽에서 재사용하는 단일 판정
-- 함수. 토큰 자체의 유효기간/사용여부뿐 아니라 "행사가 아직 시작 전인지"도
-- 매번 다시 확인한다 - 토큰 발급 시점과 실제 제출 시점 사이에 행사가
-- 시작될 수 있기 때문.
create or replace function public.is_emergency_participant_token_valid(event_id_value text, token_value text)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.emergency_participant_tokens t
    join public.events e on e.id = t.event_id
    where t.event_id = event_id_value
      and t.token_hash = encode(extensions.digest(coalesce(token_value, ''), 'sha256'), 'hex')
      and t.expires_at > now()
      and t.used_at is null
      and e.started_at is null
  );
$$;

grant execute on function public.is_emergency_participant_token_valid(text, text) to anon, authenticated, service_role;

create or replace function public.get_emergency_participant_token_event(event_id_value text, token_value text)
returns table (id text, title text, short_name text, event_date date, start_time time, location text)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_emergency_participant_token_valid(event_id_value, token_value) then
    return;
  end if;

  return query
  select e.id, e.title, e.short_name, e.event_date, e.start_time, e.location
  from public.events e
  where e.id = event_id_value;
end;
$$;

grant execute on function public.get_emergency_participant_token_event(text, text) to anon, authenticated;

-- 3) 운영자 승인: 심사대기 -> 참가확정 + 체크인 + 전체 rotation 재생성 -----
-- update_application_review_for_session의 무료 자동승격(결제 0원이면
-- application_tickets 발급) 로직과 동일한 티켓 발급 방식을 재사용하되,
-- 긴급 참가자는 결제대기 단계 자체가 없으므로 곧바로 참가확정 + 체크인까지
-- 한 번에 처리하고, 행사 시작 전이므로 전체 라운드를 처음부터 다시 만든다.
create or replace function public.approve_emergency_participant_for_session(session_token text, application_id_value uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
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

grant execute on function public.approve_emergency_participant_for_session(text, uuid) to anon, authenticated;

-- 4) 운영자 참가자 목록에 긴급 도보 참가 여부도 함께 내려준다(대기 중인
-- 긴급 신청을 목록에서 걸러내 승인 UI를 보여주기 위함). RETURNS TABLE
-- 컬럼이 또 늘어나므로 drop 후 재생성.
drop function if exists public.get_admin_applications_for_session(text);

create or replace function public.get_admin_applications_for_session(session_token text)
returns table (
  id uuid, application_no text, event_id text, user_id uuid, user_display_id text, account_type text,
  is_returning boolean, status application_status, is_new boolean, name text, birth_date date, gender text,
  residence text, phone text, relationship_status text, id_photo_path text, nickname text,
  profile_photo_paths text[], representative_photo_index integer, representative_crop jsonb, voice_intro_path text,
  height text, job text, employment_proof_path text, access_route text, filming_consent boolean,
  interview_consent text, refund_agreement boolean, inquiry text, review_notice_confirmed boolean,
  payment_deadline timestamptz, payment_notice_sent_at timestamptz, deposit_requested_at timestamptz,
  deposit_failed_at timestamptz, deposit_failure_reason text, depositor_name text, payment_method text,
  refund_policy_confirmed boolean, refund_policy_confirmed_at timestamptz, transfer_guide_confirmed_at timestamptz,
  transfer_intent_confirmed boolean, payment_completed_at timestamptz, checked_in_at timestamptz,
  reviewed_at timestamptz, submitted_at timestamptz, event_date date, short_name text, attendance_status text,
  is_emergency_walkin boolean
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
    a.id,
    a.application_no,
    a.event_id,
    a.user_id,
    case
      when coalesce(ua.account_type, au.account_type, 'member') = 'guest' and ga.phone_normalized is not null then
        '비회원 ' || substring(ga.phone_normalized from char_length(ga.phone_normalized) - 7 for 4)
        || '-' ||
        substring(ga.phone_normalized from char_length(ga.phone_normalized) - 3 for 4)
      when ma.login_id is not null then ma.login_id
      else a.nickname
    end,
    coalesce(ua.account_type, au.account_type, 'member'),
    a.is_returning,
    a.status,
    a.is_new,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    a.phone,
    a.relationship_status,
    a.id_photo_path,
    a.nickname,
    a.profile_photo_paths,
    a.representative_photo_index,
    a.representative_crop,
    a.voice_intro_path,
    a.height,
    a.job,
    a.employment_proof_path,
    a.access_route,
    a.filming_consent,
    a.interview_consent,
    a.refund_agreement,
    a.inquiry,
    a.review_notice_confirmed,
    a.payment_deadline,
    a.payment_notice_sent_at,
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
    a.checked_in_at,
    a.reviewed_at,
    a.submitted_at,
    e.event_date,
    e.short_name,
    a.attendance_status,
    a.is_emergency_walkin
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id;
end;
$$;

grant execute on function public.get_admin_applications_for_session(text) to anon, authenticated;
