-- 결과화면 "받은 마음 한 줄" 수락/거절 + 그로 인한 추가 최종매칭.
--
-- 조사 결과 확인한 사실:
--   - 최종매칭은 현재 별도 테이블 없이 "final_selections에 양방향 선택이
--     모두 존재하는지"를 그때그때 계산해서 보여준다
--     (get_my_final_selection_outcome, get_admin_final_selection_results
--     둘 다 동일한 방식) - 이 계산 로직 자체는 이번에 건드리지 않는다.
--   - heart_notes(event_id, sender_application_id, target_application_id,
--     message, created_at)는 이미 존재하지만 지금까지는 관리자만 볼 수
--     있고(RLS: is_admin()만 접근) 참가자 응답 개념이 전혀 없었다.
--     UNIQUE(event_id, sender_application_id)로 "발신 1명 제한"이 이미
--     걸려 있다 - 이 제약은 그대로 둔다.
--
-- 설계:
--   1) heart_notes에 response(null/accepted/rejected) + responded_at만
--      추가한다 - 응답 상태와 최종매칭 성사 여부는 별개 개념(8번 요건)
--      이므로 이 컬럼이 매칭을 직접 만들지 않는다.
--   2) 새 테이블 heart_note_matches(event_id, participant_a_id,
--      participant_b_id)를 만들어 "마음 한 줄 수락으로 성사된 커플"만
--      담는다. participant_a_id < participant_b_id를 CHECK로 강제해
--      canonical pair를 DB 구조로 보장하고, UNIQUE(event_id, a, b)로
--      같은 커플이 두 번 생기는 것을 DB 레벨에서 원천 차단한다. 수락
--      RPC는 이 테이블에 INSERT ... ON CONFLICT DO NOTHING만 사용해
--      "동시에 서로 수락"/"중복 클릭" 모두 UNIQUE 위반 없이 idempotent
--      하게 처리되게 한다.
--   3) 기존 final_selections 기반 상호매칭 계산과 heart_note_matches를
--      "표시 시점에 UNION"해서 합친다 - final_selections 자체나 그
--      계산 로직은 한 글자도 바꾸지 않고, 최종적으로 보여주는 매칭
--      개수/목록에만 두 출처를 합쳐서(canonical pair 기준 distinct)
--      반영한다. 이렇게 하면 "이미 같은 상대와 다른 경로로 매칭돼
--      있어도 인원 수가 중복 증가하지 않는다"가 자동으로 보장된다.

alter table public.heart_notes add column if not exists response text;
alter table public.heart_notes add column if not exists responded_at timestamptz;
alter table public.heart_notes drop constraint if exists heart_notes_response_check;
alter table public.heart_notes add constraint heart_notes_response_check
  check (response is null or response in ('accepted', 'rejected'));

create table if not exists public.heart_note_matches (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  participant_a_id uuid not null references public.applications(id) on delete cascade,
  participant_b_id uuid not null references public.applications(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint heart_note_matches_canonical_pair check (participant_a_id < participant_b_id),
  constraint heart_note_matches_unique_pair unique (event_id, participant_a_id, participant_b_id)
);

create index if not exists heart_note_matches_event_id_idx on public.heart_note_matches (event_id);

alter table public.heart_note_matches enable row level security;
drop policy if exists "Admins can manage heart note matches" on public.heart_note_matches;
create policy "Admins can manage heart note matches" on public.heart_note_matches
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- 참가자: 본인이 받은 마음 한 줄 목록 조회.
-- ============================================================
create or replace function public.get_my_received_heart_notes_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_event public.events%rowtype;
  notes jsonb;
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
    return jsonb_build_object('ok', true, 'ready', false, 'notes', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', hn.id,
    'senderNickname', coalesce(nullif(eps.nickname, ''), sender_app.nickname),
    'message', hn.message,
    'response', hn.response,
    'createdAt', hn.created_at
  ) order by hn.created_at desc), '[]'::jsonb)
  into notes
  from public.heart_notes hn
  join public.applications sender_app on sender_app.id = hn.sender_application_id
  left join public.event_participant_snapshots eps
    on eps.event_id = event_id_value and eps.application_id = hn.sender_application_id
  where hn.event_id = event_id_value and hn.target_application_id = target_application.id;

  return jsonb_build_object('ok', true, 'ready', true, 'notes', notes);
end;
$function$;

grant execute on function public.get_my_received_heart_notes_for_session(text, text) to anon, authenticated;

-- ============================================================
-- 참가자: 받은 마음 한 줄 수락 - 하나의 트랜잭션 안에서 세션 확인 →
-- 본인 수신 확인 → 기응답 여부 확인 → response 저장 → canonical pair
-- 계산 → atomic upsert까지 전부 처리한다(중간 실패 상태 없음).
-- ============================================================
create or replace function public.accept_heart_note_for_session(session_token text, heart_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  note public.heart_notes%rowtype;
  recipient_user_id uuid;
  target_event public.events%rowtype;
  pair_a uuid;
  pair_b uuid;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  -- 같은 마음 한 줄에 대한 동시/중복 호출을 이 행 잠금으로 직렬화한다 -
  -- 두 번째 이후 호출은 아래에서 response가 이미 채워진 것을 보고
  -- update 없이 그대로 통과한다(11번 요건 - 중복 클릭 안전).
  select * into note from public.heart_notes where id = heart_note_id for update;
  if not found then
    raise exception '마음 한 줄을 찾을 수 없습니다.';
  end if;

  select a.user_id into recipient_user_id from public.applications a where a.id = note.target_application_id;
  if recipient_user_id is null or recipient_user_id is distinct from session_user_id then
    raise exception '본인이 받은 마음 한 줄만 처리할 수 있습니다.';
  end if;

  -- get_my_final_selection_outcome과 동일한 "결과 공개" 조건
  -- (events.ended_at is not null) 이전에는 수락 자체를 막는다 - 프론트
  -- 화면이 숨겨져 있다는 사실에 기대지 않고 서버에서 직접 검증한다.
  select * into target_event from public.events where id = note.event_id;
  if not found or target_event.ended_at is null then
    raise exception '아직 결과를 확인할 수 없습니다.';
  end if;

  if note.response is null then
    update public.heart_notes
    set response = 'accepted', responded_at = now()
    where id = heart_note_id;
    note.response := 'accepted';
  end if;
  -- 이미 'rejected'로 응답된 마음 한 줄은 되돌리지 않는다 - 한 번 정해진
  -- 응답은 반대 방향 호출로 번복되지 않는다(9번 요건과 동일한 원칙).

  if note.response = 'accepted' then
    pair_a := least(note.sender_application_id, note.target_application_id);
    pair_b := greatest(note.sender_application_id, note.target_application_id);

    -- 이미 같은 커플이 있으면(다른 마음 한 줄의 수락, 또는 동시에 들어온
    -- 반대 방향 수락) 아무 것도 하지 않는다 - UNIQUE 위반이 아니라
    -- 조용히 no-op되므로 두 요청 모두 성공으로 끝난다(3/4/5번 요건).
    insert into public.heart_note_matches (event_id, participant_a_id, participant_b_id)
    values (note.event_id, pair_a, pair_b)
    on conflict (event_id, participant_a_id, participant_b_id) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'response', note.response, 'matched', note.response = 'accepted');
end;
$function$;

grant execute on function public.accept_heart_note_for_session(text, uuid) to anon, authenticated;

-- ============================================================
-- 참가자: 받은 마음 한 줄 거절 - 응답만 기록하고 매칭에는 전혀 관여하지
-- 않는다(8번 요건). 이미 다른 경로로 성사된 매칭이 있어도 그대로 둔다.
-- ============================================================
create or replace function public.reject_heart_note_for_session(session_token text, heart_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  session_user_id uuid;
  note public.heart_notes%rowtype;
  recipient_user_id uuid;
  target_event public.events%rowtype;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select * into note from public.heart_notes where id = heart_note_id for update;
  if not found then
    raise exception '마음 한 줄을 찾을 수 없습니다.';
  end if;

  select a.user_id into recipient_user_id from public.applications a where a.id = note.target_application_id;
  if recipient_user_id is null or recipient_user_id is distinct from session_user_id then
    raise exception '본인이 받은 마음 한 줄만 처리할 수 있습니다.';
  end if;

  select * into target_event from public.events where id = note.event_id;
  if not found or target_event.ended_at is null then
    raise exception '아직 결과를 확인할 수 없습니다.';
  end if;

  if note.response is null then
    update public.heart_notes
    set response = 'rejected', responded_at = now()
    where id = heart_note_id;
    note.response := 'rejected';
  end if;
  -- 이미 'accepted'였다면(이미 매칭이 생성됐을 수 있음) 그대로 둔다 -
  -- 거절 호출이 기존 매칭을 삭제하지 않는다.

  return jsonb_build_object('ok', true, 'response', note.response);
end;
$function$;

grant execute on function public.reject_heart_note_for_session(text, uuid) to anon, authenticated;

-- ============================================================
-- 참가자용 결과 RPC: matchCount만 heart_note_matches를 합쳐 계산하도록
-- 확장(시그니처 동일 - create or replace라 기존 grant 그대로 유지).
-- receivedCount/ready 판정/세션 검증 등 나머지는 전혀 손대지 않았다.
-- ============================================================
create or replace function public.get_my_final_selection_outcome(session_token text, event_id_value text)
returns jsonb
language plpgsql
stable security definer
set search_path = 'public'
as $function$
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

  -- 기존 final_selections 상호매칭 + heart_note_matches를 canonical
  -- 상대 id 기준으로 union(distinct)해 "몇 명과 매칭됐는지"를 센다 -
  -- 같은 상대가 두 출처 모두에 있어도 union이 자동으로 한 번만 센다
  -- (6번 요건).
  select count(*) into match_count
  from (
    select fs_out.selected_application_id as other_id
    from public.final_selections fs_out
    where fs_out.event_id = event_id_value
      and fs_out.selector_application_id = target_application.id
      and exists (
        select 1 from public.final_selections fs_in
        where fs_in.event_id = event_id_value
          and fs_in.selector_application_id = fs_out.selected_application_id
          and fs_in.selected_application_id = target_application.id
      )
    union
    select case when hnm.participant_a_id = target_application.id then hnm.participant_b_id else hnm.participant_a_id end
    from public.heart_note_matches hnm
    where hnm.event_id = event_id_value
      and (hnm.participant_a_id = target_application.id or hnm.participant_b_id = target_application.id)
  ) combined;

  return jsonb_build_object(
    'ok', true,
    'ready', true,
    'receivedCount', received_count,
    'matchCount', match_count
  );
end;
$function$;

-- ============================================================
-- 관리자 결과 RPC: "서로 선택한 참가자" 목록/개수와 참가자별 matchCount에
-- heart_note_matches를 합친다. participants/heartNotes 조회 로직의
-- 나머지 부분과 selectionCount 등은 그대로 둔다. heartNotes 목록에는
-- response 상태만 추가로 내려준다(운영자가 처리 현황을 볼 수 있도록).
-- ============================================================
create or replace function public.get_admin_final_selection_results(session_token text, event_id_value text)
returns jsonb
language plpgsql
stable security definer
set search_path = 'public'
as $function$
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
      select count(*) from (
        select fs_out.selected_application_id as other_id
        from public.final_selections fs_out
        where fs_out.event_id = event_id_value and fs_out.selector_application_id = ep.id
          and exists (
            select 1 from public.final_selections fs_in
            where fs_in.event_id = event_id_value
              and fs_in.selector_application_id = fs_out.selected_application_id
              and fs_in.selected_application_id = ep.id
          )
        union
        select case when hnm.participant_a_id = ep.id then hnm.participant_b_id else hnm.participant_a_id end
        from public.heart_note_matches hnm
        where hnm.event_id = event_id_value and (hnm.participant_a_id = ep.id or hnm.participant_b_id = ep.id)
      ) combined
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

  with all_pairs as (
    select least(fs.selector_application_id, fs.selected_application_id) as a_id,
           greatest(fs.selector_application_id, fs.selected_application_id) as b_id
    from public.final_selections fs
    join public.final_selections reverse_fs
      on reverse_fs.event_id = fs.event_id
      and reverse_fs.selector_application_id = fs.selected_application_id
      and reverse_fs.selected_application_id = fs.selector_application_id
    where fs.event_id = event_id_value
      and fs.selector_application_id::text < fs.selected_application_id::text
    union
    select hnm.participant_a_id, hnm.participant_b_id
    from public.heart_note_matches hnm
    where hnm.event_id = event_id_value
  )
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
  from all_pairs ap
  join public.applications left_app on left_app.id = ap.a_id
  join public.applications right_app on right_app.id = ap.b_id
  left join public.event_participant_snapshots left_eps on left_eps.event_id = event_id_value and left_eps.application_id = left_app.id
  left join public.event_participant_snapshots right_eps on right_eps.event_id = event_id_value and right_eps.application_id = right_app.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', hn.id,
    'senderApplicationId', hn.sender_application_id,
    'senderNickname', coalesce(nullif(sender_eps.nickname, ''), sender_app.nickname),
    'targetApplicationId', hn.target_application_id,
    'targetNickname', coalesce(nullif(target_eps.nickname, ''), target_app.nickname),
    'message', hn.message,
    'response', hn.response,
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
$function$;
