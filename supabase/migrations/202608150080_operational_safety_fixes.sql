create unique index if not exists application_drafts_user_event_unique
on public.application_drafts (user_id, event_id);

alter table if exists public.applications
add column if not exists canceled_at timestamptz,
add column if not exists cancel_reason text;

create or replace function public.cancel_expired_payment_applications()
returns table(application_id uuid, previous_status text, new_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with updated as (
    update public.applications
    set
      status = '자동 취소',
      canceled_at = coalesce(canceled_at, now()),
      cancel_reason = coalesce(cancel_reason, 'payment_deadline_expired'),
      updated_at = now()
    where status = '결제 대기'
      and payment_deadline is not null
      and payment_deadline < now()
      and payment_completed_at is null
      and canceled_at is null
    returning id, '결제 대기'::text as previous_status, status::text as new_status
  )
  select id, previous_status, new_status from updated;
end;
$$;

revoke all on function public.cancel_expired_payment_applications() from public;

do $$
begin
  if exists (
    select 1 from pg_namespace where nspname = 'cron'
  ) then
    perform cron.unschedule('time2meet-cancel-expired-payment-applications');
    perform cron.schedule(
      'time2meet-cancel-expired-payment-applications',
      '*/10 * * * *',
      'select public.cancel_expired_payment_applications();'
    );
  end if;
exception
  when undefined_function then
    null;
  when insufficient_privilege then
    null;
end $$;

create or replace function public.get_expired_guest_cleanup_targets()
returns table (
  user_id uuid,
  storage_bucket text,
  storage_path text
)
language sql
security definer
set search_path = public
as $$
  with expired_guests as (
    select ua.user_id
    from public.user_accounts ua
    left join public.applications a
      on a.user_id = ua.user_id
      and a.status not in ('자동 취소', '참가 거부', '환불 완료')
    left join public.events e
      on e.id = a.event_id
      and (e.event_date >= current_date or a.status in ('심사 대기', '참여 보류', '결제 대기', '결제중', '입금 확인 중', '참가 확정'))
    where ua.account_type = 'guest'
      and ua.converted_to_member_at is null
      and ua.created_at < now() - interval '24 hours'
      and a.id is null
      and e.id is null
  ),
  application_file_paths as (
    select a.user_id, unnest(array_remove(array[
      a.id_photo_path,
      a.voice_intro_path,
      a.employment_proof_path
    ], null)) as storage_path
    from public.applications a
    join expired_guests eg on eg.user_id = a.user_id
    union all
    select a.user_id, unnest(coalesce(a.profile_photo_paths, '{}'::text[])) as storage_path
    from public.applications a
    join expired_guests eg on eg.user_id = a.user_id
  )
  select user_id, 'application-files'::text as storage_bucket, storage_path
  from application_file_paths
  where storage_path is not null and storage_path <> '';
$$;

revoke all on function public.get_expired_guest_cleanup_targets() from public;

create or replace function public.finalize_expired_guest_cleanup(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.application_drafts where user_id = target_user_id;
  delete from public.applications where user_id = target_user_id;
  delete from public.guest_accounts where user_id = target_user_id;
  delete from public.user_accounts
  where user_id = target_user_id
    and account_type = 'guest'
    and converted_to_member_at is null;
end;
$$;

revoke all on function public.finalize_expired_guest_cleanup(uuid) from public;

notify pgrst, 'reload schema';
