-- get_my_page_summary declares `nickname` as part of its RETURNS TABLE,
-- which makes plpgsql implicitly bind an OUT parameter named `nickname`
-- throughout the function body. The `(select nickname from active_profile)` /
-- `(select nickname from latest_application)` subqueries then collide with
-- that OUT parameter, so every call raised "column reference \"nickname\" is
-- ambiguous" (42702) -- the RPC never returned data, so the frontend always
-- fell back to a hardcoded "비회원" label with no photo. Qualifying the
-- column references with their CTE alias resolves the ambiguity; the
-- coalesce order (active_profile before latest_application) is unchanged.
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
    return query select null::text, false, null::text, null::text, 0;
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
        (select active_profile.nickname from active_profile),
        (select latest_application.nickname from latest_application),
        (select login_id from public.member_accounts where user_id = session_row.user_id),
        '비회원'
      ) as nickname,
      coalesce(
        (select active_profile.phone from active_profile),
        (select latest_application.phone from latest_application),
        (select phone_normalized from public.guest_accounts where user_id = session_row.user_id)
      ) as phone_value,
      coalesce(
        (select active_profile.representative_photo_index from active_profile),
        (select latest_application.representative_photo_index from latest_application),
        0
      )::integer as avatar_index,
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

grant execute on function public.get_my_page_summary(text) to anon, authenticated;
