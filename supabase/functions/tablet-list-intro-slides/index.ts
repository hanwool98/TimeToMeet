import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = { connectionToken?: string; eventId?: string; tableNumber?: number };

const signedUrlExpirySeconds = 21_600;

// 태블릿용 슬라이드 목록 조회 - get_event_progress_for_tablet과 동일한
// connection_token 인증(event_tablets: connection_status='online' +
// connection_token_hash 일치)이지만, Storage 서명이 필요해 RPC가 아니라
// Edge Function으로 처리한다. 슬라이드 목록 자체는 행사 시작 전 관리자가
// 미리 구성해두는 것이라 진행 상태 폴링과 분리해 마운트 시 한 번만
// 불러오면 충분하다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Intro slide access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (
    !payload ||
    typeof payload.eventId !== 'string' ||
    !payload.eventId ||
    typeof payload.tableNumber !== 'number' ||
    typeof payload.connectionToken !== 'string' ||
    !payload.connectionToken
  ) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tokenHash = await sha256(payload.connectionToken);
  const { data: tablet, error: tabletError } = await supabase
    .from('event_tablets')
    .select('id')
    .eq('event_id', payload.eventId)
    .eq('table_number', payload.tableNumber)
    .eq('connection_status', 'online')
    .eq('connection_token_hash', tokenHash)
    .maybeSingle();
  if (tabletError || !tablet) return json({ ok: false }, 200);

  const { data: rows, error: rowsError } = await supabase
    .from('event_intro_slides')
    .select('id, title, image_path, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (rowsError) return json({ message: '슬라이드 목록을 불러오지 못했습니다.' }, 500);

  const slides = await Promise.all(
    (rows ?? []).map(async (row) => ({
      id: row.id as string,
      imageUrl: await signUrl(supabase, row.image_path as string),
      sortOrder: row.sort_order as number,
      title: (row.title as string | null) ?? '',
    })),
  );

  return json({ ok: true, slides });
});

async function signUrl(supabase: ReturnType<typeof createClient>, path: string) {
  const { data } = await supabase.storage.from('application-files').createSignedUrl(path, signedUrlExpirySeconds);
  return data?.signedUrl ?? null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
