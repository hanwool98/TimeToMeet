import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type MediaPayload = {
  eventId?: string;
};

const signedUrlExpirySeconds = 600;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Supabase server configuration is missing.' }, 500);

  const payload = await request.json().catch(() => null) as MediaPayload | null;
  if (!payload?.eventId || typeof payload.eventId !== 'string') return json({ message: '행사 정보를 확인해주세요.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Deliberately scoped to the exact same public dataset as
  // get_public_participant_previews (confirmed participants of one event) —
  // no application id/user id is ever accepted from the caller, so this can
  // never be used to reach anyone's data outside that public preview set.
  const { data: applications, error } = await supabase
    .from('applications')
    .select('id, profile_photo_paths, representative_photo_index, representative_crop, voice_intro_path')
    .eq('event_id', payload.eventId)
    .eq('status', '참가 확정');

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
