-- 긴급 수정: 직전 마이그레이션(202608301500)에서 get_final_selection_
-- candidates를 다시 작성하면서 응답 필드 3개를 실수로 빠뜨렸다 -
-- 'finalSelectionLimit'(행사별 설정값), 'submitted'(제출 여부)가 누락됐고
-- 'selectedApplicationIds'를 'selectedIds'로 잘못 썼다. 프론트엔드
-- (fetchFinalSelectionCandidates)는 이 필드들이 없으면 각각 하드코딩된
-- fallback(3명, 미제출, 빈 배열)을 쓰도록 방어적으로 짜여 있어서 예외는
-- 안 났지만, 실제 행사에서 2명으로 설정해도 화면엔 항상 "최대 3명"으로
-- 보이고, 이미 제출한 사람도 계속 "미제출" 상태로 보였다.
create or replace function public.get_final_selection_candidates(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  candidates jsonb;
  selected_ids jsonb;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_event from public.events where id = event_id_value;

  with met as (
    select distinct
      case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_id
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id)
  ),
  scored as (
    select
      met.partner_id,
      pa.nickname,
      extract(year from age(target_event.event_date::timestamp, pa.birth_date::timestamp))::integer as age,
      pa.job,
      rr.score,
      rr.memo,
      rr.hashtags,
      rank() over (order by rr.score desc nulls last, met.partner_id asc) as rnk
    from met
    join public.applications pa on pa.id = met.partner_id
    left join public.round_ratings rr
      on rr.event_id = event_id_value
      and rr.rater_application_id = target_application.id
      and rr.ratee_application_id = met.partner_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationId', partner_id,
    'nickname', nickname,
    'age', age,
    'job', job,
    'score', score,
    'memo', memo,
    'hashtags', hashtags,
    'rank', case when score is not null then rnk end
  ) order by score desc nulls last, partner_id), '[]'::jsonb)
  into candidates
  from scored;

  select coalesce(jsonb_agg(fs.selected_application_id), '[]'::jsonb)
  into selected_ids
  from public.final_selections fs
  where fs.event_id = event_id_value and fs.selector_application_id = target_application.id;

  return jsonb_build_object(
    'ok', true,
    'finalSelectionLimit', coalesce(target_event.final_selection_limit, 3),
    'submitted', target_application.final_selection_submitted_at is not null,
    'selectedApplicationIds', selected_ids,
    'candidates', candidates
  );
end;
$$;
