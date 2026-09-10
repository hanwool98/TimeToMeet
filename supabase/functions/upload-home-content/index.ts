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

type CropPosition = { scale?: number; offsetX?: number; offsetY?: number };

type Payload = {
  caption?: string;
  cropPosition?: CropPosition;
  photo?: UploadedFile;
  sectionType?: string;
  sessionToken?: string;
};

const maxImageBytes = 6 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const signedUrlExpirySeconds = 21_600;
const allowedSections = ['love_reason', 'field_sketch', 'recruitment_application'];

// 관리자 "홈 콘텐츠 관리"에서 캐러셀용 이미지를 업로드한다. 기존 단일 버킷
// (application-files)의 home-contents/{sectionType}/ 프리픽스에 새 오브젝트로
// 저장하고, home_contents 행까지 여기서 함께 만든다(upload-event-open-chat-qr가
// events row를 직접 갱신하는 것과 같은 방식 - 별도 저장 RPC를 두지 않음).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Home content upload is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (
    !payload ||
    typeof payload.sessionToken !== 'string' ||
    !payload.sessionToken ||
    typeof payload.sectionType !== 'string' ||
    !allowedSections.includes(payload.sectionType) ||
    !payload.photo
  ) {
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

  const contentType = normalizeContentType(payload.photo.contentType);
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const path = `home-contents/${payload.sectionType}/${crypto.randomUUID()}.${extension}`;

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(payload.photo.base64);
  } catch {
    return json({ message: '이미지 데이터를 읽을 수 없습니다.' }, 400);
  }

  const { error: uploadError } = await supabase.storage.from('application-files').upload(path, bytes, {
    cacheControl: '3600',
    contentType,
    upsert: false,
  });

  if (uploadError) {
    console.error('Home content upload failed', { message: uploadError.message, path });
    return json({ message: `이미지 업로드에 실패했습니다. ${uploadError.message}` }, 500);
  }

  const { data: maxRow } = await supabase
    .from('home_contents')
    .select('sort_order')
    .eq('section_type', payload.sectionType)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const cropPosition = sanitizeCrop(payload.cropPosition);

  const { data: inserted, error: insertError } = await supabase
    .from('home_contents')
    .insert({
      caption: typeof payload.caption === 'string' ? payload.caption.trim() : '',
      crop_position: cropPosition,
      section_type: payload.sectionType,
      sort_order: nextSortOrder,
      storage_path: path,
    })
    .select('id, section_type, storage_path, caption, sort_order, is_visible, crop_position')
    .single();

  if (insertError || !inserted) {
    // 행 저장이 실패하면 방금 올린 고아 파일은 지워둔다.
    await supabase.storage.from('application-files').remove([path]);
    return json({ message: '콘텐츠 정보 저장에 실패했습니다.' }, 500);
  }

  const { data: signed } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);

  return json({
    ok: true,
    content: {
      caption: inserted.caption,
      cropPosition: inserted.crop_position,
      id: inserted.id,
      imageUrl: signed?.signedUrl ?? null,
      isVisible: inserted.is_visible,
      sectionType: inserted.section_type,
      sortOrder: inserted.sort_order,
      storagePath: inserted.storage_path,
    },
  });
});

function sanitizeCrop(crop: CropPosition | undefined) {
  const scale = Number(crop?.scale);
  const offsetX = Number(crop?.offsetX);
  const offsetY = Number(crop?.offsetY);
  return {
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    scale: Number.isFinite(scale) && scale >= 1 && scale <= 4 ? scale : 1,
  };
}

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
