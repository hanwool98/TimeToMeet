import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type MediaPayload = {
  eventId?: string;
  sessionToken?: string;
};

// This map is fetched once per round-stage entry and NOT refetched for the
// rest of the event (including the transition into bonus rounds) - a real
// event easily runs past 10 minutes, so a short expiry here made photos
// silently stop loading partway through (root cause of "추가시간 대표사진
// 누락"). 6 hours comfortably covers a single day's event.
const signedUrlExpirySeconds = 21_600;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Admin participant media access is not configured.' }, 500);

  const payload = await request.json().catch(() => null) as MediaPayload | null;
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

  const { data: applications, error } = await supabase
    .from('applications')
    .select('id, profile_photo_paths, representative_photo_index, representative_crop, voice_intro_path')
    .eq('event_id', payload.eventId);

  if (error) return json({ message: '참가자 미디어를 불러오지 못했습니다.' }, 500);

  const media = await Promise.all(
    (applications ?? []).map(async (application) => {
      const photoPaths = Array.isArray(application.profile_photo_paths) ? application.profile_photo_paths as string[] : [];
      const representativeIndex = Number(application.representative_photo_index ?? 0);
      const photoPath = photoPaths[representativeIndex];

      const [photoUrl, audioUrl] = await Promise.all([
        photoPath ? signUrl(supabase, photoPath) : Promise.resolve(null),
        application.voice_intro_path ? signUrl(supabase, application.voice_intro_path as string) : Promise.resolve(null),
      ]);

      return {
        id: application.id,
        audioUrl,
        photoUrl,
        representativeCrop: application.representative_crop ?? null,
      };
    }),
  );

  return json({ media, ok: true });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
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
