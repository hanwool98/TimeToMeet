import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

const signedUrlExpirySeconds = 21_600;
const maxEventIds = 100;

// 홈 "다가오는 행사" 카드용 - 행사 대표 이미지(events.cover_image_path)는
// private 버킷이라 signed URL이 필요하다. get_public_event_summaries가
// 경로를 돌려주지 않으므로 여기서 eventId 목록을 받아 서명해 준다(공개).
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Event cover access is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as { eventIds?: unknown } | null;
  const eventIds = Array.isArray(payload?.eventIds)
    ? (payload!.eventIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, maxEventIds)
    : [];
  if (eventIds.length === 0) return json({ ok: true, covers: {} });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from('events')
    .select('id, cover_image_path')
    .in('id', eventIds)
    .not('cover_image_path', 'is', null);
  if (error) return json({ ok: true, covers: {} });

  const covers: Record<string, string> = {};
  await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data } = await supabase.storage
        .from('application-files')
        .createSignedUrl(row.cover_image_path as string, signedUrlExpirySeconds);
      if (data?.signedUrl) covers[row.id as string] = data.signedUrl;
    }),
  );

  return json({ ok: true, covers });
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
