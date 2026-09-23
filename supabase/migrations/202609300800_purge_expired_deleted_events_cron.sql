-- 삭제 대기(72시간 유예) 행사의 자동 영구 삭제 cron.
--
-- time2meet-retry-failed-meta-lead-events(202609300500)와 완전히 동일한
-- 패턴: pg_cron + pg_net + Vault에 저장된 secret을 헤더로 붙여 Edge
-- Function을 호출한다. Vault secret(event_purge_secret)과 Edge Function
-- secret(EVENT_PURGE_SECRET)은 사용자가 같은 값으로 별도 설정해야 한다.
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'time2meet-purge-expired-deleted-events') then
      perform cron.unschedule('time2meet-purge-expired-deleted-events');
    end if;

    perform cron.schedule(
      'time2meet-purge-expired-deleted-events',
      '*/15 * * * *',
      $cron$
      select net.http_post(
        url := 'https://ebefbyekzygybvtxylwa.supabase.co/functions/v1/purge-expired-deleted-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', 'sb_publishable_-Fh_CaFgh24e7-xjeJWbHQ_72Vo-4h9',
          'Authorization', 'Bearer sb_publishable_-Fh_CaFgh24e7-xjeJWbHQ_72Vo-4h9',
          'x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'event_purge_secret')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  end if;
exception
  when undefined_table then
    null;
  when undefined_function then
    null;
  when insufficient_privilege then
    null;
end $$;
