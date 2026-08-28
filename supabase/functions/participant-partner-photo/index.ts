import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string;
  sessionToken?: string;
  // Only honored server-side while stage is actually bonus_seat_guide (the
  // merged "호감도 수정 + 다음 자리 이동" phase) - lets the "다음 상대"
  // reveal card fetch that upcoming partner's photo instead of the one the
  // rating form on the same screen is about (current_round's partner,
  // which is still the just-finished one during this phase).
  useNextRound?: boolean;
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
    .select('current_round, stage')
    .eq('event_id', payload.eventId)
    .maybeSingle();

  if (progressError || !progress?.current_round) {
    return json({ ok: true, photoUrl: null, representativeCrop: null });
  }

  // current_round points at the just-finished/current match for every
  // stage - bonus_seat_guide (the merged rating-edit + next-move phase) is
  // the one exception where the caller may explicitly ask for the
  // already-precomputed NEXT round's match instead.
  const lookupRound = payload.useNextRound && progress.stage === 'bonus_seat_guide' ? progress.current_round + 1 : progress.current_round;

  const { data: assignment, error: assignmentError } = await supabase
    .from('event_table_assignments')
    .select('male_application_id, female_application_id')
    .eq('event_id', payload.eventId)
    .eq('round_number', lookupRound)
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

  // 이번 행사 전용 프로필 카드에 사진을 따로 골랐다면 그 사진+crop을
  // 우선 쓰고, 없으면(카드 자체가 없거나 photo_path가 null이면) 기존
  // 기본 프로필 대표사진으로 fallback한다.
  const { data: partnerCard } = await supabase
    .from('event_profile_cards')
    .select(
      'photo_path, photo_crop, hobby, mbti, ideal_type, contact_style, date_style, smoking, drinking_frequency, drinking_amount, keywords, date_destination',
    )
    .eq('event_id', payload.eventId)
    .eq('application_id', partnerApplicationId)
    .maybeSingle();

  const photoPaths = Array.isArray(partner.profile_photo_paths) ? (partner.profile_photo_paths as string[]) : [];
  const representativeIndex = Number(partner.representative_photo_index ?? 0);
  const fallbackPhotoPath = photoPaths[representativeIndex];
  const photoPath = partnerCard?.photo_path ?? fallbackPhotoPath;
  const representativeCrop = partnerCard?.photo_path ? partnerCard.photo_crop : partner.representative_crop;
  const photoUrl = photoPath ? await signUrl(supabase, photoPath) : null;

  // 공통 키워드 강조를 클라이언트에서 계산할 수 있도록 호출자 본인의
  // 키워드도 같이 내려준다 - 별도 왕복 요청이 필요 없게.
  const { data: myCard } = await supabase
    .from('event_profile_cards')
    .select('keywords')
    .eq('event_id', payload.eventId)
    .eq('application_id', myApplication.id)
    .maybeSingle();

  return json({
    ok: true,
    photoUrl,
    representativeCrop: representativeCrop ?? null,
    hobby: partnerCard?.hobby ?? '',
    mbti: partnerCard?.mbti ?? '',
    idealType: partnerCard?.ideal_type ?? '',
    contactStyle: partnerCard?.contact_style ?? '',
    dateStyle: partnerCard?.date_style ?? '',
    smoking: partnerCard?.smoking ?? '',
    drinking: formatDrinkingDisplay(partnerCard?.drinking_frequency, partnerCard?.drinking_amount),
    dateDestination: partnerCard?.date_destination ?? '',
    keywords: Array.isArray(partnerCard?.keywords) ? partnerCard.keywords : [],
    myKeywords: Array.isArray(myCard?.keywords) ? myCard.keywords : [],
  });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
}

// save_event_profile_card_for_session이 저장 시점에 legacy drinking
// 컬럼에 합성해 넣는 것과 동일한 형식("빈도 / 주량 N병") - 상대 카드
// 화면은 그 legacy 컬럼을 쓰지 않고 여기서 직접 다시 합성해 최신 값을
// 그대로 반영한다(둘 다 같은 결과가 나오도록 형식을 반드시 맞춘다).
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
