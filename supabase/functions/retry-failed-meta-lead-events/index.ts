import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-secret',
};

// Meta Pixel ID는 비밀값이 아니다 - src/lib/metaPixel.ts, index.html,
// submit-application/index.ts와 반드시 같은 값으로 유지한다.
const metaPixelId = '1090793103739228';
// 한 번 시도할 때마다(성공/실패 무관) attempt_count가 올라간다 - 이 이상
// 실패하면 포기한다(무한 재시도로 자원을 낭비하지 않기 위함). 15분 주기
// 크론 기준으로 약 2시간 동안 재시도하는 셈이다. 재시도해도 결과가 똑같은
// 4xx(잘못된 토큰 등)는 isRetryableMetaFailure가 걸러서 이 상한과 무관하게
// 즉시 포기(permanently_failed_at)한다.
const maxAttempts = 8;
// 크론이 겹쳐 돌거나 같은 tick 안에서 두 번 집히는 걸 막기 위한 최소 간격.
const minRetryIntervalMs = 5 * 60 * 1000;
const maxRowsPerRun = 50;
// 전송이 끝난(성공했거나 영구 실패한) 지 이만큼 지난 건은 IP/fbp/fbc/
// user-agent를 지운다 - 문제 확인/재문의 대응에 필요한 최소 기간만 두고,
// 목적을 다한 뒤에는 지체 없이 파기한다는 이 서비스의 개인정보 처리 원칙
// (ProfileFormPage 개인정보 동의 문구 참고)에 맞춘 최소 보존이다. 사용자가
// 확인 요청한 4번째 항목에 대한 조치.
const redactAfterMs = 7 * 24 * 60 * 60 * 1000;

// submit-application이 신청 저장 직후 한 번 시도했지만 실패했거나(Meta 장애,
// 타임아웃 등) 애초에 시도조차 못 하고 죽은 경우(함수 인스턴스 강제 종료 등)를
// 위한 재시도 배치. time2meet-cleanup-expired-guest-accounts와 동일한 방식
// (pg_cron + pg_net, Vault의 secret을 x-retry-secret 헤더로 붙여 호출)으로
// 15분마다 실행된다(202609300500_meta_lead_conversion_tracking.sql 참고).
//
// "동일 신청의 중복 CAPI 전송 방지"와 "일시적 장애로 인한 영구 유실 방지"를
// 동시에 만족시키기 위해, meta_lead_dispatches.sent_at(Meta가 실제로 2xx를
// 준 경우에만 채워짐)이 비어있는 행만 대상으로 하고, 각 행은 attempt_count를
// 원자적으로 올리는 조건부 update로 먼저 "선점"한 뒤에만 실제 전송을
// 시도한다 - 그래도 event_id(=application_id)는 매번 동일하므로, 만에 하나
// 경쟁 상태로 같은 이벤트가 두 번 나가더라도 Meta의 이벤트 중복 제거가
// 최종적으로 하나로 묶어준다.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const retrySecret = Deno.env.get('META_LEAD_RETRY_SECRET');
  if (!retrySecret || req.headers.get('x-retry-secret') !== retrySecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const accessToken = Deno.env.get('META_CONVERSIONS_API_TOKEN');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Missing server configuration' }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // 액세스 토큰이 없어도(아직 설정 전) 보존기간이 지난 개인정보성 필드는
  // 그대로 지워야 하므로, 재시도 루프만 건너뛰고 redaction은 계속 진행한다.
  let attempted = 0;
  let succeeded = 0;
  if (accessToken) {
    const throttleCutoff = new Date(Date.now() - minRetryIntervalMs).toISOString();
    const { data: pending, error: pendingError } = await supabase
      .from('meta_lead_dispatches')
      .select('application_id, fbp, fbc, event_source_url, client_ip, client_user_agent, created_at, applications(phone)')
      .is('sent_at', null)
      .is('permanently_failed_at', null)
      .lt('attempt_count', maxAttempts)
      .or(`last_attempt_at.is.null,last_attempt_at.lt.${throttleCutoff}`)
      .order('created_at', { ascending: true })
      .limit(maxRowsPerRun);

    if (pendingError) return json({ error: pendingError.message }, 500);

    for (const row of pending ?? []) {
      const applicationId = row.application_id as string;

      // 이 행을 원자적으로 먼저 선점한다(attempt_count를 DB 함수 안에서
      // 단일 update문으로 증가) - 동시에 두 번 돌아가는 실행이 같은 신청을
      // 중복으로 재전송하지 않도록. 클라이언트에서 읽은 값을 다시 써넣는
      // read-modify-write는 경쟁 상태가 생기므로 쓰지 않는다.
      const { data: claimed, error: claimError } = await supabase.rpc('claim_meta_lead_dispatch_retry', {
        max_attempts: maxAttempts,
        min_retry_interval_seconds: Math.floor(minRetryIntervalMs / 1000),
        target_application_id: applicationId,
      });

      if (claimError || claimed !== true) continue;

      attempted += 1;
      const phone = (row as { applications?: { phone?: string } }).applications?.phone ?? '';
      // event_time은 재시도 시각이 아니라 원래 신청(=이 dispatch 행) 생성
      // 시각을 그대로 쓴다 - Meta에 "언제 전환이 실제로 일어났는지"가
      // 재시도할 때마다 밀리지 않게 한다(사용자 지적).
      const body = await buildMetaLeadEventBody({
        applicationId,
        clientIp: row.client_ip as string | null,
        clientUserAgent: row.client_user_agent as string | null,
        eventSourceUrl: (row.event_source_url as string) || `https://time2meet.kr/`,
        eventTimeSeconds: Math.floor(new Date(row.created_at as string).getTime() / 1000),
        fbc: row.fbc as string | null,
        fbp: row.fbp as string | null,
        phone,
      });

      const result = await sendMetaLeadEventOnce(accessToken, body);
      if (result.ok) {
        succeeded += 1;
        await supabase.from('meta_lead_dispatches').update({ sent_at: new Date().toISOString() }).eq('application_id', applicationId);
      } else if (isRetryableMetaFailure(result.status)) {
        console.error('Meta Lead retry failed (retryable)', { applicationId, error: result.error });
        await supabase.from('meta_lead_dispatches').update({ last_error: result.error }).eq('application_id', applicationId);
      } else {
        console.error('Meta Lead retry failed (permanent)', { applicationId, error: result.error });
        await supabase
          .from('meta_lead_dispatches')
          .update({ last_error: result.error, permanently_failed_at: new Date().toISOString() })
          .eq('application_id', applicationId);
      }
    }
  }

  // 전송이 끝난(성공/영구실패 확정) 지 오래된 건의 IP/fbp/fbc/user-agent를
  // 지운다 - 최소 보존 원칙(사용자 확인 요청 4번). application_id/시도
  // 횟수/성공 여부 같은 비-개인정보성 집계 기록은 그대로 남겨 통계·디버깅에
  // 계속 쓸 수 있게 한다.
  const redactCutoff = new Date(Date.now() - redactAfterMs).toISOString();
  const { error: redactError, count: redactedCount } = await supabase
    .from('meta_lead_dispatches')
    .update(
      { client_ip: null, client_user_agent: null, fbc: null, fbp: null },
      { count: 'exact' },
    )
    .not('fbp', 'is', null)
    .or(`sent_at.lt.${redactCutoff},permanently_failed_at.lt.${redactCutoff}`);
  if (redactError) console.error('Meta Lead dispatch redaction failed', redactError);

  return json({ attempted, ok: true, redacted: redactedCount ?? 0, succeeded });
});

// 429(rate limit)와 5xx(Meta 쪽 일시적 오류), 그리고 네트워크 자체가 끊기거나
// 타임아웃난 경우(status가 없음)는 다시 시도하면 성공할 가능성이 있다.
// 그 외 4xx(400 잘못된 파라미터, 401 잘못된 토큰, 403 권한 없음 등)는 같은
// 요청을 몇 번을 다시 보내도 똑같이 거부되므로 재시도 대상에서 뺀다.
// submit-application/index.ts와 동일한 규칙(두 함수가 코드를 공유하지
// 않는 이 프로젝트 관례상 각자 둔다).
function isRetryableMetaFailure(status: number | null): boolean {
  if (status === null) return true;
  if (status === 429) return true;
  return status >= 500;
}

async function buildMetaLeadEventBody(params: {
  applicationId: string;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl: string;
  eventTimeSeconds: number;
  fbc?: string | null;
  fbp?: string | null;
  phone: string;
}) {
  const userData: Record<string, unknown> = {};
  if (params.clientIp) userData.client_ip_address = params.clientIp;
  if (params.clientUserAgent) userData.client_user_agent = params.clientUserAgent;
  if (params.fbp) userData.fbp = params.fbp;
  if (params.fbc) userData.fbc = params.fbc;

  const normalizedPhone = normalizePhone(params.phone);
  if (normalizedPhone) {
    const metaFormattedPhone = `82${normalizedPhone.replace(/^0+/, '')}`;
    userData.ph = [await sha256(metaFormattedPhone)];
  }

  return {
    data: [
      {
        action_source: 'website',
        event_id: params.applicationId,
        event_name: 'Lead',
        event_source_url: params.eventSourceUrl,
        event_time: params.eventTimeSeconds,
        user_data: userData,
      },
    ],
    ...(Deno.env.get('META_TEST_EVENT_CODE') ? { test_event_code: Deno.env.get('META_TEST_EVENT_CODE') } : {}),
  };
}

async function sendMetaLeadEventOnce(
  accessToken: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: string; status: number | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${metaPixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      },
    );
    if (response.ok) return { ok: true };
    const text = await response.text().catch(() => '');
    return { error: `HTTP ${response.status}: ${text.slice(0, 500)}`, ok: false, status: response.status };
  } catch (fetchError) {
    return { error: fetchError instanceof Error ? fetchError.message : String(fetchError), ok: false, status: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizePhone(value: string) {
  return String(value ?? '').replace(/\D/g, '');
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
