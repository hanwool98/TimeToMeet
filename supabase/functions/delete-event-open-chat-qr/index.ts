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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'QR delete is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload?.eventId || typeof payload.eventId !== 'string' || typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
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

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, open_chat_qr_path')
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError || !event) return json({ message: '행사를 찾을 수 없습니다.' }, 404);

  if (event.open_chat_qr_path) {
    await supabase.storage.from('application-files').remove([event.open_chat_qr_path]);
  }

  const { error: updateError } = await supabase.from('events').update({ open_chat_qr_path: null }).eq('id', payload.eventId);
  if (updateError) return json({ message: 'QR 코드 삭제에 실패했습니다.' }, 500);

  return json({ ok: true });
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
