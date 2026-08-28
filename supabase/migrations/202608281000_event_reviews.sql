-- 최종선택 제출 후 "후기 작성" 유도 화면을 위한 후기 테이블. final_selections/
-- final_selection_submissions와 완전히 분리된 테이블이라 후기 미작성/삭제가
-- 최종선택 결과에 절대 영향을 주지 않는다(요청: 후기는 별도 데이터).
create table if not exists public.event_reviews (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  content text not null default '',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, application_id)
);

alter table public.event_reviews enable row level security;

drop policy if exists "event_reviews no direct access" on public.event_reviews;
create policy "event_reviews no direct access" on public.event_reviews for all using (false);

create or replace function public.save_event_review_for_session(
  session_token text,
  event_id_value text,
  content_value text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  clean_content text;
  result_submitted_at timestamptz;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
    and a.checked_in_at is not null
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '체크인된 참가자만 후기를 작성할 수 있습니다.';
  end if;

  clean_content := trim(coalesce(content_value, ''));
  if clean_content = '' then
    raise exception '후기 내용을 입력해주세요.';
  end if;
  if char_length(clean_content) > 2000 then
    raise exception '후기는 2000자 이내로 작성해주세요.';
  end if;

  insert into public.event_reviews (event_id, application_id, content, submitted_at, updated_at)
  values (event_id_value, target_application.id, clean_content, now(), now())
  on conflict (event_id, application_id) do update set
    content = excluded.content,
    submitted_at = coalesce(public.event_reviews.submitted_at, now()),
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at);
end;
$$;

grant execute on function public.save_event_review_for_session(text, text, text) to anon, authenticated;

create or replace function public.get_my_event_review_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  review_row public.event_reviews%rowtype;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select r.* into review_row
  from public.event_reviews r
  join public.applications a on a.id = r.application_id
  where r.event_id = event_id_value and a.user_id = session_user_id;

  if not found then
    return jsonb_build_object('content', '', 'submittedAt', null);
  end if;

  return jsonb_build_object('content', review_row.content, 'submittedAt', review_row.submitted_at);
end;
$$;

grant execute on function public.get_my_event_review_for_session(text, text) to anon, authenticated;

-- get_my_event_tickets에 reviewSubmittedAt을 얹는다 - 반환 컬럼이 늘어나는
-- returns table 시그니처 변경이므로 drop 후 재생성.
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
  event_review_submitted_at timestamptz
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
    er.submitted_at
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
