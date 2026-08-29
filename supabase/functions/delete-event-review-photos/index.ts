import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string;
  paths?: string[];
  sessionToken?: string;
};

// 참가자 본인이 후기에서 뺀(save_event_review_for_session이 removedImagePaths로
// 알려준) 사진을 Storage에서 실제로 정리한다. admin-delete-storage-objects는
// admin 세션만 받으므로 재사용 불가 - 참가자 본인 소유 파일만 지울 수 있게
// 별도로 만든다. 넘어온 경로가 실제로 "본인" 소유 프리픽스인지 검증한 뒤
// 통과한 것만 지운다(다른 사람 경로가 섞여 들어와도 그건 무시하고 넘어감).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Storage cleanup is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (
    !payload ||
    !payload.eventId ||
    typeof payload.eventId !== 'string' ||
    typeof payload.sessionToken !== 'string' ||
    !payload.sessionToken ||
    !Array.isArray(payload.paths)
  ) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const paths = payload.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  if (paths.length === 0) return json({ ok: true, deleted: [], skipped: [] });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionError || !session?.user_id || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: '세션이 필요합니다.' }, 401);
  }

  const { data: myApplication, error: myApplicationError } = await supabase
    .from('applications')
    .select('id')
    .eq('event_id', payload.eventId)
    .eq('user_id', session.user_id)
    .maybeSingle();

  if (myApplicationError || !myApplication) return json({ message: '참가 정보를 찾을 수 없습니다.' }, 404);

  const safeEventId = await sanitizeIdForStoragePath(payload.eventId);
  const ownPrefix = `event-reviews/${safeEventId}/${myApplication.id}/`;
  const ownPaths = paths.filter((path) => path.startsWith(ownPrefix));
  const skipped = paths.filter((path) => !path.startsWith(ownPrefix));

  if (ownPaths.length === 0) return json({ ok: true, deleted: [], skipped });

  const { data, error } = await supabase.storage.from('application-files').remove(ownPaths);
  if (error) {
    console.error('delete-event-review-photos failed', { message: error.message, ownPaths });
    return json({ ok: false, deleted: [], message: error.message, skipped }, 500);
  }

  return json({ ok: true, deleted: (data ?? []).map((row) => row.name), skipped });
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sanitizeIdForStoragePath(id: string) {
  if (/^[A-Za-z0-9_.-]+$/.test(id)) return id;
  return sha256(id);
}
