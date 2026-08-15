import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Session service is not configured.' }, 500);

  const { sessionToken } = await request.json().catch(() => ({ sessionToken: '' }));
  if (typeof sessionToken !== 'string' || !sessionToken) return json({ message: '로그인이 필요합니다.' }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await sha256(sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, role, expires_at')
    .eq('token_hash', tokenHash)
    .in('role', ['member', 'guest'])
    .maybeSingle();

  if (sessionError || !session || new Date(String(session.expires_at)).getTime() <= Date.now()) {
    return json({ message: '로그인 세션이 만료되었습니다.' }, 401);
  }

  if (session.role !== 'guest') {
    return json({ ok: true, accountType: session.role, guestDisplayId: null, phoneMasked: null });
  }

  const { data: guest, error: guestError } = await supabase
    .from('guest_accounts')
    .select('phone_normalized')
    .eq('user_id', session.user_id)
    .maybeSingle();

  if (guestError) {
    console.error('Guest phone lookup failed', guestError);
    return json({ message: '비회원 정보를 불러오지 못했습니다.' }, 500);
  }

  const phone = typeof guest?.phone_normalized === 'string' ? guest.phone_normalized : '';

  return json({
    accountType: 'guest',
    guestDisplayId: formatGuestDisplayId(phone),
    ok: true,
    phoneMasked: maskPhone(phone),
  });
});

function formatGuestDisplayId(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `${digits.slice(-8, -4)}-${digits.slice(-4)}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
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
