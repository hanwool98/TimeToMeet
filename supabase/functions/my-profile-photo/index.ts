import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

const signedUrlExpirySeconds = 600;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Profile photo access is not configured.' }, 500);

  const { sessionToken } = await request.json().catch(() => ({ sessionToken: '' }));
  if (typeof sessionToken !== 'string' || !sessionToken) return json({ message: 'Invalid request.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tokenHash = await sha256(sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, role, expires_at')
    .eq('token_hash', tokenHash)
    .in('role', ['member', 'guest'])
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: 'Session required.' }, 401);
  }

  // Mirrors get_my_page_summary's resolution order: an explicitly active
  // saved profile wins, otherwise fall back to the most recently submitted
  // application — the same source MyPage's nickname/avatar_index come from,
  // so the photo shown always matches the profile currently on display.
  const { data: activeProfile } = await supabase
    .from('participant_profiles')
    .select('profile_photo_paths, representative_photo_index')
    .eq('user_id', session.user_id)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let photoPaths: string[] = [];
  let representativeIndex = 0;

  if (activeProfile) {
    photoPaths = Array.isArray(activeProfile.profile_photo_paths) ? activeProfile.profile_photo_paths as string[] : [];
    representativeIndex = Number(activeProfile.representative_photo_index ?? 0);
  } else {
    const { data: latestApplication } = await supabase
      .from('applications')
      .select('profile_photo_paths, representative_photo_index')
      .eq('user_id', session.user_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestApplication) {
      photoPaths = Array.isArray(latestApplication.profile_photo_paths) ? latestApplication.profile_photo_paths as string[] : [];
      representativeIndex = Number(latestApplication.representative_photo_index ?? 0);
    }
  }

  const photoPath = photoPaths[representativeIndex];
  if (!photoPath) return json({ ok: true, signedUrl: null });

  const { data: signed, error: signError } = await supabase.storage
    .from('application-files')
    .createSignedUrl(photoPath, signedUrlExpirySeconds);

  if (signError || !signed?.signedUrl) return json({ ok: true, signedUrl: null });

  return json({ ok: true, signedUrl: signed.signedUrl });
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
  return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
