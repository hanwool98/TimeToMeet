-- Ties two things to the same "3 days after the event" boundary so they stay
-- consistent with each other:
--   1) A guest's applications only protect their account from cleanup while
--      the related event is upcoming/ongoing OR ended within the last 3
--      days - previously protection ended the instant event_date passed,
--      giving no grace period at all.
--   2) "내 행사" stops listing a ticket once its event is more than 3 days
--      in the past, instead of listing every past ticket forever. This
--      keeps the ticket's visibility window and the account's deletion
--      grace window aligned - a guest never sees "no tickets" while their
--      account still exists protected, nor keeps seeing a ticket for an
--      account that's about to be cleaned up without warning.
create or replace function public.get_expired_guest_account_cleanup_candidates()
returns table (user_id uuid, delete_after timestamptz)
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    ga.user_id,
    ga.delete_after
  from public.guest_accounts ga
  join public.user_accounts ua on ua.user_id = ga.user_id
  where ua.account_type = 'guest'
    and ua.converted_to_member_at is null
    and ga.delete_after <= now()
    and not exists (
      select 1
      from public.applications a
      join public.events e on e.id = a.event_id
      where a.user_id = ga.user_id
        and e.event_date >= current_date - 3
        and a.status in (
          '심사 대기',
          '결제 대기',
          '결제중',
          '입금 확인 중',
          '참가 확정',
          '참여 보류'
        )
    )
    and not exists (
      select 1
      from public.applications a
      where a.user_id = ga.user_id
        and (a.legal_hold = true or a.has_dispute = true)
    );
$$;

create or replace function public.get_my_event_tickets(session_token text)
returns table (
  application_id uuid,
  application_no text,
  status application_status,
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
  review_reason text,
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
set search_path = 'public'
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
    and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정', '참여 보류', '반려')
    and e.event_date >= current_date - 3
  order by e.event_date asc, e.start_time asc;
end;
$$;
