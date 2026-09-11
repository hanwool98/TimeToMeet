-- 행사 종료 흐름 개편: 최종선택 화면에 "마음 한 줄"(선택, 최종선택과는
-- 독립적인 데이터) 추가, 후기 1회 제출 후 잠금, 행사 종료 시 전원 최종선택
-- 제출 여부 강제, 참가자 결과 조회 RPC, 관리자 결과 화면에 받은 선택/매칭
-- 수 및 마음 한 줄 노출.

-- (1) 마음 한 줄 - final_selections(여러 명, 순위 없는 선택)와는 완전히
-- 다른 개념(정확히 한 명, 메시지 포함)이라 별도 테이블로 분리한다.
-- 참가자당 행사별 1건만 허용(unique). 메시지를 안 쓴 경우에도 "누구를
-- 다시 보고 싶어했는지"는 운영자에게 의미가 있어 message는 nullable로만
-- 두고 대상 선택 자체가 없으면(target_application_id 없음) 아예 행을
-- 만들지 않는다. RLS는 같은 종류의 기존 테이블(final_selections,
-- final_selection_submissions)과 동일하게 is_admin() 전용 + RPC(security
-- definer)로만 참가자가 접근하게 한다.
create table if not exists public.heart_notes (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  sender_application_id uuid not null references public.applications(id) on delete cascade,
  target_application_id uuid not null references public.applications(id) on delete cascade,
  message text,
  created_at timestamptz not null default now(),
  unique (event_id, sender_application_id)
);

create index if not exists heart_notes_event_id_idx on public.heart_notes (event_id);

alter table public.heart_notes enable row level security;
drop policy if exists "Admins can manage heart notes" on public.heart_notes;
create policy "Admins can manage heart notes" on public.heart_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- (2) 최종선택 제출에 "마음 한 줄"을 선택적으로 함께 싣는다 - 한 번의
-- 제출 액션으로 두 데이터를 각자의 테이블에 나눠 저장하되(서로 다른
-- 기능이라는 점 유지), 최종선택 대상과 마음 한 줄 대상은 완전히 독립
-- (같아도 되고 달라도 됨). 기존 검증 로직은 전부 그대로 유지한다.
-- 파라미터 2개 추가라 시그니처가 바뀌므로 create or replace만으로는 기존
-- 3-인자 함수를 대체하지 못하고 오버로드가 생겨버린다 - 먼저 drop한다.
drop function if exists public.submit_final_selection(text, text, uuid[]);

create or replace function public.submit_final_selection(
  session_token text,
  event_id_value text,
  selected_application_ids uuid[],
  heart_note_target_id uuid default null,
  heart_note_message text default null
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
  clean_heart_note_message text;
  heart_note_target_valid boolean;
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
      and ((eta.male_application_id = target_application.id and eta.female_application_id = sel.id)
        or (eta.female_application_id = target_application.id and eta.male_application_id = sel.id))
  );

  if valid_count <> submitted_count then
    raise exception '유효하지 않은 선택 대상이 포함되어 있습니다.';
  end if;

  -- 마음 한 줄은 완전히 선택사항 - target이 없으면 검증/저장 전부 건너뛴다.
  if heart_note_target_id is not null then
    if heart_note_target_id = target_application.id then
      raise exception '본인에게는 마음 한 줄을 보낼 수 없습니다.';
    end if;

    select exists (
      select 1 from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and ((eta.male_application_id = target_application.id and eta.female_application_id = heart_note_target_id)
          or (eta.female_application_id = target_application.id and eta.male_application_id = heart_note_target_id))
    ) into heart_note_target_valid;

    if not heart_note_target_valid then
      raise exception '유효하지 않은 마음 한 줄 대상입니다.';
    end if;

    clean_heart_note_message := nullif(trim(coalesce(heart_note_message, '')), '');
    if clean_heart_note_message is not null and char_length(clean_heart_note_message) > 200 then
      raise exception '마음 한 줄은 200자 이내로 작성해주세요.';
    end if;
  end if;

  insert into public.final_selections (event_id, selector_application_id, selected_application_id)
  select event_id_value, target_application.id, sel
  from unnest(coalesce(selected_application_ids, '{}'::uuid[])) as sel
  on conflict (event_id, selector_application_id, selected_application_id) do nothing;

  insert into public.final_selection_submissions (event_id, participant_id, submitted_at)
  values (event_id_value, target_application.id, submitted_time);

  update public.applications
  set final_selection_submitted_at = submitted_time
  where id = target_application.id;

  if heart_note_target_id is not null then
    insert into public.heart_notes (event_id, sender_application_id, target_application_id, message, created_at)
    values (event_id_value, target_application.id, heart_note_target_id, clean_heart_note_message, submitted_time)
    on conflict (event_id, sender_application_id) do nothing;
  end if;
end;
$$;

grant execute on function public.submit_final_selection(text, text, uuid[], uuid, text) to anon, authenticated;

-- (3) 후기는 1회 제출 후 잠금 - upsert(on conflict do update)였던 것을
-- insert-only로 바꾼다. 이미 행이 있으면(=이미 제출) 그 자리에서 바로
-- 막고, 동시 이중 제출 레이스에 대비해 on conflict do nothing 이후에도
-- 실제로 삽입됐는지(result_submitted_at is null 여부) 다시 확인한다.
create or replace function public.save_event_review_for_session(
  session_token text,
  event_id_value text,
  content_value text,
  image_paths_value text[] default '{}'::text[],
  rating_value integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  clean_content text;
  clean_image_paths text[];
  expected_prefix text;
  path_value text;
  result_submitted_at timestamptz;
  review_exists boolean;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
    and a.checked_in_at is not null
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '체크인된 참가자만 후기를 작성할 수 있습니다.';
  end if;

  select exists(
    select 1 from public.event_reviews
    where event_id = event_id_value and application_id = target_application.id
  ) into review_exists;

  if review_exists then
    raise exception '이미 후기를 제출했습니다. 후기는 한 번만 작성할 수 있어요.';
  end if;

  clean_content := trim(coalesce(content_value, ''));
  if clean_content = '' then
    raise exception '후기 내용을 입력해주세요.';
  end if;
  if char_length(clean_content) > 2000 then
    raise exception '후기는 2000자 이내로 작성해주세요.';
  end if;

  if rating_value is null or rating_value < 1 or rating_value > 5 then
    raise exception '별점을 선택해주세요.';
  end if;

  clean_image_paths := coalesce(image_paths_value, '{}');
  if array_length(clean_image_paths, 1) > 3 then
    raise exception '후기 이미지는 최대 3장까지 첨부할 수 있습니다.';
  end if;
  expected_prefix := 'event-reviews/' || public.sanitize_storage_id(event_id_value) || '/' || target_application.id::text || '/';
  foreach path_value in array clean_image_paths loop
    if left(path_value, char_length(expected_prefix)) <> expected_prefix then
      raise exception '본인이 업로드한 사진만 첨부할 수 있습니다.';
    end if;
  end loop;

  insert into public.event_reviews (event_id, application_id, content, image_paths, rating, submitted_at, updated_at)
  values (event_id_value, target_application.id, clean_content, clean_image_paths, rating_value, now(), now())
  on conflict (event_id, application_id) do nothing
  returning submitted_at into result_submitted_at;

  if result_submitted_at is null then
    raise exception '이미 후기를 제출했습니다. 후기는 한 번만 작성할 수 있어요.';
  end if;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at, 'removedImagePaths', '[]'::jsonb);
end;
$$;

grant execute on function public.save_event_review_for_session(text, text, text, text[], integer) to anon, authenticated;

-- (4) 행사 종료는 "전원 최종선택 제출 완료 + 운영자가 종료 버튼 클릭"
-- 두 조건을 모두 만족해야 한다 - 미제출자가 있으면 몇 명인지 알려주고
-- 종료 자체를 막는다. events.ended_at이 곧 "결과 확정" 단일 플래그가
-- 되므로(이 체크를 통과해야만 세팅됨) 별도의 "결과 확정" 테이블/컬럼을
-- 새로 만들 필요가 없다.
create or replace function public.end_admin_event_for_session(session_token text, event_id_value text)
returns timestamptz
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  result_ended_at timestamptz;
  total_participants integer;
  submitted_count integer;
  missing_count integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select count(*) into total_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정';

  select count(*) into submitted_count
  from public.final_selection_submissions fss
  where fss.event_id = event_id_value;

  missing_count := greatest(total_participants - submitted_count, 0);
  if missing_count > 0 then
    raise exception '최종선택을 완료하지 않은 참가자가 %명 있습니다.', missing_count;
  end if;

  update public.events
  set ended_at = coalesce(ended_at, now())
  where id = event_id_value
  returning ended_at into result_ended_at;

  update public.event_progress set stage = 'ended', updated_at = now() where event_id = event_id_value;

  return result_ended_at;
end;
$$;

grant execute on function public.end_admin_event_for_session(text, text) to anon, authenticated;

-- (5) 참가자 본인 결과 조회 - "행사 종료(ended_at) + 전원 제출"이 이미
-- end_admin_event_for_session에서 강제되므로 여기선 ended_at만 확인하면
-- 곧 두 조건이 모두 충족된 상태다. 본인 수치만 반환(다른 참가자 결과는
-- 절대 포함하지 않음).
create or replace function public.get_my_final_selection_outcome(session_token text, event_id_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  received_count integer;
  match_count integer;
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
  if not found or target_event.ended_at is null then
    return jsonb_build_object('ok', true, 'ready', false);
  end if;

  select count(*) into received_count
  from public.final_selections fs
  where fs.event_id = event_id_value and fs.selected_application_id = target_application.id;

  select count(*) into match_count
  from public.final_selections fs_out
  where fs_out.event_id = event_id_value
    and fs_out.selector_application_id = target_application.id
    and exists (
      select 1 from public.final_selections fs_in
      where fs_in.event_id = event_id_value
        and fs_in.selector_application_id = fs_out.selected_application_id
        and fs_in.selected_application_id = target_application.id
    );

  return jsonb_build_object(
    'ok', true,
    'ready', true,
    'receivedCount', received_count,
    'matchCount', match_count
  );
end;
$$;

grant execute on function public.get_my_final_selection_outcome(text, text) to anon, authenticated;

-- (6) 관리자 최종선택 결과 화면 확장 - 참가자별 받은 선택 수/매칭 수,
-- 그리고 전체 마음 한 줄(작성자/대상/메시지) 목록을 추가로 내려준다.
-- 기존 응답 구조(participants/mutualMatches/summary)는 그대로 유지하고
-- 필드만 덧붙인다.
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
  heart_notes jsonb;
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
    'nickname', coalesce(nullif(eps.nickname, ''), ep.nickname),
    'gender', coalesce(eps.gender, ep.gender),
    'age', coalesce(eps.age, extract(year from age(target_event.event_date::timestamp, ep.birth_date::timestamp))::integer),
    'submittedAt', fss.submitted_at,
    'receivedCount', coalesce((
      select count(*) from public.final_selections fs_recv
      where fs_recv.event_id = event_id_value and fs_recv.selected_application_id = ep.id
    ), 0),
    'matchCount', coalesce((
      select count(*) from public.final_selections fs_out
      where fs_out.event_id = event_id_value and fs_out.selector_application_id = ep.id
        and exists (
          select 1 from public.final_selections fs_in
          where fs_in.event_id = event_id_value
            and fs_in.selector_application_id = fs_out.selected_application_id
            and fs_in.selected_application_id = ep.id
        )
    ), 0),
    'selected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'applicationId', selected_person.id,
        'nickname', coalesce(nullif(sel_eps.nickname, ''), selected_person.nickname),
        'age', coalesce(sel_eps.age, extract(year from age(target_event.event_date::timestamp, selected_person.birth_date::timestamp))::integer)
      ) order by selected_person.nickname, selected_person.id)
      from public.final_selections fs
      join public.applications selected_person on selected_person.id = fs.selected_application_id
      left join public.event_participant_snapshots sel_eps
        on sel_eps.event_id = event_id_value and sel_eps.application_id = selected_person.id
      where fs.event_id = event_id_value and fs.selector_application_id = ep.id
    ), '[]'::jsonb)
  ) order by ep.gender, ep.nickname, ep.id), '[]'::jsonb)
  into participants
  from event_participants ep
  left join public.final_selection_submissions fss
    on fss.event_id = event_id_value and fss.participant_id = ep.id
  left join public.event_participant_snapshots eps
    on eps.event_id = event_id_value and eps.application_id = ep.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'left', jsonb_build_object(
      'applicationId', left_app.id,
      'nickname', coalesce(nullif(left_eps.nickname, ''), left_app.nickname),
      'age', coalesce(left_eps.age, extract(year from age(target_event.event_date::timestamp, left_app.birth_date::timestamp))::integer)
    ),
    'right', jsonb_build_object(
      'applicationId', right_app.id,
      'nickname', coalesce(nullif(right_eps.nickname, ''), right_app.nickname),
      'age', coalesce(right_eps.age, extract(year from age(target_event.event_date::timestamp, right_app.birth_date::timestamp))::integer)
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
  left join public.event_participant_snapshots left_eps on left_eps.event_id = fs.event_id and left_eps.application_id = left_app.id
  left join public.event_participant_snapshots right_eps on right_eps.event_id = fs.event_id and right_eps.application_id = right_app.id
  where fs.event_id = event_id_value
    and fs.selector_application_id::text < fs.selected_application_id::text;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', hn.id,
    'senderApplicationId', hn.sender_application_id,
    'senderNickname', coalesce(nullif(sender_eps.nickname, ''), sender_app.nickname),
    'targetApplicationId', hn.target_application_id,
    'targetNickname', coalesce(nullif(target_eps.nickname, ''), target_app.nickname),
    'message', hn.message,
    'createdAt', hn.created_at
  ) order by hn.created_at desc), '[]'::jsonb)
  into heart_notes
  from public.heart_notes hn
  join public.applications sender_app on sender_app.id = hn.sender_application_id
  join public.applications target_app on target_app.id = hn.target_application_id
  left join public.event_participant_snapshots sender_eps
    on sender_eps.event_id = event_id_value and sender_eps.application_id = hn.sender_application_id
  left join public.event_participant_snapshots target_eps
    on target_eps.event_id = event_id_value and target_eps.application_id = hn.target_application_id
  where hn.event_id = event_id_value;

  select count(*) into total_participants
  from public.applications a where a.event_id = event_id_value and a.status = '참가 확정';
  select count(*) into submitted_count
  from public.final_selection_submissions fss where fss.event_id = event_id_value;
  select count(*) into selection_count
  from public.final_selections fs where fs.event_id = event_id_value;

  return jsonb_build_object(
    'event', jsonb_build_object('id', target_event.id, 'title', target_event.title, 'eventDate', target_event.event_date, 'endedAt', target_event.ended_at),
    'summary', jsonb_build_object(
      'totalParticipants', total_participants,
      'submittedCount', submitted_count,
      'selectionCount', selection_count,
      'mutualMatchCount', jsonb_array_length(mutual_matches)
    ),
    'participants', participants,
    'mutualMatches', mutual_matches,
    'heartNotes', heart_notes
  );
end;
$$;

grant execute on function public.get_admin_final_selection_results(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
