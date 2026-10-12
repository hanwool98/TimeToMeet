-- [타임투밋 관리자 참가자 관리 개선 2건 - 2. 참가확정 참가자 "행사 이동"]
--
-- 설계 근거(투자된 분석 요약, 상세 보고는 대화로 전달):
--   - applications.event_id는 events(id) ON DELETE RESTRICT 단순 FK라
--     UPDATE 자체는 막혀있지 않지만, applications에는
--     assign_event_application_no_before_insert 트리거(BEFORE INSERT만
--     동작)가 있어 UPDATE로 event_id만 바꾸면 application_no/
--     application_sequence가 "원래 행사" 번호 그대로 남는다 - 새 행사
--     기준 번호로 재발급해야 한다(기존 next_event_application_no 재사용).
--   - application_tickets의 PK는 application_id 그 자체(1:1) - 다른 어떤
--     테이블도 application_tickets를 FK로 참조하지 않으므로 삭제 후
--     재생성보다 그 자리에서 UPDATE하는 편이 더 안전하다. qr_token도
--     함께 새로 발급해 "새 티켓" 성격을 분명히 한다.
--   - round_ratings/final_selections/final_selection_submissions/
--     heart_notes/heart_note_matches/event_table_assignments/
--     event_preround_seats/event_profile_cards/event_participant_snapshots/
--     event_pause_requests/event_reviews/bonus_keyword_missions/
--     bonus_matching_baseline_ratings 중 하나라도 이 application_id로 된
--     행이 있으면 "행사 진행 데이터가 있다"로 보고 이동 자체를 금지한다
--     (체크인 여부만으로 판단하지 않고 개별 테이블 존재를 직접 재확인 -
--     체크인 플래그만 믿는 것보다 더 안전).
--   - payment_invitations/application_review_logs/meta_lead_dispatches/
--     participant_profiles는 event_id 컬럼이 없거나(payment_invitations)
--     애초에 event 범위와 분리된 기록이라 손대지 않는다(그대로 유지).
--   - 결제금액(payment_amount)/계좌정보/결제완료 시각 등은 전혀 건드리지
--     않는다 - 타깃 행사 가격으로 덮어쓰지 않는다(요청 명시 사항).
--   - 대상 행사는 삭제되지 않고(get_admin_event_summaries와 동일하게
--     deleted_at is null), 종료되지 않고(ended_at is null), **아직
--     시작되지 않은**(started_at is null) 행사만 허용한다 - "행사 시작 전
--     참가자 이동"이라는 요청 전제를 타깃 쪽에도 대칭적으로 적용한
--     설계 판단(원 행사도 started_at is null을 추가로 요구).
--   - 동일 참가자가 타깃 행사에 이미 신청한 기록이 있는지는 user_id
--     기준으로 판단한다(이 시스템에서 "같은 사람"을 식별하는 기존 방식과
--     동일).
--   - 성별 정원 검증은 기존 update_application_review_for_session의
--     패턴(결제 대기/결제중/입금 확인 중/참가 확정을 "자리 차지"로 보는
--     분류, events 행 for update로 동시 이동/승인 직렬화)을 그대로
--     재사용한다.

-- 관리자가 "이동 가능한 행사" 목록을 고를 때 쓰는 가벼운 전용 RPC.
-- 기존 get_admin_event_summaries는 이미 여러 화면이 쓰고 있어 반환
-- 컬럼을 건드리지 않고, 이 용도만을 위한 새 함수를 추가한다.
create or replace function public.get_admin_movable_events_for_session(session_token text)
 returns table(
   id text,
   title text,
   short_name text,
   event_date date,
   start_time time without time zone,
   location text,
   male_capacity integer,
   female_capacity integer,
   male_confirmed integer,
   female_confirmed integer
 )
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    e.id, e.title, e.short_name, e.event_date, e.start_time, e.location,
    e.male_capacity, e.female_capacity,
    count(a.id) filter (where a.gender = '남성' and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정'))::integer,
    count(a.id) filter (where a.gender = '여성' and a.status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정'))::integer
  from public.events e
  left join public.applications a on a.event_id = e.id
  where e.deleted_at is null
    and e.ended_at is null
    and e.started_at is null
  group by e.id
  order by e.event_date, e.start_time;
end;
$$;

grant execute on function public.get_admin_movable_events_for_session(text) to anon, authenticated;

create or replace function public.move_participant_to_event_for_admin_session(
  session_token text,
  p_application_id uuid,
  target_event_id text
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  admin_user_id uuid;
  target_application public.applications%rowtype;
  source_event public.events%rowtype;
  target_event public.events%rowtype;
  target_capacity integer;
  occupied_count integer;
  new_application_no text;
  new_application_sequence integer;
  blocking_reason text;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  select s.user_id
  into admin_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role = 'admin';

  select *
  into target_application
  from public.applications
  where id = p_application_id
  for update;

  if target_application.id is null then
    raise exception '신청 정보를 찾을 수 없습니다.';
  end if;

  if target_application.status <> '참가 확정' then
    raise exception '참가확정 상태의 참가자만 다른 행사로 이동할 수 있습니다.';
  end if;

  if target_application.checked_in_at is not null then
    raise exception '이미 체크인한 참가자는 이동할 수 없습니다.';
  end if;

  if target_application.attendance_status <> 'active' then
    raise exception '현재 참가 상태(%)에서는 이동할 수 없습니다.', target_application.attendance_status;
  end if;

  if target_event_id = target_application.event_id then
    raise exception '현재 참가 중인 행사와 동일합니다.';
  end if;

  select * into source_event from public.events where id = target_application.event_id;
  if source_event.started_at is not null then
    raise exception '이미 시작된 행사의 참가자는 이동할 수 없습니다.';
  end if;

  -- 행사 진행 데이터가 조금이라도 있으면 이동 금지. 체크인 플래그만
  -- 믿지 않고 실제 진행 테이블들을 직접 다시 확인한다.
  select case
    when exists (select 1 from public.event_preround_seats where male_application_id = target_application.id or female_application_id = target_application.id) then '사전 좌석 배정'
    when exists (select 1 from public.event_table_assignments where male_application_id = target_application.id or female_application_id = target_application.id) then '테이블 배정'
    when exists (select 1 from public.round_ratings where rater_application_id = target_application.id or ratee_application_id = target_application.id) then '라운드 호감도 평가'
    when exists (select 1 from public.final_selections where selector_application_id = target_application.id or selected_application_id = target_application.id) then '최종 선택'
    when exists (select 1 from public.final_selection_submissions where participant_id = target_application.id) then '최종 선택 제출'
    when exists (select 1 from public.heart_notes where sender_application_id = target_application.id or target_application_id = target_application.id) then '마음 한 줄'
    when exists (select 1 from public.heart_note_matches where participant_a_id = target_application.id or participant_b_id = target_application.id) then '마음 한 줄 매칭'
    when exists (select 1 from public.event_reviews where application_id = target_application.id) then '후기'
    when exists (select 1 from public.event_profile_cards where application_id = target_application.id) then '행사용 프로필 카드'
    when exists (select 1 from public.event_participant_snapshots where application_id = target_application.id) then '참가자 스냅샷'
    when exists (select 1 from public.event_pause_requests where requested_by_application_id = target_application.id) then '진행 일시정지 요청'
    when exists (select 1 from public.bonus_keyword_missions where participant_application_id = target_application.id or opponent_application_id = target_application.id) then '추가대화 키워드 미션'
    when exists (select 1 from public.bonus_matching_baseline_ratings where rater_application_id = target_application.id or ratee_application_id = target_application.id) then '추가매칭 기준 평가'
    else null
  end into blocking_reason;

  if blocking_reason is not null then
    raise exception '이미 행사 진행 데이터(%)가 있어 이동할 수 없습니다.', blocking_reason;
  end if;

  select * into target_event from public.events where id = target_event_id for update;
  if target_event.id is null then
    raise exception '대상 행사를 찾을 수 없습니다.';
  end if;

  if target_event.deleted_at is not null then
    raise exception '삭제된 행사로는 이동할 수 없습니다.';
  end if;

  if target_event.ended_at is not null then
    raise exception '종료된 행사로는 이동할 수 없습니다.';
  end if;

  if target_event.started_at is not null then
    raise exception '이미 시작된 행사로는 이동할 수 없습니다.';
  end if;

  if exists (
    select 1 from public.applications
    where event_id = target_event_id
      and user_id = target_application.user_id
  ) then
    raise exception '해당 참가자는 대상 행사에 이미 신청한 기록이 있습니다.';
  end if;

  target_capacity := case when target_application.gender = '남성' then target_event.male_capacity else target_event.female_capacity end;

  select count(*)
  into occupied_count
  from public.applications
  where event_id = target_event_id
    and gender = target_application.gender
    and status in ('결제 대기', '결제중', '입금 확인 중', '참가 확정');

  if target_capacity is not null and occupied_count >= target_capacity then
    raise exception '% 정원이 모두 찼습니다 (%/%)', target_application.gender, occupied_count, target_capacity;
  end if;

  select n.application_no, n.application_sequence
  into new_application_no, new_application_sequence
  from public.next_event_application_no(target_event_id) n;

  update public.applications
  set
    event_id = target_event_id,
    application_no = new_application_no,
    application_sequence = new_application_sequence,
    updated_at = now()
  where id = p_application_id;

  insert into public.application_tickets (application_id, user_id, event_id)
  values (target_application.id, target_application.user_id, target_event_id)
  on conflict (application_id) do update set
    event_id = excluded.event_id,
    qr_token = encode(extensions.gen_random_bytes(32), 'hex'),
    issued_at = now(),
    revoked_at = null,
    checked_in_at = null,
    checked_in_by = null,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'applicationId', target_application.id,
    'fromEventId', target_application.event_id,
    'toEventId', target_event_id,
    'applicationNo', new_application_no
  );
end;
$$;

grant execute on function public.move_participant_to_event_for_admin_session(text, uuid, text) to anon, authenticated;
