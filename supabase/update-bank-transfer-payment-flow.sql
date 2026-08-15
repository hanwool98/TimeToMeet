create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  alter type public.application_status add value if not exists '결제중';
exception
  when duplicate_object then null;
end $$;

alter table if exists public.applications
add column if not exists payment_method text,
add column if not exists refund_policy_confirmed boolean not null default false,
add column if not exists refund_policy_confirmed_at timestamptz,
add column if not exists transfer_guide_confirmed_at timestamptz,
add column if not exists transfer_intent_confirmed boolean not null default false;

create table if not exists public.payment_settings (
  id boolean primary key default true,
  bank_name text not null default '국민은행',
  account_number text not null default '300102-04-126961',
  account_holder text not null default '윤영석',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint payment_settings_singleton check (id)
);

alter table public.payment_settings
add column if not exists is_active boolean not null default true;

insert into public.payment_settings (id, bank_name, account_number, account_holder, is_active)
values (true, '국민은행', '300102-04-126961', '윤영석', true)
on conflict (id) do update set
  bank_name = excluded.bank_name,
  account_number = excluded.account_number,
  account_holder = excluded.account_holder,
  is_active = true,
  updated_at = now();

drop function if exists public.request_bank_transfer_confirmation(text, uuid, text);
drop function if exists public.request_bank_transfer_confirmation(text, uuid, text, boolean);
create or replace function public.request_bank_transfer_confirmation(
  session_token text,
  p_application_id uuid,
  depositor_name_value text,
  refund_policy_confirmed_value boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
  current_status public.application_status;
  current_deadline timestamptz;
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

  select a.status, a.payment_deadline
  into current_status, current_deadline
  from public.applications a
  where a.id = p_application_id
    and a.user_id = session_user_id
  for update;

  if current_status is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
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

grant execute on function public.request_bank_transfer_confirmation(text, uuid, text, boolean) to anon, authenticated;

drop function if exists public.get_my_event_tickets(text);
create or replace function public.get_my_event_tickets(session_token text)
returns table (
  application_id uuid,
  application_no text,
  status public.application_status,
  event_id text,
  event_title text,
  event_date date,
  start_time time,
  end_time time,
  location text,
  nickname text,
  job text,
  age integer,
  gender text,
  applicant_name text,
  payment_deadline timestamptz,
  payment_amount integer,
  deposit_requested_at timestamptz,
  deposit_failed_at timestamptz,
  deposit_failure_reason text,
  depositor_name text,
  payment_method text,
  refund_policy_confirmed boolean,
  refund_policy_confirmed_at timestamptz,
  transfer_guide_confirmed_at timestamptz,
  transfer_intent_confirmed boolean,
  payment_completed_at timestamptz,
  qr_token text,
  qr_issued_at timestamptz,
  checked_in_at timestamptz,
  bank_name text,
  bank_account_number text,
  bank_account_holder text
)
language plpgsql
stable
security definer
set search_path = public
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
    e.location,
    a.nickname,
    a.job,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer,
    a.gender,
    a.name,
    a.payment_deadline,
    case when a.gender = '남성' then e.male_price else e.female_price end,
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
    case when a.status = '참가 확정' and t.revoked_at is null then t.qr_token else null end,
    t.issued_at,
    coalesce(t.checked_in_at, a.checked_in_at),
    ps.bank_name,
    ps.account_number,
    ps.account_holder
  from public.applications a
  join public.events e on e.id = a.event_id
  cross join public.payment_settings ps
  left join public.application_tickets t on t.application_id = a.id
  where a.user_id = session_user_id
    and ps.is_active = true
    and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정')
  order by e.event_date asc, e.start_time asc;
end;
$$;

grant execute on function public.get_my_event_tickets(text) to anon, authenticated;

drop function if exists public.confirm_bank_transfer_for_session(text, uuid);
create or replace function public.confirm_bank_transfer_for_session(
  session_token text,
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
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

grant execute on function public.confirm_bank_transfer_for_session(text, uuid) to anon, authenticated;

drop function if exists public.reject_bank_transfer_for_session(text, uuid, text);
create or replace function public.reject_bank_transfer_for_session(
  session_token text,
  p_application_id uuid,
  failure_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  update public.applications
  set
    status = '결제 대기',
    deposit_failed_at = now(),
    deposit_failure_reason = coalesce(nullif(trim(failure_reason), ''), '입금 내역을 확인하지 못했습니다.'),
    updated_at = now()
  where public.applications.id = p_application_id
    and public.applications.status in ('결제중', '입금 확인 중');
end;
$$;

grant execute on function public.reject_bank_transfer_for_session(text, uuid, text) to anon, authenticated;

drop function if exists public.get_admin_applications_for_session(text);
create or replace function public.get_admin_applications_for_session(session_token text)
returns table (
  id uuid,
  application_no text,
  event_id text,
  user_id uuid,
  user_display_id text,
  account_type text,
  is_returning boolean,
  status public.application_status,
  is_new boolean,
  name text,
  birth_date date,
  gender text,
  residence text,
  phone text,
  relationship_status text,
  id_photo_path text,
  nickname text,
  profile_photo_paths text[],
  representative_photo_index integer,
  representative_crop jsonb,
  voice_intro_path text,
  height text,
  job text,
  employment_proof_path text,
  access_route text,
  filming_consent boolean,
  interview_consent text,
  refund_agreement boolean,
  inquiry text,
  review_notice_confirmed boolean,
  payment_deadline timestamptz,
  payment_notice_sent_at timestamptz,
  deposit_requested_at timestamptz,
  deposit_failed_at timestamptz,
  deposit_failure_reason text,
  depositor_name text,
  payment_method text,
  refund_policy_confirmed boolean,
  refund_policy_confirmed_at timestamptz,
  transfer_guide_confirmed_at timestamptz,
  transfer_intent_confirmed boolean,
  payment_completed_at timestamptz,
  checked_in_at timestamptz,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  event_date date,
  short_name text
)
language plpgsql
stable
security definer
set search_path = public
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
    e.short_name
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id;
end;
$$;

grant execute on function public.get_admin_applications_for_session(text) to anon, authenticated;

notify pgrst, 'reload schema';
