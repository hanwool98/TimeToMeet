-- 신청 퍼널(홈 -> 행사정보 확인 -> 비회원 로그인 -> 프로필 작성 -> 신청
-- 완료) 단계별 도달 인원을 세기 위한 최소한의 계측 테이블.
--
-- 조사 결과 이 흐름을 서버에서 재구성할 방법이 기존에는 전혀 없었다:
--   - 홈/행사정보 화면 방문은 어디에도 기록되지 않음(Meta Pixel PageView는
--     Facebook 쪽에만 남고 Supabase에서 조회 불가).
--   - app_sessions는 로그인 성공마다 새 행이 생기지만 세션이 30일간
--     로컬에 재사용되어 "이번 방문에 로그인했는지"의 신호로 쓸 수 없다.
--   - application_drafts는 신청 제출이 성공하면 즉시 삭제되므로(성공
--     경로에서 증거가 사라짐), "프로필 작성에 도달한 인원"의 분모로 쓰면
--     크게 과소집계된다.
--
-- application_error_logs와 완전히 동일한 패턴을 따른다: RLS는
-- using(false)/with check(false)로 직접 접근을 막고, anon/authenticated
-- 모두 호출 가능한 security definer RPC로만 기록한다. 로깅 실패가 실제
-- 사용자 흐름에 영향을 주면 안 되므로 항상 예외를 삼킨다.
create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 로그인 여부와 무관하게 브라우저(기기)를 구분하기 위한 임의 식별자
  -- (localStorage에 저장되는 uuid, PII 아님) - 로그인 전/후 단계를
  -- 이어붙여 실제 단계별 이탈률을 계산할 수 있게 해준다.
  anon_id text,
  user_id uuid,
  event_id text,
  step text not null check (step in (
    'home_view',
    'event_detail_view',
    'login_screen_view',
    'login_success',
    'profile_form_view',
    'gender_selected',
    'submit_success'
  )),
  gender text check (gender is null or gender in ('남성', '여성')),
  user_agent text,
  constraint funnel_events_anon_id_length check (char_length(coalesce(anon_id, '')) <= 100),
  constraint funnel_events_user_agent_length check (char_length(coalesce(user_agent, '')) <= 300)
);

create index if not exists funnel_events_step_created_at_idx
  on public.funnel_events (step, created_at desc);

create index if not exists funnel_events_anon_id_idx
  on public.funnel_events (anon_id)
  where anon_id is not null;

create index if not exists funnel_events_event_id_idx
  on public.funnel_events (event_id)
  where event_id is not null;

alter table public.funnel_events enable row level security;

drop policy if exists "No direct funnel event access" on public.funnel_events;
create policy "No direct funnel event access"
on public.funnel_events
for all
using (false)
with check (false);

-- 클라이언트(로그인 전 포함)와 submit-application Edge Function이 공통으로
-- 호출하는 기록용 RPC. 알 수 없는 step 값이나 세션 조회 실패 등 어떤
-- 문제가 생겨도 절대 예외를 던지지 않는다 - 계측 실패가 실제 신청 흐름을
-- 막으면 안 된다.
create or replace function public.log_funnel_event(
  p_step text,
  p_anon_id text default null,
  p_event_id text default null,
  p_session_token text default null,
  p_gender text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  resolved_user_id uuid;
begin
  if p_step is null or p_step not in (
    'home_view', 'event_detail_view', 'login_screen_view', 'login_success',
    'profile_form_view', 'gender_selected', 'submit_success'
  ) then
    return;
  end if;

  if p_session_token is not null and p_session_token <> '' then
    select s.user_id into resolved_user_id
    from public.app_sessions s
    where s.token_hash = public.hash_app_session_token(p_session_token)
      and s.expires_at > now()
    limit 1;
  end if;

  insert into public.funnel_events (anon_id, user_id, event_id, step, gender, user_agent)
  values (
    nullif(left(coalesce(p_anon_id, ''), 100), ''),
    resolved_user_id,
    nullif(p_event_id, ''),
    p_step,
    case when p_gender in ('남성', '여성') then p_gender else null end,
    left(coalesce(p_user_agent, ''), 300)
  );
exception when others then
  null;
end;
$$;

grant execute on function public.log_funnel_event(text, text, text, text, text, text) to anon, authenticated;

-- 관리자용 집계 조회. 원본 행을 그대로 노출하지 않고 (step, gender)별
-- 카운트만 돌려줘, 화면/리포트에서 바로 단계별 인원과 이탈률을 계산할 수
-- 있게 한다. anon_id/user_id는 각각 "몇 명"과 "몇 회"를 구분하기 위해
-- distinct 카운트로만 내려준다(개별 식별자 자체는 노출하지 않음).
create or replace function public.get_admin_funnel_summary(session_token text, days_back integer default 7)
returns table (
  step text,
  gender text,
  event_count bigint,
  distinct_anon_count bigint,
  distinct_user_count bigint
)
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select
    fe.step,
    coalesce(fe.gender, '(미상)') as gender,
    count(*)::bigint as event_count,
    count(distinct fe.anon_id)::bigint as distinct_anon_count,
    count(distinct fe.user_id)::bigint as distinct_user_count
  from public.funnel_events fe
  where fe.created_at >= now() - make_interval(days => greatest(1, coalesce(days_back, 7)))
  group by fe.step, coalesce(fe.gender, '(미상)')
  order by fe.step, gender;
end;
$$;

grant execute on function public.get_admin_funnel_summary(text, integer) to anon, authenticated;
