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
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Profile photo service is not configured.' }, 500);

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

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: '로그인 세션이 만료되었습니다.' }, 401);
  }

  const userId = session.user_id as string;
  const profile = await findProfilePhotoSource(supabase, userId);
  if (!profile?.path) return json({ ok: true, signedUrl: null });

  const { data, error } = await supabase.storage
    .from('application-files')
    .createSignedUrl(profile.path, 60 * 60);

  if (error) {
    console.error('Signed URL creation failed', error);
    return json({ message: '대표사진을 불러오지 못했습니다.' }, 500);
  }

  return json({ ok: true, signedUrl: data.signedUrl });
});

async function findProfilePhotoSource(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: defaultProfile } = await supabase
    .from('participant_profiles')
    .select('profile_photo_paths, representative_photo_index')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const defaultPath = pickRepresentativePath(defaultProfile?.profile_photo_paths, defaultProfile?.representative_photo_index);
  if (defaultPath) return { path: defaultPath };

  const { data: latestApplication } = await supabase
    .from('applications')
    .select('profile_photo_paths, representative_photo_index')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const applicationPath = pickRepresentativePath(latestApplication?.profile_photo_paths, latestApplication?.representative_photo_index);
  if (applicationPath) return { path: applicationPath };

  return null;
}

function pickRepresentativePath(paths: unknown, indexValue: unknown) {
  if (!Array.isArray(paths) || paths.length === 0) return '';
  const index = typeof indexValue === 'number' ? indexValue : Number(indexValue ?? 0);
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.min(index, paths.length - 1)) : 0;
  const path = paths[safeIndex];
  return typeof path === 'string' ? path : '';
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
