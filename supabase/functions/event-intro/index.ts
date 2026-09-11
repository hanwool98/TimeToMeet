import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  eventId?: string;
  sessionToken?: string;
};

const signedUrlExpirySeconds = 21_600;

// 행사 소개 콘텐츠(텍스트/이미지 갤러리 섹션) 조회 전용. 이미지는 Storage
// 서명(service role)이 필요해 RPC로는 못 하고 Edge Function으로 처리한다
// (home-contents와 동일한 이유/구조).
//   - 공개(참가자) 호출: { eventId } -> is_visible=true 섹션만 순서대로
//   - 관리자 호출: { eventId, sessionToken } -> 숨김 포함 전체 섹션
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Event intro access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (!payload || typeof payload.eventId !== 'string' || !payload.eventId) {
    return json({ message: 'Invalid request.' }, 400);
  }

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
    .from('event_intro_sections')
    .select('id, section_type, title, content, display_order, is_visible')
    .eq('event_id', payload.eventId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (!isAdminCall) sectionQuery = sectionQuery.eq('is_visible', true);

  const { data: sectionRows, error: sectionError } = await sectionQuery;
  if (sectionError) return json({ message: '행사 소개를 불러오지 못했습니다.' }, 500);

  const sectionIds = (sectionRows ?? []).map((row) => row.id as string);
  const imagesBySection = new Map<string, Array<{ id: string; imageUrl: string | null; caption: string; displayOrder: number }>>();

  if (sectionIds.length > 0) {
    const { data: imageRows } = await supabase
      .from('event_intro_images')
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

  return json({ ok: true, sections });
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
