-- 참가자용 참가자 리스트 공개 시점을 "행사 시작 7일 전"에서
-- "행사 시작 3일 전"으로 앞당긴다(요청 사항). 클라이언트의
-- src/utils/participantListGate.ts도 같은 커밋에서 3일로 함께 맞춘다 -
-- 서버는 실제 데이터 차단을, 클라이언트는 공개 전 안내 문구 표시 시점을
-- 담당하는 동일한 기준값이라 항상 같이 움직여야 한다(파일 상단 주석에
-- 명시된 기존 관례 그대로 유지). 반환 타입/시그니처는 그대로라
-- create or replace로 충분하다.
create or replace function public.get_public_participant_previews(target_event_id text, preview_token text default null)
returns table(id text, gender text, nickname text, age integer, job text, avatar_index integer)
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    a.id::text,
    a.gender,
    a.nickname,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer as age,
    a.job,
    (((row_number() over (partition by a.gender order by a.submitted_at asc, a.id asc)) - 1) % 6 + 1)::integer as avatar_index
  from public.applications a
  join public.events e on e.id = a.event_id
  where a.event_id = target_event_id
    and (e.is_test_event = false or public.is_test_event_preview_token_valid(target_event_id, preview_token))
    and a.status = '참가 확정'
    and (
      public.is_test_event_preview_token_valid(target_event_id, preview_token)
      or now() >= ((e.event_date + e.start_time) at time zone 'Asia/Seoul') - interval '3 days'
    )
  order by a.gender, a.submitted_at asc, a.id asc;
$$;

grant execute on function public.get_public_participant_previews(text, text) to anon, authenticated;

create or replace function public.event_participant_list_public_at(event_id_value text)
returns timestamptz
language sql
stable
security definer
set search_path = 'public'
as $$
  select ((e.event_date + e.start_time) at time zone 'Asia/Seoul') - interval '3 days'
  from public.events e
  where e.id = event_id_value;
$$;

grant execute on function public.event_participant_list_public_at(text) to anon, authenticated;

notify pgrst, 'reload schema';
