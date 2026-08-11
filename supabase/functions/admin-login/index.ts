import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

const maxFailedAttempts = 5;
const lockMinutes = 15;
const resetAfterMinutes = 30;

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

function getRequestKey(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const connectingIp = request.headers.get('cf-connecting-ip')?.trim();
  const userAgent = request.headers.get('user-agent') ?? 'unknown';
  return `${connectingIp || forwardedFor || 'unknown'}:${userAgent.slice(0, 120)}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const adminAccessCode = Deno.env.get('ADMIN_ACCESS_CODE');

  if (!supabaseUrl || !serviceRoleKey || !adminAccessCode) {
    return json({ message: 'Admin login is not configured.' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const requestHash = await sha256(getRequestKey(request));
  const { data: attempt } = await supabase
    .from('admin_login_attempts')
    .select('failed_count, locked_until, last_failed_at')
    .eq('request_hash', requestHash)
    .maybeSingle();

  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
    return json({ message: 'Too many attempts. Try again later.' }, 429);
  }

  const { code } = await request.json().catch(() => ({ code: '' }));
  if (typeof code !== 'string' || code !== adminAccessCode) {
    const lastFailedAt = attempt?.last_failed_at ? new Date(attempt.last_failed_at).getTime() : 0;
    const shouldReset = lastFailedAt < Date.now() - resetAfterMinutes * 60 * 1000;
    const nextFailedCount = shouldReset ? 1 : Number(attempt?.failed_count ?? 0) + 1;
    const lockedUntil = nextFailedCount >= maxFailedAttempts
      ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString()
      : null;

    await supabase.from('admin_login_attempts').upsert({
      failed_count: nextFailedCount,
      last_failed_at: new Date().toISOString(),
      locked_until: lockedUntil,
      request_hash: requestHash,
    });

    return json({ message: 'Invalid admin code.' }, 401);
  }

  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`;
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from('app_sessions').insert({
    expires_at: expiresAt,
    role: 'admin',
    token_hash: tokenHash,
  });

  if (error) {
    return json({ message: 'Admin session could not be created.' }, 500);
  }

  await supabase.from('admin_login_attempts').delete().eq('request_hash', requestHash);

  return json({
    expires_at: expiresAt,
    role: 'admin',
    session_token: rawToken,
  });
});
