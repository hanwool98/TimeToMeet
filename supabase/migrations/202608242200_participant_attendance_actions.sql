-- 운영자가 참가자를 불참/중도이탈 처리하거나 복귀시키는 RPC. attendance_status만
-- 바꾸고, 스케줄이 아직 하나도 없으면(행사 시작 전, 또는 시작했지만 첫
-- 라운드 전) 처음부터, 이미 라운드가 진행 중이면 현재 라운드 다음부터만
-- 재생성한다(regenerate_round_schedule_from_round이 이미 과거 라운드는
-- 손대지 않도록 보장).
create or replace function public.set_participant_attendance_status_for_session(
  session_token text,
  application_id_value uuid,
  status_value text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  has_existing_schedule boolean;
  boundary_round integer;
  original_last_round integer;
  max_rounds_value integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if status_value not in ('active', 'no_show', 'left_early') then
    raise exception '올바르지 않은 참가 상태입니다.';
  end if;

  select * into target_application from public.applications where id = application_id_value;
  if not found then
    raise exception '참가자를 찾을 수 없습니다.';
  end if;
  if target_application.status <> '참가 확정' then
    raise exception '참가 확정 상태의 참가자만 대상이 될 수 있습니다.';
  end if;

  update public.applications set attendance_status = status_value where id = application_id_value;

  select exists (
    select 1 from public.event_table_assignments
    where event_id = target_application.event_id and not is_bonus
  ) into has_existing_schedule;

  if not has_existing_schedule then
    perform public.regenerate_round_schedule_from_round(target_application.event_id, 1);
    return;
  end if;

  select * into target_progress from public.event_progress where event_id = target_application.event_id;
  boundary_round := coalesce(target_progress.current_round, 0) + 1;

  -- 이미 계획되어 있던 마지막 라운드 번호를 넘지 않도록 상한을 둔다 -
  -- 그렇지 않으면 인원이 줄어든 뒤 재계산이 "모두가 서로 한 번씩 만나는"
  -- 원형법을 처음부터 다시 돌리면서 원래 예정보다 라운드 수가 늘어나
  -- 행사가 길어질 수 있다(실제 검증 중 발견).
  select max(round_number) into original_last_round
  from public.event_table_assignments
  where event_id = target_application.event_id and not is_bonus;

  if original_last_round is not null then
    max_rounds_value := greatest(0, original_last_round - boundary_round + 1);
  else
    max_rounds_value := null;
  end if;

  perform public.regenerate_round_schedule_from_round(target_application.event_id, boundary_round, max_rounds_value);
end;
$$;

grant execute on function public.set_participant_attendance_status_for_session(text, uuid, text) to anon, authenticated;

-- 운영자 참가자 목록/미리보기가 각 참가자의 현재 attendance_status를 알아야
-- 불참/중도이탈/복귀 버튼을 올바르게 조건부로 보여줄 수 있다. RETURNS
-- TABLE 컬럼을 하나 추가하는 것이라 CREATE OR REPLACE로는 안 되고 먼저
-- drop이 필요하다.
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
  reviewed_at timestamptz, submitted_at timestamptz, event_date date, short_name text, attendance_status text
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
    a.attendance_status
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id;
end;
$$;

grant execute on function public.get_admin_applications_for_session(text) to anon, authenticated;
