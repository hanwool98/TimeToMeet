-- 자리 유도 대기 화면이 폴링으로 부르는 read-only RPC. 태블릿은 admin 세션이
-- 없으므로(연결 토큰만 보유) event_tablets에 저장된 connection_token_hash로
-- "이 기기가 정말 이 테이블의 연결된 태블릿인지"부터 검증한 뒤, 아직 아무
-- 데이터도 없는 event_table_assignments(관리자 좌석배정 기능은 이후 과제)를
-- 조회해 남/여 닉네임을 돌려준다. 폴링 김에 last_seen_at도 함께 갱신해서
-- 별도 하트비트 호출 없이 "연결 유지" 신호도 겸한다.
--
-- 참고: 이 프로젝트의 admin 전용 테이블(RLS의 is_admin()은 Supabase Auth의
-- auth.uid() 기반인데 이 앱은 Supabase Auth를 쓰지 않아 항상 false)은 무엇을
-- 구독하든 Realtime이 실제로 이벤트를 전달하지 못한다. 그래서 이 화면은
-- Realtime 대신 짧은 polling으로 최신 좌석 배정을 반영한다.
create or replace function public.get_event_table_seat_guide(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns table (ok boolean, male_nickname text, female_nickname text, round_number integer)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target public.event_tablets%rowtype;
  assignment public.event_table_assignments%rowtype;
begin
  select et.* into target
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::text, null::text, null::integer;
    return;
  end if;

  update public.event_tablets et
  set last_seen_at = now(), updated_at = now()
  where et.id = target.id;

  select eta.* into assignment
  from public.event_table_assignments eta
  where eta.event_id = event_id_value and eta.table_number = table_number_value
  order by eta.round_number asc nulls first
  limit 1;

  return query
  select
    true,
    (select a.nickname from public.applications a where a.id = assignment.male_application_id),
    (select a.nickname from public.applications a where a.id = assignment.female_application_id),
    assignment.round_number;
end;
$$;

grant execute on function public.get_event_table_seat_guide(text, integer, text) to anon, authenticated;
