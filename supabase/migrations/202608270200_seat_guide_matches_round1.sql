-- 자리유도(get_event_table_seat_guide_by_roster)가 신청번호(application_no)
-- 순서로 테이블을 계산하던 것을, 실제 1라운드 배정
-- (generate_round_schedule_if_missing)과 완전히 동일한 기준
-- (체크인 시각 순번, 체크인 완료 + 참가중 상태만 대상)으로 맞춘다.
-- 두 계산 방식이 서로 다르면 자리유도 화면이 안내한 테이블과 실제
-- 1라운드 테이블이 어긋날 수 있었다(체크인 순서가 신청번호 순서와 다를
-- 때마다 발생). generate_round_schedule_if_missing 자체는 건드리지
-- 않으므로 라운드 로테이션(여성 고정/남성 이동)과 지각 참가자 합류
-- 로직은 그대로 유지된다.
create or replace function public.get_event_table_seat_guide_by_roster(event_id_value text, table_number_value integer, connection_token text)
 returns table(ok boolean, male_nickname text, female_nickname text, male_checked_in boolean, female_checked_in boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  target public.event_tablets%rowtype;
  male_app record;
  female_app record;
begin
  select et.* into target
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return query select false, null::text, null::text, null::boolean, null::boolean;
    return;
  end if;

  update public.event_tablets et
  set last_seen_at = now(), updated_at = now()
  where et.id = target.id;

  select a.nickname
  into male_app
  from public.applications a
  where a.event_id = event_id_value and a.gender = '남성' and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active'
  order by a.checked_in_at asc nulls last, a.id asc
  offset greatest(0, table_number_value - 1) limit 1;

  select a.nickname
  into female_app
  from public.applications a
  where a.event_id = event_id_value and a.gender = '여성' and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active'
  order by a.checked_in_at asc nulls last, a.id asc
  offset greatest(0, table_number_value - 1) limit 1;

  return query
  select
    true,
    male_app.nickname,
    female_app.nickname,
    male_app.nickname is not null,
    female_app.nickname is not null;
end;
$function$;
