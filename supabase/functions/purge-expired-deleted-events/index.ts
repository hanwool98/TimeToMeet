import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-purge-secret',
  'Access-Control-Allow-Origin': '*',
};

type ApplicationFilesRow = {
  id: string;
  employment_proof_path: string | null;
  id_photo_path: string | null;
  profile_photo_paths: string[] | null;
  voice_intro_path: string | null;
};

type ProfileFilesRow = {
  employment_proof_path: string | null;
  id_photo_path: string | null;
  profile_photo_paths: string[] | null;
  voice_intro_path: string | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

// 삭제 대기(deleted_at) 상태로 72시간(scheduled_purge_at) 이상 지난 행사를
// 실제로 영구 삭제하는 cron 전용 함수 - admin-delete-event가 예전에 즉시
// 하던 일(파일 보호 + Storage 삭제 + applications/events 삭제)을 그대로
// 재사용하되, "지금 삭제해도 되는지"를 이 함수가 직접 판단하는 대신 DB의
// claim_event_for_purge(원자적 UPDATE)로 선점한 행사만 처리한다. 이렇게
// 하면 (a) 이 함수가 겹쳐 실행돼도 같은 행사를 두 번 동시에 처리하지 않고,
// (b) 관리자가 그 사이 복구 버튼을 눌러도(restore_deleted_event_for_admin_session이
// purge_claimed_at을 확인) 안전하게 막힌다.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ message: 'Method not allowed.' }, 405);
  }

  const purgeSecret = Deno.env.get('EVENT_PURGE_SECRET');
  if (!purgeSecret || request.headers.get('x-purge-secret') !== purgeSecret) {
    return json({ message: 'Unauthorized.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ message: 'Event purge is not configured.' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: candidates, error: candidateError } = await supabase
    .from('events')
    .select('id')
    .not('deleted_at', 'is', null)
    .not('scheduled_purge_at', 'is', null)
    .lte('scheduled_purge_at', new Date().toISOString());

  if (candidateError) return json({ message: candidateError.message }, 500);

  // 5년 보존 기간이 지난 결제 기록 스냅샷은 더 이상 보관할 이유가 없는
  // 개인정보이므로 여기서 함께 정리한다(다른 cron을 새로 만들지 않고
  // 기존 15분 주기에 얹는다 - retry-failed-meta-lead-events가 같은
  // 실행에서 PII redaction까지 처리하는 것과 동일한 패턴).
  const paymentRecordRetentionCutoff = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const { error: retentionError } = await supabase
    .from('event_deleted_payment_records')
    .delete()
    .lt('created_at', paymentRecordRetentionCutoff);
  if (retentionError) {
    console.error('[EVENT_PURGE] payment_record_retention_cleanup_failed', { message: retentionError.message });
  }

  const purged: string[] = [];
  const skipped: string[] = [];
  const failures: Array<{ eventId: string; reason: string; stage: string }> = [];

  for (const candidate of candidates ?? []) {
    const eventId = candidate.id as string;

    const { data: claimed, error: claimError } = await supabase.rpc('claim_event_for_purge', {
      event_id_value: eventId,
    });
    if (claimError) {
      failures.push({ eventId, reason: claimError.message, stage: 'claim' });
      continue;
    }
    if (!claimed) {
      // 다른 실행이 이미 처리 중이거나(30분 이내 claim), 조건이 그 사이
      // 바뀐 것(예: 복구됨) - 이번 실행에서는 건드리지 않는다.
      skipped.push(eventId);
      continue;
    }

    try {
      await purgeEvent(supabase, eventId);
      purged.push(eventId);
    } catch (purgeError) {
      const reason = purgeError instanceof Error ? purgeError.message : String(purgeError);
      failures.push({ eventId, reason, stage: 'purge' });
      console.error('[EVENT_PURGE] purge_failed', { eventId, reason });
      // claim은 그대로 두고(30분 뒤 다음 실행에서 재시도) 다음 후보로 넘어간다.
      // purge_last_error는 순수 관측용 기록이라 실패해도(예: 이 사이 행사
      // 행 자체가 없어짐) 전체 실행을 막지 않는다.
      const { error: markError } = await supabase.from('events').update({ purge_last_error: reason }).eq('id', eventId);
      if (markError) console.error('[EVENT_PURGE] purge_last_error_write_failed', { eventId, message: markError.message });
    }
  }

  return json({ failedCount: failures.length, failures, purgedCount: purged.length, purgedEventIds: purged, skippedCount: skipped.length });
});

async function purgeEvent(supabase: ReturnType<typeof createClient>, eventId: string) {
  await snapshotPaymentRecordsBeforeDelete(supabase, eventId);

  const { data: applicationFiles, error: applicationFilesError } = await supabase
    .from('applications')
    .select('id, id_photo_path, profile_photo_paths, voice_intro_path, employment_proof_path')
    .eq('event_id', eventId);
  if (applicationFilesError) throw new Error(`application files lookup failed: ${applicationFilesError.message}`);

  const applicationRows = (applicationFiles ?? []) as ApplicationFilesRow[];
  const applicationIds = applicationRows.map((row) => row.id);
  let protectedProfilePaths = new Set<string>();

  if (applicationIds.length > 0) {
    const { data: profileFiles, error: profileFilesError } = await supabase
      .from('participant_profiles')
      .select('id_photo_path, profile_photo_paths, voice_intro_path, employment_proof_path')
      .in('source_application_id', applicationIds);
    if (profileFilesError) throw new Error(`profile file lookup failed: ${profileFilesError.message}`);
    protectedProfilePaths = new Set(collectStoragePaths((profileFiles ?? []) as ProfileFilesRow[]));
  }

  const storagePaths = collectStoragePaths(applicationRows).filter((path) => !protectedProfilePaths.has(path));
  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from('application-files').remove(storagePaths);
    // Storage remove는 이미 지워진 경로를 다시 넘겨도 에러를 던지지 않는다
    // (idempotent) - 그래서 여기서 에러가 나면 진짜 실패로 취급해 이 행사
    // 전체를 건너뛰고(claim은 30분 뒤 재시도) 다음 후보로 넘어간다.
    if (storageError) throw new Error(`storage remove failed: ${storageError.message}`);
  }

  const { error: draftError } = await supabase.from('application_drafts').delete().eq('event_id', eventId);
  if (draftError) throw new Error(`draft delete failed: ${draftError.message}`);

  const { error: applicationError } = await supabase.from('applications').delete().eq('event_id', eventId);
  if (applicationError) throw new Error(`application delete failed: ${applicationError.message}`);

  // deleted_at/purge_claimed_at 조건을 다시 걸어, 혹시라도 이 사이 복구된
  // 행사를(claim은 이미 막았지만 방어적으로 한 번 더) 실수로 지우지 않는다.
  const { error: eventError } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId)
    .not('deleted_at', 'is', null)
    .not('purge_claimed_at', 'is', null);
  if (eventError) throw new Error(`event delete failed: ${eventError.message}`);
}

// 결제/입금이 실제로 진행된 신청만(참가비가 무료라 결제 단계 자체가 없던
// 신청은 보존할 거래 기록이 없으므로 제외) applications가 지워지기 전에
// 별도 테이블로 스냅샷한다. application_id에 unique 제약이 있어 같은
// 행사를 두 번 처리해도(예: 이전 실행이 중간에 실패해 재시도) 중복
// 저장되지 않는다.
async function snapshotPaymentRecordsBeforeDelete(supabase: ReturnType<typeof createClient>, eventId: string) {
  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('title, event_date')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) throw new Error(`event lookup for payment snapshot failed: ${eventError.message}`);
  if (!eventRow) return; // Already gone somehow - nothing to snapshot against.

  const { data: paidApplications, error: paidApplicationsError } = await supabase
    .from('applications')
    .select('id, application_no, status, payment_amount, payment_method, payment_completed_at, depositor_name, updated_at')
    .eq('event_id', eventId)
    .or('payment_completed_at.not.is.null,deposit_requested_at.not.is.null');
  if (paidApplicationsError) throw new Error(`paid application lookup failed: ${paidApplicationsError.message}`);
  if (!paidApplications || paidApplications.length === 0) return;

  // 참가자 프로필(닉네임/사진/직업/연락처 등)은 절대 포함하지 않는다 - 결제
  // 증빙에 필요한 최소 필드만 골라서 옮긴다(applications row 전체를
  // 그대로 복제하지 않음).
  const rows = paidApplications.map((application) => ({
    event_id: eventId,
    event_title: eventRow.title as string,
    event_date: eventRow.event_date as string,
    application_id: application.id,
    application_no: application.application_no,
    status: application.status,
    status_updated_at: application.updated_at,
    payment_amount: application.payment_amount,
    payment_method: application.payment_method,
    payment_completed_at: application.payment_completed_at,
    depositor_name: application.depositor_name,
  }));

  const { error: insertError } = await supabase
    .from('event_deleted_payment_records')
    .upsert(rows, { onConflict: 'application_id', ignoreDuplicates: true });
  if (insertError) throw new Error(`payment record snapshot failed: ${insertError.message}`);
}

function collectStoragePaths(rows: Array<ApplicationFilesRow | ProfileFilesRow>) {
  const paths = rows.flatMap((row) => [
    row.id_photo_path,
    row.voice_intro_path,
    row.employment_proof_path,
    ...(row.profile_photo_paths ?? []),
  ]);
  return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}
