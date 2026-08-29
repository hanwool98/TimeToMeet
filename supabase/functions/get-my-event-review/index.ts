import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string;
  sessionToken?: string;
};

const signedUrlExpirySeconds = 600;

// ReviewFormPage가 후기 작성/수정 화면을 열 때 쓰는 조회 - 텍스트뿐 아니라
// 기존 첨부 사진의 signed URL까지 한 번에 내려준다(get_my_event_review_for_session
// RPC는 Storage 서명이 불가능해 텍스트만 반환했었다). 여기서 서명한 URL은
// 미리보기/삭제 판단용일 뿐, 실제 저장은 여전히 save_event_review_for_session이 한다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Review access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload?.eventId || typeof payload.eventId !== 'string' || typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }

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

  if (myApplicationError || !myApplication) {
    return json({ ok: true, content: '', images: [], submittedAt: null });
  }

  const { data: review } = await supabase
    .from('event_reviews')
    .select('content, image_paths, submitted_at')
    .eq('event_id', payload.eventId)
    .eq('application_id', myApplication.id)
    .maybeSingle();

  const imagePaths = Array.isArray(review?.image_paths) ? (review!.image_paths as string[]) : [];
  const images = await Promise.all(
    imagePaths.map(async (path) => ({ path, url: await signUrl(supabase, path) })),
  );

  return json({
    ok: true,
    content: review?.content ?? '',
    images,
    submittedAt: review?.submitted_at ?? null,
  });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
}

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
