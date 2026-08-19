import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Server configuration is missing.' }, 500);

  const { eventId, sessionToken } = await request.json().catch(() => ({ eventId: '', sessionToken: '' }));
  if (typeof eventId !== 'string' || !eventId || typeof sessionToken !== 'string' || !sessionToken) {
    return json({ message: 'Invalid request.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Both RPCs independently re-verify the admin session and that the event
  // is a test event - this function has no bypass of its own, it only
  // orchestrates Storage cleanup (which SQL can't do) around them.
  const { data: paths, error: pathsError } = await supabase.rpc('get_test_event_reset_storage_paths', {
    event_id_value: eventId,
    session_token: sessionToken,
  });
  if (pathsError) return json({ message: pathsError.message }, 400);

  const uniquePaths = [...new Set((paths ?? []).map((row: { storage_path: string }) => row.storage_path).filter(Boolean))];
  if (uniquePaths.length > 0) {
    const { error: removeError } = await supabase.storage.from('application-files').remove(uniquePaths);
    if (removeError) {
      console.error('Test event storage cleanup failed', removeError);
      return json({ message: `테스트 파일 삭제에 실패했습니다. ${removeError.message}` }, 500);
    }
  }

  const { error: finalizeError } = await supabase.rpc('finalize_test_event_reset', {
    event_id_value: eventId,
    session_token: sessionToken,
  });
  if (finalizeError) return json({ message: finalizeError.message }, 400);

  return json({ ok: true, removedFileCount: uniquePaths.length });
});
