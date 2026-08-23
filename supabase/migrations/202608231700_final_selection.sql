-- 최종 선택: 정규(+추가시간) 라운드에서 실제로 만난 상대 중 최대
-- final_selection_limit명까지 고르는 마지막 phase. 서로 선택이 일치하는
-- 경우에만 이후 매칭 결과로 쓸 수 있도록 원시 선택 데이터를 그대로
-- 저장한다(한쪽만 선택한 경우가 상대에게 노출되지 않도록, 이번 작업에서는
-- 결과 화면 자체를 만들지 않는다 - 데이터 구조만 준비).
create table if not exists public.final_selections (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  selector_application_id uuid not null references public.applications(id) on delete cascade,
  selected_application_id uuid not null references public.applications(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, selector_application_id, selected_application_id)
);

create index if not exists final_selections_event_id_idx on public.final_selections (event_id);
create index if not exists final_selections_selected_idx on public.final_selections (event_id, selected_application_id);

alter table public.final_selections enable row level security;
drop policy if exists "Admins can manage final selections" on public.final_selections;
create policy "Admins can manage final selections" on public.final_selections
  for all using (public.is_admin()) with check (public.is_admin());

-- 제출 여부의 server-truth. 0명을 선택해도 "제출은 했음"을 구분해야 하므로
-- final_selections 행 개수가 아니라 이 컬럼으로 제출 완료를 판단한다.
alter table public.applications add column if not exists final_selection_submitted_at timestamptz;

-- 선택 화면(2번)에 필요한 후보 목록: 이 참가자가 정규 라운드에서 실제로
-- 만난 상대만(event_table_assignments, is_bonus=false) 대상으로 하고, 각
-- 상대에 대해 현재 저장되어 있는 최신 round_ratings 점수/메모를 그대로
-- 붙인다 - 정규 라운드 최초 점수가 아니라 추가시간에서 수정됐다면 그
-- 수정된 값이 자동으로 반영된다(별도의 "보너스 rating 찾기" 로직 불필요,
-- submit_bonus_round_rating이 애초에 같은 행을 upsert하기 때문).
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
      and not eta.is_bonus
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

grant execute on function public.get_final_selection_candidates(text, text) to anon, authenticated;

-- 제출은 한 번만 허용(서버가 이미 제출했는지 직접 확인 - 클라이언트
-- 상태나 라우팅만으로는 재제출/수정을 막을 수 없음). 선택 대상도 클라이언트
-- 입력을 그대로 믿지 않고 실제로 이 참가자와 정규 라운드에서 만난 사람인지
-- 서버가 다시 검증한다.
create or replace function public.submit_final_selection(
  session_token text,
  event_id_value text,
  selected_application_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  submitted_count integer;
  valid_count integer;
  distinct_count integer;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  if target_application.final_selection_submitted_at is not null then
    raise exception '이미 최종 선택을 제출했습니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  submitted_count := coalesce(array_length(selected_application_ids, 1), 0);

  select count(distinct x) into distinct_count from unnest(coalesce(selected_application_ids, '{}')) as x;
  if distinct_count <> submitted_count then
    raise exception '선택 목록에 중복된 참가자가 있습니다.';
  end if;

  if submitted_count > coalesce(target_event.final_selection_limit, 3) then
    raise exception '최대 선택 가능 인원을 초과했습니다.';
  end if;

  select count(*) into valid_count
  from unnest(coalesce(selected_application_ids, '{}')) as sel(id)
  where exists (
    select 1 from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and not eta.is_bonus
      and ((eta.male_application_id = target_application.id and eta.female_application_id = sel.id)
        or (eta.female_application_id = target_application.id and eta.male_application_id = sel.id))
  );

  if valid_count <> submitted_count then
    raise exception '유효하지 않은 선택 대상이 포함되어 있습니다.';
  end if;

  insert into public.final_selections (event_id, selector_application_id, selected_application_id)
  select event_id_value, target_application.id, sel
  from unnest(coalesce(selected_application_ids, '{}')) as sel;

  update public.applications set final_selection_submitted_at = now() where id = target_application.id;
end;
$$;

grant execute on function public.submit_final_selection(text, text, uuid[]) to anon, authenticated;
