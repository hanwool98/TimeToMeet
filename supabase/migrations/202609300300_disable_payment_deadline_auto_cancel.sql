-- 결제 대기 신청서를 승인 후 24시간이 지나면 자동으로 '자동 취소' 처리하던
-- pg_cron 스케줄을 끈다. 화면에는 여전히 "24시간 이내 결제" 안내/기한
-- 표시는 그대로 두되(프론트엔드 변경 없음), 실제로 서버가 그 기한을 넘겼다고
-- 자동취소시키지는 않기로 결정 - 함수(public.cancel_expired_payment_applications)
-- 자체는 남겨둔다(필요해지면 다시 스케줄만 걸면 되고, 관리자가 수동으로
-- 정리하고 싶을 때 SQL로 직접 호출할 수도 있게).
do $$
begin
  if exists (
    select 1 from pg_namespace where nspname = 'cron'
  ) then
    if exists (
      select 1
      from cron.job
      where jobname = 'time2meet-cancel-expired-payment-applications'
    ) then
      perform cron.unschedule('time2meet-cancel-expired-payment-applications');
    end if;
  end if;
exception
  when undefined_table then
    null;
  when undefined_function then
    null;
  when insufficient_privilege then
    null;
end $$;
