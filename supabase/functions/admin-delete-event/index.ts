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

type ApplicationFilesRow = {
  id: string;
  employment_proof_path: string | null;
  id_photo_path: string | null;
  profile_photo_paths: string[] | null;
  voice_intro_path: string | null;
};

type ProfileFilesRow = {
  employment_proof_path: string | null;
  id_photo_path: string | null;
  profile_photo_paths: string[] | null;
  voice_intro_path: string | null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ message: 'Method not allowed.' }, 405);
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

  const { data: applicationFiles, error: applicationFilesError } = await supabase
    .from('applications')
    .select('id, id_photo_path, profile_photo_paths, voice_intro_path, employment_proof_path')
    .eq('event_id', eventId);

  if (applicationFilesError) {
    return json({ message: 'Event application files could not be inspected.' }, 500);
  }

  const applicationRows = (applicationFiles ?? []) as ApplicationFilesRow[];
  const applicationIds = applicationRows.map((row) => row.id);
  let protectedProfilePaths = new Set<string>();

  if (applicationIds.length > 0) {
    const { data: profileFiles, error: profileFilesError } = await supabase
      .from('participant_profiles')
      .select('id_photo_path, profile_photo_paths, voice_intro_path, employment_proof_path')
      .in('source_application_id', applicationIds);

    if (profileFilesError) {
      console.error('Participant profile file references could not be inspected', profileFilesError);
      return json({ message: '저장된 회원 프로필 파일을 확인하지 못해 행사 삭제를 중단했습니다.' }, 500);
    }

    protectedProfilePaths = new Set(collectStoragePaths((profileFiles ?? []) as ProfileFilesRow[]));
  }

  const storagePaths = collectStoragePaths(applicationRows).filter((path) => !protectedProfilePaths.has(path));
  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from('application-files').remove(storagePaths);
    if (storageError) {
      console.error('Event storage cleanup failed', { eventId, message: storageError.message });
      return json({ message: '행사 신청 파일 삭제에 실패해 행사 삭제를 중단했습니다.' }, 500);
    }
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

  return json({ ok: true, removedStorageFileCount: storagePaths.length });
});

function collectStoragePaths(rows: Array<ApplicationFilesRow | ProfileFilesRow>) {
  const paths = rows.flatMap((row) => [
    row.id_photo_path,
    row.voice_intro_path,
    row.employment_proof_path,
    ...(row.profile_photo_paths ?? []),
  ]);
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}
