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
  filmingConsent: boolean;
  gender: string;
  height: string;
  idPhoto: UploadedFile;
  inquiry: string;
  interviewConsent: string;
  job: string;
  name: string;
  nickname: string;
  phone: string;
  profilePhotos: UploadedFile[];
  refundAgreement: boolean;
  relationshipStatus: string;
  representativeCrop: Record<string, number>;
  representativeIndex: number;
  residence: string;
  returning: boolean;
  saveAsDefaultProfile?: boolean;
  sessionToken: string;
  userId?: string;
  voiceIntro: UploadedFile;
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

  const payload = await request.json().catch(() => null) as SubmitPayload | null;
  if (!payload?.sessionToken || !payload.eventId) return json({ message: '로그인 또는 비회원 세션이 필요합니다.' }, 401);
  if (!payload.idPhoto || !payload.employmentProof || !payload.voiceIntro || !Array.isArray(payload.profilePhotos) || payload.profilePhotos.length === 0) {
    return json({ message: '필수 첨부 파일을 확인해주세요.' }, 400);
  }
  if (payload.profilePhotos.length > 3) return json({ message: '프로필 사진은 최대 3장까지 첨부할 수 있습니다.' }, 400);

  const fileValidationError = validateSubmissionFiles(payload);
  if (fileValidationError) return json({ message: fileValidationError }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, role, expires_at')
    .eq('token_hash', tokenHash)
    .in('role', ['guest', 'member'])
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: '로그인 또는 비회원 세션이 만료되었습니다. 다시 로그인해주세요.' }, 401);
  }

  const userId = session.user_id as string;
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, event_date, application_deadline')
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError) return json({ message: '행사 정보를 확인하지 못했습니다.' }, 500);
  if (!event) return json({ message: '선택한 행사를 찾을 수 없습니다.' }, 404);
  if (event.application_deadline && new Date(event.application_deadline).getTime() <= Date.now()) {
    return json({ message: '이 행사의 신청이 마감되었습니다.' }, 409);
  }

  const fieldValidationError = validateSubmissionFields(payload, String(event.event_date));
  if (fieldValidationError) return json({ message: fieldValidationError }, 400);

  if (session.role === 'guest') {
    const { data: guestAccount, error: guestAccountError } = await supabase
      .from('guest_accounts')
      .select('phone_normalized')
      .eq('user_id', userId)
      .maybeSingle();

    if (guestAccountError) return json({ message: '비회원 계정 정보를 확인하지 못했습니다.' }, 500);
    if (!guestAccount?.phone_normalized || normalizePhone(payload.phone) !== guestAccount.phone_normalized) {
      return json({ message: '비회원 로그인 전화번호와 신청서 전화번호가 일치해야 합니다.' }, 400);
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from('applications')
    .select('id')
    .eq('event_id', payload.eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) return json({ message: '기존 신청 내역 확인에 실패했습니다.' }, 500);
  if (existing) return json({ message: '이미 이 행사에 신청한 내역이 있습니다.' }, 409);

  let idPhotoPath = '';
  let employmentProofPath = '';
  let voiceIntroPath = '';
  let profilePhotoPaths: string[] = [];
  const uploadedPaths: string[] = [];
  try {
    const basePath = `${userId}/${crypto.randomUUID()}`;
    idPhotoPath = await uploadPrivateFile(supabase, `${basePath}/id-${sanitizeFileName(payload.idPhoto.fileName)}`, payload.idPhoto);
    uploadedPaths.push(idPhotoPath);
    employmentProofPath = await uploadPrivateFile(supabase, `${basePath}/employment-${sanitizeFileName(payload.employmentProof.fileName)}`, payload.employmentProof);
    uploadedPaths.push(employmentProofPath);
    voiceIntroPath = await uploadPrivateFile(supabase, `${basePath}/voice-${sanitizeFileName(payload.voiceIntro.fileName)}`, payload.voiceIntro);
    uploadedPaths.push(voiceIntroPath);
    profilePhotoPaths = [];
    for (let index = 0; index < payload.profilePhotos.length; index += 1) {
      const file = payload.profilePhotos[index];
      const uploadedPath = await uploadPrivateFile(supabase, `${basePath}/profile-${index + 1}-${sanitizeFileName(file.fileName)}`, file);
      profilePhotoPaths.push(uploadedPath);
      uploadedPaths.push(uploadedPath);
    }
  } catch (error) {
    console.error('Application file upload failed', error);
    await cleanupUploadedFiles(supabase, uploadedPaths);
    return json({ message: error instanceof Error ? error.message : '파일 업로드에 실패했습니다.' }, 500);
  }

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
    name: payload.name.trim(),
    nickname: payload.nickname.trim(),
    phone: normalizePhone(payload.phone),
    profile_photo_paths: profilePhotoPaths,
    refund_agreement: payload.refundAgreement,
    relationship_status: payload.relationshipStatus.trim(),
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
    return json({ message: deadlineMessage }, 500);
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
      return json({ message: `신청서는 저장됐지만 기본 프로필 저장에 실패했습니다. ${profileError.message}` }, 500);
    }
  }

  const { error: draftDeleteError } = await supabase
    .from('application_drafts')
    .delete()
    .eq('event_id', payload.eventId)
    .eq('user_id', userId);
  if (draftDeleteError) console.error('Application draft cleanup failed', draftDeleteError);

  return json({ ok: true });
});

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
  if (age === null || age < 23 || age > 35) return '행사일 기준 만 23~35세만 신청할 수 있습니다.';

  return '';
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
