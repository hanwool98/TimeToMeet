-- 행사 이름이 한글이면 event_id 자체에 한글이 그대로 들어가는데(이전에
-- 여러 Edge Function에서 "Invalid key" 버그의 원인이었던 것과 동일 문제),
-- upload-event-review-photo Edge Function은 그 케이스에서 결정적 해시로
-- 치환한 경로에 업로드한다. save_event_review_for_session의 소유권
-- prefix 검증도 똑같은 치환 규칙을 SQL로 재현해야 정상 업로드된 경로가
-- "본인이 업로드한 사진만" 검증에서 거부되지 않는다.
create or replace function public.sanitize_storage_id(id text)
returns text
language sql
immutable
set search_path = 'public'
as $$
  select case
    when id ~ '^[A-Za-z0-9_.-]+$' then id
    else encode(extensions.digest(id, 'sha256'), 'hex')
  end;
$$;

create or replace function public.save_event_review_for_session(
  session_token text,
  event_id_value text,
  content_value text,
  image_paths_value text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  clean_content text;
  clean_image_paths text[];
  expected_prefix text;
  path_value text;
  existing_image_paths text[];
  removed_paths text[];
  result_submitted_at timestamptz;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    raise exception '로그인 세션이 필요합니다.';
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
    and a.checked_in_at is not null
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    raise exception '체크인된 참가자만 후기를 작성할 수 있습니다.';
  end if;

  clean_content := trim(coalesce(content_value, ''));
  if clean_content = '' then
    raise exception '후기 내용을 입력해주세요.';
  end if;
  if char_length(clean_content) > 2000 then
    raise exception '후기는 2000자 이내로 작성해주세요.';
  end if;

  clean_image_paths := coalesce(image_paths_value, '{}');
  if array_length(clean_image_paths, 1) > 3 then
    raise exception '후기 이미지는 최대 3장까지 첨부할 수 있습니다.';
  end if;
  expected_prefix := 'event-reviews/' || public.sanitize_storage_id(event_id_value) || '/' || target_application.id::text || '/';
  foreach path_value in array clean_image_paths loop
    if left(path_value, char_length(expected_prefix)) <> expected_prefix then
      raise exception '본인이 업로드한 사진만 첨부할 수 있습니다.';
    end if;
  end loop;

  select image_paths into existing_image_paths
  from public.event_reviews
  where event_id = event_id_value and application_id = target_application.id;

  select coalesce(array_agg(p), '{}')
  into removed_paths
  from unnest(coalesce(existing_image_paths, '{}')) as p
  where p <> all (clean_image_paths);

  insert into public.event_reviews (event_id, application_id, content, image_paths, submitted_at, updated_at)
  values (event_id_value, target_application.id, clean_content, clean_image_paths, now(), now())
  on conflict (event_id, application_id) do update set
    content = excluded.content,
    image_paths = excluded.image_paths,
    submitted_at = coalesce(public.event_reviews.submitted_at, now()),
    updated_at = now()
  returning submitted_at into result_submitted_at;

  return jsonb_build_object('ok', true, 'submittedAt', result_submitted_at, 'removedImagePaths', to_jsonb(removed_paths));
end;
$$;

grant execute on function public.save_event_review_for_session(text, text, text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';
