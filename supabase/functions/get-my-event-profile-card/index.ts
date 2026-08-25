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

// 프로필 카드 작성 화면이 처음 열릴 때 필요한 모든 것(기존 기본 프로필의
// 닉네임/나이/직업/대표사진, 이번 행사에서 고를 수 있는 본인 업로드 사진
// 전체, 그리고 지금까지 저장된 카드 내용)을 한 번에 signed URL과 함께
// 내려준다 - Storage 서명은 서비스 롤이 필요해 일반 RPC로는 할 수 없다.
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
    .select('id, nickname, job, birth_date, profile_photo_paths, representative_photo_index, representative_crop')
    .eq('event_id', payload.eventId)
    .eq('user_id', session.user_id)
    .eq('status', '참가 확정')
    .order('checked_in_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (myApplicationError || !myApplication) {
    return json({ message: '체크인된 참가자만 프로필 카드를 작성할 수 있습니다.' }, 404);
  }

  const { data: event } = await supabase.from('events').select('event_date').eq('id', payload.eventId).maybeSingle();

  const age = event?.event_date ? computeAge(String(myApplication.birth_date), String(event.event_date)) : null;

  const { data: card } = await supabase
    .from('event_profile_cards')
    .select('photo_path, photo_crop, hobby, mbti, ideal_type, contact_style, date_style, smoking, drinking, keywords, submitted_at')
    .eq('event_id', payload.eventId)
    .eq('application_id', myApplication.id)
    .maybeSingle();

  const ownPhotoPaths = Array.isArray(myApplication.profile_photo_paths) ? (myApplication.profile_photo_paths as string[]) : [];
  const representativeIndex = Number(myApplication.representative_photo_index ?? 0);
  const defaultPhotoPath = ownPhotoPaths[representativeIndex] ?? null;

  const [ownPhotos, cardPhotoUrl] = await Promise.all([
    Promise.all(ownPhotoPaths.map(async (path) => ({ path, signedUrl: await signUrl(supabase, path) }))),
    card?.photo_path ? signUrl(supabase, card.photo_path) : defaultPhotoPath ? signUrl(supabase, defaultPhotoPath) : Promise.resolve(null),
  ]);

  return json({
    ok: true,
    nickname: myApplication.nickname,
    age,
    job: myApplication.job,
    defaultPhotoPath,
    defaultPhotoCrop: myApplication.representative_crop ?? null,
    ownPhotos,
    card: {
      photoPath: card?.photo_path ?? null,
      photoCrop: card?.photo_crop ?? null,
      photoUrl: cardPhotoUrl,
      hobby: card?.hobby ?? '',
      mbti: card?.mbti ?? '',
      idealType: card?.ideal_type ?? '',
      contactStyle: card?.contact_style ?? '',
      dateStyle: card?.date_style ?? '',
      smoking: card?.smoking ?? '',
      drinking: card?.drinking ?? '',
      keywords: Array.isArray(card?.keywords) ? card.keywords : [],
      submittedAt: card?.submitted_at ?? null,
    },
  });
});

function computeAge(birthDate: string, eventDate: string) {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const event = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(event.getTime())) return null;
  let age = event.getUTCFullYear() - birth.getUTCFullYear();
  const eventMonth = event.getUTCMonth();
  const birthMonth = birth.getUTCMonth();
  if (eventMonth < birthMonth || (eventMonth === birthMonth && event.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

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
