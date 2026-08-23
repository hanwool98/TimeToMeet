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

// Unlike public-participant-media (unauthenticated, whole-event preview
// list, client-side-blurred), this only ever returns ONE photo: the
// caller's own current-round match, derived server-side from
// event_table_assignments rather than trusted from client input - a
// participant can never request another participant's photo by id.
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

  const { data: progress, error: progressError } = await supabase
    .from('event_progress')
    .select('current_round')
    .eq('event_id', payload.eventId)
    .maybeSingle();

  // current_round already points at the correct row in
  // event_table_assignments no matter the stage - it's bumped to the next
  // 추가시간 round number as soon as bonus_matching for that round starts,
  // not deferred until the bonus conversation actually begins.
  if (progressError || !progress?.current_round) {
    return json({ ok: true, photoUrl: null, representativeCrop: null });
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('event_table_assignments')
    .select('male_application_id, female_application_id')
    .eq('event_id', payload.eventId)
    .eq('round_number', progress.current_round)
    .or(`male_application_id.eq.${myApplication.id},female_application_id.eq.${myApplication.id}`)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return json({ ok: true, photoUrl: null, representativeCrop: null });
  }

  const partnerApplicationId =
    assignment.male_application_id === myApplication.id ? assignment.female_application_id : assignment.male_application_id;

  if (!partnerApplicationId) return json({ ok: true, photoUrl: null, representativeCrop: null });

  const { data: partner, error: partnerError } = await supabase
    .from('applications')
    .select('profile_photo_paths, representative_photo_index, representative_crop')
    .eq('id', partnerApplicationId)
    .maybeSingle();

  if (partnerError || !partner) return json({ ok: true, photoUrl: null, representativeCrop: null });

  const photoPaths = Array.isArray(partner.profile_photo_paths) ? (partner.profile_photo_paths as string[]) : [];
  const representativeIndex = Number(partner.representative_photo_index ?? 0);
  const photoPath = photoPaths[representativeIndex];
  const photoUrl = photoPath ? await signUrl(supabase, photoPath) : null;

  return json({ ok: true, photoUrl, representativeCrop: partner.representative_crop ?? null });
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
