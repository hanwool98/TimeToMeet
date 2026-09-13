import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = { sessionToken?: string };

// intro-content와 동일한 이유로 6시간 - 참가자 개인정보가 아니라 운영자가
// 직접 등록한 마케팅/안내용 슬라이드 이미지라 짧게 잡을 필요가 없다.
const signedUrlExpirySeconds = 21_600;

// 관리자 "행사 소개 슬라이드 관리" 화면과 운영자 행사 진행 화면
// (AdminEventLivePage) 양쪽이 공유하는 슬라이드 목록 조회 - 둘 다 admin
// 세션으로 호출한다. event_intro_slides는 RLS가 항상 false라 여기서
// service role로만 읽을 수 있고, Storage 서명도 필요해서 RPC가 아니라
// Edge Function으로 처리한다(intro-content와 동일 패턴).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Intro slide access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload || typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
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

  const { data: rows, error: rowsError } = await supabase
    .from('event_intro_slides')
    .select('id, title, image_path, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (rowsError) return json({ message: '슬라이드 목록을 불러오지 못했습니다.' }, 500);

  const slides = await Promise.all(
    (rows ?? []).map(async (row) => ({
      id: row.id as string,
      imagePath: row.image_path as string,
      imageUrl: await signUrl(supabase, row.image_path as string),
      sortOrder: row.sort_order as number,
      title: (row.title as string | null) ?? '',
    })),
  );

  return json({ ok: true, slides });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
