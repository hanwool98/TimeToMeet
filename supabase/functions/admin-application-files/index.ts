import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type ApplicationFileRow = {
  employment_proof_path: string | null;
  id_photo_path: string | null;
  profile_photo_paths: string[] | null;
  representative_photo_index: number | null;
  voice_intro_path: string | null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Admin file service is not configured.' }, 500);

  const { applicationId, sessionToken } = await request.json().catch(() => ({
    applicationId: '',
    sessionToken: '',
  }));

  if (typeof applicationId !== 'string' || !applicationId || typeof sessionToken !== 'string' || !sessionToken) {
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

  if (sessionError || !session || new Date(String(session.expires_at)).getTime() <= Date.now()) {
    return json({ message: 'Admin session required.' }, 401);
  }

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .select('id_photo_path, profile_photo_paths, representative_photo_index, voice_intro_path, employment_proof_path')
    .eq('id', applicationId)
    .maybeSingle<ApplicationFileRow>();

  if (applicationError) {
    console.error('Application file lookup failed', applicationError);
    return json({ message: '신청 자료를 조회하지 못했습니다.' }, 500);
  }

  if (!application) return json({ message: '신청서를 찾을 수 없습니다.' }, 404);

  return json({
    ok: true,
    employmentProof: await signFile(supabase, application.employment_proof_path),
    idPhoto: await signFile(supabase, application.id_photo_path),
    profilePhotos: await Promise.all((application.profile_photo_paths ?? []).map((path) => signFile(supabase, path))).then((files) =>
      files.filter(Boolean),
    ),
    representativeIndex: application.representative_photo_index ?? 0,
    voiceIntro: await signFile(supabase, application.voice_intro_path),
  });
});

async function signFile(supabase: ReturnType<typeof createClient>, path: string | null) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from('application-files')
    .createSignedUrl(path, 60 * 60);

  if (error) {
    console.error('Signed URL creation failed', { error, path });
    return null;
  }

  return {
    fileName: decodeURIComponent(path.split('/').pop() ?? '첨부파일'),
    path,
    signedUrl: data.signedUrl,
  };
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
