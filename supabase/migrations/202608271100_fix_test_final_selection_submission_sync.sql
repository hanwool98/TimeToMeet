-- simulate_test_event_final_selections는 final_selections는 정상 저장하면서도
-- final_selection_submissions에는 기록을 남기지 않아, 결과 화면
-- (get_admin_final_selection_results)이 참조하는 "제출 여부"가 어긋났다
-- (상호선택 계산은 final_selections를 직접 보므로 정상 - 오직 제출 여부
-- 표시만 어긋남). 레거시 applications.final_selection_submitted_at만 갱신하고
-- 신규 final_selection_submissions 테이블 insert가 누락된 것이 원인.
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
  submitted_time timestamptz;
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

    submitted_time := now();

    update public.applications set final_selection_submitted_at = submitted_time where id = rec.application_id;

    insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
    values (event_id_value, rec.application_id, submitted_time)
    on conflict (event_id, participant_id) do nothing;

    simulated_count := simulated_count + 1;
  end loop;

  return simulated_count;
end;
$$;

-- 이미 (버그가 있던 함수로) 자동제출되어 final_selection_submitted_at은
-- 있지만 final_selection_submissions에 누락된 기존 데이터를 복구한다.
-- 202608231900 마이그레이션의 최초 backfill과 동일한 idempotent insert.
insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
select a.event_id, a.id, a.final_selection_submitted_at
from public.applications a
where a.final_selection_submitted_at is not null
on conflict (event_id, participant_id) do nothing;

notify pgrst, 'reload schema';
