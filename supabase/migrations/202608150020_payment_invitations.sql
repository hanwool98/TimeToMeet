create table if not exists public.payment_invitations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  read_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.payment_invitations enable row level security;

create index if not exists payment_invitations_user_unread_idx
on public.payment_invitations (user_id, read_at, dismissed_at);

drop trigger if exists touch_payment_invitations_updated_at on public.payment_invitations;
create trigger touch_payment_invitations_updated_at
before update on public.payment_invitations
for each row execute function public.touch_updated_at();

drop policy if exists "Users can read own payment invitations" on public.payment_invitations;
create policy "Users can read own payment invitations"
on public.payment_invitations
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins can manage payment invitations" on public.payment_invitations;
create policy "Admins can manage payment invitations"
on public.payment_invitations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.update_application_review_for_session(
  session_token text,
  application_id uuid,
  next_status public.application_status,
  next_payment_deadline timestamptz,
  next_payment_notice_sent_at timestamptz,
  next_reviewed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  update public.applications
  set
    is_new = false,
    payment_deadline = next_payment_deadline,
    payment_notice_sent_at = next_payment_notice_sent_at,
    reviewed_at = coalesce(next_reviewed_at, now()),
    status = next_status,
    updated_at = now()
  where id = application_id;

  if next_status = '결제 대기' then
    insert into public.payment_invitations (
      application_id,
      user_id
    )
    select
      a.id,
      a.user_id
    from public.applications a
    where a.id = application_id
      and a.payment_deadline is not null
      and a.payment_deadline > now()
    on conflict (application_id) do update set
      read_at = null,
      dismissed_at = null,
      updated_at = now();
  else
    update public.payment_invitations
    set
      dismissed_at = coalesce(dismissed_at, now()),
      read_at = coalesce(read_at, now()),
      updated_at = now()
    where public.payment_invitations.application_id = update_application_review_for_session.application_id
      and next_status in ('참여 보류', '반려', '참가 확정', '환불 완료', '자동 취소');
  end if;
end;
$$;

grant execute on function public.update_application_review_for_session(text, uuid, public.application_status, timestamptz, timestamptz, timestamptz) to anon, authenticated;

drop function if exists public.get_my_payment_invitations(text);

create or replace function public.get_my_payment_invitations(
  session_token text
)
returns table (
  id uuid,
  application_id uuid,
  event_id text,
  event_title text,
  event_date date,
  start_time time,
  end_time time,
  status public.application_status,
  payment_deadline timestamptz,
  created_at timestamptz,
  dismissed_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
begin
  select s.user_id
    into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  return query
  select
    pi.id,
    a.id as application_id,
    e.id as event_id,
    e.title as event_title,
    e.event_date,
    e.start_time,
    e.end_time,
    a.status,
    a.payment_deadline,
    pi.created_at,
    pi.dismissed_at,
    pi.read_at
  from public.payment_invitations pi
  join public.applications a on a.id = pi.application_id
  join public.events e on e.id = a.event_id
  where pi.user_id = session_user_id
    and a.user_id = session_user_id
    and a.status = '결제 대기'
    and a.payment_deadline is not null
    and a.payment_deadline > now()
  order by pi.created_at asc;
end;
$$;

grant execute on function public.get_my_payment_invitations(text) to anon, authenticated;

drop function if exists public.mark_payment_invitation_dismissed(text, uuid);

create or replace function public.mark_payment_invitation_dismissed(
  session_token text,
  invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
begin
  select s.user_id
    into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  update public.payment_invitations
  set
    dismissed_at = coalesce(dismissed_at, now()),
    updated_at = now()
  where id = invitation_id
    and user_id = session_user_id
    and read_at is null;
end;
$$;

grant execute on function public.mark_payment_invitation_dismissed(text, uuid) to anon, authenticated;

drop function if exists public.mark_payment_invitation_read(text, uuid);

create or replace function public.mark_payment_invitation_read(
  session_token text,
  invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_user_id uuid;
begin
  select s.user_id
    into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token::text, 'sha256'::text), 'hex')
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_user_id is null then
    raise exception 'App session required.';
  end if;

  update public.payment_invitations
  set
    dismissed_at = coalesce(dismissed_at, now()),
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where id = invitation_id
    and user_id = session_user_id;
end;
$$;

grant execute on function public.mark_payment_invitation_read(text, uuid) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.payment_invitations;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
