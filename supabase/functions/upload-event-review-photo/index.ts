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

type Payload = {
  eventId?: string;
  photo?: UploadedFile;
  sessionToken?: string;
};

// 클라이언트가 이미 compressImageIfNeeded로 축소/재인코딩해서 보내므로
// 이 상한은 그걸 우회한 경우만 걸러낸다 - 일반 업로드를 재는 값이 아니다.
const maxImageBytes = 6 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const signedUrlExpirySeconds = 600;

// 후기 첨부 사진 업로드(최대 3장, 개수 제한은 save_event_review_for_session
// 쪽에서 최종 검증). 여기서는 업로드만 하고 event_reviews에는 쓰지 않는다 -
// 실제 저장은 후기 제출 시점에 save_event_review_for_session이 한다(선택만
// 하고 제출 안 하면 아무 것도 Storage에 남지 않도록, 업로드 자체를
// 프론트에서 제출 버튼을 눌렀을 때만 호출하는 구조).
// 경로 규칙(event-reviews/{sanitized eventId}/{applicationId}/...)은
// save_event_review_for_session의 소유권 검증과 반드시 일치해야 한다 -
// sanitize_storage_id(SQL)와 sanitizeIdForStoragePath(여기)가 동일한
// sha256 hex 규칙을 쓴다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Photo upload is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload?.eventId || typeof payload.sessionToken !== 'string' || !payload.sessionToken || !payload.photo) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const fileError = validateFile(payload.photo);
  if (fileError) return json({ message: fileError }, 400);

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
    .not('checked_in_at', 'is', null)
    .order('checked_in_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (myApplicationError || !myApplication) {
    return json({ message: '체크인된 참가자만 후기 사진을 등록할 수 있습니다.' }, 404);
  }

  const contentType = normalizeContentType(payload.photo.contentType);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const safeEventId = await sanitizeIdForStoragePath(payload.eventId);
  const path = `event-reviews/${safeEventId}/${myApplication.id}/${crypto.randomUUID()}.${extension}`;

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(payload.photo.base64);
  } catch {
    return json({ message: '사진 데이터를 읽을 수 없습니다.' }, 400);
  }

  const { error: uploadError } = await supabase.storage.from('application-files').upload(path, bytes, {
    cacheControl: '3600',
    contentType,
    upsert: false,
  });

  if (uploadError) {
    console.error('Event review photo upload failed', { message: uploadError.message, path });
    return json({ message: `사진 업로드에 실패했습니다. ${uploadError.message}` }, 500);
  }

  const { data: signed } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);

  return json({ ok: true, photoPath: path, photoUrl: signed?.signedUrl ?? null });
});

function validateFile(file: UploadedFile) {
  if (!file?.base64 || !file.fileName) return '사진 파일을 첨부해주세요.';
  const contentType = normalizeContentType(file.contentType);
  if (!imageTypes.includes(contentType)) return '사진 파일 형식이 올바르지 않습니다.';
  const size = estimateBase64Bytes(file.base64);
  if (size <= 0) return '사진 파일이 비어 있습니다.';
  if (size > maxImageBytes) return `사진 파일은 ${Math.floor(maxImageBytes / 1024 / 1024)}MB 이하로 첨부해주세요.`;

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(file.base64);
  } catch {
    return '사진 파일 데이터를 읽을 수 없습니다.';
  }
  if (bytes.length !== size && Math.abs(bytes.length - size) > 2) return '사진 파일 데이터가 손상되었습니다.';
  if (!matchesFileSignature(bytes, contentType)) return '사진 파일의 실제 형식과 업로드 형식이 일치하지 않습니다.';
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

async function sanitizeIdForStoragePath(id: string) {
  if (/^[A-Za-z0-9_.-]+$/.test(id)) return id;
  return sha256(id);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
