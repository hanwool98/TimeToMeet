import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// 행사 삭제는 더 이상 즉시 영구 삭제하지 않는다 - deleted_at/
// scheduled_purge_at만 기록해 72시간 유예기간을 준다. 실제 파일/DB 영구
// 삭제는 별도 cron Edge Function(purge-expired-deleted-events)이 유예기간이
// 지난 뒤에 처리한다. 그래서 이 함수는 더 이상 Storage를 건드리지 않는다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ message: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ message: 'Admin event deletion is not configured.' }, 500);
  }

  const { eventId, sessionToken } = await request.json().catch(() => ({
    eventId: '',
    sessionToken: '',
  }));

  if (typeof eventId !== 'string' || !eventId || typeof sessionToken !== 'string' || !sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const tokenHash = await sha256(sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('role, expires_at')
    .eq('token_hash', tokenHash)
    .eq('role', 'admin')
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: 'Admin session required.' }, 401);
  }

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('is_locked, deleted_at')
    .eq('id', eventId)
    .maybeSingle();

  if (eventError) return json({ message: 'Event could not be inspected.' }, 500);
  if (!eventRow) return json({ message: '행사를 찾을 수 없습니다.' }, 404);
  if (eventRow.is_locked) return json({ message: '잠긴 행사는 삭제할 수 없습니다.' }, 409);

  // 이미 삭제 대기 중이면 유예기간을 초기화/연장하지 않고 그대로 성공
  // 처리한다(반복 삭제 요청이 들어와도 최초 삭제 시각 기준을 유지).
  if (eventRow.deleted_at) {
    return json({ ok: true, alreadyDeleted: true });
  }

  const deletedAt = new Date();
  const scheduledPurgeAt = new Date(deletedAt.getTime() + GRACE_PERIOD_MS);

  const { error: updateError } = await supabase
    .from('events')
    .update({ deleted_at: deletedAt.toISOString(), scheduled_purge_at: scheduledPurgeAt.toISOString() })
    .eq('id', eventId)
    .is('deleted_at', null);

  if (updateError) return json({ message: '행사를 삭제하지 못했습니다.' }, 500);

  return json({ ok: true, deletedAt: deletedAt.toISOString(), scheduledPurgeAt: scheduledPurgeAt.toISOString() });
});
