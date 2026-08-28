import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  sessionToken?: string;
  paths?: string[];
};

const maxPathsPerRequest = 200;

// 범용 admin-only Storage 정리 함수. 지금은 "행사 진행 초기화"가 지운
// event_profile_cards의 photo_path 고아 파일을 정리하는 데 쓰이지만,
// 다른 정리 작업에서도 재사용할 수 있게 특정 기능에 묶지 않는다. 어떤
// eventId/참가자 소유권 검증도 하지 않으므로 admin 세션 검증만으로
// 충분한, 이미 서버에서 확정된 경로 목록만 받는 용도로만 사용한다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Storage cleanup is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload || typeof payload.sessionToken !== 'string' || !payload.sessionToken || !Array.isArray(payload.paths)) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const paths = payload.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  if (paths.length === 0) return json({ ok: true, deleted: [], failed: [] });
  if (paths.length > maxPathsPerRequest) {
    return json({ message: `한 번에 최대 ${maxPathsPerRequest}개까지만 정리할 수 있습니다.` }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('role, expires_at')
    .eq('token_hash', tokenHash)
    .eq('role', 'admin')
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: 'Admin session required.' }, 401);
  }

  const { data, error } = await supabase.storage.from('application-files').remove(paths);

  if (error) {
    console.error('admin-delete-storage-objects failed', { message: error.message, paths });
    return json({ ok: false, deleted: [], failed: paths, message: error.message }, 500);
  }

  const deletedPaths = new Set((data ?? []).map((row) => row.name));
  const failed = paths.filter((path) => !deletedPaths.has(path));

  return json({ ok: true, deleted: Array.from(deletedPaths), failed });
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
