alter table public.guest_accounts
add column if not exists delete_after timestamptz;

update public.guest_accounts
set delete_after = coalesce(delete_after, created_at + interval '24 hours')
where delete_after is null;

alter table public.guest_accounts
alter column delete_after set default (now() + interval '24 hours');

create or replace function public.get_expired_guest_account_cleanup_candidates()
returns table (
  user_id uuid,
  delete_after timestamptz
)
language sql
stable
security definer
set search_path = public
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
        and e.event_date >= current_date
        and a.status in ('심사 대기', '결제 대기', '참가 확정', '참여 보류')
    )
    and not exists (
      select 1
      from public.applications a
      where a.user_id = ga.user_id
        and (a.legal_hold = true or a.has_dispute = true)
    );
$$;

create or replace function public.cleanup_expired_guest_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_count integer := 0;
  target record;
begin
  for target in
    select * from public.get_expired_guest_account_cleanup_candidates()
  loop
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
    where applications.user_id = target.user_id
      and applications.legal_hold = false
      and applications.has_dispute = false
      and not exists (
        select 1
        from public.events e
        where e.id = applications.event_id
          and e.event_date >= current_date
          and applications.status in ('심사 대기', '결제 대기', '참가 확정', '참여 보류')
      );

    delete from public.application_drafts
    where application_drafts.user_id = target.user_id;

    delete from public.app_sessions
    where app_sessions.user_id = target.user_id
      and app_sessions.role = 'guest';

    delete from public.guest_login_attempts
    where guest_login_attempts.phone_hash in (
      select public.guest_phone_hash(guest_accounts.phone_normalized)
      from public.guest_accounts
      where guest_accounts.user_id = target.user_id
    );

    delete from public.guest_accounts
    where guest_accounts.user_id = target.user_id;

    delete from public.user_accounts
    where user_accounts.user_id = target.user_id
      and user_accounts.account_type = 'guest';

    delete from public.app_users
    where app_users.user_id = target.user_id
      and app_users.account_type = 'guest';

    cleaned_count := cleaned_count + 1;
  end loop;

  return cleaned_count;
end;
$$;

grant execute on function public.get_expired_guest_account_cleanup_candidates() to anon, authenticated;
grant execute on function public.cleanup_expired_guest_accounts() to anon, authenticated;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception
  when insufficient_privilege or undefined_file then
    null;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) then
    perform cron.unschedule('cleanup-expired-guest-accounts');
    perform cron.schedule(
      'cleanup-expired-guest-accounts',
      '15 * * * *',
      'select public.cleanup_expired_guest_accounts();'
    );
  end if;
exception
  when others then
    null;
end $$;

notify pgrst, 'reload schema';
