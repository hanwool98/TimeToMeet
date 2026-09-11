import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  sessionToken?: string;
};

const signedUrlExpirySeconds = 21_600;

// 타임투밋 공통 행사소개 콘텐츠(텍스트/이미지 갤러리 섹션) 조회 전용.
// 행사별 콘텐츠가 아니라 앱 전체에서 공유하는 단일 콘텐츠라 eventId를
// 받지 않는다. 이미지는 Storage 서명(service role)이 필요해 RPC로는 못
// 하고 Edge Function으로 처리한다(home-contents와 동일한 구조).
//   - 공개(참가자) 호출: {} -> is_visible=true 섹션만 순서대로
//   - 관리자 호출: { sessionToken } -> 숨김 포함 전체 섹션
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Intro content access is not configured.' }, 500);

  const payload = (await request.json().catch(() => ({}))) as Payload;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const isAdminCall = typeof payload.sessionToken === 'string' && Boolean(payload.sessionToken);

  if (isAdminCall) {
    const tokenHash = await sha256(payload.sessionToken as string);
    const { data: session, error: sessionError } = await supabase
      .from('app_sessions')
      .select('role, expires_at')
      .eq('token_hash', tokenHash)
      .eq('role', 'admin')
      .maybeSingle();

    if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
      return json({ message: 'Admin session required.' }, 401);
    }
  }

  let sectionQuery = supabase
    .from('intro_sections')
    .select('id, section_type, title, content, display_order, is_visible')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (!isAdminCall) sectionQuery = sectionQuery.eq('is_visible', true);

  const { data: sectionRows, error: sectionError } = await sectionQuery;
  if (sectionError) return json({ message: '행사소개를 불러오지 못했습니다.' }, 500);

  const sectionIds = (sectionRows ?? []).map((row) => row.id as string);
  const imagesBySection = new Map<string, Array<{ id: string; imageUrl: string | null; caption: string; displayOrder: number }>>();

  if (sectionIds.length > 0) {
    const { data: imageRows } = await supabase
      .from('intro_images')
      .select('id, section_id, storage_path, caption, display_order')
      .in('section_id', sectionIds)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    for (const row of imageRows ?? []) {
      const list = imagesBySection.get(row.section_id as string) ?? [];
      list.push({
        caption: (row.caption as string) ?? '',
        displayOrder: row.display_order as number,
        id: row.id as string,
        imageUrl: await signUrl(supabase, row.storage_path as string),
      });
      imagesBySection.set(row.section_id as string, list);
    }
  }

  const sections = (sectionRows ?? []).map((row) => ({
    content: (row.content as string | null) ?? null,
    displayOrder: row.display_order as number,
    id: row.id as string,
    images: imagesBySection.get(row.id as string) ?? [],
    isVisible: row.is_visible as boolean,
    sectionType: row.section_type as 'text' | 'gallery',
    title: (row.title as string | null) ?? null,
  }));

  const { data: defaultRow } = await supabase
    .from('intro_default_info')
    .select(
      'title, date_label, start_time, location, male_price, female_price, male_capacity, female_capacity, discount_note, default_cover_path',
    )
    .eq('id', 1)
    .maybeSingle();

  const defaultCoverPath = (defaultRow?.default_cover_path as string | null) ?? null;

  const defaultInfo = {
    coverUrl: defaultCoverPath ? await signUrl(supabase, defaultCoverPath) : null,
    dateLabel: (defaultRow?.date_label as string | null) ?? null,
    discountNote: (defaultRow?.discount_note as string | null) ?? null,
    femaleCapacity: (defaultRow?.female_capacity as number | null) ?? null,
    femalePrice: (defaultRow?.female_price as number | null) ?? null,
    location: (defaultRow?.location as string | null) ?? null,
    maleCapacity: (defaultRow?.male_capacity as number | null) ?? null,
    malePrice: (defaultRow?.male_price as number | null) ?? null,
    startTime: (defaultRow?.start_time as string | null) ?? null,
    title: (defaultRow?.title as string | null) ?? null,
  };

  return json({ ok: true, defaultInfo, sections });
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
