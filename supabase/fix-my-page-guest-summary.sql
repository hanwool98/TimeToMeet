create or replace function public.get_my_page_summary(session_token text)
returns table (
  account_type text,
  has_profile boolean,
  nickname text,
  phone_masked text,
  guest_display_id text,
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
  select
    s.user_id,
    coalesce(ua.account_type, au.account_type, s.role) as resolved_role
  into session_row
  from public.app_sessions s
  left join public.user_accounts ua on ua.user_id = s.user_id
  left join public.app_users au on au.user_id = s.user_id
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
      coalesce(
        (select nickname from active_profile),
        (select nickname from latest_application),
        (select login_id from public.member_accounts where user_id = session_row.user_id),
        case when session_row.resolved_role = 'guest' then '비회원' else '회원' end
      ) as nickname,
      coalesce(
        (select phone from active_profile),
        (select phone from latest_application),
        (select phone_normalized from public.guest_accounts where user_id = session_row.user_id)
      ) as phone_value,
      coalesce((select representative_photo_index from active_profile), (select representative_photo_index from latest_application), 0)::integer as avatar_index,
      exists(select 1 from active_profile) or exists(select 1 from latest_application) as has_profile
  )
  select
    session_row.resolved_role::text,
    chosen.has_profile,
    chosen.nickname,
    case
      when chosen.phone_value is null or length(regexp_replace(chosen.phone_value, '\D', '', 'g')) < 8 then null
      else left(regexp_replace(chosen.phone_value, '\D', '', 'g'), 3) || '-****-' || right(regexp_replace(chosen.phone_value, '\D', '', 'g'), 4)
    end,
    case
      when session_row.resolved_role <> 'guest' or chosen.phone_value is null or length(regexp_replace(chosen.phone_value, '\D', '', 'g')) < 8 then null
      else substring(regexp_replace(chosen.phone_value, '\D', '', 'g') from char_length(regexp_replace(chosen.phone_value, '\D', '', 'g')) - 7 for 4)
        || '-' ||
        substring(regexp_replace(chosen.phone_value, '\D', '', 'g') from char_length(regexp_replace(chosen.phone_value, '\D', '', 'g')) - 3 for 4)
    end,
    chosen.avatar_index
  from chosen;
end;
$$;

grant execute on function public.get_my_page_summary(text) to anon, authenticated;

notify pgrst, 'reload schema';
