-- claim_event_for_purge는 이미 30분 stale-claim이면 재선점을 허용하므로
-- purge_claimed_at 자체 때문에 행사가 영구히 갇히지는 않는다. 다만 지금
-- 구조로는 같은 행사가 반복해서 실패하고 있어도(예: Storage 권한 문제 등
-- 지속적인 원인) 관리자가 알 방법이 전혀 없었다 - '삭제된 행사' 목록에는
-- 그냥 계속 "복구 불가" 상태로만 보인다. 시도 횟수/마지막 오류를 기록해서
-- 관리자 화면에 노출할 수 있게 한다(자동 복구는 여전히 막되, 문제가
-- 있다는 사실만은 보이게 함).
alter table public.events
  add column if not exists purge_attempt_count integer not null default 0,
  add column if not exists purge_last_attempt_at timestamptz,
  add column if not exists purge_last_error text;

comment on column public.events.purge_attempt_count is '영구 삭제 cron이 이 행사를 claim(시도)한 총 횟수.';
comment on column public.events.purge_last_error is '가장 최근 영구 삭제 시도가 실패한 이유(성공하면 행이 삭제되므로 이 값을 볼 일이 없음 - 값이 남아있다는 것 자체가 "아직 실패 중"이라는 신호).';

create or replace function public.claim_event_for_purge(event_id_value text)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $$
  update public.events
  set purge_claimed_at = now(),
      purge_attempt_count = purge_attempt_count + 1,
      purge_last_attempt_at = now()
  where id = event_id_value
    and deleted_at is not null
    and scheduled_purge_at is not null
    and scheduled_purge_at <= now()
    and (purge_claimed_at is null or purge_claimed_at < now() - interval '30 minutes')
  returning true;
$$;

revoke all on function public.claim_event_for_purge(text) from public, anon, authenticated;
grant execute on function public.claim_event_for_purge(text) to service_role;

-- 관리자 '삭제된 행사' 목록에도 반복 실패 여부를 노출한다.
drop function if exists public.get_admin_deleted_event_summaries(text);

create function public.get_admin_deleted_event_summaries(session_token text)
 returns table(
   id text, title text, event_date date, start_time time without time zone,
   is_test_event boolean, deleted_at timestamp with time zone, scheduled_purge_at timestamp with time zone,
   purge_attempt_count integer, purge_last_error text
 )
 language plpgsql
 stable security definer
 set search_path to 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select e.id, e.title, e.event_date, e.start_time, e.is_test_event, e.deleted_at, e.scheduled_purge_at,
    e.purge_attempt_count, e.purge_last_error
  from public.events e
  where e.deleted_at is not null
  order by e.deleted_at desc;
end;
$$;

grant execute on function public.get_admin_deleted_event_summaries(text) to anon, authenticated;
