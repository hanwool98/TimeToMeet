-- cancel_expired_payment_applications has been failing on every single
-- pg_cron run (every 10 minutes, confirmed via cron.job_run_details - 100%
-- failure rate) since it was created: RETURNS TABLE(..., previous_status
-- text, new_status text) implicitly declares OUT variables with those
-- names, which collide with the CTE's own column aliases of the same name.
-- Same class of bug already documented/fixed elsewhere in this project -
-- found while verifying the 0원 payment-skip change didn't touch anything
-- related, unrelated to that change itself. Fixed by qualifying the CTE's
-- columns explicitly.
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
  select updated.id, updated.previous_status, updated.new_status from updated;
end;
$$;
