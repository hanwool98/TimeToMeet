-- Wires up the automatic schedule for cleanup-expired-guest-accounts, which
-- previously had to be triggered manually. Runs once a day at an off-peak
-- hour. The x-cleanup-secret value is read from Supabase Vault at call time
-- (stored separately via vault.create_secret, not in this migration) so the
-- plaintext secret never appears in the migration history.
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'time2meet-cleanup-expired-guest-accounts',
  '0 19 * * *', -- 19:00 UTC = 04:00 KST
  $$
  select net.http_post(
    url := 'https://ebefbyekzygybvtxylwa.supabase.co/functions/v1/cleanup-expired-guest-accounts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- The gateway requires a valid apikey/Authorization before the
      -- function even runs; this is the publishable key, already shipped in
      -- the client bundle, not a secret. The function's own x-cleanup-secret
      -- check (read from Vault, not embedded here) is the real auth gate.
      'apikey', 'sb_publishable_-Fh_CaFgh24e7-xjeJWbHQ_72Vo-4h9',
      'Authorization', 'Bearer sb_publishable_-Fh_CaFgh24e7-xjeJWbHQ_72Vo-4h9',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'guest_cleanup_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
