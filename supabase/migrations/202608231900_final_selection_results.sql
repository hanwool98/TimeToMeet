-- Final selections are unordered choices. Submission state is stored
-- separately so submitting an empty selection is distinguishable from not
-- submitting at all.
create table if not exists public.final_selection_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.applications(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique (event_id, participant_id)
);

create index if not exists final_selection_submissions_event_id_idx
  on public.final_selection_submissions (event_id, submitted_at);

alter table public.final_selection_submissions enable row level security;
drop policy if exists "Admins can manage final selection submissions" on public.final_selection_submissions;
create policy "Admins can manage final selection submissions" on public.final_selection_submissions
  for all using (public.is_admin()) with check (public.is_admin());

-- Preserve submissions made before the dedicated table existed.
insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
select a.event_id, a.id, a.final_selection_submitted_at
from public.applications a
where a.final_selection_submitted_at is not null
on conflict (event_id, participant_id) do nothing;

-- Candidate order may still use rating score as a convenience, but no rank
-- or selection order is returned or stored.
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
  ), candidates_with_notes as (
    select
      met.partner_id,
      pa.nickname,
      extract(year from age(target_event.event_date::timestamp, pa.birth_date::timestamp))::integer as age,
      pa.job,
      rr.score,
      rr.memo
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
    'memo', memo
  ) order by score desc nulls last, partner_id), '[]'::jsonb)
  into candidates
  from candidates_with_notes;

  select coalesce(jsonb_agg(fs.selected_application_id), '[]'::jsonb)
  into selected_ids
  from public.final_selections fs
  where fs.event_id = event_id_value and fs.selector_application_id = target_application.id;

  return jsonb_build_object(
    'ok', true,
    'finalSelectionLimit', coalesce(target_event.final_selection_limit, 3),
    'submitted', exists (
      select 1 from public.final_selection_submissions fss
      where fss.event_id = event_id_value and fss.participant_id = target_application.id
    ),
    'selectedApplicationIds', selected_ids,
    'candidates', candidates
  );
end;
$$;

grant execute on function public.get_final_selection_candidates(text, text) to anon, authenticated;

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
  submitted_time timestamptz := now();
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
  limit 1
  for update;

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  if exists (
    select 1 from public.final_selection_submissions fss
    where fss.event_id = event_id_value and fss.participant_id = target_application.id
  ) then
    raise exception '이미 최종 선택을 제출했습니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  submitted_count := coalesce(array_length(selected_application_ids, 1), 0);

  select count(distinct x) into distinct_count
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as x;
  if distinct_count <> submitted_count then
    raise exception '선택 목록에 중복된 참가자가 있습니다.';
  end if;

  if submitted_count > coalesce(target_event.final_selection_limit, 3) then
    raise exception '최대 선택 가능 인원을 초과했습니다.';
  end if;

  select count(*) into valid_count
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel(id)
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
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel
  on conflict (event_id, selector_application_id, selected_application_id) do nothing;

  insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
  values (event_id_value, target_application.id, submitted_time);

  -- Keep the legacy timestamp synchronized for older deployed clients. New
  -- code reads the dedicated submissions table.
  update public.applications
  set final_selection_submitted_at = submitted_time
  where id = target_application.id;
end;
$$;

grant execute on function public.submit_final_selection(text, text, uuid[]) to anon, authenticated;

create or replace function public.get_admin_final_selection_events(session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  result jsonb;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', e.id,
    'title', e.title,
    'eventDate', e.event_date,
    'totalParticipants', coalesce(stats.total_participants, 0),
    'submittedCount', coalesce(stats.submitted_count, 0),
    'selectionCount', coalesce(stats.selection_count, 0),
    'mutualMatchCount', coalesce(stats.mutual_match_count, 0)
  ) order by e.event_date desc, e.start_time desc), '[]'::jsonb)
  into result
  from public.events e
  left join lateral (
    select
      (select count(*) from public.applications a where a.event_id = e.id and a.status = '참가 확정')::integer as total_participants,
      (select count(*) from public.final_selection_submissions fss where fss.event_id = e.id)::integer as submitted_count,
      (select count(*) from public.final_selections fs where fs.event_id = e.id)::integer as selection_count,
      (select count(*) from public.final_selections fs
        where fs.event_id = e.id
          and fs.selector_application_id::text < fs.selected_application_id::text
          and exists (
            select 1 from public.final_selections reverse_fs
            where reverse_fs.event_id = fs.event_id
              and reverse_fs.selector_application_id = fs.selected_application_id
              and reverse_fs.selected_application_id = fs.selector_application_id
          ))::integer as mutual_match_count
  ) stats on true
  where exists (select 1 from public.applications a where a.event_id = e.id)
     or exists (select 1 from public.final_selection_submissions fss where fss.event_id = e.id);

  return result;
end;
$$;

grant execute on function public.get_admin_final_selection_events(text) to anon, authenticated;

create or replace function public.get_admin_final_selection_results(session_token text, event_id_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  participants jsonb;
  mutual_matches jsonb;
  total_participants integer;
  submitted_count integer;
  selection_count integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  with event_participants as (
    select a.*
    from public.applications a
    where a.event_id = event_id_value
      and (
        a.status = '참가 확정'
        or exists (select 1 from public.final_selection_submissions fss where fss.participant_id = a.id and fss.event_id = event_id_value)
        or exists (select 1 from public.final_selections fs where fs.event_id = event_id_value and (fs.selector_application_id = a.id or fs.selected_application_id = a.id))
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationId', ep.id,
    'nickname', ep.nickname,
    'gender', ep.gender,
    'age', extract(year from age(target_event.event_date::timestamp, ep.birth_date::timestamp))::integer,
    'submittedAt', fss.submitted_at,
    'selected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'applicationId', selected_person.id,
        'nickname', selected_person.nickname,
        'age', extract(year from age(target_event.event_date::timestamp, selected_person.birth_date::timestamp))::integer
      ) order by selected_person.nickname, selected_person.id)
      from public.final_selections fs
      join public.applications selected_person on selected_person.id = fs.selected_application_id
      where fs.event_id = event_id_value and fs.selector_application_id = ep.id
    ), '[]'::jsonb)
  ) order by ep.gender, ep.nickname, ep.id), '[]'::jsonb)
  into participants
  from event_participants ep
  left join public.final_selection_submissions fss
    on fss.event_id = event_id_value and fss.participant_id = ep.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'left', jsonb_build_object(
      'applicationId', left_app.id,
      'nickname', left_app.nickname,
      'age', extract(year from age(target_event.event_date::timestamp, left_app.birth_date::timestamp))::integer
    ),
    'right', jsonb_build_object(
      'applicationId', right_app.id,
      'nickname', right_app.nickname,
      'age', extract(year from age(target_event.event_date::timestamp, right_app.birth_date::timestamp))::integer
    )
  ) order by left_app.nickname, right_app.nickname), '[]'::jsonb)
  into mutual_matches
  from public.final_selections fs
  join public.final_selections reverse_fs
    on reverse_fs.event_id = fs.event_id
    and reverse_fs.selector_application_id = fs.selected_application_id
    and reverse_fs.selected_application_id = fs.selector_application_id
  join public.applications left_app on left_app.id = fs.selector_application_id
  join public.applications right_app on right_app.id = fs.selected_application_id
  where fs.event_id = event_id_value
    and fs.selector_application_id::text < fs.selected_application_id::text;

  select count(*) into total_participants
  from public.applications a where a.event_id = event_id_value and a.status = '참가 확정';
  select count(*) into submitted_count
  from public.final_selection_submissions fss where fss.event_id = event_id_value;
  select count(*) into selection_count
  from public.final_selections fs where fs.event_id = event_id_value;

  return jsonb_build_object(
    'event', jsonb_build_object('id', target_event.id, 'title', target_event.title, 'eventDate', target_event.event_date),
    'summary', jsonb_build_object(
      'totalParticipants', total_participants,
      'submittedCount', submitted_count,
      'selectionCount', selection_count,
      'mutualMatchCount', jsonb_array_length(mutual_matches)
    ),
    'participants', participants,
    'mutualMatches', mutual_matches
  );
end;
$$;

grant execute on function public.get_admin_final_selection_results(text, text) to anon, authenticated;

-- Test reset already deletes applications and therefore cascades into both
-- final-selection tables. Reload PostgREST after adding the new RPCs.
notify pgrst, 'reload schema';
