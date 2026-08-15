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

  const supabase = createClient(supabaseUrl, serviceRoleKey);
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
    .select('id')
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError) return json({ message: '행사 정보를 확인하지 못했습니다.' }, 500);
  if (!event) return json({ message: '선택한 행사를 찾을 수 없습니다.' }, 404);

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
    access_route: payload.accessRoute,
    applicant_kind: session.role,
    birth_date: payload.birthDate,
    consents: payload.consents,
    employment_proof_path: employmentProofPath,
    event_id: payload.eventId,
    filming_consent: payload.filmingConsent,
    gender: payload.gender,
    height: payload.height,
    id_photo_path: idPhotoPath,
    inquiry: payload.inquiry,
    interview_consent: payload.interviewConsent,
    job: payload.job,
    name: payload.name,
    nickname: payload.nickname,
    phone: payload.phone,
    profile_photo_paths: profilePhotoPaths,
    refund_agreement: payload.refundAgreement,
    relationship_status: payload.relationshipStatus,
    representative_crop: payload.representativeCrop,
    representative_photo_index: payload.representativeIndex,
    residence: payload.residence,
    is_returning: payload.returning,
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
    return json({ message: `신청서 저장에 실패했습니다. ${insertError.message}` }, 500);
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

  await supabase.from('application_drafts').delete().eq('event_id', payload.eventId).eq('user_id', userId);
  return json({ ok: true });
});

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
  return '';
}

function normalizeContentType(value: string) {
  return value.split(';')[0].trim().toLowerCase();
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
    contentType: file.contentType || 'application/octet-stream',
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
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sanitizeFileName(fileName: string) {
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleanName || 'file';
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
