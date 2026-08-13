do $$
begin
  begin
    perform cron.unschedule('cleanup-expired-guest-accounts');
  exception
    when others then
      null;
  end;

  perform cron.schedule(
    'cleanup-expired-guest-accounts',
    '15 * * * *',
    'select public.cleanup_expired_guest_accounts();'
  );
end $$;
