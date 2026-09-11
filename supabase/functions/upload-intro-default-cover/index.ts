import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type UploadedFile = { base64: string; contentType: string; fileName: string };
type Payload = { photo?: UploadedFile; remove?: boolean; sessionToken?: string };

const maxImageBytes = 6 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const signedUrlExpirySeconds = 21_600;

// 관리자 "행사소개 관리 > 기본 행사 정보"의 대표 이미지 등록/교체/삭제.
// upload-event-cover와 동일 패턴 - 고정 경로 intro-content/default-cover.{ext}
// 에 upsert하고 intro_default_info.default_cover_path를 갱신한다. 실제
// 행사에 연결된 상태에서는 이 값이 전혀 쓰이지 않는다(그 행사의 실제
// 대표 이미지가 우선).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Default cover upload is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload || typeof payload.sessionToken !== 'string' || !payload.sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }
  if (!payload.remove && !payload.photo) return json({ message: 'Invalid request.' }, 400);

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

  const { data: row } = await supabase.from('intro_default_info').select('default_cover_path').eq('id', 1).maybeSingle();
  const existingPath = (row?.default_cover_path as string | null) ?? null;

  if (payload.remove) {
    if (existingPath) await supabase.storage.from('application-files').remove([existingPath]);
    const { error: clearError } = await supabase.from('intro_default_info').update({ default_cover_path: null }).eq('id', 1);
    if (clearError) return json({ message: '대표 이미지 삭제에 실패했습니다.' }, 500);
    return json({ ok: true, coverImagePath: null, coverImageUrl: null });
  }

  const fileError = validateFile(payload.photo!);
  if (fileError) return json({ message: fileError }, 400);

  const contentType = normalizeContentType(payload.photo!.contentType);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `intro-content/default-cover.${extension}`;

  if (existingPath && existingPath !== path) {
    await supabase.storage.from('application-files').remove([existingPath]);
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(payload.photo!.base64);
  } catch {
    return json({ message: '이미지 데이터를 읽을 수 없습니다.' }, 400);
  }

  const { error: uploadError } = await supabase.storage.from('application-files').upload(path, bytes, {
    cacheControl: '3600',
    contentType,
    upsert: true,
  });
  if (uploadError) {
    console.error('Intro default cover upload failed', { message: uploadError.message, path });
    return json({ message: `대표 이미지 업로드에 실패했습니다. ${uploadError.message}` }, 500);
  }

  const { error: updateError } = await supabase.from('intro_default_info').update({ default_cover_path: path }).eq('id', 1);
  if (updateError) return json({ message: '대표 이미지 경로 저장에 실패했습니다.' }, 500);

  const { data: signed } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return json({ ok: true, coverImagePath: path, coverImageUrl: signed?.signedUrl ?? null });
});

function validateFile(file: UploadedFile) {
  if (!file?.base64 || !file.fileName) return '이미지 파일을 첨부해주세요.';
  const contentType = normalizeContentType(file.contentType);
  if (!imageTypes.includes(contentType)) return '이미지 파일 형식이 올바르지 않습니다.';
  const size = estimateBase64Bytes(file.base64);
  if (size <= 0) return '이미지 파일이 비어 있습니다.';
  if (size > maxImageBytes) return `이미지 파일은 ${Math.floor(maxImageBytes / 1024 / 1024)}MB 이하로 첨부해주세요.`;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(file.base64);
  } catch {
    return '이미지 파일 데이터를 읽을 수 없습니다.';
  }
  if (bytes.length !== size && Math.abs(bytes.length - size) > 2) return '이미지 파일 데이터가 손상되었습니다.';
  if (!matchesFileSignature(bytes, contentType)) return '이미지 파일의 실제 형식과 업로드 형식이 일치하지 않습니다.';
  return '';
}

function matchesFileSignature(bytes: Uint8Array, contentType: string) {
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return bytes.length >= 12 && startsWith(0x52, 0x49, 0x46, 0x46);
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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
