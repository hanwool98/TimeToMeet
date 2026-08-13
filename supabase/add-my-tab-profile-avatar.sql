create or replace function public.get_my_tab_profile_avatar(session_token text)
returns table (
  has_profile boolean,
  avatar_index integer
)
language sql
stable
security definer
set search_path = public
as $$
  with current_user_session as (
    select public.get_app_session_user_id(session_token, array['member', 'guest']) as user_id
  ),
  latest_application as (
    select
      a.id,
      row_number() over (partition by a.gender order by a.reviewed_at nulls last, a.submitted_at) - 1 as avatar_index
    from public.applications a
    join current_user_session s on s.user_id = a.user_id
    where s.user_id is not null
    order by a.submitted_at desc
    limit 1
  )
  select
    exists(select 1 from latest_application) as has_profile,
    coalesce((select latest_application.avatar_index::integer from latest_application limit 1), 0) as avatar_index;
$$;

grant execute on function public.get_my_tab_profile_avatar(text) to anon, authenticated;

notify pgrst, 'reload schema';
