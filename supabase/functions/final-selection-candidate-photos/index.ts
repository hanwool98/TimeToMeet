import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string;
  sessionToken?: string;
};

const signedUrlExpirySeconds = 600;

// Like participant-partner-photo (session-resolved, never trusts a
// client-supplied application id) but returns every real (non-bonus) round
// partner at once, for the 최종 선택 pick screen - the candidate list itself
// is server-derived from event_table_assignments, so this can never be used
// to fetch an arbitrary participant's photo.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Participant media access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload?.eventId || typeof payload.eventId !== 'string' || typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionError || !session?.user_id || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: '세션이 필요합니다.' }, 401);
  }

  const { data: myApplication, error: myApplicationError } = await supabase
    .from('applications')
    .select('id')
    .eq('event_id', payload.eventId)
    .eq('user_id', session.user_id)
    .eq('status', '참가 확정')
    .order('checked_in_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (myApplicationError || !myApplication) {
    return json({ message: '참가 확정 상태의 신청 정보를 찾을 수 없습니다.' }, 404);
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from('event_table_assignments')
    .select('male_application_id, female_application_id')
    .eq('event_id', payload.eventId)
    .eq('is_bonus', false)
    .or(`male_application_id.eq.${myApplication.id},female_application_id.eq.${myApplication.id}`);

  if (assignmentsError) return json({ ok: true, photos: [] });

  const partnerIds = Array.from(
    new Set(
      (assignments ?? []).map((row) =>
        row.male_application_id === myApplication.id ? row.female_application_id : row.male_application_id,
      ),
    ),
  ).filter((id): id is string => Boolean(id));

  if (partnerIds.length === 0) return json({ ok: true, photos: [] });

  const { data: partners, error: partnersError } = await supabase
    .from('applications')
    .select('id, profile_photo_paths, representative_photo_index, representative_crop')
    .in('id', partnerIds);

  if (partnersError) return json({ ok: true, photos: [] });

  const photos = await Promise.all(
    (partners ?? []).map(async (partner) => {
      const photoPaths = Array.isArray(partner.profile_photo_paths) ? (partner.profile_photo_paths as string[]) : [];
      const representativeIndex = Number(partner.representative_photo_index ?? 0);
      const photoPath = photoPaths[representativeIndex];
      const photoUrl = photoPath ? await signUrl(supabase, photoPath) : null;
      return { applicationId: partner.id as string, photoUrl, representativeCrop: partner.representative_crop ?? null };
    }),
  );

  return json({ ok: true, photos });
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
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
