-- 실제 사고: end_admin_event_for_session이 "전원 최종선택 제출 완료"를
-- 확인할 때 '참가 확정' 상태의 신청 전부를 분모로 삼았다. 그런데 그
-- 분모에는 승인은 됐지만 실제로 체크인조차 하지 않은(=행사에 아예
-- 안 나온) 사람도 포함된다 - 이런 사람은 테이블 배정도, 만난 상대도
-- 없어 최종선택을 제출할 수 있는 방법 자체가 없으므로 missing_count가
-- 절대 0이 될 수 없고, "행사 종료" 버튼이 영구히 막히는 문제가 있었다.
-- (이번에 실제로 이 문제로 종료가 막힌 것을 확인 - 참가 확정 16명 중
-- 1명이 체크인을 아예 안 해 최종선택 제출자가 나머지 15명뿐이었는데도
-- missing_count=1로 계속 막혔다.)
--
-- "전원 제출 완료"의 분모를 실제로 체크인해 행사에 참여한 사람으로
-- 좁힌다 - 이 프로젝트 전반에서 "실제 참가자"를 가리킬 때 이미 쓰고
-- 있는 checked_in_at is not null 기준(예: generate_bonus_round_assignments)
-- 과 동일하게 맞춘다. 그 외 로직(전원 미제출 시 종료 차단, ended_at/stage
-- 세팅)은 전혀 바꾸지 않았다.
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
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null;

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

notify pgrst, 'reload schema';
