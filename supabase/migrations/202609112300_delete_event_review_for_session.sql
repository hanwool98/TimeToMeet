-- 관리자 "콘텐츠 관리 > 후기 관리"에서 후기를 삭제할 수 있게 하는 RPC.
-- event_reviews는 RLS가 using(false)라 관리자 세션 검증을 거친 RPC로만
-- 지울 수 있다. Storage에 남은 첨부 이미지는 RPC가 직접 지울 수 없으므로
-- (delete_home_content_for_session과 동일 패턴) 지워진 행의 image_paths를
-- 그대로 반환하고, 클라이언트가 admin-delete-storage-objects로 정리한다.
create or replace function public.delete_event_review_for_session(
  session_token text,
  review_id_value uuid
)
returns text[]
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  removed_image_paths text[];
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  delete from public.event_reviews er
  where er.id = review_id_value
  returning coalesce(er.image_paths, '{}'::text[]) into removed_image_paths;

  if not found then
    raise exception '삭제할 후기를 찾을 수 없습니다.';
  end if;

  return coalesce(removed_image_paths, '{}'::text[]);
end;
$$;

grant execute on function public.delete_event_review_for_session(text, uuid) to anon, authenticated;
