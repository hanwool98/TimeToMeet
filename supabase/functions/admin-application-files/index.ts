import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type SignedFile = {
  errorMessage?: string;
  fileName: string;
  path: string;
  signedUrl?: string;
};

const signedUrlExpirySeconds = 600;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Admin application files access is not configured.' }, 500);

  const { applicationId, sessionToken } = await request.json().catch(() => ({ applicationId: '', sessionToken: '' }));
  if (typeof applicationId !== 'string' || !applicationId || typeof sessionToken !== 'string' || !sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

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

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .select('event_id, user_id, id_photo_path, employment_proof_path, profile_photo_paths, representative_photo_index, voice_intro_path')
    .eq('id', applicationId)
    .maybeSingle();

  if (applicationError) return json({ message: '신청 정보를 불러오지 못했습니다.' }, 500);
  if (!application) return json({ message: '신청 정보를 찾을 수 없습니다.' }, 404);

  const profilePhotoPaths = Array.isArray(application.profile_photo_paths) ? application.profile_photo_paths as string[] : [];

  // 참여이력 썸네일은 계정 정리 이후에도 당시 행사에 고정된 사진을 써야
  // 한다. 기존 심사 자료 응답은 그대로 두고 별도 필드만 추가한다.
  const [{ data: participantSnapshot }, { data: eventProfileCard }, { data: currentProfile }] = await Promise.all([
    supabase
      .from('event_participant_snapshots')
      .select('photo_path')
      .eq('event_id', application.event_id)
      .eq('application_id', applicationId)
      .maybeSingle(),
    supabase
      .from('event_profile_cards')
      .select('photo_path')
      .eq('event_id', application.event_id)
      .eq('application_id', applicationId)
      .maybeSingle(),
    supabase
      .from('participant_profiles')
      .select('profile_photo_paths, representative_photo_index')
      .eq('user_id', application.user_id)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const currentProfilePaths = Array.isArray(currentProfile?.profile_photo_paths)
    ? currentProfile.profile_photo_paths as string[]
    : [];
  const representativePath =
    (participantSnapshot?.photo_path as string | null)
    ?? (eventProfileCard?.photo_path as string | null)
    ?? profilePhotoPaths[Number(application.representative_photo_index ?? 0)]
    ?? currentProfilePaths[Number(currentProfile?.representative_photo_index ?? 0)]
    ?? null;

  const [idPhoto, employmentProof, voiceIntro, profilePhotos, historicalRepresentativePhoto] = await Promise.all([
    signFile(supabase, application.id_photo_path as string | null),
    signFile(supabase, application.employment_proof_path as string | null),
    signFile(supabase, application.voice_intro_path as string | null),
    Promise.all(profilePhotoPaths.map((path) => signFile(supabase, path))),
    signFile(supabase, representativePath),
  ]);

  return json({
    employmentProof: employmentProof ?? undefined,
    historicalRepresentativePhoto: historicalRepresentativePhoto ?? undefined,
    idPhoto: idPhoto ?? undefined,
    ok: true,
    profilePhotos: profilePhotos.filter((file): file is SignedFile => Boolean(file)),
    representativeIndex: Number(application.representative_photo_index ?? 0),
    voiceIntro: voiceIntro ?? undefined,
  });
});

async function signFile(supabase: ReturnType<typeof createClient>, path: string | null): Promise<SignedFile | null> {
  if (!path) return null;
  const fileName = path.split('/').pop() || path;
  const { data, error } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  if (error || !data?.signedUrl) {
    return { errorMessage: error?.message ?? '파일을 불러오지 못했습니다.', fileName, path };
  }
  return { fileName, path, signedUrl: data.signedUrl };
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
  return Array.from(new Uint8Array(hashBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
