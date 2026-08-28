import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string;
  applicationId?: string;
  sessionToken?: string;
};

const signedUrlExpirySeconds = 600;

// 운영자가 행사 진행 중 참가자 상세(호감도 작성 기록)를 볼 때, 그 위에
// 해당 참가자의 event profile card를 읽기 전용으로 보여주기 위한 조회.
// participant-partner-photo와 동일하게 "행사 전용 카드 사진 우선, 없으면
// 기본 대표사진" 우선순위를 그대로 재사용한다 - 새 로직을 따로 만들지
// 않는다. Storage 서명은 서비스 롤이 필요해 일반 RPC로는 할 수 없다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Admin media access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (
    !payload?.eventId ||
    typeof payload.eventId !== 'string' ||
    !payload.applicationId ||
    typeof payload.applicationId !== 'string' ||
    typeof payload.sessionToken !== 'string' ||
    !payload.sessionToken
  ) {
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

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .select('id, nickname, job, birth_date, profile_photo_paths, representative_photo_index, representative_crop')
    .eq('id', payload.applicationId)
    .eq('event_id', payload.eventId)
    .maybeSingle();

  if (applicationError || !application) return json({ message: '참가자를 찾을 수 없습니다.' }, 404);

  const { data: event } = await supabase.from('events').select('event_date').eq('id', payload.eventId).maybeSingle();
  const age = event?.event_date ? computeAge(String(application.birth_date), String(event.event_date)) : null;

  const { data: card } = await supabase
    .from('event_profile_cards')
    .select(
      'photo_path, photo_crop, hobby, mbti, ideal_type, contact_style, date_style, smoking, drinking_frequency, drinking_amount, keywords, date_destination, submitted_at',
    )
    .eq('event_id', payload.eventId)
    .eq('application_id', payload.applicationId)
    .maybeSingle();

  const ownPhotoPaths = Array.isArray(application.profile_photo_paths) ? (application.profile_photo_paths as string[]) : [];
  const representativeIndex = Number(application.representative_photo_index ?? 0);
  const fallbackPhotoPath = ownPhotoPaths[representativeIndex] ?? null;
  const photoPath = card?.photo_path ?? fallbackPhotoPath;
  const representativeCrop = card?.photo_path ? card.photo_crop : application.representative_crop;
  const photoUrl = photoPath ? await signUrl(supabase, photoPath) : null;

  return json({
    ok: true,
    nickname: application.nickname,
    age,
    job: application.job,
    photoUrl,
    representativeCrop: representativeCrop ?? null,
    hasSubmittedCard: Boolean(card?.submitted_at),
    hobby: card?.hobby ?? '',
    mbti: card?.mbti ?? '',
    idealType: card?.ideal_type ?? '',
    contactStyle: card?.contact_style ?? '',
    dateStyle: card?.date_style ?? '',
    dateDestination: card?.date_destination ?? '',
    smoking: card?.smoking ?? '',
    drinking: formatDrinkingDisplay(card?.drinking_frequency, card?.drinking_amount),
    keywords: Array.isArray(card?.keywords) ? card.keywords : [],
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

// save_event_profile_card_for_session이 legacy drinking 컬럼에 합성해
// 넣는 것과 동일한 형식("빈도 / 주량 N병") - participant-partner-photo의
// formatDrinkingDisplay와 완전히 동일한 로직을 유지해야 한다.
function formatDrinkingDisplay(frequency?: string | null, amount?: string | null) {
  const hasFrequency = Boolean(frequency);
  const hasAmount = Boolean(amount);
  if (hasFrequency && hasAmount) return `${frequency} / 주량 ${amount}`;
  if (hasFrequency) return frequency as string;
  if (hasAmount) return `주량 ${amount}`;
  return '';
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
