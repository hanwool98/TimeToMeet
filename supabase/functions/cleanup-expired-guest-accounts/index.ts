import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const cleanupSecret = Deno.env.get('GUEST_CLEANUP_SECRET');
  if (!cleanupSecret || req.headers.get('x-cleanup-secret') !== cleanupSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing server configuration' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: targets, error: targetError } = await supabase.rpc('get_expired_guest_cleanup_targets');
  if (targetError) return json({ error: targetError.message }, 500);

  const pathsByUser = new Map<string, string[]>();
  for (const target of targets ?? []) {
    if (!target.user_id || !target.storage_path) continue;
    pathsByUser.set(target.user_id, [...(pathsByUser.get(target.user_id) ?? []), target.storage_path]);
  }

  const cleaned: string[] = [];
  const failures: Array<{ userId: string; reason: string }> = [];

  for (const [userId, paths] of pathsByUser.entries()) {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length > 0) {
      const { error: removeError } = await supabase.storage.from('application-files').remove(uniquePaths);
      if (removeError) {
        failures.push({ userId, reason: removeError.message });
        continue;
      }
    }

    const { error: finalizeError } = await supabase.rpc('finalize_expired_guest_cleanup', {
      target_user_id: userId,
    });
    if (finalizeError) {
      failures.push({ userId, reason: finalizeError.message });
      continue;
    }

    cleaned.push(userId);
  }

  return json({ cleanedCount: cleaned.length, failedCount: failures.length, failures });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
