-- Minimal application-submit error logging so operators can see why a real
-- applicant's submission failed (Safari image/base64 issues especially),
-- without storing any of the sensitive file/PIN content itself.
create table if not exists public.application_error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id text,
  user_id uuid,
  application_id uuid,
  user_agent text,
  stage text not null check (stage in (
    'image_compression',
    'file_validation',
    'file_encoding',
    'submit_request',
    'storage_upload',
    'application_insert',
    'response',
    'unknown'
  )),
  message text,
  file_count integer,
  total_bytes bigint,
  constraint application_error_logs_message_length check (char_length(coalesce(message, '')) <= 500),
  constraint application_error_logs_user_agent_length check (char_length(coalesce(user_agent, '')) <= 300)
);

create index if not exists application_error_logs_created_at_idx
  on public.application_error_logs (created_at desc);

alter table public.application_error_logs enable row level security;

drop policy if exists "No direct application error log access" on public.application_error_logs;
create policy "No direct application error log access"
on public.application_error_logs
for all
using (false)
with check (false);

-- Called from the client as a best-effort, fire-and-forget report when a
-- submission fails at any stage. Never raises - a logging hiccup must never
-- turn into an additional failure on top of the applicant's real problem.
create or replace function public.log_application_error(
  p_event_id text,
  p_session_token text,
  p_stage text,
  p_message text,
  p_file_count integer default null,
  p_total_bytes bigint default null,
  p_user_agent text default null,
  p_application_id uuid default null
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
    event_id, user_id, application_id, user_agent, stage, message, file_count, total_bytes
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
    p_total_bytes
  );
exception when others then
  -- Swallow anything unexpected (e.g. a transient DB hiccup) - this function
  -- exists purely as a diagnostic side channel and must never surface an
  -- error of its own to the caller.
  null;
end;
$$;

grant execute on function public.log_application_error(text, text, text, text, integer, bigint, text, uuid) to anon, authenticated;

create or replace function public.get_admin_application_error_logs(session_token text, limit_count integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  event_id text,
  event_title text,
  event_date date,
  stage text,
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
