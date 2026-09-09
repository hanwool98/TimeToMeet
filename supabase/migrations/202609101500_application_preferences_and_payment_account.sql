-- Optional, event-specific matching notes. Existing applications remain valid.
alter table public.applications
  add column if not exists preferred_partner_description text,
  add column if not exists avoid_participant_note text;

-- Payment screens already read the single active row through
-- get_my_event_tickets(). Updating the setting does not touch application or
-- payment state.
update public.payment_settings
set
  bank_name = '토스뱅크',
  account_number = '1002-7570-4703'
where is_active = true
  and (bank_name, account_number) is distinct from ('토스뱅크', '1002-7570-4703');

-- The return type changes, so PostgreSQL requires a drop before recreation.
drop function if exists public.get_admin_applications_for_session(text);

create function public.get_admin_applications_for_session(session_token text)
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
  preferred_partner_description text,
  avoid_participant_note text,
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
  short_name text,
  attendance_status text,
  is_emergency_walkin boolean,
  is_test_participant boolean
)
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
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
      else coalesce(nullif(eps.nickname, ''), a.nickname)
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
    a.preferred_partner_description,
    a.avoid_participant_note,
    a.id_photo_path,
    coalesce(nullif(eps.nickname, ''), a.nickname),
    case when eps.photo_path is not null then array[eps.photo_path] else a.profile_photo_paths end,
    case when eps.photo_path is not null then 0 else a.representative_photo_index end,
    coalesce(eps.photo_crop, a.representative_crop),
    a.voice_intro_path,
    a.height,
    coalesce(nullif(eps.job, ''), a.job),
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
    a.is_emergency_walkin,
    a.is_test_participant
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id
  left join public.event_participant_snapshots eps on eps.event_id = a.event_id and eps.application_id = a.id;
end;
$function$;

revoke all on function public.get_admin_applications_for_session(text) from public;
grant execute on function public.get_admin_applications_for_session(text) to anon, authenticated;

notify pgrst, 'reload schema';
