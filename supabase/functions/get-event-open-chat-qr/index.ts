import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  connectionToken?: string;
  eventId?: string;
  sessionToken?: string;
  tableNumber?: number;
};

const signedUrlExpirySeconds = 21_600;

// 오픈채팅 QR 조회는 두 종류의 호출자가 쓴다 - 행사 준비 화면의 운영자
// (sessionToken, admin 세션)와 최종선택 단계의 태블릿(connectionToken +
// tableNumber, event_tablets에 연결된 기기인지 검증). 둘 다 signed URL
// 발급에 서비스 롤이 필요해 RPC가 아니라 Edge Function으로 만든다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'QR lookup is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload?.eventId || typeof payload.eventId !== 'string') {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let authorized = false;

  if (typeof payload.sessionToken === 'string' && payload.sessionToken) {
    const tokenHash = await sha256(payload.sessionToken);
    const { data: session } = await supabase
      .from('app_sessions')
      .select('role, expires_at')
      .eq('token_hash', tokenHash)
      .eq('role', 'admin')
      .maybeSingle();
    if (session && new Date(session.expires_at).getTime() > Date.now()) authorized = true;
  }

  if (!authorized && typeof payload.connectionToken === 'string' && payload.connectionToken && typeof payload.tableNumber === 'number') {
    const tokenHash = await sha256(payload.connectionToken);
    const { data: tablet } = await supabase
      .from('event_tablets')
      .select('id')
      .eq('event_id', payload.eventId)
      .eq('table_number', payload.tableNumber)
      .eq('connection_status', 'online')
      .eq('connection_token_hash', tokenHash)
      .maybeSingle();
    if (tablet) authorized = true;
  }

  if (!authorized) return json({ message: '인증에 실패했습니다.' }, 401);

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('open_chat_qr_path')
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError || !event) return json({ message: '행사를 찾을 수 없습니다.' }, 404);

  if (!event.open_chat_qr_path) return json({ ok: true, qrUrl: null });

  const { data: signed } = await supabase.storage.from('application-files').createSignedUrl(event.open_chat_qr_path, signedUrlExpirySeconds);

  return json({ ok: true, qrUrl: signed?.signedUrl ?? null });
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
