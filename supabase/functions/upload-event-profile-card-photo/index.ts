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

// Client already downscales/re-encodes before sending (see resizeImageFile in
// supabaseApplications.ts), so this ceiling only needs to catch someone
// bypassing that - not size a "normal" upload.
const maxImageBytes = 6 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const signedUrlExpirySeconds = 600;

// 프로필 카드 전용 대표사진 업로드. 기존 기본 프로필의
// applications.profile_photo_paths는 절대 건드리지 않고, 완전히 새로운
// Storage 오브젝트를 만들어 그 경로만 반환한다 - 실제로 event_profile_cards
// 행에 저장하는 것은 save_event_profile_card_for_session RPC의 몫이다(여기서는
// 업로드만 하고 DB에 쓰지 않음). 그 RPC는 경로가 본인 user_id로 시작하는지로
// 소유권을 검증한다(아래 path 생성 방식과 짝을 이룸).
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
    .order('checked_in_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (myApplicationError || !myApplication) {
    return json({ message: '체크인된 참가자만 프로필 카드 사진을 등록할 수 있습니다.' }, 404);
  }

  const contentType = normalizeContentType(payload.photo.contentType);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  // 행사 이름이 한글이면 이벤트 id 자체에도 한글이 그대로 들어간다
  // (createEventId가 유니코드 글자를 보존함) - Storage 오브젝트 key는
  // 비-ASCII 문자를 거부하므로("Invalid key") 그대로 못 쓴다.
  const safeEventId = await sanitizeIdForStoragePath(payload.eventId);
  const path = `${session.user_id}/event-card-${safeEventId}/${crypto.randomUUID()}.${extension}`;

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
    console.error('Event profile card photo upload failed', { message: uploadError.message, path });
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

// id가 이미 Storage key로 안전하면(영문/숫자/._-) 그대로 쓰고(기존에 이미
// 업로드된 경로와 계속 호환), 그렇지 않으면(한글 등 비-ASCII 포함) 결정적
// 해시로 치환한다 - 같은 eventId는 항상 같은 경로를 가리키므로 이후
// 업로드/조회가 서로 어긋나지 않는다.
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
