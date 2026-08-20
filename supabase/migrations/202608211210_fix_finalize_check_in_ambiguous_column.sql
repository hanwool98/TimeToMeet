-- Same ambiguous-column class of bug as before: finalize_application_check_in
-- declares `checked_in_at` as a RETURNS TABLE output column, which shadows
-- the bare `checked_in_at` reference inside its own UPDATE statement
-- (coalesce(checked_in_at, now()) - is it the output param or the column
-- being updated?). Alias the table explicitly to remove the ambiguity.
create or replace function public.finalize_application_check_in(admin_user_id uuid, target_application_id uuid)
returns table (checked_in_at timestamptz)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result_checked_in_at timestamptz;
begin
  update public.application_tickets t
  set checked_in_at = coalesce(t.checked_in_at, now()),
      checked_in_by = coalesce(t.checked_in_by, admin_user_id),
      updated_at = now()
  where t.application_id = target_application_id
  returning t.checked_in_at into result_checked_in_at;

  update public.applications a
  set checked_in_at = result_checked_in_at,
      checked_in_by = coalesce(a.checked_in_by, admin_user_id),
      updated_at = now()
  where a.id = target_application_id;

  return query select result_checked_in_at;
end;
$$;

revoke all on function public.finalize_application_check_in(uuid, uuid) from public, anon, authenticated;
