import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type UploadedFile = {
  base64: string;
  contentType: string;
  fileName: string;
};

type SubmitPayload = {
  accessRoute: string;
  birthDate: string;
  consents: Record<string, boolean>;
  employmentProof: UploadedFile;
  eventId: string;
  // Meta Conversions API(Lead) 매칭/중복제거용. 신청 저장 자체와는 무관하고
  // 전부 선택값 - 없어도 신청은 그대로 저장되고, Meta 전송만 그만큼 매칭
  // 품질이 낮아지거나(fbp/fbc 없음) event_source_url이 기본값으로 대체된다.
  eventSourceUrl?: string;
  fbc?: string;
  fbp?: string;
  filmingConsent: boolean;
  gender: string;
  height: string;
  idPhoto: UploadedFile;
  inquiry: string;
  interviewConsent: string;
  job: string;
  kakaoId?: string | null;
  name: string;
  nickname: string;
  phone: string;
  profilePhotos: UploadedFile[];
  refundAgreement: boolean;
  relationshipStatus: string;
  preferredPartnerDescription?: string | null;
  avoidParticipantNote?: string | null;
  representativeCrop: Record<string, number>;
  representativeIndex: number;
  residence: string;
  returning: boolean;
  previewToken?: string;
  saveAsDefaultProfile?: boolean;
  sessionToken: string;
  userId?: string;
  voiceIntro?: UploadedFile;
};

const maxImageBytes = 8 * 1024 * 1024;
const maxAudioBytes = 8 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const audioTypes = ['audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-m4a'];
const allowedGenders = new Set(['남성', '여성']);
// Meta Pixel ID는 비밀값이 아니다(브라우저에도 그대로 노출되는 공개
// 스크립트) - src/lib/metaPixel.ts, index.html과 반드시 같은 값으로 유지한다.
const metaPixelId = '1090793103739228';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.', stage: 'unknown' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Supabase server configuration is missing.', stage: 'unknown' }, 500);

  const payload = await request.json().catch(() => null) as SubmitPayload | null;
  if (!payload?.sessionToken || !payload.eventId) return json({ message: '로그인 또는 비회원 세션이 필요합니다.', stage: 'submit_request' }, 401);
  // 어떤 파일이 빠졌는지 구체적으로 알려준다 - "필수 첨부 파일을
  // 확인해주세요"만으로는 참가자도 관리자도 신분증/재직증명/프로필사진
  // 중 무엇이 문제였는지 알 수 없어 원인 파악이 어려웠다.
  const missingFileLabels: string[] = [];
  if (!payload.idPhoto) missingFileLabels.push('신분증 사진');
  if (!payload.employmentProof) missingFileLabels.push('재직 증명 사진');
  if (!Array.isArray(payload.profilePhotos) || payload.profilePhotos.length === 0) missingFileLabels.push('프로필 사진');
  if (missingFileLabels.length > 0) {
    return json({ message: `${missingFileLabels.join(', ')}을(를) 첨부해주세요.`, stage: 'file_validation' }, 400);
  }
  if (payload.profilePhotos.length > 3) return json({ message: '프로필 사진은 최대 3장까지 첨부할 수 있습니다.', stage: 'file_validation' }, 400);

  const fileValidationError = validateSubmissionFiles(payload);
  if (fileValidationError) return json({ message: fileValidationError, stage: 'file_validation' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, role, expires_at')
    .eq('token_hash', tokenHash)
    .in('role', ['guest', 'member'])
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: '로그인 또는 비회원 세션이 만료되었습니다. 다시 로그인해주세요.', stage: 'response' }, 401);
  }

  const userId = session.user_id as string;
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(
      'id, event_date, application_deadline, male_price, female_price, early_bird_deadline, early_bird_discount_male, early_bird_discount_female, is_test_event',
    )
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError) return json({ message: '행사 정보를 확인하지 못했습니다.', stage: 'response' }, 500);
  if (!event) return json({ message: '선택한 행사를 찾을 수 없습니다.', stage: 'response' }, 404);

  // Test events are invisible to the public app entirely - the only way to
  // legitimately reach the submit form for one is through an admin-issued,
  // event-scoped preview token, so re-verify that here rather than trusting
  // that the client only got this far because it had one.
  if (event.is_test_event) {
    const { data: tokenValid, error: tokenError } = await supabase.rpc('is_test_event_preview_token_valid', {
      event_id_value: payload.eventId,
      preview_token: payload.previewToken ?? '',
    });
    if (tokenError || !tokenValid) {
      return json({ message: '테스트 행사 접근 권한이 없습니다. 유효한 테스트 링크로 다시 접속해주세요.', stage: 'response' }, 403);
    }
  }

  const fieldValidationError = validateSubmissionFields(payload, String(event.event_date));
  if (fieldValidationError) return json({ message: fieldValidationError, stage: 'response' }, 400);

  if (session.role === 'guest') {
    const { data: guestAccount, error: guestAccountError } = await supabase
      .from('guest_accounts')
      .select('phone_normalized')
      .eq('user_id', userId)
      .maybeSingle();

    if (guestAccountError) return json({ message: '비회원 계정 정보를 확인하지 못했습니다.', stage: 'response' }, 500);
    if (!guestAccount?.phone_normalized || normalizePhone(payload.phone) !== guestAccount.phone_normalized) {
      return json({ message: '전화번호가 일치하지 않습니다. 로그인한 번호를 확인해주세요.', stage: 'response' }, 400);
    }
  }

  // Statuses that mean the applicant's previous attempt is over and shouldn't
  // block a new one - kept in sync with the same terminal-status set used for
  // guest cleanup eligibility (see get_expired_guest_cleanup_targets).
  const terminalStatuses = ['반려', '자동 취소', '환불 완료', '신청 취소'];
  const { data: existing, error: existingError } = await supabase
    .from('applications')
    .select('id')
    .eq('event_id', payload.eventId)
    .eq('user_id', userId)
    .not('status', 'in', `(${terminalStatuses.join(',')})`)
    .maybeSingle();

  if (existingError) return json({ message: '기존 신청 내역 확인에 실패했습니다.', stage: 'response' }, 500);
  if (existing) return json({ message: '이미 이 행사에 신청한 내역이 있습니다.', stage: 'response' }, 409);

  // 정원이 찼어도 신청 자체는 항상 접수한다(요청). 예전에는 여기서
  // 성별 정원을 미리 확인해 막았는데, '참여 보류' 같은 실제 좌석을
  // 점유하지 않는 상태까지 세는 바람에 대기로 돌려도 마감이 안 풀리는
  // 문제가 있었다 - 이제 이 사전 차단 자체를 없앤다. 실제 정원 검증은
  // 관리자가 승인(결제 대기 전환)하는 시점에 update_application_review_
  // for_session RPC가 서버에서 다시 계산해 막는다(그 쪽 카운트는 이미
  // 처음부터 결제 대기/결제중/입금 확인 중/참가 확정만 세고 있었다).

  let idPhotoPath = '';
  let employmentProofPath = '';
  let voiceIntroPath: string | null = null;
  let profilePhotoPaths: string[] = [];
  let uploadedPaths: string[] = [];
  {
    const basePath = `${userId}/${crypto.randomUUID()}`;
    const uploadTasks = [
      { key: 'idPhoto' as const, file: payload.idPhoto, path: `${basePath}/id-${sanitizeFileName(payload.idPhoto.fileName)}` },
      { key: 'employmentProof' as const, file: payload.employmentProof, path: `${basePath}/employment-${sanitizeFileName(payload.employmentProof.fileName)}` },
      // 음성 소개는 선택이라 첨부됐을 때만 업로드 목록에 넣는다 - 아래
      // paths 추출은 이 목록의 순서(신분증, 재직증명, [음성], 프로필사진들)를
      // 그대로 따라가는 커서 방식이라 인덱스가 밀려도 안전하다.
      ...(payload.voiceIntro
        ? [{ key: 'voiceIntro' as const, file: payload.voiceIntro, path: `${basePath}/voice-${sanitizeFileName(payload.voiceIntro.fileName)}` }]
        : []),
      ...payload.profilePhotos.map((file, index) => ({
        key: 'profilePhoto' as const,
        file,
        path: `${basePath}/profile-${index + 1}-${sanitizeFileName(file.fileName)}`,
      })),
    ];

    // Uploaded concurrently (with a retry each) instead of one-at-a-time: six
    // sequential round-trips to Storage were slow enough on real mobile photos
    // to trip client/gateway timeouts, surfacing as "failed to send a
    // request" or a bare non-2xx with no message once the function itself
    // got cut off mid-upload.
    const uploadResults = await Promise.allSettled(
      uploadTasks.map((task) => uploadPrivateFileWithRetry(supabase, task.path, task.file)),
    );

    const succeededPaths = uploadResults
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map((result) => result.value);
    const firstFailure = uploadResults.find((result): result is PromiseRejectedResult => result.status === 'rejected');

    if (firstFailure) {
      console.error('Application file upload failed', firstFailure.reason);
      await cleanupUploadedFiles(supabase, succeededPaths);
      const message = firstFailure.reason instanceof Error ? firstFailure.reason.message : '파일 업로드에 실패했습니다.';
      return json({ message, stage: 'storage_upload' }, 500);
    }

    const paths = uploadResults.map((result) => (result as PromiseFulfilledResult<string>).value);
    idPhotoPath = paths[0];
    employmentProofPath = paths[1];
    let cursor = 2;
    if (payload.voiceIntro) {
      voiceIntroPath = paths[cursor];
      cursor += 1;
    }
    profilePhotoPaths = paths.slice(cursor);
    uploadedPaths = succeededPaths;
  }

  const basePrice = payload.gender === '남성' ? Number(event.male_price ?? 0) : Number(event.female_price ?? 0);
  const isEarlyBird = Boolean(event.early_bird_deadline) && new Date(event.early_bird_deadline as string).getTime() > Date.now();
  const earlyBirdDiscount = isEarlyBird
    ? Number((payload.gender === '남성' ? event.early_bird_discount_male : event.early_bird_discount_female) ?? 0)
    : 0;
  const paymentAmount = Math.max(basePrice - earlyBirdDiscount, 0);

  const applicationSnapshot = {
    access_route: payload.accessRoute.trim(),
    applicant_kind: session.role,
    birth_date: payload.birthDate,
    consents: payload.consents,
    employment_proof_path: employmentProofPath,
    event_id: payload.eventId,
    filming_consent: payload.filmingConsent,
    gender: payload.gender,
    height: payload.height.trim(),
    id_photo_path: idPhotoPath,
    inquiry: payload.inquiry?.trim() ?? '',
    interview_consent: payload.interviewConsent.trim(),
    job: payload.job.trim(),
    kakao_id: cleanOptionalText(payload.kakaoId),
    name: payload.name.trim(),
    nickname: payload.nickname.trim(),
    payment_amount: paymentAmount,
    phone: normalizePhone(payload.phone),
    profile_photo_paths: profilePhotoPaths,
    refund_agreement: payload.refundAgreement,
    relationship_status: payload.relationshipStatus.trim(),
    preferred_partner_description: cleanOptionalText(payload.preferredPartnerDescription),
    avoid_participant_note: cleanOptionalText(payload.avoidParticipantNote),
    representative_crop: payload.representativeCrop,
    representative_photo_index: payload.representativeIndex,
    residence: payload.residence.trim(),
    is_returning: Boolean(payload.returning),
    review_notice_confirmed: true,
    user_id: userId,
    voice_intro_path: voiceIntroPath,
  };

  const { data: insertedApplication, error: insertError } = await supabase
    .from('applications')
    .insert(applicationSnapshot)
    .select('id')
    .single();

  if (insertError) {
    console.error('Application insert failed', insertError);
    await cleanupUploadedFiles(supabase, uploadedPaths);
    const deadlineMessage = insertError.message?.includes('Application deadline has passed')
      ? '이 행사의 신청이 마감되었습니다.'
      : `신청서 저장에 실패했습니다. ${insertError.message}`;
    return json({ message: deadlineMessage, stage: 'application_insert' }, 500);
  }

  if (session.role === 'member' && payload.saveAsDefaultProfile) {
    const { error: profileError } = await saveMemberDefaultProfile(supabase, {
      ...applicationSnapshot,
      source_application_id: insertedApplication.id,
    });

    if (profileError) {
      console.error('Default participant profile save failed', profileError);
      await supabase.from('applications').delete().eq('id', insertedApplication.id);
      await cleanupUploadedFiles(supabase, uploadedPaths);
      return json({ message: `신청서는 저장됐지만 기본 프로필 저장에 실패했습니다. ${profileError.message}`, stage: 'application_insert' }, 500);
    }
  }

  const { error: draftDeleteError } = await supabase
    .from('application_drafts')
    .delete()
    .eq('event_id', payload.eventId)
    .eq('user_id', userId);
  if (draftDeleteError) console.error('Application draft cleanup failed', draftDeleteError);

  // 신청서가 확정 저장된 직후(위의 기본 프로필 저장 실패 시 롤백 등 신청
  // 자체가 취소될 수 있는 경로를 모두 지난 뒤)에만 Meta에 Lead 전환을
  // 알린다 - 행사 상세 방문/신청 버튼 클릭/폼 진입 시점이 아니라 실제
  // 저장 성공 시점 기준(요청 사항). 실패해도 절대 신청 자체를 실패로
  // 되돌리지 않는다.
  try {
    await notifyMetaLeadConversion(supabase, request, insertedApplication.id as string, payload);
  } catch (metaError) {
    console.error('Meta Lead conversion dispatch failed', metaError);
  }

  return json({ ok: true, applicationId: insertedApplication.id });
});

// Deno Deploy(Supabase Edge Functions 런타임)는 응답을 보낸 뒤에도 이
// 콜백으로 넘긴 작업을 계속 실행해준다 - 있으면 이걸 써서 Meta로 나가는
// 네트워크 요청이 사용자 응답 시간에 영향을 주지 않게 한다. 혹시 이
// 런타임에서 지원하지 않으면(구버전 등) 그냥 기다리는 쪽으로 안전하게
// 대체한다 - fire-and-forget으로만 던지면 함수 인스턴스가 그 사이에
// 종료돼 요청 자체가 나가지 않을 수 있기 때문이다.
function runInBackground(task: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === 'function') {
    runtime.waitUntil(task);
    return Promise.resolve();
  }
  return task;
}

// applications 테이블에 boolean/timestamp 하나로 "선점"하던 원래 방식은,
// 선점 직후 Meta 호출이 실패하면 그 신청은 영원히 재시도되지 않는 문제가
// 있었다(실사용 리뷰로 지적됨). 그래서 "성공 확정"(sent_at)과 "시도 횟수"
// (attempt_count)를 meta_lead_dispatches 테이블로 분리했다 - sent_at은 Meta가
// 실제로 2xx를 준 경우에만 채워지고, 그 전까지는 attempt_count가 몇이든
// retry-failed-meta-lead-events 크론(별도 함수, 재시도 상한을 거기서 관리)이
// 계속 재시도 대상으로 본다.
async function notifyMetaLeadConversion(
  supabase: ReturnType<typeof createClient>,
  request: Request,
  applicationId: string,
  payload: SubmitPayload,
) {
  const accessToken = Deno.env.get('META_CONVERSIONS_API_TOKEN');
  if (!accessToken) return; // Secret이 아직 설정 안 됐으면 조용히 건너뛴다 - 신청 저장에는 영향 없음.

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const clientUserAgent = request.headers.get('user-agent') || null;
  const eventSourceUrl =
    typeof payload.eventSourceUrl === 'string' && payload.eventSourceUrl
      ? payload.eventSourceUrl
      : `https://time2meet.kr/events/${payload.eventId}/apply/profile`;

  // 실제 신청 완료 시각을 딱 한 번 캡처해서 created_at에 명시적으로
  // 넣어둔다(컬럼 기본값 now()에 맡기지 않는 이유: 이 값이 곧 Meta
  // event_time의 유일한 출처가 되어야 하므로, DB가 실제로 무엇을 저장했는지와
  // 이 함수가 event_time으로 쓰는 값이 100% 같은 값이어야 한다). 재시도할
  // 때(retry-failed-meta-lead-events)도 이 created_at을 그대로 event_time으로
  // 다시 쓴다 - "재시도한 시각"이 아니라 "실제 전환이 일어난 시각"이 Meta에
  // 계속 보고되게 하기 위함(사용자 지적).
  const submittedAt = new Date();

  // 재시도할 때 원래 요청과 최대한 같은 이벤트를 다시 보낼 수 있도록,
  // 이 요청의 일시적 컨텍스트(쿠키/헤더)를 먼저 저장해둔다. 이 insert
  // 자체는 이 application_id에 대해 최초 1회뿐이라(방금 만들어진 신청)
  // 경쟁 상태 걱정이 없다 - attempt_count=1로 시작해 "1차 시도는 이미
  // 했다"를 곧바로 반영한다.
  const { error: dispatchInsertError } = await supabase.from('meta_lead_dispatches').insert({
    application_id: applicationId,
    attempt_count: 1,
    client_ip: clientIp,
    client_user_agent: clientUserAgent,
    created_at: submittedAt.toISOString(),
    event_source_url: eventSourceUrl,
    fbc: typeof payload.fbc === 'string' && payload.fbc ? payload.fbc : null,
    fbp: typeof payload.fbp === 'string' && payload.fbp ? payload.fbp : null,
    last_attempt_at: submittedAt.toISOString(),
  });
  if (dispatchInsertError) {
    console.error('Meta Lead dispatch row insert failed', dispatchInsertError);
    return;
  }

  const body = await buildMetaLeadEventBody({
    applicationId,
    clientIp,
    clientUserAgent,
    eventSourceUrl,
    eventTimeSeconds: Math.floor(submittedAt.getTime() / 1000),
    fbc: payload.fbc,
    fbp: payload.fbp,
    phone: payload.phone,
  });

  const send = (async () => {
    const result = await sendMetaLeadEventOnce(accessToken, body);
    if (result.ok) {
      await supabase.from('meta_lead_dispatches').update({ sent_at: new Date().toISOString() }).eq('application_id', applicationId);
    } else if (isRetryableMetaFailure(result.status)) {
      // timeout/network/5xx/429 - 일시적일 가능성이 높으니 그대로 재시도
      // 대상으로 남겨둔다(last_error만 기록, sent_at/permanently_failed_at
      // 둘 다 안 건드림).
      console.error('Meta Conversions API request failed (retryable)', result.error);
      await supabase.from('meta_lead_dispatches').update({ last_error: result.error }).eq('application_id', applicationId);
    } else {
      // 그 외 4xx(잘못된 토큰/payload 등) - 다시 시도해도 결과가 똑같을
      // 가능성이 높으므로 재시도 대상에서 뺀다(불필요한 반복 호출 방지 -
      // 사용자 지적). 크론이 이 신청을 계속 다시 집지 않는다.
      console.error('Meta Conversions API request failed (permanent)', result.error);
      await supabase
        .from('meta_lead_dispatches')
        .update({ last_error: result.error, permanently_failed_at: new Date().toISOString() })
        .eq('application_id', applicationId);
    }
  })();

  await runInBackground(send);
}

// 429(rate limit)와 5xx(Meta 쪽 일시적 오류), 그리고 네트워크 자체가 끊기거나
// 타임아웃난 경우(status가 없음)는 다시 시도하면 성공할 가능성이 있다.
// 그 외 4xx(400 잘못된 파라미터, 401 잘못된 토큰, 403 권한 없음 등)는 같은
// 요청을 몇 번을 다시 보내도 똑같이 거부되므로 재시도 대상에서 뺀다.
function isRetryableMetaFailure(status: number | null): boolean {
  if (status === null) return true;
  if (status === 429) return true;
  return status >= 500;
}

async function buildMetaLeadEventBody(params: {
  applicationId: string;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl: string;
  eventTimeSeconds: number;
  fbc?: string | null;
  fbp?: string | null;
  phone: string;
}) {
  const userData: Record<string, unknown> = {};
  if (params.clientIp) userData.client_ip_address = params.clientIp;
  if (params.clientUserAgent) userData.client_user_agent = params.clientUserAgent;
  if (params.fbp) userData.fbp = params.fbp;
  if (params.fbc) userData.fbc = params.fbc;

  const normalizedPhone = normalizePhone(params.phone);
  if (normalizedPhone) {
    // Meta 해시 요구사항: 숫자만, 국가번호 포함(선행 0 제거 후 82 부착),
    // 소문자/공백 없음(전화번호는 숫자뿐이라 해당 없음) 상태로 SHA-256.
    const metaFormattedPhone = `82${normalizedPhone.replace(/^0+/, '')}`;
    userData.ph = [await sha256(metaFormattedPhone)];
  }

  return {
    data: [
      {
        action_source: 'website',
        event_id: params.applicationId,
        event_name: 'Lead',
        event_source_url: params.eventSourceUrl,
        event_time: params.eventTimeSeconds,
        user_data: userData,
      },
    ],
    ...(Deno.env.get('META_TEST_EVENT_CODE') ? { test_event_code: Deno.env.get('META_TEST_EVENT_CODE') } : {}),
  };
}

async function sendMetaLeadEventOnce(
  accessToken: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string; status: number | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${metaPixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      },
    );
    if (response.ok) return { ok: true };
    const text = await response.text().catch(() => '');
    return { error: `HTTP ${response.status}: ${text.slice(0, 500)}`, ok: false, status: response.status };
  } catch (fetchError) {
    // fetch 자체가 던지는 경우(네트워크 끊김, AbortController 타임아웃 등)는
    // HTTP status가 아예 없다 - 항상 재시도 대상으로 분류한다.
    return { error: fetchError instanceof Error ? fetchError.message : String(fetchError), ok: false, status: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateSubmissionFields(payload: SubmitPayload, eventDate: string) {
  const requiredText: Array<[string, unknown]> = [
    ['이름', payload.name],
    ['생년월일', payload.birthDate],
    ['거주지', payload.residence],
    ['전화번호', payload.phone],
    ['닉네임', payload.nickname],
    ['키', payload.height],
    ['직업', payload.job],
    ['접속 경로', payload.accessRoute],
    ['인터뷰 여부', payload.interviewConsent],
    ['교제 상태', payload.relationshipStatus],
  ];

  for (const [label, value] of requiredText) {
    if (typeof value !== 'string' || !value.trim()) return `${label} 항목을 확인해주세요.`;
  }

  if (!allowedGenders.has(payload.gender)) return '성별 항목을 확인해주세요.';
  if (!/^01[016789][0-9]{7,8}$/.test(normalizePhone(payload.phone))) return '전화번호 형식을 확인해주세요.';
  if (!payload.consents?.privacy || !payload.consents?.thirdParty) return '필수 개인정보 동의가 필요합니다.';
  if (!payload.filmingConsent) return '촬영 동의가 필요합니다.';
  if (!payload.refundAgreement) return '환불 규정 동의가 필요합니다.';
  if (!Number.isInteger(payload.representativeIndex) || payload.representativeIndex < 0 || payload.representativeIndex >= payload.profilePhotos.length) {
    return '대표 프로필 사진을 다시 선택해주세요.';
  }
  if (!isValidRepresentativeCrop(payload.representativeCrop)) return '대표사진 위치 정보를 확인해주세요.';

  const age = getAgeOnDate(payload.birthDate, eventDate);
  if (age === null || age < 24 || age > 33) return '행사일 기준 만 24~33세만 신청할 수 있습니다.';

  return '';
}

function cleanOptionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function validateSubmissionFiles(payload: SubmitPayload) {
  const requiredImages: Array<[string, UploadedFile]> = [
    ['신분증 사진', payload.idPhoto],
    ['재직 증명 사진', payload.employmentProof],
  ];

  for (const [label, file] of requiredImages) {
    const error = validateFile(file, imageTypes, maxImageBytes, label);
    if (error) return error;
  }

  for (let index = 0; index < payload.profilePhotos.length; index += 1) {
    const error = validateFile(payload.profilePhotos[index], imageTypes, maxImageBytes, `프로필 사진 ${index + 1}`);
    if (error) return error;
  }

  // 음성 소개는 선택 항목 - 첨부하지 않았으면 검사 자체를 건너뛴다. 첨부한
  // 경우에는 여전히 형식/서명 검증을 통과해야 한다.
  if (!payload.voiceIntro) return '';
  return validateFile(payload.voiceIntro, audioTypes, maxAudioBytes, '자기소개 음성');
}

function validateFile(file: UploadedFile | undefined, allowedTypes: string[], maxBytes: number, label: string) {
  if (!file?.base64 || !file.fileName) return `${label} 파일을 첨부해주세요.`;
  const contentType = normalizeContentType(file.contentType);
  if (!allowedTypes.includes(contentType)) return `${label} 파일 형식이 올바르지 않습니다.`;
  const size = estimateBase64Bytes(file.base64);
  if (size <= 0) return `${label} 파일이 비어 있습니다.`;
  if (size > maxBytes) return `${label} 파일은 ${Math.floor(maxBytes / 1024 / 1024)}MB 이하로 첨부해주세요.`;

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(file.base64);
  } catch {
    return `${label} 파일 데이터를 읽을 수 없습니다.`;
  }

  if (bytes.length !== size && Math.abs(bytes.length - size) > 2) return `${label} 파일 데이터가 손상되었습니다.`;
  if (!matchesFileSignature(bytes, contentType)) return `${label} 파일의 실제 형식과 업로드 형식이 일치하지 않습니다.`;
  return '';
}

function matchesFileSignature(bytes: Uint8Array, contentType: string) {
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, value: string) => value.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  const isIsoBaseMedia = bytes.length >= 12 && ascii(4, 'ftyp');

  switch (contentType) {
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'image/heic':
    case 'image/heif': {
      if (!isIsoBaseMedia) return false;
      const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
      return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
    }
    case 'audio/mp4':
    case 'audio/x-m4a':
      return isIsoBaseMedia;
    case 'audio/mpeg':
      return ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'audio/aac':
      return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    case 'audio/webm':
      return startsWith(0x1a, 0x45, 0xdf, 0xa3);
    case 'audio/ogg':
      return ascii(0, 'OggS');
    case 'audio/wav':
      return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WAVE');
    default:
      return false;
  }
}

function isValidRepresentativeCrop(value: Record<string, number> | undefined) {
  if (!value || typeof value !== 'object') return false;
  return ['scale', 'offsetX', 'offsetY'].every((key) => Number.isFinite(Number(value[key])));
}

function getAgeOnDate(birthDate: string, targetDate: string) {
  const birth = parseDate(birthDate);
  const target = parseDate(targetDate);
  if (!birth || !target || birth.getTime() > target.getTime()) return null;

  let age = target.getUTCFullYear() - birth.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const birthMonth = birth.getUTCMonth();
  if (targetMonth < birthMonth || (targetMonth === birthMonth && target.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function normalizePhone(value: string) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeContentType(value: string) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function estimateBase64Bytes(base64: string) {
  const cleanValue = base64.replace(/\s/g, '');
  const padding = cleanValue.endsWith('==') ? 2 : cleanValue.endsWith('=') ? 1 : 0;
  return Math.floor((cleanValue.length * 3) / 4) - padding;
}

async function saveMemberDefaultProfile(supabase: ReturnType<typeof createClient>, snapshot: Record<string, unknown>) {
  const userId = snapshot.user_id as string;
  await supabase
    .from('participant_profiles')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_active', true);

  return supabase.from('participant_profiles').insert({
    birth_date: snapshot.birth_date,
    employment_proof_path: snapshot.employment_proof_path,
    gender: snapshot.gender,
    height: snapshot.height,
    id_photo_path: snapshot.id_photo_path,
    job: snapshot.job,
    kakao_id: snapshot.kakao_id ?? null,
    name: snapshot.name,
    nickname: snapshot.nickname,
    phone: snapshot.phone,
    profile_photo_paths: snapshot.profile_photo_paths,
    relationship_status: snapshot.relationship_status,
    representative_crop: snapshot.representative_crop,
    representative_photo_index: snapshot.representative_photo_index,
    residence: snapshot.residence,
    source_application_id: snapshot.source_application_id,
    user_id: userId,
    voice_intro_path: snapshot.voice_intro_path,
  });
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function uploadPrivateFile(supabase: ReturnType<typeof createClient>, path: string, file: UploadedFile) {
  const bytes = decodeBase64(file.base64);
  const { error } = await supabase.storage.from('application-files').upload(path, bytes, {
    cacheControl: '3600',
    contentType: normalizeContentType(file.contentType) || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    console.error('Storage upload failed', { message: error.message, path });
    throw new Error(`파일 업로드에 실패했습니다. ${error.message}`);
  }
  return path;
}

async function uploadPrivateFileWithRetry(supabase: ReturnType<typeof createClient>, path: string, file: UploadedFile) {
  const maxAttempts = 2;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await uploadPrivateFile(supabase, path, file);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw lastError;
}

async function cleanupUploadedFiles(supabase: ReturnType<typeof createClient>, paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (uniquePaths.length === 0) return;
  const { error } = await supabase.storage.from('application-files').remove(uniquePaths);
  if (error) {
    console.error('Uploaded file rollback cleanup failed', {
      message: error.message,
      paths: uniquePaths,
    });
  }
}

function decodeBase64(base64: string) {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sanitizeFileName(fileName: string) {
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return cleanName || 'file';
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
