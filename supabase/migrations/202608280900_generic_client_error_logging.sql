-- application_error_logs는 원래 "신청서 제출 실패" 전용이었다. 이제
-- 관리자 화면을 포함한 다른 화면의 오류도 같은 로그/화면으로 모으고
-- 싶다는 요청에 따라, 테이블/화면은 재사용하고 어디서 난 오류인지
-- 구분할 수 있는 context 컬럼만 추가한다(추가 전용, nullable) - stage는
-- 기존 신청서 제출 단계 전용 값(image_compression 등)을 그대로 두고,
-- 신청서 제출이 아닌 오류는 stage='unknown' + context에 실제 출처
-- ("AdminEventPreparePage:qr-upload" 등)를 넣는 방식으로 구분한다.
alter table public.application_error_logs add column if not exists context text;
alter table public.application_error_logs
  drop constraint if exists application_error_logs_context_length,
  add constraint application_error_logs_context_length check (char_length(coalesce(context, '')) <= 200);

drop function if exists public.log_application_error(text, text, text, text, integer, bigint, text, uuid);

create or replace function public.log_application_error(
  p_event_id text,
  p_session_token text,
  p_stage text,
  p_message text,
  p_file_count integer default null,
  p_total_bytes bigint default null,
  p_user_agent text default null,
  p_application_id uuid default null,
  p_context text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  resolved_user_id uuid;
begin
  select s.user_id
  into resolved_user_id
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(coalesce(p_session_token, ''))
    and s.expires_at > now()
  limit 1;

  insert into public.application_error_logs (
    event_id, user_id, application_id, user_agent, stage, message, file_count, total_bytes, context
  ) values (
    nullif(p_event_id, ''),
    resolved_user_id,
    p_application_id,
    left(coalesce(p_user_agent, ''), 300),
    case
      when p_stage in ('image_compression', 'file_validation', 'file_encoding', 'submit_request', 'storage_upload', 'application_insert', 'response', 'unknown')
        then p_stage
      else 'unknown'
    end,
    left(coalesce(p_message, ''), 500),
    p_file_count,
    p_total_bytes,
    nullif(left(coalesce(p_context, ''), 200), '')
  );
exception when others then
  -- Swallow anything unexpected (e.g. a transient DB hiccup) - this function
  -- exists purely as a diagnostic side channel and must never surface an
  -- error of its own to the caller.
  null;
end;
$$;

grant execute on function public.log_application_error(text, text, text, text, integer, bigint, text, uuid, text) to anon, authenticated;

drop function if exists public.get_admin_application_error_logs(text, integer);

create or replace function public.get_admin_application_error_logs(session_token text, limit_count integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  event_id text,
  event_title text,
  event_date date,
  stage text,
  context text,
  message text,
  file_count integer,
  total_bytes bigint,
  user_agent text,
  application_id uuid,
  application_no text
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
  select
    l.id,
    l.created_at,
    l.event_id,
    e.title,
    e.event_date,
    l.stage,
    l.context,
    l.message,
    l.file_count,
    l.total_bytes,
    l.user_agent,
    l.application_id,
    a.application_no
  from public.application_error_logs l
  left join public.events e on e.id = l.event_id
  left join public.applications a on a.id = l.application_id
  order by l.created_at desc
  limit least(greatest(coalesce(limit_count, 100), 1), 200);
end;
$$;

grant execute on function public.get_admin_application_error_logs(text, integer) to anon, authenticated;
