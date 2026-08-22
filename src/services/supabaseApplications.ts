import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getAdminSession } from './adminAuth';
import { getAppSession } from './appAuth';
import type { EventData } from '../types/event';
import type { ParticipantData, ParticipantProfile } from '../types/participant';
import type { StoredApplication } from '../utils/adminApplications';

interface SubmitApplicationInput {
  eventId: string;
  previewToken?: string;
  returning: boolean;
  name: string;
  birthDate: string;
  gender: string;
  residence: string;
  phone: string;
  relationshipStatus: string;
  idPhoto: File;
  nickname: string;
  profilePhotos: File[];
  representativeIndex: number;
  representativeCrop: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  saveAsDefaultProfile?: boolean;
  voiceIntro: Blob;
  voiceIntroFileName: string;
  height: string;
  job: string;
  employmentProof: File;
  accessRoute: string;
  filmingConsent: boolean;
  interviewConsent: string;
  refundAgreement: boolean;
  inquiry: string;
  consents: Record<string, boolean>;
}

interface SupabaseApplicationRow {
  id: string;
  application_no: string;
  event_id: string;
  user_id: string;
  is_returning: boolean;
  status: StoredApplication['status'];
  is_new: boolean;
  name: string;
  birth_date: string;
  gender: '남성' | '여성';
  residence: string;
  phone: string;
  relationship_status: string;
  id_photo_path: string | null;
  nickname: string;
  profile_photo_paths: string[] | null;
  representative_photo_index: number;
  voice_intro_path: string | null;
  height: string;
  job: string;
  employment_proof_path: string | null;
  access_route: string;
  filming_consent: boolean;
  interview_consent: string;
  refund_agreement: boolean;
  inquiry: string;
  review_notice_confirmed: boolean;
  payment_deadline: string | null;
  payment_notice_sent_at: string | null;
  deposit_requested_at: string | null;
  deposit_failed_at: string | null;
  deposit_failure_reason: string | null;
  depositor_name: string | null;
  payment_method: string | null;
  refund_policy_confirmed: boolean | null;
  refund_policy_confirmed_at: string | null;
  transfer_guide_confirmed_at: string | null;
  transfer_intent_confirmed: boolean | null;
  payment_completed_at: string | null;
  checked_in_at: string | null;
  reviewed_at: string | null;
  submitted_at: string;
  event_date?: string;
  short_name?: string;
  user_display_id?: string;
  account_type?: 'member' | 'guest';
}

interface PublicEventSummaryRow {
  id: string;
  title: string;
  short_name: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  venue_booked: boolean;
  male_price: number | null;
  female_price: number | null;
  current_participants: number;
  target_participants: number;
  male_applications: number;
  female_applications: number;
  male_confirmed: number;
  female_confirmed: number;
  application_deadline: string | null;
  male_capacity: number;
  female_capacity: number;
  early_bird_deadline: string | null;
  early_bird_discount_male: number | null;
  early_bird_discount_female: number | null;
  is_test_event?: boolean;
}

interface AdminEventDetailsRow {
  id: string;
  title: string;
  short_name: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  venue_detail: string;
  application_deadline: string | null;
  venue_booked: boolean;
  male_capacity: number;
  female_capacity: number;
  male_price: number;
  female_price: number;
  early_bird_deadline: string | null;
  early_bird_discount_male: number | null;
  early_bird_discount_female: number | null;
  is_test_event?: boolean;
}

interface PublicParticipantPreviewRow {
  id: string;
  gender: '남성' | '여성';
  nickname: string;
  age: number;
  job: string;
  avatar_index: number;
}

interface AdminEventModeSummaryRow {
  checkin_count: number;
  confirmed_count: number;
  end_time: string;
  event_date: string;
  female_checkin_count?: number;
  female_confirmed_count?: number;
  id: string;
  is_test_event: boolean;
  location: string;
  male_checkin_count?: number;
  male_confirmed_count?: number;
  required_tablets: number;
  start_time: string;
  started_at?: string | null;
  tablet_count: number;
  title: string;
}

export interface AdminEventModeSummary {
  checkinCount: number;
  confirmedCount: number;
  date: string;
  endTime: string;
  femaleCheckinCount: number;
  femaleConfirmedCount: number;
  id: string;
  isTestEvent: boolean;
  location: string;
  maleCheckinCount: number;
  maleConfirmedCount: number;
  requiredTablets: number;
  startTime: string;
  startedAt?: string;
  tabletCount: number;
  title: string;
}

export interface AdminEventTabletStatus {
  connected: boolean;
  deviceLabel?: string;
  lastSeenAt?: string;
  tableNumber: number;
}

export interface PaymentInvitation {
  applicationId: string;
  createdAt: string;
  dismissedAt?: string;
  eventDate: string;
  eventId: string;
  eventTitle: string;
  id: string;
  paymentDeadline: string;
  readAt?: string;
  startTime: string;
  status: '결제 대기';
}

export interface MyEventTicket {
  applicationId: string;
  applicationNo: string;
  status: StoredApplication['status'];
  eventId: string;
  eventTitle: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  nickname: string;
  job: string;
  age: number;
  gender: '남성' | '여성';
  applicantName: string;
  paymentDeadline?: string;
  paymentAmount: number;
  reviewReason?: string;
  depositRequestedAt?: string;
  depositFailedAt?: string;
  depositFailureReason?: string;
  depositorName?: string;
  paymentMethod?: string;
  refundPolicyConfirmed?: boolean;
  refundPolicyConfirmedAt?: string;
  transferGuideConfirmedAt?: string;
  transferIntentConfirmed?: boolean;
  paymentCompletedAt?: string;
  qrToken?: string;
  qrIssuedAt?: string;
  checkedInAt?: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

interface MyEventTicketRow {
  application_id: string;
  application_no: string;
  status: StoredApplication['status'];
  event_id: string;
  event_title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  nickname: string;
  job: string;
  age: number;
  gender: '남성' | '여성';
  applicant_name: string;
  payment_deadline: string | null;
  payment_amount: number;
  review_reason: string | null;
  deposit_requested_at: string | null;
  deposit_failed_at: string | null;
  deposit_failure_reason: string | null;
  depositor_name: string | null;
  payment_method: string | null;
  refund_policy_confirmed: boolean | null;
  refund_policy_confirmed_at: string | null;
  transfer_guide_confirmed_at: string | null;
  transfer_intent_confirmed: boolean | null;
  payment_completed_at: string | null;
  qr_token: string | null;
  qr_issued_at: string | null;
  checked_in_at: string | null;
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
}

export interface AdminCheckInResult {
  alreadyCheckedIn: boolean;
  applicationNo: string;
  checkedInAt?: string;
  message: string;
  nickname: string;
  ok: boolean;
}

export interface AdminTicketPreview {
  alreadyCheckedIn: boolean;
  applicationId?: string;
  applicationNo: string;
  checkedInAt?: string;
  message: string;
  nickname: string;
  ok: boolean;
}

export interface AdminApplicationFiles {
  employmentProof?: SignedApplicationFile;
  idPhoto?: SignedApplicationFile;
  profilePhotos: SignedApplicationFile[];
  representativeIndex: number;
  voiceIntro?: SignedApplicationFile;
}

export interface SignedApplicationFile {
  errorMessage?: string;
  fileName: string;
  path: string;
  signedUrl?: string;
}

interface PaymentInvitationRow {
  application_id: string;
  created_at: string;
  dismissed_at: string | null;
  event_date: string;
  event_id: string;
  event_title: string;
  id: string;
  payment_deadline: string;
  read_at: string | null;
  start_time: string;
  status: '결제 대기';
}

export async function ensureApplicationSession() {
  if (!supabase) throw new Error('Supabase is not configured.');

  const appSession = getAppSession();
  if (appSession?.userId) return { id: appSession.userId };

  throw new Error('로그인이 필요합니다.');
}

export type ApplicationErrorStage =
  | 'image_compression'
  | 'file_validation'
  | 'file_encoding'
  | 'submit_request'
  | 'storage_upload'
  | 'application_insert'
  | 'response'
  | 'unknown';

const knownApplicationErrorStages: ApplicationErrorStage[] = [
  'image_compression',
  'file_validation',
  'file_encoding',
  'submit_request',
  'storage_upload',
  'application_insert',
  'response',
  'unknown',
];

export class ApplicationSubmitError extends Error {
  stage: ApplicationErrorStage;

  constructor(message: string, stage: ApplicationErrorStage) {
    super(message);
    this.name = 'ApplicationSubmitError';
    this.stage = stage;
  }
}

export async function submitApplicationToSupabase(input: SubmitApplicationInput) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const user = await ensureApplicationSession();
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인 또는 비회원 세션이 필요합니다.');

  let payload: Record<string, unknown>;
  try {
    payload = {
      accessRoute: input.accessRoute,
      birthDate: input.birthDate,
      consents: input.consents,
      employmentProof: await fileToPayload(input.employmentProof),
      eventId: input.eventId,
      filmingConsent: input.filmingConsent,
      gender: input.gender,
      height: input.height,
      idPhoto: await fileToPayload(input.idPhoto),
      inquiry: input.inquiry,
      interviewConsent: input.interviewConsent,
      job: input.job,
      name: input.name,
      nickname: input.nickname,
      phone: input.phone,
      previewToken: input.previewToken,
      profilePhotos: await Promise.all(input.profilePhotos.map(fileToPayload)),
      refundAgreement: input.refundAgreement,
      relationshipStatus: input.relationshipStatus,
      representativeCrop: input.representativeCrop,
      representativeIndex: input.representativeIndex,
      residence: input.residence,
      returning: input.returning,
      saveAsDefaultProfile: Boolean(input.saveAsDefaultProfile),
      sessionToken: session.token,
      userId: user.id,
      voiceIntro: await blobToPayload(input.voiceIntro, input.voiceIntroFileName),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '첨부파일을 처리하지 못했습니다.';
    throw new ApplicationSubmitError(message, 'file_encoding');
  }

  const { data, error } = await supabase.functions.invoke('submit-application', {
    body: payload,
  });

  if (error || data?.ok !== true) {
    const resolved = await resolveFunctionError(error, data, '신청서 저장에 실패했습니다.');
    throw new ApplicationSubmitError(resolved.message, resolved.stage);
  }
}

/**
 * On a non-2xx response, supabase-js discards the response body and returns
 * `data: null` with a generic `FunctionsHttpError` ("Edge Function returned a
 * non-2xx status code") — the actual Korean message our Edge Function sent
 * back (e.g. "파일 업로드에 실패했습니다...") is only reachable via
 * `error.context`, the raw Response object. Without reading it, every server
 * failure surfaces to the user as that one opaque SDK message no matter what
 * actually went wrong.
 */
async function resolveFunctionError(
  error: unknown,
  data: { message?: string; stage?: string } | null | undefined,
  fallback: string,
): Promise<{ message: string; stage: ApplicationErrorStage }> {
  const asStage = (value: unknown): ApplicationErrorStage =>
    knownApplicationErrorStages.includes(value as ApplicationErrorStage) ? (value as ApplicationErrorStage) : 'response';

  if (data?.message) return { message: data.message, stage: asStage(data.stage) };
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.message) return { message: String(body.message), stage: asStage(body.stage) };
    } catch {
      // Response body wasn't JSON (e.g. an infra/gateway error page) -
      // fall through to the generic fallback rather than surface raw HTML.
    }
    return { message: fallback, stage: 'response' };
  }
  if (error instanceof FunctionsFetchError) return { message: fallback, stage: 'submit_request' };
  return { message: fallback, stage: 'unknown' };
}

/**
 * Best-effort diagnostic log for a failed submission, so operators can see
 * why real applicants' submissions failed (Safari especially) without
 * relying on someone screenshotting an alert. Never throws - a logging
 * failure must never compound the applicant's actual problem. Deliberately
 * takes only non-sensitive metadata (never file bytes, PIN, or admin code).
 */
export async function logApplicationError(input: {
  applicationId?: string;
  eventId: string;
  fileCount?: number;
  message: string;
  stage: ApplicationErrorStage;
  totalBytes?: number;
}) {
  try {
    if (!supabase) return;
    const session = getAppSession();
    await supabase.rpc('log_application_error', {
      p_application_id: input.applicationId ?? null,
      p_event_id: input.eventId,
      p_file_count: input.fileCount ?? null,
      p_message: input.message,
      p_session_token: session?.token ?? '',
      p_stage: input.stage,
      p_total_bytes: input.totalBytes ?? null,
      p_user_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    });
  } catch {
    // Fire-and-forget: logging is a side channel, not part of the submit flow.
  }
}

export interface ApplicationErrorLogRow {
  applicationId: string | null;
  applicationNo: string | null;
  createdAt: string;
  eventDate: string | null;
  eventId: string | null;
  eventTitle: string | null;
  fileCount: number | null;
  id: string;
  message: string | null;
  stage: string;
  totalBytes: number | null;
  userAgent: string | null;
}

export async function fetchAdminApplicationErrorLogs(limit = 100): Promise<ApplicationErrorLogRow[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_application_error_logs', {
    limit_count: limit,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    applicationId: (row.application_id as string) ?? null,
    applicationNo: (row.application_no as string) ?? null,
    createdAt: row.created_at as string,
    eventDate: (row.event_date as string) ?? null,
    eventId: (row.event_id as string) ?? null,
    eventTitle: (row.event_title as string) ?? null,
    fileCount: (row.file_count as number) ?? null,
    id: row.id as string,
    message: (row.message as string) ?? null,
    stage: row.stage as string,
    totalBytes: (row.total_bytes as number) ?? null,
    userAgent: (row.user_agent as string) ?? null,
  }));
}

export async function fetchOwnApplicationForEvent(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('application-session-data', {
    body: {
      action: 'get-existing',
      eventId,
      sessionToken: session.token,
    },
  });

  if (error || data?.ok !== true) throw new Error(data?.message || error?.message || '기존 신청 내역 확인에 실패했습니다.');
  return data.application ?? null;
}

export async function fetchApplicationDraft(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('application-session-data', {
    body: {
      action: 'get-draft',
      eventId,
      sessionToken: session.token,
    },
  });

  if (error || data?.ok !== true) throw new Error(data?.message || error?.message || '임시저장을 불러오지 못했습니다.');
  return (data.draft ?? null) as Record<string, unknown> | null;
}

export async function saveApplicationDraft(eventId: string, draftData: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('application-session-data', {
    body: {
      action: 'save-draft',
      draftData,
      eventId,
      sessionToken: session.token,
    },
  });

  if (error || data?.ok !== true) throw new Error(data?.message || error?.message || '임시저장에 실패했습니다.');
}

async function ensureAccountRow(userId: string, accountType: 'member' | 'guest') {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { error } = await supabase.from('user_accounts').upsert({
    account_type: accountType,
    user_id: userId,
  }, {
    onConflict: 'user_id',
  });

  if (error) throw error;
}

async function getCurrentAccountType(userId: string): Promise<'member' | 'guest'> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data } = await supabase
    .from('user_accounts')
    .select('account_type')
    .eq('user_id', userId)
    .maybeSingle();

  return data?.account_type === 'guest' ? 'guest' : 'member';
}

export async function fetchAdminApplicationsFromSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase
    .rpc('get_admin_applications_for_session', {
      session_token: adminSession.token,
    });

  if (error) throw error;
  return (data as SupabaseApplicationRow[])
    .map(mapApplicationRow)
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

export async function updateApplicationReviewInSupabase(
  application: StoredApplication,
  status: '결제 대기' | '참여 보류' | '반려' | '참가 확정' | '자동 취소',
  values: {
    paymentDeadline?: string;
    paymentNoticeSentAt?: string;
    reason?: string;
    reviewedAt?: string;
  } = {},
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!application.dbId) throw new Error('Supabase 신청서 ID가 없습니다.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  // The server can override the requested status (e.g. a 0원 event skips
  // 결제 대기 and confirms immediately), so the actual applied status is
  // returned here rather than assumed to match what was requested.
  const { data, error } = await supabase.rpc('update_application_review_for_session', {
    next_payment_deadline: values.paymentDeadline ?? application.paymentDeadline ?? null,
    next_payment_notice_sent_at: values.paymentNoticeSentAt ?? application.paymentNoticeSentAt ?? null,
    next_review_reason: values.reason ?? null,
    next_reviewed_at: values.reviewedAt ?? application.reviewedAt ?? new Date().toISOString(),
    next_status: status,
    session_token: adminSession.token,
    target_application_id: application.dbId,
  });

  if (error) throw error;
  return data as StoredApplication['status'];
}

export async function cancelMyHeldApplication(applicationId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { error } = await supabase.rpc('cancel_my_held_application', {
    application_id: applicationId,
    session_token: session.token,
  });

  if (error) throw error;
}

export async function resetGuestPinForAdmin(userId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('reset_guest_pin_for_admin_session', {
    session_token: adminSession.token,
    target_user_id: userId,
  });

  if (error || typeof data !== 'string') throw error ?? new Error('PIN을 초기화하지 못했습니다.');
  return data;
}

export async function confirmBankTransferInSupabase(application: StoredApplication) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!application.dbId) throw new Error('Supabase 신청서 ID가 없습니다.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('confirm_bank_transfer_for_session', {
    p_application_id: application.dbId,
    session_token: adminSession.token,
  });

  if (error) throw error;
}

export async function rejectBankTransferInSupabase(application: StoredApplication, reason: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!application.dbId) throw new Error('Supabase 신청서 ID가 없습니다.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('reject_bank_transfer_for_session', {
    failure_reason: reason,
    p_application_id: application.dbId,
    session_token: adminSession.token,
  });

  if (error) throw error;
}

export async function fetchAdminApplicationFiles(application: StoredApplication) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!application.dbId) throw new Error('Supabase 신청서 ID가 없습니다.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const functionName = 'admin-application-files';
  const requestBody = {
    applicationId: application.dbId,
    sessionToken: adminSession.token,
  };

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: requestBody,
  });

  if (error || data?.ok !== true) {
    const status = readFunctionStatus(error);
    console.error('Admin application file request failed', {
      applicationId: application.dbId,
      functionName,
      hasAdminSession: Boolean(adminSession.token),
      message: error?.message || data?.message,
      status,
    });
    throw new Error(data?.message || functionErrorMessage(status, error?.message));
  }

  return {
    employmentProof: data.employmentProof ?? undefined,
    idPhoto: data.idPhoto ?? undefined,
    profilePhotos: Array.isArray(data.profilePhotos) ? data.profilePhotos : [],
    representativeIndex: Number(data.representativeIndex ?? 0),
    voiceIntro: data.voiceIntro ?? undefined,
  } satisfies AdminApplicationFiles;
}

function readFunctionStatus(error: unknown) {
  const context = typeof error === 'object' && error !== null && 'context' in error ? (error as { context?: unknown }).context : null;
  if (context && typeof context === 'object' && 'status' in context) {
    const status = Number((context as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

function functionErrorMessage(status?: number, rawMessage?: string) {
  if (status === 401 || status === 403) return '관리자 인증이 만료되었거나 권한이 없습니다. 다시 관리자 인증 후 시도해주세요.';
  if (status === 404) return '심사 자료 조회 함수가 배포되지 않았습니다. admin-application-files 배포 상태를 확인해주세요.';
  if (status && status >= 500) return '심사 자료 서버에서 오류가 발생했습니다. Function 로그를 확인해주세요.';
  if (rawMessage?.includes('Failed to send')) return '심사 자료 요청을 보내지 못했습니다. Edge Function 배포와 Supabase 프로젝트 설정을 확인해주세요.';
  return '심사 자료를 불러오지 못했습니다. 다시 시도해주세요.';
}

function mapPublicEventSummaryRow(event: PublicEventSummaryRow): EventData {
  return {
    applicationDeadline: event.application_deadline ?? undefined,
    currentParticipants: event.current_participants,
    date: event.event_date,
    earlyBirdDeadline: event.early_bird_deadline ?? undefined,
    earlyBirdDiscountMale: event.early_bird_discount_male ?? 0,
    earlyBirdDiscountFemale: event.early_bird_discount_female ?? 0,
    endTime: event.end_time.slice(0, 5),
    id: event.id,
    isTestEvent: event.is_test_event ?? false,
    location: event.location,
    malePrice: event.male_price ?? 50000,
    femalePrice: event.female_price ?? 40000,
    femaleApplications: event.female_applications,
    femaleConfirmed: event.female_confirmed,
    maleApplications: event.male_applications,
    maleConfirmed: event.male_confirmed,
    maleCapacity: event.male_capacity,
    femaleCapacity: event.female_capacity,
    shortName: event.short_name,
    startTime: event.start_time.slice(0, 5),
    targetParticipants: event.target_participants,
    title: event.title,
    venueBooked: event.venue_booked,
  };
}

export async function fetchPublicEventsFromSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_public_event_summaries');
  if (error) throw error;

  return (data as PublicEventSummaryRow[]).map(mapPublicEventSummaryRow) satisfies EventData[];
}

/**
 * Same shape as fetchPublicEventsFromSupabase, but for admin screens: unlike
 * the public listing (which deliberately hides test events from real
 * visitors), admins need to see and manage test events too - e.g. the
 * per-event participant list page looks up the event by id from this list,
 * and previously came up empty for any test event.
 */
export async function fetchAdminEventSummariesFromSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_event_summaries', {
    session_token: adminSession.token,
  });
  if (error) throw error;

  return (data as PublicEventSummaryRow[]).map(mapPublicEventSummaryRow) satisfies EventData[];
}

export async function fetchAdminEventDetailsFromSupabase(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_event_for_session', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as AdminEventDetailsRow | undefined;
  if (!row) return null;

  return {
    applicationDeadline: row.application_deadline ?? undefined,
    date: row.event_date,
    earlyBirdDeadline: row.early_bird_deadline ?? undefined,
    earlyBirdDiscountMale: row.early_bird_discount_male ?? 0,
    earlyBirdDiscountFemale: row.early_bird_discount_female ?? 0,
    endTime: row.end_time.slice(0, 5),
    femaleCapacity: row.female_capacity,
    femalePrice: row.female_price,
    id: row.id,
    location: row.location,
    isTestEvent: row.is_test_event,
    maleCapacity: row.male_capacity,
    malePrice: row.male_price,
    shortName: row.short_name,
    startTime: row.start_time.slice(0, 5),
    title: row.title,
    venueBooked: row.venue_booked,
    venueDetail: row.venue_detail ?? '',
  };
}

export interface PublicParticipantMediaRow {
  id: string;
  audioUrl: string | null;
  photoUrl: string | null;
  representativeCrop: { scale: number; offsetX: number; offsetY: number } | null;
}

export async function fetchPublicParticipantsFromSupabase(eventId: string, previewToken?: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const [previewResult, mediaResult] = await Promise.all([
    supabase.rpc('get_public_participant_previews', { preview_token: previewToken ?? null, target_event_id: eventId }),
    supabase.functions.invoke('public-participant-media', { body: { eventId } }).catch(() => null),
  ]);

  if (previewResult.error) throw previewResult.error;

  const mediaById = new Map<string, PublicParticipantMediaRow>();
  if (mediaResult && mediaResult.error === null && mediaResult.data?.ok === true) {
    for (const row of mediaResult.data.media as PublicParticipantMediaRow[]) {
      mediaById.set(row.id, row);
    }
  }

  return (previewResult.data as PublicParticipantPreviewRow[]).map((participant) => {
    const media = mediaById.get(participant.id);
    return {
      audioIntroUrl: media?.audioUrl ?? undefined,
      avatarIndex: participant.avatar_index,
      gender: participant.gender === '여성' ? 'female' : 'male',
      id: participant.id,
      nickname: participant.nickname,
      photoUrl: media?.photoUrl ?? undefined,
      representativeCrop: media?.representativeCrop ?? undefined,
      tags: [`${participant.age}세`, participant.job],
    };
  }) satisfies ParticipantData[];
}

export async function fetchAdminEventParticipantMedia(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('admin-event-participant-media', {
    body: { eventId, sessionToken: adminSession.token },
  });

  const mediaById = new Map<string, PublicParticipantMediaRow>();
  if (error || data?.ok !== true) {
    console.error('Admin event participant media request failed', {
      eventId,
      message: error?.message || data?.message,
      status: readFunctionStatus(error),
    });
    return mediaById;
  }

  for (const row of data.media as PublicParticipantMediaRow[]) {
    mediaById.set(row.id, row);
  }
  return mediaById;
}

export async function fetchAdminEventModeSummaries() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_event_mode_summaries', {
    session_token: adminSession.token,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      return fetchAdminEventModeSummariesFromExistingSupabaseData();
    }
    throw error;
  }
  return (data as AdminEventModeSummaryRow[]).map((event) => ({
    checkinCount: event.checkin_count,
    confirmedCount: event.confirmed_count,
    date: event.event_date,
    endTime: event.end_time.slice(0, 5),
    femaleCheckinCount: event.female_checkin_count ?? 0,
    femaleConfirmedCount: event.female_confirmed_count ?? 0,
    id: event.id,
    isTestEvent: event.is_test_event,
    location: event.location,
    maleCheckinCount: event.male_checkin_count ?? 0,
    maleConfirmedCount: event.male_confirmed_count ?? 0,
    requiredTablets: event.required_tablets,
    startTime: event.start_time.slice(0, 5),
    startedAt: event.started_at ?? undefined,
    tabletCount: event.tablet_count,
    title: event.title,
  })) satisfies AdminEventModeSummary[];
}

async function fetchAdminEventModeSummariesFromExistingSupabaseData() {
  const [events, applications] = await Promise.all([
    fetchPublicEventsFromSupabase(),
    fetchAdminApplicationsFromSupabase(),
  ]);

  return events.map((event) => {
    const eventApplications = applications.filter((application) => application.eventId === event.id);
    const confirmedApplications = eventApplications.filter((application) => application.status === '참가 확정');

    return {
      checkinCount: confirmedApplications.filter((application) => Boolean(application.checkedInAt)).length,
      confirmedCount: event.currentParticipants,
      date: event.date,
      endTime: event.endTime,
      femaleCheckinCount: confirmedApplications.filter((application) => application.gender === '여성' && Boolean(application.checkedInAt)).length,
      femaleConfirmedCount: confirmedApplications.filter((application) => application.gender === '여성').length,
      id: event.id,
      isTestEvent: false,
      location: event.location,
      maleCheckinCount: confirmedApplications.filter((application) => application.gender === '남성' && Boolean(application.checkedInAt)).length,
      maleConfirmedCount: confirmedApplications.filter((application) => application.gender === '남성').length,
      requiredTablets: Math.max(1, Math.min(event.maleCapacity ?? 10, event.femaleCapacity ?? 10)),
      startTime: event.startTime,
      tabletCount: 0,
      title: event.title,
    };
  }) satisfies AdminEventModeSummary[];
}

export async function upsertEventToSupabase(event: EventData) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('upsert_event_for_admin_session', {
    event_application_deadline: event.applicationDeadline ?? null,
    event_date_value: event.date,
    event_early_bird_deadline: event.earlyBirdDeadline ?? null,
    event_early_bird_discount_female: event.earlyBirdDiscountFemale ?? 0,
    event_early_bird_discount_male: event.earlyBirdDiscountMale ?? 0,
    event_end_time: event.endTime,
    event_female_price: event.femalePrice,
    event_id_value: event.id,
    event_is_test_event: event.isTestEvent ?? false,
    event_location: event.location,
    event_male_price: event.malePrice,
    event_short_name: event.shortName,
    event_start_time: event.startTime,
    event_title: event.title,
    event_venue_booked: event.venueBooked,
    event_venue_detail: event.venueDetail ?? '',
    female_capacity_value: event.femaleCapacity ?? Math.floor(event.targetParticipants / 2),
    male_capacity_value: event.maleCapacity ?? Math.ceil(event.targetParticipants / 2),
    session_token: adminSession.token,
  });

  if (error) throw error;
}

export async function deleteEventFromSupabase(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('admin-delete-event', {
    body: {
      eventId,
      sessionToken: adminSession.token,
    },
  });

  if (error || data?.ok !== true) throw error ?? new Error('행사를 삭제하지 못했습니다.');
}

export async function createTestEventPreviewLink(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('create_test_event_preview_token', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { token: string; expires_at: string } | undefined;
  if (!row) throw new Error('테스트 링크를 생성하지 못했습니다.');
  return { expiresAt: row.expires_at, token: row.token };
}

const testEventPreviewCacheKey = 'time2meet.testEventPreviewTokens';

/**
 * The preview-link entry point (/events/{id}?previewToken=...) is several
 * navigations away from where it's actually needed (login, profile form),
 * and nothing in between re-appends the query param. Caching the token here
 * (per event id) lets every later page on this device just ask "do I have
 * access to this test event" without threading it through every Link/navigate
 * call in the chain.
 */
export function cacheTestEventPreviewToken(eventId: string, token: string) {
  try {
    const raw = window.sessionStorage.getItem(testEventPreviewCacheKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    parsed[eventId] = token;
    window.sessionStorage.setItem(testEventPreviewCacheKey, JSON.stringify(parsed));
  } catch {
    // Best-effort cache only.
  }
}

export function getCachedTestEventPreviewToken(eventId: string | undefined): string | undefined {
  if (!eventId) return undefined;
  try {
    const raw = window.sessionStorage.getItem(testEventPreviewCacheKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed[eventId];
  } catch {
    return undefined;
  }
}

export async function fetchTestEventPreview(eventId: string, previewToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_test_event_preview', {
    event_id_value: eventId,
    preview_token: previewToken,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as PublicEventSummaryRow | undefined;
  if (!row) return null;
  return mapPublicEventSummaryRow(row);
}

export async function createTestParticipants(eventId: string, maleCount: number, femaleCount: number) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('create_test_participants_for_session', {
    event_id_value: eventId,
    female_count: femaleCount,
    male_count: maleCount,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return data as number;
}

export async function resetTestEventData(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('reset-test-event', {
    body: { eventId, sessionToken: adminSession.token },
  });

  if (error || data?.ok !== true) throw new Error(data?.message || error?.message || '테스트 데이터 초기화에 실패했습니다.');
}

export function subscribeToSupabaseChanges(onChange: () => void) {
  if (!supabase) return () => undefined;

  const client = supabase;
  const channel = supabase
    .channel('time2meet-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });

  return () => {
    void client.removeChannel(channel);
  };
}

export function subscribeToAdminEventModeChanges(onChange: () => void) {
  if (!supabase) return () => undefined;

  const client = supabase;
  const channel = supabase
    .channel('time2meet-admin-event-mode')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'application_tickets' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_tablets' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });

  return () => {
    void client.removeChannel(channel);
  };
}

export async function fetchMyPaymentInvitations() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return [];

  const { data, error } = await supabase.rpc('get_my_payment_invitations', {
    session_token: session.token,
  });

  if (error) throw error;
  return (data as PaymentInvitationRow[]).map(mapPaymentInvitationRow);
}

export async function fetchMyEventTickets() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return [];

  const { data, error } = await supabase.rpc('get_my_event_tickets', {
    session_token: session.token,
  });

  if (error) throw error;
  return (data as MyEventTicketRow[]).map(mapMyEventTicketRow);
}

export async function requestBankTransferConfirmation(applicationId: string, depositorName: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { error } = await supabase.rpc('request_bank_transfer_confirmation', {
    depositor_name_value: depositorName,
    p_application_id: applicationId,
    refund_policy_confirmed_value: true,
    session_token: session.token,
  });

  if (error) throw error;
}

export function subscribeToMyApplicationChanges(onChange: () => void) {
  if (!supabase) return () => undefined;
  const session = getAppSession();
  if (!session?.userId) return () => undefined;

  const client = supabase;
  const channel = supabase
    .channel(`time2meet-my-applications-${session.userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `user_id=eq.${session.userId}`,
        schema: 'public',
        table: 'applications',
      },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });

  return () => {
    void client.removeChannel(channel);
  };
}

export async function checkInTicketInSupabase(eventId: string, qrToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('check_in_ticket_for_session', {
    event_id_value: eventId,
    qr_token_value: qrToken,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    alreadyCheckedIn: Boolean(row?.already_checked_in),
    applicationNo: row?.application_no ?? '',
    checkedInAt: row?.checked_in_at ?? undefined,
    message: row?.message ?? '',
    nickname: row?.nickname ?? '',
    ok: Boolean(row?.ok),
  } satisfies AdminCheckInResult;
}

export async function fetchAdminTicketPreview(eventId: string, qrToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_ticket_preview_for_session', {
    event_id_value: eventId,
    qr_token_value: qrToken,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    alreadyCheckedIn: Boolean(row?.already_checked_in),
    applicationId: row?.application_id ?? undefined,
    applicationNo: row?.application_no ?? '',
    checkedInAt: row?.checked_in_at ?? undefined,
    message: row?.message ?? '',
    nickname: row?.nickname ?? '',
    ok: Boolean(row?.ok),
  } satisfies AdminTicketPreview;
}

export async function checkInApplicationInSupabase(eventId: string, applicationId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('check_in_application_for_session', {
    application_id_value: applicationId,
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    alreadyCheckedIn: Boolean(row?.already_checked_in),
    applicationNo: row?.application_no ?? '',
    checkedInAt: row?.checked_in_at ?? undefined,
    message: row?.message ?? '',
    nickname: row?.nickname ?? '',
    ok: Boolean(row?.ok),
  } satisfies AdminCheckInResult;
}

export async function fetchAdminEventTabletStatus(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_event_tablet_status', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return (
    data as Array<{ connected: boolean; device_label: string | null; last_seen_at: string | null; table_number: number }>
  ).map((row) => ({
    connected: row.connected,
    deviceLabel: row.device_label ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    tableNumber: row.table_number,
  })) satisfies AdminEventTabletStatus[];
}

export interface EventTabletConnection {
  connectedAt: string;
  connectionToken: string;
  tableNumber: number;
}

export async function connectEventTablet(eventId: string, tableNumber: number) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('connect_event_tablet_for_session', {
    event_id_value: eventId,
    session_token: adminSession.token,
    table_number_value: tableNumber,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('태블릿을 연결하지 못했습니다.');
  return {
    connectedAt: row.connected_at,
    connectionToken: row.connection_token,
    tableNumber: row.table_number,
  } satisfies EventTabletConnection;
}

export async function verifyEventTabletConnection(eventId: string, tableNumber: number, connectionToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('verify_event_tablet_connection', {
    connection_token: connectionToken,
    event_id_value: eventId,
    table_number_value: tableNumber,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { connectedAt: row?.connected_at ?? undefined, ok: Boolean(row?.ok) };
}

export interface EventTableSeatGuide {
  femaleNickname?: string;
  maleNickname?: string;
  ok: boolean;
  roundNumber?: number;
}

export async function fetchEventTableSeatGuide(eventId: string, tableNumber: number, connectionToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_event_table_seat_guide', {
    connection_token: connectionToken,
    event_id_value: eventId,
    table_number_value: tableNumber,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    femaleNickname: row?.female_nickname ?? undefined,
    maleNickname: row?.male_nickname ?? undefined,
    ok: Boolean(row?.ok),
    roundNumber: row?.round_number ?? undefined,
  } satisfies EventTableSeatGuide;
}

export async function disconnectAdminEventTablet(eventId: string, tableNumber: number) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('disconnect_event_tablet_for_session', {
    event_id_value: eventId,
    session_token: adminSession.token,
    table_number_value: tableNumber,
  });

  if (error) throw error;
}

export async function startAdminEvent(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('start_admin_event_for_session', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return data as string;
}

export type EventProgressStage = 'ended' | 'intro_video' | 'round_active' | 'round_complete' | 'round_waiting' | 'seat_guide';
export type IntroVideoAction = 'complete' | 'pause' | 'play' | 'restart' | 'skip';

export interface EventProgress {
  currentRound?: number;
  introVideoCompletedAt?: string;
  introVideoDescription?: string;
  introVideoPositionSeconds: number;
  introVideoStatus: 'paused' | 'playing';
  introVideoTitle?: string;
  introVideoUpdatedAt?: string;
  introVideoUrl?: string;
  stage: EventProgressStage;
}

export type TabletEventProgress = { ok: false } | ({ ok: true } & EventProgress);

interface EventProgressRow {
  current_round: number | null;
  intro_video_completed_at: string | null;
  intro_video_description: string | null;
  intro_video_position_seconds: number;
  intro_video_status: 'paused' | 'playing';
  intro_video_title: string | null;
  intro_video_updated_at: string | null;
  intro_video_url: string | null;
  stage: EventProgressStage;
}

function mapEventProgressRow(row: EventProgressRow): EventProgress {
  return {
    currentRound: row.current_round ?? undefined,
    introVideoCompletedAt: row.intro_video_completed_at ?? undefined,
    introVideoDescription: row.intro_video_description ?? undefined,
    introVideoPositionSeconds: row.intro_video_position_seconds,
    introVideoStatus: row.intro_video_status,
    introVideoTitle: row.intro_video_title ?? undefined,
    introVideoUpdatedAt: row.intro_video_updated_at ?? undefined,
    introVideoUrl: row.intro_video_url ?? undefined,
    stage: row.stage,
  };
}

export async function fetchAdminEventProgress(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_event_progress', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('행사 진행 상태를 불러오지 못했습니다.');
  return mapEventProgressRow(row as EventProgressRow);
}

export async function fetchEventProgressForTablet(eventId: string, tableNumber: number, connectionToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_event_progress_for_tablet', {
    connection_token: connectionToken,
    event_id_value: eventId,
    table_number_value: tableNumber,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) return { ok: false } satisfies TabletEventProgress;
  return { ok: true, ...mapEventProgressRow(row as EventProgressRow) } satisfies TabletEventProgress;
}

export type IntroVideoControlResult = Pick<
  EventProgress,
  'introVideoCompletedAt' | 'introVideoPositionSeconds' | 'introVideoStatus' | 'introVideoUpdatedAt' | 'stage'
>;

export async function controlEventIntroVideo(eventId: string, action: IntroVideoAction) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('control_event_intro_video_for_session', {
    action,
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('영상 상태를 변경하지 못했습니다.');
  return {
    introVideoCompletedAt: row.intro_video_completed_at ?? undefined,
    introVideoPositionSeconds: row.intro_video_position_seconds,
    introVideoStatus: row.intro_video_status,
    introVideoUpdatedAt: row.intro_video_updated_at ?? undefined,
    stage: row.stage,
  } satisfies IntroVideoControlResult;
}

export async function startFirstRound(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('start_first_round_for_session', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return data as number;
}

export interface RoundTableMatch {
  femaleApplicationId?: string;
  femaleNickname?: string;
  maleApplicationId?: string;
  maleNickname?: string;
  tableNumber: number;
}

export interface RoundProgress {
  activeTables: number;
  completedRounds: number;
  currentRound?: number;
  matches: RoundTableMatch[];
  pendingPauseCount: number;
  roundPhase?: 'conversation' | 'transition';
  stage: EventProgressStage;
  timerPositionSeconds: number;
  timerStatus: 'paused' | 'running';
  timerUpdatedAt?: string;
  totalParticipants: number;
  totalRounds: number;
}

interface RoundProgressJson {
  activeTables: number;
  completedRounds: number;
  currentRound: number | null;
  matches: Array<{
    femaleApplicationId: string | null;
    femaleNickname: string | null;
    maleApplicationId: string | null;
    maleNickname: string | null;
    tableNumber: number;
  }>;
  pendingPauseCount: number;
  roundPhase: 'conversation' | 'transition' | null;
  stage: EventProgressStage;
  timerPositionSeconds: number;
  timerStatus: 'paused' | 'running';
  timerUpdatedAt: string | null;
  totalParticipants: number;
  totalRounds: number;
}

function mapRoundProgressJson(row: RoundProgressJson): RoundProgress {
  return {
    activeTables: row.activeTables,
    completedRounds: row.completedRounds,
    currentRound: row.currentRound ?? undefined,
    matches: (row.matches ?? []).map((match) => ({
      femaleApplicationId: match.femaleApplicationId ?? undefined,
      femaleNickname: match.femaleNickname ?? undefined,
      maleApplicationId: match.maleApplicationId ?? undefined,
      maleNickname: match.maleNickname ?? undefined,
      tableNumber: match.tableNumber,
    })),
    pendingPauseCount: row.pendingPauseCount,
    roundPhase: row.roundPhase ?? undefined,
    stage: row.stage,
    timerPositionSeconds: row.timerPositionSeconds,
    timerStatus: row.timerStatus,
    timerUpdatedAt: row.timerUpdatedAt ?? undefined,
    totalParticipants: row.totalParticipants,
    totalRounds: row.totalRounds,
  };
}

export async function fetchAdminRoundProgress(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_round_progress', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return mapRoundProgressJson(data as RoundProgressJson);
}

export type RoundTimerAction = 'pause' | 'resume' | 'skip';

export async function controlRoundTimer(eventId: string, action: RoundTimerAction) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('control_round_timer_for_session', {
    action,
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
}

export async function setCurrentRoundForSession(eventId: string, roundNumber: number) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('set_current_round_for_session', {
    event_id_value: eventId,
    round_number_value: roundNumber,
    session_token: adminSession.token,
  });

  if (error) throw error;
}

export interface TabletRoundProgress {
  currentRound?: number;
  femaleNickname?: string;
  maleNickname?: string;
  ok: boolean;
  roundPhase?: 'conversation' | 'transition';
  stage?: EventProgressStage;
  timerPositionSeconds?: number;
  timerStatus?: 'paused' | 'running';
  timerUpdatedAt?: string;
  totalRounds?: number;
}

export async function fetchRoundProgressForTablet(eventId: string, tableNumber: number, connectionToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_round_progress_for_tablet', {
    connection_token: connectionToken,
    event_id_value: eventId,
    table_number_value: tableNumber,
  });

  if (error) throw error;
  const row = data as { ok: boolean } & Partial<RoundProgressJson & { maleNickname: string | null; femaleNickname: string | null }>;
  if (!row?.ok) return { ok: false } satisfies TabletRoundProgress;
  return {
    currentRound: row.currentRound ?? undefined,
    femaleNickname: row.femaleNickname ?? undefined,
    maleNickname: row.maleNickname ?? undefined,
    ok: true,
    roundPhase: row.roundPhase ?? undefined,
    stage: row.stage,
    timerPositionSeconds: row.timerPositionSeconds ?? undefined,
    timerStatus: row.timerStatus,
    timerUpdatedAt: row.timerUpdatedAt ?? undefined,
    totalRounds: row.totalRounds ?? undefined,
  } satisfies TabletRoundProgress;
}

export interface EventPauseRequest {
  id: string;
  nickname: string;
  requestType: 'call_staff' | 'pause';
  requestedAt: string;
  status: 'acknowledged' | 'pending' | 'resolved';
  tableNumber?: number;
}

export async function fetchAdminPauseRequests(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_pause_requests', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return (
    data as Array<{
      id: string;
      nickname: string;
      request_type: EventPauseRequest['requestType'];
      requested_at: string;
      status: EventPauseRequest['status'];
      table_number: number | null;
    }>
  ).map((row) => ({
    id: row.id,
    nickname: row.nickname,
    requestType: row.request_type,
    requestedAt: row.requested_at,
    status: row.status,
    tableNumber: row.table_number ?? undefined,
  })) satisfies EventPauseRequest[];
}

export async function updatePauseRequestStatus(requestId: string, status: EventPauseRequest['status']) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('update_pause_request_status_for_session', {
    request_id_value: requestId,
    session_token: adminSession.token,
    status_value: status,
  });

  if (error) throw error;
}

export interface ParticipantRoundProgress {
  currentRound?: number;
  ok: boolean;
  partnerAge?: number;
  partnerApplicationId?: string;
  partnerJob?: string;
  partnerNickname?: string;
  roundPhase?: 'conversation' | 'transition';
  // undefined stage means the operator hasn't pressed 행사 시작 yet (no
  // event_progress row exists) - distinct from any real EventProgressStage.
  stage?: EventProgressStage;
  tableNumber?: number;
  timerPositionSeconds?: number;
  timerStatus?: 'paused' | 'running';
  timerUpdatedAt?: string;
  totalRounds?: number;
}

export async function fetchParticipantRoundProgress(eventId: string): Promise<ParticipantRoundProgress> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return { ok: false };

  const { data, error } = await supabase.rpc('get_round_progress_for_participant', {
    event_id_value: eventId,
    session_token: session.token,
  });
  if (error) throw error;
  const row = data as {
    currentRound?: number;
    ok: boolean;
    partnerAge?: number | null;
    partnerApplicationId?: string | null;
    partnerJob?: string | null;
    partnerNickname?: string | null;
    roundPhase?: 'conversation' | 'transition' | null;
    stage?: EventProgressStage | null;
    tableNumber?: number | null;
    timerPositionSeconds?: number | null;
    timerStatus?: 'paused' | 'running' | null;
    timerUpdatedAt?: string | null;
    totalRounds?: number;
  };
  if (!row?.ok) return { ok: false };
  return {
    currentRound: row.currentRound ?? undefined,
    ok: true,
    partnerAge: row.partnerAge ?? undefined,
    partnerApplicationId: row.partnerApplicationId ?? undefined,
    partnerJob: row.partnerJob ?? undefined,
    partnerNickname: row.partnerNickname ?? undefined,
    roundPhase: row.roundPhase ?? undefined,
    stage: row.stage ?? undefined,
    tableNumber: row.tableNumber ?? undefined,
    timerPositionSeconds: row.timerPositionSeconds ?? undefined,
    timerStatus: row.timerStatus ?? undefined,
    timerUpdatedAt: row.timerUpdatedAt ?? undefined,
    totalRounds: row.totalRounds ?? undefined,
  };
}

export async function createParticipantPauseRequest(
  eventId: string,
  tableNumber: number | undefined,
  requestType: 'call_staff' | 'pause',
): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase.rpc('create_event_pause_request', {
    event_id_value: eventId,
    request_type_value: requestType,
    session_token: session.token,
    table_number_value: tableNumber ?? null,
  });
  if (error) throw error;
  return data as string;
}

export interface ParticipantRating {
  memo?: string;
  partnerApplicationId: string;
  partnerNickname: string;
  roundNumber: number;
  score: number;
}

export async function fetchAdminParticipantRatings(eventId: string, applicationId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_participant_ratings', {
    application_id_value: applicationId,
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return (
    data as Array<{
      memo: string | null;
      partner_application_id: string;
      partner_nickname: string;
      round_number: number;
      score: number;
    }>
  ).map((row) => ({
    memo: row.memo ?? undefined,
    partnerApplicationId: row.partner_application_id,
    partnerNickname: row.partner_nickname,
    roundNumber: row.round_number,
    score: row.score,
  })) satisfies ParticipantRating[];
}

export interface MyRoundRating {
  memo?: string;
  score?: number;
}

export async function fetchMyRoundRating(eventId: string, roundNumber: number): Promise<MyRoundRating> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return {};

  const { data, error } = await supabase.rpc('get_my_round_rating', {
    event_id_value: eventId,
    round_number_value: roundNumber,
    session_token: session.token,
  });
  if (error) throw error;
  const row = data as { ok: boolean; score?: number | null; memo?: string | null };
  if (!row?.ok) return {};
  return { memo: row.memo ?? undefined, score: row.score ?? undefined };
}

export async function submitRoundRating(eventId: string, roundNumber: number, score: number, memo: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { error } = await supabase.rpc('submit_round_rating', {
    event_id_value: eventId,
    memo_value: memo.trim() || null,
    round_number_value: roundNumber,
    score_value: score,
    session_token: session.token,
  });
  if (error) throw error;
}

export async function fetchParticipantPartnerPhoto(eventId: string): Promise<string | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return null;

  const { data, error } = await supabase.functions.invoke('participant-partner-photo', {
    body: { eventId, sessionToken: session.token },
  });
  if (error) throw error;
  return (data as { ok: boolean; photoUrl: string | null })?.photoUrl ?? null;
}

export async function endAdminEvent(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('end_admin_event_for_session', {
    event_id_value: eventId,
    session_token: adminSession.token,
  });

  if (error) throw error;
  return data as string;
}

export async function dismissPaymentInvitation(invitationId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { error } = await supabase.rpc('mark_payment_invitation_dismissed', {
    invitation_id: invitationId,
    session_token: session.token,
  });

  if (error) throw error;
}

export async function markPaymentInvitationRead(invitationId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { error } = await supabase.rpc('mark_payment_invitation_read', {
    invitation_id: invitationId,
    session_token: session.token,
  });

  if (error) throw error;
}

export async function markPaymentInvitationReadByApplication(applicationId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인이 필요합니다.');

  const { error } = await supabase.rpc('mark_payment_invitation_read_by_application', {
    application_id: applicationId,
    session_token: session.token,
  });

  if (error) throw error;
}

export function subscribeToPaymentInvitationChanges(onChange: () => void) {
  if (!supabase) return () => undefined;
  const session = getAppSession();
  if (!session?.userId) return () => undefined;

  const client = supabase;
  const channel = supabase
    .channel(`time2meet-payment-invitations-${session.userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `user_id=eq.${session.userId}`,
        schema: 'public',
        table: 'payment_invitations',
      },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onChange();
    });

  return () => {
    void client.removeChannel(channel);
  };
}

function mapApplicationRow(row: SupabaseApplicationRow): StoredApplication {
  const age = getAge(row.birth_date, row.event_date);
  const profile = mapProfile(row);

  return {
    age,
    appliedAt: formatShortDateTime(row.submitted_at),
    dbId: row.id,
    accountType: row.account_type ?? 'member',
    eventId: row.event_id,
    eventDate: row.event_date ? formatApplicationEventDate(row.event_date) : '행사 날짜 미정',
    eventType: row.short_name ?? '로테이션',
    gender: row.gender,
    id: formatApplicationNo(row.application_no),
    isNew: row.is_new,
    checkedInAt: row.checked_in_at ?? undefined,
    depositFailedAt: row.deposit_failed_at ?? undefined,
    depositFailureReason: row.deposit_failure_reason ?? undefined,
    depositRequestedAt: row.deposit_requested_at ?? undefined,
    depositorName: row.depositor_name ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    refundPolicyConfirmed: Boolean(row.refund_policy_confirmed),
    refundPolicyConfirmedAt: row.refund_policy_confirmed_at ?? undefined,
    transferGuideConfirmedAt: row.transfer_guide_confirmed_at ?? undefined,
    transferIntentConfirmed: Boolean(row.transfer_intent_confirmed),
    paymentDeadline: row.payment_deadline ?? undefined,
    paymentCompletedAt: row.payment_completed_at ?? undefined,
    paymentNoticeSentAt: row.payment_notice_sent_at ?? undefined,
    profile,
    returning: row.is_returning ? '재참여' : '첫 참여',
    reviewedAt: row.reviewed_at ?? undefined,
    status: row.status,
    userId: row.user_display_id ?? row.nickname,
    userUuid: row.user_id,
  };
}

function mapPaymentInvitationRow(row: PaymentInvitationRow): PaymentInvitation {
  return {
    applicationId: row.application_id,
    createdAt: row.created_at,
    dismissedAt: row.dismissed_at ?? undefined,
    eventDate: row.event_date,
    eventId: row.event_id,
    eventTitle: row.event_title,
    id: row.id,
    paymentDeadline: row.payment_deadline,
    readAt: row.read_at ?? undefined,
    startTime: row.start_time.slice(0, 5),
    status: row.status,
  };
}

function mapMyEventTicketRow(row: MyEventTicketRow): MyEventTicket {
  return {
    age: row.age,
    applicantName: row.applicant_name,
    applicationId: row.application_id,
    applicationNo: formatApplicationNo(row.application_no),
    bankAccountHolder: row.bank_account_holder,
    bankAccountNumber: row.bank_account_number,
    bankName: row.bank_name,
    checkedInAt: row.checked_in_at ?? undefined,
    depositFailedAt: row.deposit_failed_at ?? undefined,
    depositFailureReason: row.deposit_failure_reason ?? undefined,
    depositRequestedAt: row.deposit_requested_at ?? undefined,
    depositorName: row.depositor_name ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    refundPolicyConfirmed: Boolean(row.refund_policy_confirmed),
    refundPolicyConfirmedAt: row.refund_policy_confirmed_at ?? undefined,
    transferGuideConfirmedAt: row.transfer_guide_confirmed_at ?? undefined,
    transferIntentConfirmed: Boolean(row.transfer_intent_confirmed),
    endTime: row.end_time.slice(0, 5),
    eventDate: row.event_date,
    eventId: row.event_id,
    eventTitle: row.event_title,
    gender: row.gender,
    job: row.job,
    location: row.location,
    nickname: row.nickname,
    paymentAmount: row.payment_amount,
    paymentCompletedAt: row.payment_completed_at ?? undefined,
    paymentDeadline: row.payment_deadline ?? undefined,
    qrIssuedAt: row.qr_issued_at ?? undefined,
    qrToken: row.qr_token ?? undefined,
    reviewReason: row.review_reason ?? undefined,
    startTime: row.start_time.slice(0, 5),
    status: row.status,
  };
}

function mapProfile(row: SupabaseApplicationRow): ParticipantProfile {
  return {
    accessRoute: row.access_route,
    birthDate: row.birth_date,
    employmentProof: row.employment_proof_path ? '첨부' : '미첨부',
    genderLabel: row.gender,
    height: row.height,
    idPhotoStatus: row.id_photo_path ? '첨부' : '미첨부',
    inquiry: row.inquiry || '특이사항 없음',
    interviewConsent: row.interview_consent,
    job: row.job,
    name: row.name,
    nickname: row.nickname,
    phone: row.phone,
    profilePhotos: `사진 ${row.profile_photo_paths?.length ?? 0}장 업로드 · 대표사진 지정 완료`,
    refundAgreement: row.refund_agreement ? '동의' : '미동의',
    relationshipStatus: row.relationship_status,
    residence: row.residence,
    reviewNotice: row.review_notice_confirmed ? '확인' : '미확인',
    shootingConsent: row.filming_consent ? '동의' : '미동의',
    voiceIntro: row.voice_intro_path ? '녹음 완료' : '미녹음',
  };
}

function formatApplicationNo(value: string) {
  return value.replace(/^TTM-(\d{4})-(\d{3})$/, 'TTM_$1_$2');
}

export interface ConversationTopic {
  category: string;
  content: string;
  createdAt: string;
  id: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

export async function fetchAdminConversationTopics(): Promise<ConversationTopic[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('get_admin_conversation_topics', { session_token: adminSession.token });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    category: row.category as string,
    content: row.content as string,
    createdAt: row.created_at as string,
    id: row.id as string,
    isActive: row.is_active as boolean,
    sortOrder: row.sort_order as number,
    updatedAt: row.updated_at as string,
  }));
}

export async function createConversationTopic(content: string, category: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { data, error } = await supabase.rpc('create_conversation_topic_for_session', {
    category_value: category,
    content_value: content,
    session_token: adminSession.token,
  });
  if (error) throw error;
  return data as string;
}

export async function updateConversationTopic(topicId: string, content: string, category: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('update_conversation_topic_for_session', {
    category_value: category,
    content_value: content,
    session_token: adminSession.token,
    topic_id: topicId,
  });
  if (error) throw error;
}

export async function setConversationTopicActive(topicId: string, isActive: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('set_conversation_topic_active_for_session', {
    is_active_value: isActive,
    session_token: adminSession.token,
    topic_id: topicId,
  });
  if (error) throw error;
}

export async function deleteConversationTopic(topicId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('delete_conversation_topic_for_session', {
    session_token: adminSession.token,
    topic_id: topicId,
  });
  if (error) throw error;
}

export interface TabletConversationTopic {
  content: string;
  id: string;
}

export async function fetchConversationTopicsForTablet(eventId: string, tableNumber: number, connectionToken: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('get_conversation_topics_for_tablet', {
    connection_token: connectionToken,
    event_id_value: eventId,
    table_number_value: tableNumber,
  });
  if (error) throw error;
  const row = data as { ok: boolean; topics?: TabletConversationTopic[] };
  if (!row?.ok) return { ok: false as const, topics: [] as TabletConversationTopic[] };
  return { ok: true as const, topics: row.topics ?? [] };
}

function isMissingRpcError(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || Boolean(error.message?.includes('Could not find the function'));
}

function getAge(birthDate: string, eventDateValue?: string) {
  const [year, month, day] = (eventDateValue ?? new Date().toISOString().slice(0, 10)).split('-').map(Number);
  const eventDate = new Date(year, month - 1, day);
  const birth = new Date(birthDate);
  let age = eventDate.getFullYear() - birth.getFullYear();
  const monthDiff = eventDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && eventDate.getDate() < birth.getDate())) age -= 1;
  return age;
}

async function fileToPayload(file: File) {
  return blobToPayload(file, file.name);
}

async function blobToPayload(blob: Blob, fileName: string) {
  const dataUrl = await blobToDataUrl(blob);
  const [, base64 = ''] = dataUrl.split(',');
  return {
    base64,
    contentType: blob.type || 'application/octet-stream',
    fileName,
  };
}

const fileReadTimeoutMs = 15000;

// FileReader can stall without ever firing onload/onerror on some mobile
// engines for a borderline-large blob - without a timeout, that leaves
// submit() awaiting forever and the submit button stuck in a permanent
// loading state.
function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => {
      reader.abort();
      reject(new Error('파일을 읽는 데 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.'));
    }, fileReadTimeoutMs);
    reader.onload = () => {
      clearTimeout(timer);
      resolve(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(reader.error ?? new Error('파일을 읽을 수 없습니다.'));
    };
    reader.readAsDataURL(blob);
  });
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hours}:${minutes}`;
}

function formatApplicationEventDate(dateValue: string) {
  const [, month, day] = dateValue.split('-').map(Number);
  return `${month}월 ${day}일`;
}
