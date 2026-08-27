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

const maxImageBytes = 6 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const signedUrlExpirySeconds = 21_600;

// 행사 준비 화면에서 운영자가 등록하는 "오픈채팅방 QR 코드" 이미지 -
// event_profile_cards 사진과 달리 참가자별이 아니라 행사 하나당 한 장이라,
// 고정 경로("event-assets/{eventId}/open-chat-qr.{ext}")에 upsert로 덮어쓴다.
// 확장자가 바뀌는 교체(예: png -> webp)는 upsert가 못 잡아주므로, 기존
// events.open_chat_qr_path가 다른 확장자였다면 그 파일을 먼저 지워
// 고아 파일이 안 남게 한다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'QR upload is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload?.eventId || typeof payload.eventId !== 'string' || typeof payload.sessionToken !== 'string' || !payload.sessionToken || !payload.photo) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const fileError = validateFile(payload.photo);
  if (fileError) return json({ message: fileError }, 400);

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

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, open_chat_qr_path')
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError || !event) return json({ message: '행사를 찾을 수 없습니다.' }, 404);

  const contentType = normalizeContentType(payload.photo.contentType);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `event-assets/${payload.eventId}/open-chat-qr.${extension}`;

  if (event.open_chat_qr_path && event.open_chat_qr_path !== path) {
    await supabase.storage.from('application-files').remove([event.open_chat_qr_path]);
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(payload.photo.base64);
  } catch {
    return json({ message: '사진 데이터를 읽을 수 없습니다.' }, 400);
  }

  const { error: uploadError } = await supabase.storage.from('application-files').upload(path, bytes, {
    cacheControl: '3600',
    contentType,
    upsert: true,
  });

  if (uploadError) {
    console.error('Open chat QR upload failed', { message: uploadError.message, path });
    return json({ message: `QR 코드 업로드에 실패했습니다. ${uploadError.message}` }, 500);
  }

  const { error: updateError } = await supabase.from('events').update({ open_chat_qr_path: path }).eq('id', payload.eventId);
  if (updateError) return json({ message: 'QR 코드 경로 저장에 실패했습니다.' }, 500);

  const { data: signed } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);

  return json({ ok: true, qrUrl: signed?.signedUrl ?? null });
});

function validateFile(file: UploadedFile) {
  if (!file?.base64 || !file.fileName) return 'QR 이미지 파일을 첨부해주세요.';
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
