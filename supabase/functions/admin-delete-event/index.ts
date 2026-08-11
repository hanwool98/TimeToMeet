import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ message: 'Admin event deletion is not configured.' }, 500);
  }

  const { eventId, sessionToken } = await request.json().catch(() => ({
    eventId: '',
    sessionToken: '',
  }));

  if (typeof eventId !== 'string' || !eventId || typeof sessionToken !== 'string' || !sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await sha256(sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('role, expires_at')
    .eq('token_hash', tokenHash)
    .eq('role', 'admin')
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: 'Admin session required.' }, 401);
  }

  const { error: draftError } = await supabase
    .from('application_drafts')
    .delete()
    .eq('event_id', eventId);
  if (draftError) return json({ message: 'Event drafts could not be deleted.' }, 500);

  const { error: applicationError } = await supabase
    .from('applications')
    .delete()
    .eq('event_id', eventId);
  if (applicationError) return json({ message: 'Event applications could not be deleted.' }, 500);

  const { error: eventError } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);
  if (eventError) return json({ message: 'Event could not be deleted.' }, 500);

  return json({ ok: true });
});
