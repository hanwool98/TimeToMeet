-- "후기 작성" 버튼이 안 뜨던 실제 원인: get_my_event_tickets가
-- events.ended_at(운영자가 "행사 종료"를 눌러 예정 시각 전에 실제로
-- 세팅하는 값)을 아예 반환하지 않아서, 참가자 티켓 쪽은 예정 종료 시각이
-- 지나기 전까지 "행사가 안 끝난 것"으로 판단했다 - 운영자 대시보드
-- (get_admin_event_mode_summaries)는 이미 "ended_at is not null OR 예정
-- 종료시각 지남"으로 판정하는데 참가자 쪽만 후자만 보고 있었던 것.
-- 반환 컬럼이 늘어나므로 drop 후 재생성.
drop function if exists public.get_my_event_tickets(text);

create function public.get_my_event_tickets(session_token text)
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
  bank_account_holder text,
  event_review_submitted_at timestamptz,
  event_ended_at timestamptz
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
    ps.account_holder,
    er.submitted_at,
    e.ended_at
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

notify pgrst, 'reload schema';
