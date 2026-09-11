import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type Payload = {
  sessionToken?: string;
  sourceEventId?: string;
  targetEventId?: string;
};

// 관리자 "기존 행사에서 불러오기" - 다른 행사의 소개 텍스트/이미지 섹션을
// 통째로 복사해 지금 편집 중인 행사 뒤에 이어 붙인다. Storage 오브젝트를
// 실제로 복사(storage.copy)해야 해서 RPC로는 못 하고 Edge Function으로
// 처리한다. 행사명/날짜/장소/가격/인원 등 events 테이블 데이터는 손대지
// 않고 event_intro_sections/event_intro_images만 복사한다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ message: 'Event intro copy is not configured.' }, 500);

  const payload = (await request.json().catch(() => null)) as Payload | null;
  if (
    !payload ||
    typeof payload.sessionToken !== 'string' ||
    !payload.sessionToken ||
    typeof payload.sourceEventId !== 'string' ||
    !payload.sourceEventId ||
    typeof payload.targetEventId !== 'string' ||
    !payload.targetEventId
  ) {
    return json({ message: 'Invalid request.' }, 400);
  }
  if (payload.sourceEventId === payload.targetEventId) {
    return json({ message: '같은 행사에서는 불러올 수 없습니다.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const tokenHash = await sha256(payload.sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from('app_sessions')
    .select('role, expires_at')
    .eq('token_hash', tokenHash)
    .eq('role', 'admin')
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) {
    return json({ message: 'Admin session required.' }, 401);
  }

  const { data: targetEvent } = await supabase.from('events').select('id').eq('id', payload.targetEventId).maybeSingle();
  if (!targetEvent) return json({ message: '대상 행사를 찾을 수 없습니다.' }, 404);

  const { data: sourceSections, error: sourceError } = await supabase
    .from('event_intro_sections')
    .select('id, section_type, title, content, display_order, is_visible')
    .eq('event_id', payload.sourceEventId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (sourceError) return json({ message: '원본 행사 소개를 불러오지 못했습니다.' }, 500);
  if (!sourceSections || sourceSections.length === 0) {
    return json({ message: '복사할 소개 콘텐츠가 없습니다.' }, 400);
  }

  const { data: maxRow } = await supabase
    .from('event_intro_sections')
    .select('display_order')
    .eq('event_id', payload.targetEventId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextOrder = (maxRow?.display_order ?? 0) + 1;

  let copiedSections = 0;
  let copiedImages = 0;

  for (const section of sourceSections) {
    const { data: newSection, error: insertSectionError } = await supabase
      .from('event_intro_sections')
      .insert({
        content: section.content,
        display_order: nextOrder,
        event_id: payload.targetEventId,
        is_visible: section.is_visible,
        section_type: section.section_type,
        title: section.title,
      })
      .select('id')
      .single();

    if (insertSectionError || !newSection) continue;
    copiedSections += 1;
    nextOrder += 1;

    if (section.section_type !== 'gallery') continue;

    const { data: sourceImages } = await supabase
      .from('event_intro_images')
      .select('storage_path, caption, display_order')
      .eq('section_id', section.id)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    for (const image of sourceImages ?? []) {
      const extension = (image.storage_path as string).split('.').pop() || 'jpg';
      const newPath = `event-assets/${await sanitizeIdForStoragePath(payload.targetEventId)}/intro/${newSection.id}/${crypto.randomUUID()}.${extension}`;

      const { error: copyError } = await supabase.storage
        .from('application-files')
        .copy(image.storage_path as string, newPath);
      if (copyError) {
        console.error('event intro image copy failed', { message: copyError.message, path: image.storage_path });
        continue;
      }

      const { error: insertImageError } = await supabase.from('event_intro_images').insert({
        caption: image.caption,
        display_order: image.display_order,
        section_id: newSection.id,
        storage_path: newPath,
      });
      if (insertImageError) {
        await supabase.storage.from('application-files').remove([newPath]);
        continue;
      }
      copiedImages += 1;
    }
  }

  return json({ ok: true, copiedImages, copiedSections });
});

async function sanitizeIdForStoragePath(id: string) {
  if (/^[A-Za-z0-9_.-]+$/.test(id)) return id;
  return sha256(id);
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
