-- 테스트 참가자(create_test_participants_for_session로 생성됨)는 phone=''
-- 계정이라 로그인 자체가 불가능하고, 최종선택을 스스로 제출할 방법이
-- 없다 - "테스트 행사 최종선택 결과가 안 보임"의 실제 원인은 조회 로직
-- 버그가 아니라 이 부분이었다(get_admin_final_selection_events/
-- get_admin_final_selection_results 자체엔 문제 없음, is_test_event 필터도
-- 없음을 확인함). create_test_participants_for_session과 동일한
-- admin+is_test_event 가드 패턴으로, 참가 확정 상태의 모든 참가자에 대해
-- 실제로 만난 상대 중 호감도 높은 순으로 최종선택 한도만큼 제출해준다.
-- 이미 (수동으로) 제출한 참가자는 건드리지 않는다.
create or replace function public.simulate_test_event_final_selections(session_token text, event_id_value text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  limit_value integer;
  rec record;
  simulated_count integer := 0;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if target_event.id is null then
    raise exception '행사를 찾을 수 없습니다.';
  end if;
  if not target_event.is_test_event then
    raise exception '테스트 행사에서만 사용할 수 있습니다.';
  end if;

  limit_value := coalesce(target_event.final_selection_limit, 3);

  for rec in
    select a.id as application_id
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.final_selection_submitted_at is null
  loop
    insert into public.final_selections (event_id, selector_application_id, selected_application_id)
    select event_id_value, rec.application_id, met.partner_id
    from (
      select
        case when eta.male_application_id = rec.application_id then eta.female_application_id else eta.male_application_id end as partner_id,
        rr.score
      from public.event_table_assignments eta
      left join public.round_ratings rr
        on rr.event_id = event_id_value
        and rr.rater_application_id = rec.application_id
        and rr.ratee_application_id = (case when eta.male_application_id = rec.application_id then eta.female_application_id else eta.male_application_id end)
      where eta.event_id = event_id_value
        and not eta.is_bonus
        and (eta.male_application_id = rec.application_id or eta.female_application_id = rec.application_id)
      order by rr.score desc nulls last, partner_id
      limit limit_value
    ) met
    on conflict (event_id, selector_application_id, selected_application_id) do nothing;

    update public.applications set final_selection_submitted_at = now() where id = rec.application_id;
    simulated_count := simulated_count + 1;
  end loop;

  return simulated_count;
end;
$$;

grant execute on function public.simulate_test_event_final_selections(text, text) to anon, authenticated;
