create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  alter type public.application_status add value if not exists '입금 확인 중';
exception
  when duplicate_object then null;
end $$;

alter table if exists public.applications
add column if not exists depositor_name text,
add column if not exists deposit_requested_at timestamptz,
add column if not exists deposit_failed_at timestamptz,
add column if not exists deposit_failure_reason text,
add column if not exists payment_completed_at timestamptz,
add column if not exists payment_confirmed_by uuid,
add column if not exists checked_in_at timestamptz,
add column if not exists checked_in_by uuid;

create table if not exists public.payment_settings (
  id boolean primary key default true,
  bank_name text not null default '은행명 입력',
  account_number text not null default '000-0000-0000',
  account_holder text not null default '타임투밋',
  updated_at timestamptz not null default now(),
  constraint payment_settings_singleton check (id)
);

insert into public.payment_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists touch_payment_settings_updated_at on public.payment_settings;
create trigger touch_payment_settings_updated_at
before update on public.payment_settings
for each row execute function public.touch_updated_at();

create table if not exists public.application_tickets (
  application_id uuid primary key references public.applications(id) on delete cascade,
  user_id uuid not null,
  event_id text not null references public.events(id) on delete cascade,
  qr_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists application_tickets_user_idx on public.application_tickets (user_id);
create index if not exists application_tickets_event_idx on public.application_tickets (event_id);

drop trigger if exists touch_application_tickets_updated_at on public.application_tickets;
create trigger touch_application_tickets_updated_at
before update on public.application_tickets
for each row execute function public.touch_updated_at();

alter table public.payment_settings enable row level security;
alter table public.application_tickets enable row level security;

drop policy if exists "Admins can manage payment settings" on public.payment_settings;
create policy "Admins can manage payment settings"
on public.payment_settings
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage application tickets" on public.application_tickets;
create policy "Admins can manage application tickets"
on public.application_tickets
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own application tickets" on public.application_tickets;
create policy "Users can read own application tickets"
on public.application_tickets
for select
using (user_id = auth.uid());

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
    and a.status in ('결제 대기', '입금 확인 중', '참가 확정')
  order by e.event_date asc, e.start_time asc;
end;
$$;

grant execute on function public.get_my_event_tickets(text) to anon, authenticated;

drop function if exists public.request_bank_transfer_confirmation(text, uuid, text);
create or replace function public.request_bank_transfer_confirmation(
  session_token text,
  application_id uuid,
  depositor_name_value text
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
  where a.id = application_id
    and a.user_id = session_user_id
  for update;

  if current_status is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if current_status = '참가 확정' then
    return;
  end if;

  if current_status not in ('결제 대기', '입금 확인 중') then
    raise exception '입금 확인을 요청할 수 없는 상태입니다.';
  end if;

  if current_status = '결제 대기' and current_deadline is not null and current_deadline < now() then
    raise exception '결제 기한이 지났습니다.';
  end if;

  update public.applications
  set
    depositor_name = nullif(trim(depositor_name_value), ''),
    deposit_requested_at = coalesce(deposit_requested_at, now()),
    deposit_failed_at = null,
    deposit_failure_reason = null,
    status = '입금 확인 중',
    updated_at = now()
  where id = application_id
    and user_id = session_user_id;
end;
$$;

grant execute on function public.request_bank_transfer_confirmation(text, uuid, text) to anon, authenticated;

drop function if exists public.mark_payment_invitation_read_by_application(text, uuid);
create or replace function public.mark_payment_invitation_read_by_application(
  session_token text,
  application_id uuid
)
returns void
language plpgsql
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

  update public.payment_invitations pi
  set read_at = coalesce(read_at, now()), updated_at = now()
  from public.applications a
  where pi.application_id = a.id
    and a.id = mark_payment_invitation_read_by_application.application_id
    and a.user_id = session_user_id;
end;
$$;

grant execute on function public.mark_payment_invitation_read_by_application(text, uuid) to anon, authenticated;

drop function if exists public.confirm_bank_transfer_for_session(text, uuid);
create or replace function public.confirm_bank_transfer_for_session(
  session_token text,
  application_id uuid
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
  where id = application_id
  for update;

  if target_application.id is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if target_application.status = '참가 확정' then
    return;
  end if;

  if target_application.status not in ('입금 확인 중', '결제 대기') then
    raise exception '참가 확정 처리할 수 없는 상태입니다.';
  end if;

  update public.applications
  set
    status = '참가 확정',
    payment_completed_at = coalesce(payment_completed_at, now()),
    payment_confirmed_by = admin_user_id,
    reviewed_at = coalesce(reviewed_at, now()),
    updated_at = now()
  where id = application_id;

  insert into public.application_tickets (application_id, user_id, event_id)
  values (target_application.id, target_application.user_id, target_application.event_id)
  on conflict (application_id) do update set
    revoked_at = null,
    updated_at = now();

  update public.payment_invitations
  set read_at = coalesce(read_at, now()), dismissed_at = coalesce(dismissed_at, now()), updated_at = now()
  where public.payment_invitations.application_id = confirm_bank_transfer_for_session.application_id;
end;
$$;

grant execute on function public.confirm_bank_transfer_for_session(text, uuid) to anon, authenticated;

drop function if exists public.reject_bank_transfer_for_session(text, uuid, text);
create or replace function public.reject_bank_transfer_for_session(
  session_token text,
  application_id uuid,
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
  where id = application_id
    and status = '입금 확인 중';
end;
$$;

grant execute on function public.reject_bank_transfer_for_session(text, uuid, text) to anon, authenticated;

drop function if exists public.check_in_ticket_for_session(text, text, text);
create or replace function public.check_in_ticket_for_session(
  session_token text,
  event_id_value text,
  qr_token_value text
)
returns table (
  ok boolean,
  already_checked_in boolean,
  message text,
  application_no text,
  nickname text,
  checked_in_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_user_id uuid;
  target_ticket public.application_tickets%rowtype;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
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
    return query select false, false, '이 행사에 발급된 QR이 아닙니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.revoked_at is not null or target_application.status <> '참가 확정' then
    return query select false, false, '취소되었거나 확정되지 않은 티켓입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if (now() at time zone 'Asia/Seoul')::date <> target_event.event_date then
    return query select false, false, '행사 당일에만 입장 확인할 수 있습니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  if target_ticket.checked_in_at is not null then
    return query select true, true, '이미 입장 확인된 참가자입니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
    return;
  end if;

  update public.application_tickets
  set checked_in_at = now(), checked_in_by = admin_user_id, updated_at = now()
  where application_id = target_ticket.application_id
  returning public.application_tickets.checked_in_at into target_ticket.checked_in_at;

  update public.applications
  set checked_in_at = target_ticket.checked_in_at, checked_in_by = admin_user_id, updated_at = now()
  where id = target_ticket.application_id;

  return query select true, false, '입장 확인이 완료되었습니다.', target_application.application_no, target_application.nickname, target_ticket.checked_in_at;
end;
$$;

grant execute on function public.check_in_ticket_for_session(text, text, text) to anon, authenticated;

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
