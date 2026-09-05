import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
};

type SnapshotCandidate = {
  eventId: string;
  applicationId: string;
  nickname: string;
  age: number | null;
  job: string;
  gender: string | null;
  sourcePhotoPath: string | null;
  sourceCrop: unknown;
  photoSource: 'event_profile_card' | 'default_profile' | null;
};

// 게스트 계정이 실제로 지워지기 전에, 그 계정의 신청서 중 체크인해서 행사에
// 실제로 참가한 기록이 있는 것들은 먼저 event_participant_snapshots에
// 닉네임/나이/직업/대표사진(Storage 사본)을 영구 보존한다. 스냅샷 저장이
// 하나라도 실패하면 그 유저는 이번 실행에서 건너뛰고(다음 cron에서 재시도)
// 절대 먼저 익명화/삭제로 넘어가지 않는다 - "스냅샷 성공 후에만 정리"
// 순서를 강제한다.
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

  // dryRun: 실제로 아무것도 쓰지 않고 이번에 뭐가 일어날지만 센다 - cron이
  // 조용히 대량으로 밀어버리기 전에 test/dev에서 미리 확인하기 위함.
  const body = await req.json().catch(() => ({}));
  const dryRun = Boolean((body as { dryRun?: boolean })?.dryRun);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: targets, error: targetError } = await supabase.rpc('get_expired_guest_cleanup_targets');
  if (targetError) return json({ error: targetError.message }, 500);

  const pathsByUser = new Map<string, string[]>();
  for (const target of targets ?? []) {
    if (!target.user_id) continue;
    const paths = pathsByUser.get(target.user_id) ?? [];
    if (target.storage_path) paths.push(target.storage_path);
    pathsByUser.set(target.user_id, paths);
  }

  const cleaned: string[] = [];
  const skipped: string[] = [];
  const failures: Array<{ userId: string; reason: string; stage: string }> = [];
  let snapshotsCreated = 0;
  let snapshotImagesCopied = 0;
  const dryRunPreview: Array<{ userId: string; storagePathCount: number; snapshotCandidateCount: number }> = [];

  for (const [userId, paths] of pathsByUser.entries()) {
    const { data: stillEligible, error: eligibilityError } = await supabase.rpc('is_guest_cleanup_eligible', {
      p_user_id: userId,
    });
    if (eligibilityError) {
      failures.push({ userId, reason: eligibilityError.message, stage: 'eligibility' });
      continue;
    }
    if (!stillEligible) {
      skipped.push(userId);
      continue;
    }

    const { data: candidatesRaw, error: candidatesError } = await supabase.rpc('get_snapshot_candidates_for_cleanup', {
      target_user_id: userId,
    });
    if (candidatesError) {
      failures.push({ userId, reason: candidatesError.message, stage: 'snapshot_candidates' });
      console.error('[GUEST_CLEANUP_SNAPSHOT] candidates_lookup_failed', { userId, message: candidatesError.message });
      continue;
    }
    const candidates = (candidatesRaw ?? []) as SnapshotCandidate[];

    if (dryRun) {
      dryRunPreview.push({ userId, storagePathCount: paths.length, snapshotCandidateCount: candidates.length });
      continue;
    }

    // 1) 스냅샷(닉네임/나이/직업 + 사진 Storage 사본)을 전부 성공시켜야만
    // 다음 단계(원본 삭제/익명화)로 넘어간다.
    let allSnapshotsOk = true;
    for (const candidate of candidates) {
      let copiedPhotoPath: string | null = null;
      try {
        if (candidate.sourcePhotoPath) {
          copiedPhotoPath = await copyToSnapshotStorage(supabase, candidate.eventId, candidate.applicationId, candidate.sourcePhotoPath);
          snapshotImagesCopied += 1;
        }
      } catch (copyError) {
        allSnapshotsOk = false;
        failures.push({
          userId,
          reason: copyError instanceof Error ? copyError.message : String(copyError),
          stage: 'snapshot_photo_copy',
        });
        console.error('[GUEST_CLEANUP_SNAPSHOT] photo_copy_failed', {
          userId,
          eventId: candidate.eventId,
          applicationId: candidate.applicationId,
          message: copyError instanceof Error ? copyError.message : String(copyError),
        });
        break;
      }

      const { error: saveError } = await supabase.rpc('save_event_participant_snapshot', {
        event_id_value: candidate.eventId,
        application_id_value: candidate.applicationId,
        nickname_value: candidate.nickname,
        age_value: candidate.age,
        job_value: candidate.job,
        gender_value: candidate.gender,
        photo_path_value: copiedPhotoPath,
        photo_crop_value: candidate.sourceCrop ?? null,
        photo_source_value: candidate.photoSource,
      });
      if (saveError) {
        allSnapshotsOk = false;
        failures.push({ userId, reason: saveError.message, stage: 'snapshot_save' });
        console.error('[GUEST_CLEANUP_SNAPSHOT] save_failed', {
          userId,
          eventId: candidate.eventId,
          applicationId: candidate.applicationId,
          message: saveError.message,
        });
        break;
      }
      snapshotsCreated += 1;
    }

    if (!allSnapshotsOk) {
      // 스냅샷이 하나라도 실패하면 이 유저는 이번 실행에서 건너뛴다 -
      // 원본 profile/Storage는 절대 먼저 지우지 않는다. 다음 cron 실행에서
      // (이미 저장된 스냅샷은 idempotent하게 건너뛰고) 나머지만 재시도한다.
      continue;
    }

    // 2) 스냅샷이 전부 안전하게 저장된 뒤에만 원본 Storage 삭제 + 계정
    // 익명화를 진행한다(기존 로직 그대로).
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length > 0) {
      const { error: removeError } = await supabase.storage.from('application-files').remove(uniquePaths);
      if (removeError) {
        failures.push({ userId, reason: removeError.message, stage: 'storage_remove' });
        console.error('[GUEST_CLEANUP_SNAPSHOT] storage_remove_failed', { userId, message: removeError.message });
        continue;
      }
    }

    const { error: finalizeError } = await supabase.rpc('finalize_expired_guest_cleanup', {
      target_user_id: userId,
    });
    if (finalizeError) {
      failures.push({ userId, reason: finalizeError.message, stage: 'finalize' });
      console.error('[GUEST_CLEANUP_SNAPSHOT] finalize_failed', { userId, message: finalizeError.message });
      continue;
    }

    cleaned.push(userId);
  }

  if (dryRun) {
    return json({ dryRun: true, targetUserCount: pathsByUser.size, preview: dryRunPreview });
  }

  return json({
    cleanedCount: cleaned.length,
    failedCount: failures.length,
    failures,
    skippedCount: skipped.length,
    snapshotsCreated,
    snapshotImagesCopied,
  });
});

// 원본 사진을 event-snapshots/{eventId}/{applicationId}/ 아래 새 오브젝트로
// 실제로 복사한다 - snapshot row가 원본 경로만 가리키면 나중에 원본이
// 지워질 때 같이 깨지므로, 독립된 사본을 만든다. 한글 등 비-ASCII
// event_id는 다른 업로드 함수들과 동일하게 결정적 해시로 치환한다.
async function copyToSnapshotStorage(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  applicationId: string,
  sourcePath: string,
): Promise<string> {
  const { data: blob, error: downloadError } = await supabase.storage.from('application-files').download(sourcePath);
  if (downloadError || !blob) {
    throw new Error(downloadError?.message || `snapshot source photo not found: ${sourcePath}`);
  }

  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(sourcePath);
  const extension = extensionMatch ? extensionMatch[1] : 'jpg';
  const safeEventId = await sanitizeIdForStoragePath(eventId);
  const destinationPath = `event-snapshots/${safeEventId}/${applicationId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage.from('application-files').upload(destinationPath, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  return destinationPath;
}

async function sanitizeIdForStoragePath(id: string) {
  if (/^[A-Za-z0-9_.-]+$/.test(id)) return id;
  return sha256(id);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
