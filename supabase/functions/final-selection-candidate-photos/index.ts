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

  // 후보 전원의 이번 행사 전용 프로필 카드를 한 번에 조회해, 사진은 카드
  // 지정 사진 우선(없으면 기본 대표사진)으로, 그 외 필드(취미/MBTI/...)는
  // 최종선택 "프로필 보기"에서 그대로 표시한다 - admin-participant-event
  // -profile-card와 동일한 select 컬럼/formatDrinkingDisplay를 재사용.
  const { data: cards } = await supabase
    .from('event_profile_cards')
    .select(
      'application_id, photo_path, photo_crop, hobby, mbti, ideal_type, contact_style, date_style, date_destination, smoking, drinking_frequency, drinking_amount, keywords, submitted_at',
    )
    .eq('event_id', payload.eventId)
    .in('application_id', partnerIds);
  const cardByApplicationId = new Map((cards ?? []).map((card) => [card.application_id as string, card]));

  // 후보 계정이 그 사이 정리(게스트 만료 등)돼 applications 대표사진이
  // 삭제된 경우, 체크인 시점에 저장해둔 스냅샷 사진을 우선 쓴다.
  const { data: snapshots } = await supabase
    .from('event_participant_snapshots')
    .select('application_id, photo_path, photo_crop')
    .eq('event_id', payload.eventId)
    .in('application_id', partnerIds);
  const snapshotByApplicationId = new Map((snapshots ?? []).map((row) => [row.application_id as string, row]));

  const photos = await Promise.all(
    (partners ?? []).map(async (partner) => {
      const photoPaths = Array.isArray(partner.profile_photo_paths) ? (partner.profile_photo_paths as string[]) : [];
      const representativeIndex = Number(partner.representative_photo_index ?? 0);
      const fallbackPhotoPath = photoPaths[representativeIndex];
      const card = cardByApplicationId.get(partner.id as string);
      const snapshot = snapshotByApplicationId.get(partner.id as string);
      const photoPath = snapshot?.photo_path ?? card?.photo_path ?? fallbackPhotoPath;
      const representativeCrop = snapshot?.photo_path ? snapshot.photo_crop : card?.photo_path ? card.photo_crop : partner.representative_crop;
      const photoUrl = photoPath ? await signUrl(supabase, photoPath) : null;
      return {
        applicationId: partner.id as string,
        contactStyle: card?.contact_style ?? '',
        dateDestination: card?.date_destination ?? '',
        dateStyle: card?.date_style ?? '',
        drinking: formatDrinkingDisplay(card?.drinking_frequency, card?.drinking_amount),
        hasSubmittedCard: Boolean(card?.submitted_at),
        hobby: card?.hobby ?? '',
        idealType: card?.ideal_type ?? '',
        keywords: Array.isArray(card?.keywords) ? card.keywords : [],
        mbti: card?.mbti ?? '',
        photoUrl,
        representativeCrop: representativeCrop ?? null,
        smoking: card?.smoking ?? '',
      };
    }),
  );

  return json({ ok: true, photos });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
}

// save_event_profile_card_for_session이 legacy drinking 컬럼에 합성해
// 넣는 것과 동일한 형식("빈도 / 주량 N병") - participant-partner-photo/
// admin-participant-event-profile-card의 동일 헬퍼와 로직을 반드시
// 맞춰야 한다.
function formatDrinkingDisplay(frequency?: string | null, amount?: string | null) {
  const hasFrequency = Boolean(frequency);
  const hasAmount = Boolean(amount);
  if (hasFrequency && hasAmount) return `${frequency} / 주량 ${amount}`;
  if (hasFrequency) return frequency as string;
  if (hasAmount) return `주량 ${amount}`;
  return '';
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
