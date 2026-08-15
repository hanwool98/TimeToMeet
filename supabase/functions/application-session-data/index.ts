import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type RequestPayload = {
  action?: 'get-existing' | 'get-draft' | 'save-draft';
  draftData?: Record<string, unknown>;
  eventId?: string;
  sessionToken?: string;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Supabase server configuration is missing.' }, 500);

  const payload = await request.json().catch(() => null) as RequestPayload | null;
  if (!payload?.action || !payload.eventId || !payload.sessionToken) {
    return json({ message: '요청 정보가 올바르지 않습니다.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const session = await getValidAppSession(supabase, payload.sessionToken);
  if (!session) return json({ message: '로그인 또는 비회원 세션이 만료되었습니다. 다시 로그인해주세요.' }, 401);

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('id', payload.eventId)
    .maybeSingle();

  if (eventError) return json({ message: '행사 정보를 확인하지 못했습니다.' }, 500);
  if (!event) return json({ message: '선택한 행사를 찾을 수 없습니다.' }, 404);

  if (payload.action === 'get-existing') {
    const { data, error } = await supabase
      .from('applications')
      .select('id, status')
      .eq('event_id', payload.eventId)
      .eq('user_id', session.user_id)
      .maybeSingle();

    if (error) return json({ message: '기존 신청 내역 확인에 실패했습니다.' }, 500);
    return json({ ok: true, application: data ?? null });
  }

  if (payload.action === 'get-draft') {
    const { data, error } = await supabase
      .from('application_drafts')
      .select('draft_data')
      .eq('event_id', payload.eventId)
      .eq('user_id', session.user_id)
      .maybeSingle();

    if (error) return json({ message: '임시저장을 불러오지 못했습니다.' }, 500);
    return json({ ok: true, draft: data?.draft_data ?? null });
  }

  if (payload.action === 'save-draft') {
    const { error } = await supabase
      .from('application_drafts')
      .upsert(
        {
          draft_data: payload.draftData ?? {},
          event_id: payload.eventId,
          updated_at: new Date().toISOString(),
          user_id: session.user_id,
        },
        { onConflict: 'user_id,event_id' },
      );

    if (error) return json({ message: '임시저장에 실패했습니다.' }, 500);
    return json({ ok: true });
  }

  return json({ message: '지원하지 않는 요청입니다.' }, 400);
});

async function getValidAppSession(supabase: ReturnType<typeof createClient>, sessionToken: string) {
  const tokenHash = await sha256(sessionToken);
  const { data, error } = await supabase
    .from('app_sessions')
    .select('user_id, role, expires_at')
    .eq('token_hash', tokenHash)
    .in('role', ['guest', 'member'])
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) return null;
  return data as { user_id: string; role: 'guest' | 'member'; expires_at: string };
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
