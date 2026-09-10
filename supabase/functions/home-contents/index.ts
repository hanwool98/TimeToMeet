import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  sectionType?: string;
  sessionToken?: string;
};

const signedUrlExpirySeconds = 21_600;
const allowedSections = ['love_reason', 'field_sketch', 'recruitment_application'];

// 홈 콘텐츠 조회 전용. Storage 서명(service role 필요)이 있어야 하므로 RPC로는
// 못 하고 Edge Function으로 처리한다.
//   - 공개(홈) 호출: { sectionType } -> 그 섹션의 is_visible=true 행만 sort_order 순
//   - 관리자 호출: { sessionToken } (+ 선택 sectionType) -> 숨김 포함 전체 행
// get-event-open-chat-qr가 admin/tablet 분기를 한 함수에서 처리하는 것과 동일.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Home content access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const isAdminCall = typeof payload?.sessionToken === 'string' && Boolean(payload?.sessionToken);

  if (isAdminCall) {
    const tokenHash = await sha256(payload!.sessionToken as string);
    const { data: session, error: sessionError } = await supabase
      .from('app_sessions')
      .select('role, expires_at')
      .eq('token_hash', tokenHash)
      .eq('role', 'admin')
      .maybeSingle();

    if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
      return json({ message: 'Admin session required.' }, 401);
    }

    let adminQuery = supabase
      .from('home_contents')
      .select('id, section_type, storage_path, caption, sort_order, is_visible, crop_position')
      .order('section_type', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (typeof payload?.sectionType === 'string' && allowedSections.includes(payload.sectionType)) {
      adminQuery = adminQuery.eq('section_type', payload.sectionType);
    }

    const { data: rows, error: rowsError } = await adminQuery;
    if (rowsError) return json({ message: '홈 콘텐츠를 불러오지 못했습니다.' }, 500);

    const contents = await Promise.all(
      (rows ?? []).map(async (row) => ({
        caption: row.caption as string,
        cropPosition: row.crop_position,
        id: row.id as string,
        imageUrl: await signUrl(supabase, row.storage_path as string),
        isVisible: row.is_visible as boolean,
        sectionType: row.section_type as string,
        sortOrder: row.sort_order as number,
        storagePath: row.storage_path as string,
      })),
    );

    return json({ ok: true, contents });
  }

  if (typeof payload?.sectionType !== 'string' || !allowedSections.includes(payload.sectionType)) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const { data: rows, error: rowsError } = await supabase
    .from('home_contents')
    .select('id, caption, storage_path, crop_position')
    .eq('section_type', payload.sectionType)
    .eq('is_visible', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (rowsError) return json({ ok: true, contents: [] });

  const contents = await Promise.all(
    (rows ?? []).map(async (row) => ({
      caption: row.caption as string,
      cropPosition: row.crop_position,
      id: row.id as string,
      imageUrl: await signUrl(supabase, row.storage_path as string),
    })),
  );

  return json({ ok: true, contents });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
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
