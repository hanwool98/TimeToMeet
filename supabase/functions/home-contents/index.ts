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

// 홈 배너/현장 스케치는 참가자 개인정보가 아니라 누구나 보는 마케팅
// 이미지라 짧게 만료시킬 이유가 없다 - 오히려 만료가 짧으면 방문할 때마다
// 새 서명 URL이 발급돼 브라우저/CDN이 같은 파일도 매번 새로 받아야 한다.
// 7일로 넉넉히 늘려서 클라이언트 캐시(fetchPublicHomeContents의 24시간
// 캐시)가 실제 만료 시점보다 항상 충분히 먼저 갱신되도록 여유를 둔다.
const signedUrlExpirySeconds = 604_800;
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

  // storagePath를 공개 응답에도 실어준다 - 이미지 자체가 아니라 그냥 경로
  // 문자열이라 노출에 문제가 없고, 클라이언트가 이 값으로 "같은 파일이면
  // 이전에 캐시해둔 서명 URL을 재사용" 판단을 할 수 있게 해준다
  // (fetchPublicHomeContents 참고). 이 콘텐츠는 한 번 업로드되면 캡션/크롭만
  // 바뀔 뿐 storage_path 자체는 바뀌지 않으므로(교체하려면 삭제 후 새로
  // 업로드해야 함 - AdminHomeContentPage/updateHomeContent 참고) 경로가
  // 같다는 것은 곧 같은 이미지라는 뜻이다.
  const contents = await Promise.all(
    (rows ?? []).map(async (row) => ({
      caption: row.caption as string,
      cropPosition: row.crop_position,
      id: row.id as string,
      imageUrl: await signUrl(supabase, row.storage_path as string),
      storagePath: row.storage_path as string,
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
