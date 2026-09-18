-- 버그: 게스트 계정 정리(cleanup-expired-guest-accounts)가 체크인한 참가자의
-- 닉네임/나이/직업/대표사진을 지우기 전에 event_participant_snapshots에
-- 먼저 영구 보존해두는데(202609061000_event_participant_snapshots.sql),
-- 정작 공개 참가자 리스트(get_public_participant_previews)는 이 스냅샷을
-- 전혀 읽지 않고 매번 applications 테이블의 "현재" 값만 봤다. 그래서 정리가
-- 끝난 지난 행사는 참가자 리스트가 전부 "삭제된 프로필"로만 보이는 문제가
-- 있었다(지난 행사 참가자 소개는 계속 보여준다는 원래 설계 의도가 실제
-- 코드에는 반영되지 않았던 것 - 실제 개인정보(전화번호 등)는 계속 지워진
-- 채로 두고, 닉네임/나이/직업만 스냅샷에서 보충한다).
--
-- age는 birth_date 기준으로 계산하는데 익명화 후에도 birth_date 자체는
-- 안 지워지므로(실측 확인) 그대로 두고, nickname/job만 익명화 마커
-- ('삭제된 프로필' / 빈 문자열)일 때 스냅샷 값으로 대체한다.
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
    coalesce(nullif(a.nickname, '삭제된 프로필'), s.nickname, a.nickname) as nickname,
    extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer as age,
    coalesce(nullif(a.job, ''), s.job, a.job) as job,
    (((row_number() over (partition by a.gender order by a.submitted_at asc, a.id asc)) - 1) % 6 + 1)::integer as avatar_index
  from public.applications a
  join public.events e on e.id = a.event_id
  left join public.event_participant_snapshots s on s.application_id = a.id
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

notify pgrst, 'reload schema';
