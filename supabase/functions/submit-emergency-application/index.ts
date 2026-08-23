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

// 행사 시작 전 긴급 대체 참가자용 간소화 신청 - 일반 submit-application의
// 신분증/재직증명/24시간 결제 제한 없이, 운영자가 발급한 1회성 토큰만으로
// 닉네임/성별/생년월일/직업/대표사진/(선택)음성소개만 받아 곧바로 심사
// 대기 신청서를 만든다. 승인은 approve_emergency_participant_for_session이
// 별도로 처리한다(이 함수는 신청서 생성 + 세션 발급까지만 담당).
type EmergencySubmitPayload = {
  birthDate: string;
  eventId: string;
  gender: string;
  job: string;
  nickname: string;
  representativeCrop: Record<string, number>;
  representativePhoto: UploadedFile;
  token: string;
  voiceIntro?: UploadedFile;
};

const maxImageBytes = 8 * 1024 * 1024;
const maxAudioBytes = 8 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const audioTypes = ['audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-m4a'];
const allowedGenders = new Set(['남성', '여성']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Supabase server configuration is missing.' }, 500);

  const payload = await request.json().catch(() => null) as EmergencySubmitPayload | null;
  if (!payload?.token || !payload.eventId) return json({ message: '유효하지 않은 긴급 참가 링크입니다.' }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // 이 링크는 1회성이어야 하므로, "확인만" 하는 is_emergency_participant_token_valid
  // 대신 여기서는 used_at을 즉시 원자적으로 소모(claim)한다 - 조건에 맞는
  // 행이 실제로 갱신됐을 때만 성공으로 본다(동시에 두 번 제출돼도 하나만
  // 통과). 이 시점에 이미 사용 처리되므로, 아래에서 행사 시작 여부 등으로
  // 이후 단계가 실패하더라도 같은 링크는 다시 쓸 수 없다.
  const tokenHash = await sha256(payload.token);
  const { data: claimedToken, error: claimError } = await supabase
    .from('emergency_participant_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('event_id', payload.eventId)
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  if (claimError || !claimedToken) {
    return json({ message: '긴급 참가 링크가 만료되었거나 이미 사용되었습니다. 운영자에게 새 링크를 요청해주세요.' }, 403);
  }

  const fieldError = validateFields(payload);
  if (fieldError) return json({ message: fieldError }, 400);

  const photoError = validateFile(payload.representativePhoto, imageTypes, maxImageBytes, '대표 사진');
  if (photoError) return json({ message: photoError }, 400);
  if (payload.voiceIntro) {
    const voiceError = validateFile(payload.voiceIntro, audioTypes, maxAudioBytes, '음성 소개');
    if (voiceError) return json({ message: voiceError }, 400);
  }

  // 토큰이 유효한 시점과 실제 신청서를 만드는 이 시점 사이에도 행사가
  // 시작될 수 있으므로 마지막으로 한 번 더 확인한다.
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, started_at')
    .eq('id', payload.eventId)
    .maybeSingle();
  if (eventError || !event) return json({ message: '행사 정보를 확인하지 못했습니다.' }, 404);
  if (event.started_at) return json({ message: '행사가 시작된 이후에는 긴급 대체 참가자를 추가할 수 없습니다.' }, 409);

  let representativePhotoPath = '';
  let voiceIntroPath: string | null = null;
  const uploadedPaths: string[] = [];
  const basePath = `emergency/${payload.eventId}/${crypto.randomUUID()}`;

  try {
    representativePhotoPath = await uploadPrivateFileWithRetry(
      supabase,
      `${basePath}/profile-1-${sanitizeFileName(payload.representativePhoto.fileName)}`,
      payload.representativePhoto,
    );
    uploadedPaths.push(representativePhotoPath);

    if (payload.voiceIntro) {
      voiceIntroPath = await uploadPrivateFileWithRetry(
        supabase,
        `${basePath}/voice-${sanitizeFileName(payload.voiceIntro.fileName)}`,
        payload.voiceIntro,
      );
      uploadedPaths.push(voiceIntroPath);
    }
  } catch (error) {
    console.error('Emergency application file upload failed', error);
    await cleanupUploadedFiles(supabase, uploadedPaths);
    const message = error instanceof Error ? error.message : '파일 업로드에 실패했습니다.';
    return json({ message }, 500);
  }

  // 긴급 도보 참가자는 phone+PIN 로그인 없이 토큰만으로 바로 행사모드를
  // 이용해야 하므로, 실제 전화번호 대신 다른 게스트와 절대 충돌하지 않는
  // 합성 식별자를 만든다 - guest_accounts.phone_normalized는 UNIQUE지만
  // 자릿수/형식을 강제하는 DB 제약은 없어 안전하다.
  const syntheticPhone = `EMG-${crypto.randomUUID()}`;
  let userId = '';

  try {
    const { data: newUser, error: userError } = await supabase
      .from('app_users')
      .insert({ account_type: 'guest' })
      .select('user_id')
      .single();
    if (userError || !newUser) throw new Error(userError?.message ?? '게스트 계정 생성에 실패했습니다.');
    userId = newUser.user_id as string;

    const { error: guestError } = await supabase
      .from('guest_accounts')
      .insert({ user_id: userId, phone_normalized: syntheticPhone });
    if (guestError) throw new Error(guestError.message);

    const { error: userAccountError } = await supabase
      .from('user_accounts')
      .upsert({ user_id: userId, account_type: 'guest' }, { onConflict: 'user_id' });
    if (userAccountError) throw new Error(userAccountError.message);
  } catch (error) {
    console.error('Emergency guest account creation failed', error);
    await cleanupUploadedFiles(supabase, uploadedPaths);
    const message = error instanceof Error ? error.message : '게스트 계정 생성에 실패했습니다.';
    return json({ message }, 500);
  }

  const { data: insertedApplication, error: insertError } = await supabase
    .from('applications')
    .insert({
      access_route: '긴급 대체 참가',
      birth_date: payload.birthDate,
      event_id: payload.eventId,
      filming_consent: true,
      gender: payload.gender,
      height: '',
      interview_consent: '아니오',
      is_emergency_walkin: true,
      job: payload.job.trim(),
      name: payload.nickname.trim(),
      nickname: payload.nickname.trim(),
      phone: syntheticPhone,
      profile_photo_paths: [representativePhotoPath],
      refund_agreement: true,
      relationship_status: '긴급 대체 참가자',
      representative_crop: payload.representativeCrop,
      representative_photo_index: 0,
      residence: '',
      review_notice_confirmed: true,
      status: '심사 대기',
      user_id: userId,
      voice_intro_path: voiceIntroPath,
    })
    .select('id')
    .single();

  if (insertError || !insertedApplication) {
    console.error('Emergency application insert failed', insertError);
    await cleanupUploadedFiles(supabase, uploadedPaths);
    return json({ message: `긴급 참가 신청서 저장에 실패했습니다. ${insertError?.message ?? ''}`.trim() }, 500);
  }

  const { data: sessionRows, error: sessionError } = await supabase.rpc('issue_app_session', {
    target_role: 'guest',
    target_user_id: userId,
    ttl: '30 days',
  });
  if (sessionError || !sessionRows) {
    console.error('Emergency session issue failed', sessionError);
    return json({ message: '신청서는 저장됐지만 세션 발급에 실패했습니다. 운영자에게 문의해주세요.' }, 500);
  }
  const session = Array.isArray(sessionRows) ? sessionRows[0] : sessionRows;

  return json({
    applicationId: insertedApplication.id,
    expiresAt: session.expires_at,
    ok: true,
    sessionToken: session.session_token,
    userId: session.user_id,
  });
});

function validateFields(payload: EmergencySubmitPayload) {
  if (!payload.nickname?.trim()) return '닉네임을 입력해주세요.';
  if (!allowedGenders.has(payload.gender)) return '성별을 선택해주세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.birthDate ?? '')) return '생년월일을 확인해주세요.';
  if (!payload.job?.trim()) return '직업을 입력해주세요.';
  if (!isValidRepresentativeCrop(payload.representativeCrop)) return '대표사진 위치 정보를 확인해주세요.';
  return '';
}

function isValidRepresentativeCrop(value: Record<string, number> | undefined) {
  if (!value || typeof value !== 'object') return false;
  return ['scale', 'offsetX', 'offsetY'].every((key) => Number.isFinite(Number(value[key])));
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

function normalizeContentType(value: string) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function estimateBase64Bytes(base64: string) {
  const cleanValue = base64.replace(/\s/g, '');
  const padding = cleanValue.endsWith('==') ? 2 : cleanValue.endsWith('=') ? 1 : 0;
  return Math.floor((cleanValue.length * 3) / 4) - padding;
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
    console.error('Uploaded file rollback cleanup failed', { message: error.message, paths: uniquePaths });
  }
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
