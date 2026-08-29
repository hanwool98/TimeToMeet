import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string | null;
  sessionToken?: string;
};

const signedUrlExpirySeconds = 600;

// 관리자 콘텐츠 관리 > 후기 관리 목록. event_reviews를 applications/events와
// 조인해 닉네임/나이/직업/행사명을 가져오고, 사진은 다른 화면들과 동일한
// "행사 전용 카드 사진 우선, 없으면 기본 대표사진" 우선순위로 batch 서명한다
// (final-selection-candidate-photos/admin-participant-event-profile-card와
// 동일 패턴 재사용 - RPC로는 Storage 서명이 불가능해 Edge Function으로 처리).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Admin media access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload || typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
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

  let reviewQuery = supabase
    .from('event_reviews')
    .select('event_id, application_id, content, submitted_at')
    .order('submitted_at', { ascending: false });
  if (payload.eventId) reviewQuery = reviewQuery.eq('event_id', payload.eventId);

  const { data: reviews, error: reviewsError } = await reviewQuery;
  if (reviewsError) return json({ message: '후기 목록을 불러오지 못했습니다.' }, 500);
  if (!reviews || reviews.length === 0) return json({ ok: true, reviews: [] });

  const eventIds = Array.from(new Set(reviews.map((row) => row.event_id as string)));
  const applicationIds = Array.from(new Set(reviews.map((row) => row.application_id as string)));

  const [{ data: events }, { data: applications }, { data: cards }] = await Promise.all([
    supabase.from('events').select('id, title, event_date').in('id', eventIds),
    supabase
      .from('applications')
      .select('id, nickname, job, birth_date, profile_photo_paths, representative_photo_index, representative_crop')
      .in('id', applicationIds),
    supabase.from('event_profile_cards').select('event_id, application_id, photo_path, photo_crop').in('application_id', applicationIds),
  ]);

  const eventById = new Map((events ?? []).map((row) => [row.id as string, row]));
  const applicationById = new Map((applications ?? []).map((row) => [row.id as string, row]));
  const cardByCompositeKey = new Map((cards ?? []).map((row) => [`${row.event_id}:${row.application_id}`, row]));

  const rows = await Promise.all(
    reviews.map(async (review) => {
      const event = eventById.get(review.event_id as string);
      const application = applicationById.get(review.application_id as string);
      const card = cardByCompositeKey.get(`${review.event_id}:${review.application_id}`);

      const age =
        event?.event_date && application?.birth_date ? computeAge(String(application.birth_date), String(event.event_date)) : null;

      const photoPaths = Array.isArray(application?.profile_photo_paths) ? (application!.profile_photo_paths as string[]) : [];
      const representativeIndex = Number(application?.representative_photo_index ?? 0);
      const fallbackPhotoPath = photoPaths[representativeIndex];
      const photoPath = card?.photo_path ?? fallbackPhotoPath;
      const photoUrl = photoPath ? await signUrl(supabase, photoPath) : null;

      return {
        applicationId: review.application_id,
        age,
        content: review.content,
        eventId: review.event_id,
        eventTitle: event?.title ?? '',
        job: application?.job ?? '',
        nickname: application?.nickname ?? '',
        photoUrl,
        submittedAt: review.submitted_at,
      };
    }),
  );

  return json({ ok: true, reviews: rows });
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
