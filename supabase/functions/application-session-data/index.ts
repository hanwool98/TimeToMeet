import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type ActionPayload = {
  action?: string;
  draftData?: unknown;
  eventId?: string;
  sessionToken?: string;
};

const maxDraftJsonBytes = 200 * 1024;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Supabase server configuration is missing.' }, 500);

  const payload = await request.json().catch(() => null) as ActionPayload | null;
  if (!payload?.sessionToken) return json({ message: '로그인 또는 비회원 세션이 필요합니다.' }, 401);
  if (!payload.eventId || typeof payload.eventId !== 'string') return json({ message: '행사 정보를 확인해주세요.' }, 400);
  if (payload.action !== 'get-existing' && payload.action !== 'get-draft' && payload.action !== 'save-draft') {
    return json({ message: '지원하지 않는 요청입니다.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // The user id always comes from the validated session lookup below, never
  // from any client-supplied field, so callers cannot read or write another
  // user's application/draft by passing a different id.
  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('user_id, role, expires_at')
    .eq('token_hash', tokenHash)
    .in('role', ['guest', 'member'])
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: '로그인 또는 비회원 세션이 만료되었습니다. 다시 로그인해주세요.' }, 401);
  }

  const userId = session.user_id as string;

  if (payload.action === 'get-existing') {
    const { data: application, error } = await supabase
      .from('applications')
      .select('id, application_no, status, submitted_at')
      .eq('event_id', payload.eventId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return json({ message: '기존 신청 내역 확인에 실패했습니다.' }, 500);
    if (!application) return json({ ok: true, application: null });

    return json({
      application: {
        applicationNo: application.application_no,
        id: application.id,
        status: application.status,
        submittedAt: application.submitted_at,
      },
      ok: true,
    });
  }

  if (payload.action === 'get-draft') {
    const { data: draft, error } = await supabase
      .from('application_drafts')
      .select('draft_data')
      .eq('event_id', payload.eventId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return json({ message: '임시저장을 불러오지 못했습니다.' }, 500);
    return json({ draft: draft?.draft_data ?? null, ok: true });
  }

  // action === 'save-draft'
  if (
    typeof payload.draftData !== 'object' ||
    payload.draftData === null ||
    Array.isArray(payload.draftData)
  ) {
    return json({ message: '임시저장 데이터 형식이 올바르지 않습니다.' }, 400);
  }
  if (estimateJsonBytes(payload.draftData) > maxDraftJsonBytes) {
    return json({ message: '임시저장 데이터가 너무 큽니다.' }, 400);
  }

  const { error: upsertError } = await supabase
    .from('application_drafts')
    .upsert(
      {
        draft_data: payload.draftData,
        event_id: payload.eventId,
        updated_at: new Date().toISOString(),
        user_id: userId,
      },
      { onConflict: 'event_id,user_id' },
    );

  if (upsertError) return json({ message: '임시저장에 실패했습니다.' }, 500);
  return json({ ok: true });
});

function estimateJsonBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
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
