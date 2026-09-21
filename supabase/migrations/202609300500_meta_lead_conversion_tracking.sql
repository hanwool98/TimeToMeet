-- Meta Conversions API(Lead) 발송 상태를 별도 테이블로 추적한다.
--
-- 처음 구현에서는 applications.meta_lead_sent_at 하나만 두고 "Meta 호출
-- 직전에 원자적으로 선점"하는 방식이었는데, 그러면 선점 직후 Meta 호출이
-- 실패했을 때 그 신청은 영원히 재시도되지 않는 문제가 있었다(사용자 지적).
-- "성공했다는 확정"과 "몇 번 시도했는지"를 분리해야 한다:
--   - sent_at: Meta가 실제로 2xx로 응답했을 때만 채워진다. 이게 null인 동안만
--     재시도 대상이다 - 실패해도 절대 여기가 채워지지 않으므로 유실되지 않는다.
--   - permanently_failed_at: 재시도해도 해결되지 않는 실패(잘못된 토큰,
--     잘못된 payload 등 4xx - 429 제외)로 판단되면 채워진다. 이후 다시는
--     재시도 대상이 되지 않는다(무의미한 반복 호출 방지 - 사용자 지적).
--   - attempt_count: 시도할 때마다(성공/실패 무관) 올라간다. 재시도 상한과
--     동시 중복 실행 방지에만 쓴다.
-- 재전송 시 원래 요청과 최대한 동일한 이벤트를 다시 보낼 수 있도록,
-- 신청 시점의 일시적 컨텍스트(fbp/fbc/event_source_url/client_ip/user_agent)도
-- 여기 같이 저장해둔다(브라우저 쿠키/요청 헤더라 신청서 자체 컬럼이 아니라
-- 이 테이블에만 존재). created_at은 이 행이 처음 만들어진 시각(=실제 신청
-- 완료 시각)을 그대로 담아, 재시도할 때도 이 값 기준의 event_time을 계속
-- 써서 Meta에 "재시도한 시각"이 아니라 "실제 전환이 일어난 시각"이
-- 보고되게 한다(사용자 지적 - submit-application/retry-failed-meta-lead
-- -events 양쪽 다 created_at을 event_time으로 쓴다).
create table if not exists public.meta_lead_dispatches (
  application_id uuid primary key references public.applications(id) on delete cascade,
  fbp text,
  fbc text,
  event_source_url text,
  client_ip text,
  client_user_agent text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  permanently_failed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 서비스 역할(Edge Function)만 접근한다. RLS를 켜고 정책을 하나도 안 두면
-- anon/authenticated는 자동으로 전부 차단되지만(Postgres 기본 동작), 이
-- 프로젝트의 다른 서버 전용 테이블(event_participant_snapshots 등)처럼
-- "일부러 막아둔 것"임을 명시적인 정책으로 남겨 나중에 실수로 정책을
-- 추가했다가 노출되는 일을 줄인다. client_ip/fbp/fbc/user_agent는 개인정보에
-- 준해 다루는 값이라 일반 클라이언트(anon/authenticated) 조회를 원천 차단한다.
alter table public.meta_lead_dispatches enable row level security;

create policy "No direct meta lead dispatch access" on public.meta_lead_dispatches
for all to public using (false);

-- 재시도 크론이 한 행을 원자적으로 "선점"하기 위한 RPC. Supabase JS의
-- .update()는 "attempt_count = attempt_count + 1" 같은 SQL 표현식을 직접
-- 못 쓰므로(클라이언트에서 읽은 값을 다시 써넣는 read-modify-write가 되어
-- 경쟁 상태가 생김), DB 함수 안에서 단일 update문으로 원자적으로 처리한다.
-- 두 크론 실행이 겹치거나 같은 행을 동시에 집어도 이 update는 딱 한 번만
-- 성공한다(반환된 boolean이 true인 실행만 실제로 Meta에 전송을 시도한다).
-- permanently_failed_at이 채워진 행은 영구 실패로 확정된 것이라 여기서도
-- 다시는 선점되지 않는다.
create or replace function public.claim_meta_lead_dispatch_retry(
  target_application_id uuid,
  max_attempts integer,
  min_retry_interval_seconds integer
)
returns boolean
language sql
security definer
set search_path = 'public'
as $$
  with claimed as (
    update public.meta_lead_dispatches
    set attempt_count = attempt_count + 1,
        last_attempt_at = now()
    where application_id = target_application_id
      and sent_at is null
      and permanently_failed_at is null
      and attempt_count < max_attempts
      and (last_attempt_at is null or last_attempt_at < now() - (min_retry_interval_seconds || ' seconds')::interval)
    returning application_id
  )
  select exists(select 1 from claimed);
$$;

revoke all on function public.claim_meta_lead_dispatch_retry(uuid, integer, integer) from public;
grant execute on function public.claim_meta_lead_dispatch_retry(uuid, integer, integer) to service_role;

-- 15분마다 "아직 확정 전송 못 한" 건을 재시도하고, 다 끝난(성공했거나 영구
-- 실패한) 오래된 건은 개인정보성 필드(fbp/fbc/client_ip/client_user_agent)를
-- 지우는 크론 - 기존 time2meet-cleanup-expired-guest-accounts와 완전히
-- 동일한 패턴(pg_cron + pg_net + Vault에 저장된 secret을 헤더로 붙여 Edge
-- Function 호출)을 재사용한다. Vault secret(meta_lead_retry_secret)과 Edge
-- Function secret(META_LEAD_RETRY_SECRET)은 같은 값으로 사용자가 별도로
-- 설정해야 한다(guest_cleanup_secret/GUEST_CLEANUP_SECRET과 동일한 방식).
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'time2meet-retry-failed-meta-lead-events') then
      perform cron.unschedule('time2meet-retry-failed-meta-lead-events');
    end if;

    perform cron.schedule(
      'time2meet-retry-failed-meta-lead-events',
      '*/15 * * * *',
      $cron$
      select net.http_post(
        url := 'https://ebefbyekzygybvtxylwa.supabase.co/functions/v1/retry-failed-meta-lead-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', 'sb_publishable_-Fh_CaFgh24e7-xjeJWbHQ_72Vo-4h9',
          'Authorization', 'Bearer sb_publishable_-Fh_CaFgh24e7-xjeJWbHQ_72Vo-4h9',
          'x-retry-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_lead_retry_secret')
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
