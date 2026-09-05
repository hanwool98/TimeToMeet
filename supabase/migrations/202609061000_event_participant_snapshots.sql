-- 과거 행사 데이터 영속성: 게스트 계정 정리(cleanup-expired-guest-accounts)가
-- applications의 닉네임/직업/사진을 익명화하면서, 참가자 리스트/미리보기/
-- 후기관리/최종선택 화면이 전부 applications를 그때그때 다시 join해서
-- 보여주는 구조라 "삭제된 프로필"로 깨지는 문제가 있었다(실제 체험단 1기
-- 전원 발생 확인). 계정/세션/민감정보 삭제(applications 익명화 포함)와
-- "행사에서 서로에게 보여졌던 표시정보 보존"을 분리한다.
--
-- event_id + application_id 단위(한 사람이 여러 행사에 참가했을 수 있어
-- global profile snapshot이 아니다). 대표사진은 경로만 가리키는 게 아니라
-- Edge Function이 별도 Storage object로 실제 복사한 뒤 그 경로를 저장한다
-- (원본이 나중에 cleanup으로 삭제돼도 안전).
create table if not exists public.event_participant_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  nickname text not null default '',
  age integer,
  job text not null default '',
  gender text,
  photo_path text,
  photo_crop jsonb,
  photo_source text,
  created_at timestamptz not null default now(),
  unique (event_id, application_id)
);

alter table public.event_participant_snapshots enable row level security;

drop policy if exists "No direct event participant snapshot access" on public.event_participant_snapshots;
create policy "No direct event participant snapshot access" on public.event_participant_snapshots
  for all using (false);

-- 정리 대상 계정의 applications 중, 실제로 체크인해서 행사에 참가한 기록이
-- 있고 아직 snapshot이 없는 것만 골라 반환한다(체크인 안 한 신청은 프로필
-- 카드/평가/후기/최종선택 어느 것도 만들 수 없는 구조라 보존할 표시정보가
-- 없다). event_profile_cards의 행사 전용 사진이 있으면 그걸, 없으면 기본
-- 대표사진을 candidate로 제시한다 - 실제 복사는 Storage 접근이 되는
-- Edge Function이 한다(RPC는 Storage를 직접 건드릴 수 없다).
create or replace function public.get_snapshot_candidates_for_cleanup(target_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', a.event_id,
    'applicationId', a.id,
    'nickname', a.nickname,
    'age', case when a.birth_date is not null then
        extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer
      else null end,
    'job', a.job,
    'gender', a.gender,
    'sourcePhotoPath', coalesce(epc.photo_path, a.profile_photo_paths[coalesce(a.representative_photo_index, 0) + 1]),
    'sourceCrop', case when epc.photo_path is not null then epc.photo_crop else a.representative_crop end,
    'photoSource', case
      when epc.photo_path is not null then 'event_profile_card'
      when a.profile_photo_paths[coalesce(a.representative_photo_index, 0) + 1] is not null then 'default_profile'
      else null
    end
  )), '[]'::jsonb)
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.event_profile_cards epc on epc.event_id = a.event_id and epc.application_id = a.id
  where a.user_id = target_user_id
    and a.checked_in_at is not null
    and not exists (
      select 1 from public.event_participant_snapshots eps
      where eps.event_id = a.event_id and eps.application_id = a.id
    );
$$;

revoke all on function public.get_snapshot_candidates_for_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.get_snapshot_candidates_for_cleanup(uuid) to service_role;

-- on conflict do nothing로 idempotent하게 만든다 - cron이 반복 실행되거나
-- 같은 대상을 두 번 처리해도 기존 snapshot을 덮어쓰지 않는다(이미 있으면
-- 그게 더 원본에 가까운 값일 수 있으므로 절대 최신 값으로 갱신하지 않음).
create or replace function public.save_event_participant_snapshot(
  event_id_value text,
  application_id_value uuid,
  nickname_value text,
  age_value integer,
  job_value text,
  gender_value text,
  photo_path_value text,
  photo_crop_value jsonb,
  photo_source_value text
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.event_participant_snapshots (
    event_id, application_id, nickname, age, job, gender, photo_path, photo_crop, photo_source
  )
  values (
    event_id_value, application_id_value, coalesce(nickname_value, ''), age_value, coalesce(job_value, ''),
    gender_value, photo_path_value, photo_crop_value, photo_source_value
  )
  on conflict (event_id, application_id) do nothing;
end;
$$;

revoke all on function public.save_event_participant_snapshot(text, uuid, text, integer, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_event_participant_snapshot(text, uuid, text, integer, text, text, text, jsonb, text) to service_role;

-- 참가자 리스트: snapshot이 있으면(=계정 정리로 applications가 이미
-- 익명화된 경우) 닉네임/직업/대표사진을 snapshot으로 대체한다. 반환
-- 컬럼 구성은 기존과 완전히 동일 - 이 함수를 쓰는 다른 화면에 영향 없다.
create or replace function public.get_admin_applications_for_session(session_token text)
returns table (id uuid, application_no text, event_id text, user_id uuid, user_display_id text, account_type text, is_returning boolean, status application_status, is_new boolean, name text, birth_date date, gender text, residence text, phone text, relationship_status text, id_photo_path text, nickname text, profile_photo_paths text[], representative_photo_index integer, representative_crop jsonb, voice_intro_path text, height text, job text, employment_proof_path text, access_route text, filming_consent boolean, interview_consent text, refund_agreement boolean, inquiry text, review_notice_confirmed boolean, payment_deadline timestamptz, payment_notice_sent_at timestamptz, deposit_requested_at timestamptz, deposit_failed_at timestamptz, deposit_failure_reason text, depositor_name text, payment_method text, refund_policy_confirmed boolean, refund_policy_confirmed_at timestamptz, transfer_guide_confirmed_at timestamptz, transfer_intent_confirmed boolean, payment_completed_at timestamptz, checked_in_at timestamptz, reviewed_at timestamptz, submitted_at timestamptz, event_date date, short_name text, attendance_status text, is_emergency_walkin boolean, is_test_participant boolean)
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    a.id,
    a.application_no,
    a.event_id,
    a.user_id,
    case
      when coalesce(ua.account_type, au.account_type, 'member') = 'guest' and ga.phone_normalized is not null then
        '비회원 ' || substring(ga.phone_normalized from char_length(ga.phone_normalized) - 7 for 4)
        || '-' ||
        substring(ga.phone_normalized from char_length(ga.phone_normalized) - 3 for 4)
      when ma.login_id is not null then ma.login_id
      else coalesce(nullif(eps.nickname, ''), a.nickname)
    end,
    coalesce(ua.account_type, au.account_type, 'member'),
    a.is_returning,
    a.status,
    a.is_new,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    a.phone,
    a.relationship_status,
    a.id_photo_path,
    coalesce(nullif(eps.nickname, ''), a.nickname),
    case when eps.photo_path is not null then array[eps.photo_path] else a.profile_photo_paths end,
    case when eps.photo_path is not null then 0 else a.representative_photo_index end,
    coalesce(eps.photo_crop, a.representative_crop),
    a.voice_intro_path,
    a.height,
    coalesce(nullif(eps.job, ''), a.job),
    a.employment_proof_path,
    a.access_route,
    a.filming_consent,
    a.interview_consent,
    a.refund_agreement,
    a.inquiry,
    a.review_notice_confirmed,
    a.payment_deadline,
    a.payment_notice_sent_at,
    a.deposit_requested_at,
    a.deposit_failed_at,
    a.deposit_failure_reason,
    a.depositor_name,
    a.payment_method,
    a.refund_policy_confirmed,
    a.refund_policy_confirmed_at,
    a.transfer_guide_confirmed_at,
    a.transfer_intent_confirmed,
    a.payment_completed_at,
    a.checked_in_at,
    a.reviewed_at,
    a.submitted_at,
    e.event_date,
    e.short_name,
    a.attendance_status,
    a.is_emergency_walkin,
    a.is_test_participant
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.user_accounts ua on ua.user_id = a.user_id
  left join public.app_users au on au.user_id = a.user_id
  left join public.guest_accounts ga on ga.user_id = a.user_id
  left join public.member_accounts ma on ma.user_id = a.user_id
  left join public.event_participant_snapshots eps on eps.event_id = a.event_id and eps.application_id = a.id;
end;
$function$;

-- 최종선택 결과: 본인/선택한 상대/서로선택 양쪽 전부 snapshot 닉네임을
-- 우선한다. age는 birth_date가 cleanup으로도 안 지워지는 컬럼이라 원래도
-- 안 깨졌지만, snapshot에 있으면 그쪽을 우선해 일관성을 맞춘다.
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
    'nickname', coalesce(nullif(eps.nickname, ''), ep.nickname),
    'gender', coalesce(eps.gender, ep.gender),
    'age', coalesce(eps.age, extract(year from age(target_event.event_date::timestamp, ep.birth_date::timestamp))::integer),
    'submittedAt', fss.submitted_at,
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
