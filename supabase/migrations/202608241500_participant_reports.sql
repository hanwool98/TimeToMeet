-- 참가자 신고 기능. event_pause_requests(운영자 호출/일시정지 요청)와 같은
-- 구조/권한 패턴을 그대로 따른다 - 별개 기능이라 테이블도 별개로 둔다.
create table if not exists public.participant_reports (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  reporter_application_id uuid not null,
  reporter_nickname text not null default '참가자',
  reported_application_id uuid not null,
  reported_nickname text not null default '참가자',
  round_number integer,
  table_number integer,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists participant_reports_event_id_idx on public.participant_reports (event_id);

alter table public.participant_reports enable row level security;
drop policy if exists "Admins can manage participant reports" on public.participant_reports;
create policy "Admins can manage participant reports" on public.participant_reports
  for all using (public.is_admin()) with check (public.is_admin());

-- 실제로 이 행사에서 만난 적이 있는 상대만 신고 가능하게 해서(round/table은
-- 그 만남 기록에서 그대로 스냅샷) 임의 참가자를 신고 대상으로 지정하는 것을
-- 막는다. 가장 최근에 만난 라운드를 신고 시점 컨텍스트로 사용.
create or replace function public.create_participant_report(
  session_token text,
  event_id_value text,
  reported_application_id_value uuid,
  reason_value text
)
returns text
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  reported_application public.applications%rowtype;
  assignment public.event_table_assignments%rowtype;
  clean_reason text;
  new_id uuid;
begin
  clean_reason := nullif(trim(coalesce(reason_value, '')), '');
  if clean_reason is null then
    raise exception '신고 사유를 입력해주세요.';
  end if;
  if char_length(clean_reason) > 200 then
    raise exception '신고 사유는 200자 이내로 작성해주세요.';
  end if;

  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정';

  if not found then
    raise exception '참가 확정 상태의 신청 정보를 찾을 수 없습니다.';
  end if;

  select * into reported_application
  from public.applications a
  where a.id = reported_application_id_value and a.event_id = event_id_value;

  if not found then
    raise exception '신고 대상을 찾을 수 없습니다.';
  end if;

  select * into assignment
  from public.event_table_assignments eta
  where eta.event_id = event_id_value
    and ((eta.male_application_id = target_application.id and eta.female_application_id = reported_application_id_value)
      or (eta.female_application_id = target_application.id and eta.male_application_id = reported_application_id_value))
  order by eta.round_number desc
  limit 1;

  if not found then
    raise exception '함께 대화한 적이 없는 참가자입니다.';
  end if;

  insert into public.participant_reports (
    event_id, reporter_application_id, reporter_nickname, reported_application_id, reported_nickname,
    round_number, table_number, reason
  ) values (
    event_id_value, target_application.id, target_application.nickname, reported_application.id, reported_application.nickname,
    assignment.round_number, assignment.table_number, clean_reason
  ) returning id into new_id;

  return new_id::text;
end;
$$;

grant execute on function public.create_participant_report(text, text, uuid, text) to anon, authenticated;

create or replace function public.get_admin_participant_reports(session_token text, event_id_value text)
returns table (
  id uuid,
  reporter_nickname text,
  reported_nickname text,
  round_number integer,
  table_number integer,
  reason text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select pr.id, pr.reporter_nickname, pr.reported_nickname, pr.round_number, pr.table_number, pr.reason, pr.status, pr.created_at, pr.resolved_at
  from public.participant_reports pr
  where pr.event_id = event_id_value
  order by pr.created_at desc;
end;
$$;

grant execute on function public.get_admin_participant_reports(text, text) to anon, authenticated;

create or replace function public.update_participant_report_status_for_session(session_token text, report_id_value uuid, status_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if status_value not in ('pending', 'resolved') then
    raise exception '올바르지 않은 처리 상태입니다.';
  end if;

  update public.participant_reports
  set status = status_value, resolved_at = case when status_value = 'resolved' then now() else null end
  where id = report_id_value;
end;
$$;

grant execute on function public.update_participant_report_status_for_session(text, uuid, text) to anon, authenticated;

-- 운영자 행사 진행 화면의 벨(요청) 아이콘 옆에 신고 뱃지를 상시 표시하려면
-- pendingPauseCount처럼 매 poll마다 오는 값이 필요하다 - 여기에 얹는다.
-- serverNow도 함께 유지한다(직전 세션에서 이미 추가된 필드로, 이 함수를
-- 다시 CREATE OR REPLACE하면서 빠뜨리면 그 필드가 사라져버리기 때문).
create or replace function public.get_admin_round_progress(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  target_progress public.event_progress%rowtype;
  total_rounds integer;
  total_participants integer;
  active_tables integer;
  completed_rounds integer;
  pending_pause_count integer;
  pending_report_count integer;
  matches jsonb;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_event from public.events where id = event_id_value;
  if not found then
    raise exception '행사를 찾을 수 없습니다.';
  end if;

  select * into target_progress from public.event_progress where event_id = event_id_value;
  if not found then
    raise exception '행사 진행 상태가 없습니다.';
  end if;

  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  select count(*) into total_participants
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null;

  select count(distinct eta.table_number) into active_tables
  from public.event_table_assignments eta
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

  completed_rounds := case
    when target_progress.stage = 'round_complete' then total_rounds
    when coalesce(target_progress.current_round, 1) > total_rounds then total_rounds
    else greatest(0, coalesce(target_progress.current_round, 1) - 1)
  end;

  select count(*) into pending_pause_count
  from public.event_pause_requests
  where event_id = event_id_value and status = 'pending';

  select count(*) into pending_report_count
  from public.participant_reports
  where event_id = event_id_value and status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'tableNumber', eta.table_number,
    'maleApplicationId', eta.male_application_id,
    'maleNickname', ma.nickname,
    'femaleApplicationId', eta.female_application_id,
    'femaleNickname', fa.nickname
  ) order by eta.table_number), '[]'::jsonb)
  into matches
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value and eta.round_number = coalesce(target_progress.current_round, 1);

  return jsonb_build_object(
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'totalParticipants', total_participants,
    'activeTables', active_tables,
    'completedRounds', completed_rounds,
    'pendingPauseCount', pending_pause_count,
    'pendingReportCount', pending_report_count,
    'matches', matches,
    'conversationDurationSeconds', coalesce(target_event.conversation_duration_seconds, 600),
    'isBonusRound', coalesce(target_progress.is_bonus_round, false),
    'bonusRoundIndex', case when coalesce(target_progress.current_round, 0) > total_rounds then target_progress.current_round - total_rounds else null end,
    'bonusRoundCount', coalesce(target_event.bonus_round_count, 0),
    'serverNow', now()
  );
end;
$$;

grant execute on function public.get_admin_round_progress(text, text) to anon, authenticated;
