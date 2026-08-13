create table if not exists public.participant_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  is_active boolean not null default true,
  source_application_id uuid references public.applications(id) on delete set null,
  name text not null,
  birth_date date not null,
  gender text not null check (gender in ('남성', '여성')),
  residence text not null,
  phone text not null,
  relationship_status text not null,
  id_photo_path text,
  nickname text not null,
  profile_photo_paths text[] not null default '{}',
  representative_photo_index integer not null default 0,
  representative_crop jsonb not null default '{}'::jsonb,
  voice_intro_path text,
  height text not null,
  job text not null,
  employment_proof_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists participant_profiles_one_active_per_user
on public.participant_profiles (user_id)
where is_active;

alter table public.participant_profiles enable row level security;

drop policy if exists "No direct participant profile reads" on public.participant_profiles;
create policy "No direct participant profile reads"
on public.participant_profiles
for select
using (false);

create or replace function public.get_my_page_summary(session_token text)
returns table (
  account_type text,
  has_profile boolean,
  nickname text,
  phone_masked text,
  avatar_index integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_row record;
begin
  select s.user_id, s.role
  into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_row.user_id is null then
    return query select
      null::text,
      false,
      null::text,
      null::text,
      0;
    return;
  end if;

  return query
  with active_profile as (
    select pp.*
    from public.participant_profiles pp
    where pp.user_id = session_row.user_id
      and pp.is_active
    order by pp.updated_at desc
    limit 1
  ),
  latest_application as (
    select a.*
    from public.applications a
    where a.user_id = session_row.user_id
    order by a.submitted_at desc
    limit 1
  ),
  chosen as (
    select
      coalesce((select nickname from active_profile), (select nickname from latest_application), (select login_id from public.member_accounts where user_id = session_row.user_id), '비회원') as nickname,
      coalesce((select phone from active_profile), (select phone from latest_application), (select phone_normalized from public.guest_accounts where user_id = session_row.user_id)) as phone_value,
      coalesce((select representative_photo_index from active_profile), (select representative_photo_index from latest_application), 0)::integer as avatar_index,
      exists(select 1 from active_profile) or exists(select 1 from latest_application) as has_profile
  )
  select
    session_row.role::text,
    chosen.has_profile,
    chosen.nickname,
    case
      when chosen.phone_value is null or length(regexp_replace(chosen.phone_value, '\D', '', 'g')) < 8 then null
      else left(regexp_replace(chosen.phone_value, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(chosen.phone_value, '\D', '', 'g'), 4)
    end,
    chosen.avatar_index
  from chosen;
end;
$$;

create or replace function public.get_my_participant_profile(session_token text)
returns table (
  id uuid,
  account_type text,
  source text,
  can_reuse boolean,
  name text,
  birth_date date,
  gender text,
  residence text,
  phone_masked text,
  relationship_status text,
  nickname text,
  profile_photo_count integer,
  representative_photo_index integer,
  representative_crop jsonb,
  has_voice_intro boolean,
  height text,
  job text,
  has_id_photo boolean,
  has_employment_proof boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_row record;
begin
  select s.user_id, s.role
  into session_row
  from public.app_sessions s
  where s.token_hash = public.hash_app_session_token(session_token)
    and s.expires_at > now()
    and s.role in ('member', 'guest')
  limit 1;

  if session_row.user_id is null then
    return;
  end if;

  if session_row.role = 'member' then
    return query
    select
      pp.id,
      'member'::text,
      'default_profile'::text,
      true,
      pp.name,
      pp.birth_date,
      pp.gender,
      pp.residence,
      left(regexp_replace(pp.phone, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(pp.phone, '\D', '', 'g'), 4),
      pp.relationship_status,
      pp.nickname,
      coalesce(array_length(pp.profile_photo_paths, 1), 0),
      pp.representative_photo_index,
      pp.representative_crop,
      pp.voice_intro_path is not null,
      pp.height,
      pp.job,
      pp.id_photo_path is not null,
      pp.employment_proof_path is not null,
      pp.updated_at
    from public.participant_profiles pp
    where pp.user_id = session_row.user_id
      and pp.is_active
    order by pp.updated_at desc
    limit 1;
    return;
  end if;

  return query
  select
    a.id,
    'guest'::text,
    'application_profile'::text,
    false,
    a.name,
    a.birth_date,
    a.gender,
    a.residence,
    left(regexp_replace(a.phone, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(a.phone, '\D', '', 'g'), 4),
    a.relationship_status,
    a.nickname,
    coalesce(array_length(a.profile_photo_paths, 1), 0),
    a.representative_photo_index,
    a.representative_crop,
    a.voice_intro_path is not null,
    a.height,
    a.job,
    a.id_photo_path is not null,
    a.employment_proof_path is not null,
    a.submitted_at
  from public.applications a
  where a.user_id = session_row.user_id
  order by a.submitted_at desc
  limit 1;
end;
$$;

create or replace function public.update_my_participant_profile_nickname(session_token text, nickname_value text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := public.get_app_session_user_id(session_token, array['member']);
  if current_user_id is null then
    raise exception 'Member session required.';
  end if;

  if length(trim(nickname_value)) < 1 then
    raise exception 'Nickname is required.';
  end if;

  update public.participant_profiles
  set nickname = trim(nickname_value),
      updated_at = now()
  where user_id = current_user_id
    and is_active;

  return found;
end;
$$;

grant execute on function public.get_my_page_summary(text) to anon, authenticated;
grant execute on function public.get_my_participant_profile(text) to anon, authenticated;
grant execute on function public.update_my_participant_profile_nickname(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
