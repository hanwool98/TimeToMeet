-- Closes a real time-of-check-to-time-of-use gap before wiring up an
-- automatic schedule for guest cleanup: get_expired_guest_cleanup_targets()
-- snapshots eligible users once, but finalize_expired_guest_cleanup() never
-- re-verified anything before actually erasing data - if a guest applied to
-- an event (or an application's status changed) in the gap between the two
-- calls, their account would still be wiped. Both now go through a single
-- shared predicate, and the destructive step re-checks it immediately
-- before doing anything.
create or replace function public.is_guest_cleanup_eligible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.guest_accounts ga
    join public.user_accounts ua on ua.user_id = ga.user_id
    where ga.user_id = p_user_id
      and ua.account_type = 'guest'
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
      )
  );
$$;

grant execute on function public.is_guest_cleanup_eligible(uuid) to service_role;

create or replace function public.get_expired_guest_account_cleanup_candidates()
returns table (user_id uuid, delete_after timestamptz)
language sql
stable
security definer
set search_path = 'public'
as $$
  select ga.user_id, ga.delete_after
  from public.guest_accounts ga
  where public.is_guest_cleanup_eligible(ga.user_id);
$$;

create or replace function public.finalize_expired_guest_cleanup(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_guest_cleanup_eligible(target_user_id) then
    -- Something changed since this user was listed as a target (e.g. they
    -- just applied to an upcoming event, or their application moved into
    -- an active status) - do nothing rather than risk deleting an account
    -- that's no longer eligible.
    return;
  end if;

  update public.applications
  set
    name = '삭제된 비회원',
    residence = '',
    phone = '',
    relationship_status = '',
    id_photo_path = null,
    nickname = '삭제된 프로필',
    profile_photo_paths = '{}',
    representative_crop = '{}',
    voice_intro_path = null,
    height = '',
    job = '',
    employment_proof_path = null,
    access_route = '',
    inquiry = '',
    consents = '{}',
    updated_at = now()
  where user_id = target_user_id
    and legal_hold = false
    and has_dispute = false;

  delete from public.application_drafts where user_id = target_user_id;
  delete from public.app_sessions where user_id = target_user_id and role = 'guest';

  delete from public.guest_login_attempts
  where phone_hash in (
    select public.guest_phone_hash(ga.phone_normalized)
    from public.guest_accounts ga
    where ga.user_id = target_user_id
  );

  delete from public.guest_accounts where user_id = target_user_id;
  delete from public.user_accounts
  where user_id = target_user_id
    and account_type = 'guest';
  delete from public.app_users
  where user_id = target_user_id
    and account_type = 'guest';
end;
$$;
