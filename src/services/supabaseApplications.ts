import { supabase } from '../lib/supabase';
import { getAdminSession } from './adminAuth';
import { getAppSession } from './appAuth';
import type { EventData } from '../types/event';
import type { ParticipantData, ParticipantProfile } from '../types/participant';
import type { StoredApplication } from '../utils/adminApplications';

interface SubmitApplicationInput {
  eventId: string;
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
  id: string;
  is_test_event: boolean;
  location: string;
  required_tablets: number;
  start_time: string;
  tablet_count: number;
  title: string;
}

export interface AdminEventModeSummary {
  checkinCount: number;
  confirmedCount: number;
  date: string;
  endTime: string;
  id: string;
  isTestEvent: boolean;
  location: string;
  requiredTablets: number;
  startTime: string;
  tabletCount: number;
  title: string;
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

export async function submitApplicationToSupabase(input: SubmitApplicationInput) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const user = await ensureApplicationSession();
  const session = getAppSession();
  if (!session?.token) throw new Error('로그인 또는 비회원 세션이 필요합니다.');

  const payload = {
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

  const { data, error } = await supabase.functions.invoke('submit-application', {
    body: payload,
  });

  if (error || data?.ok !== true) {
    const message = data?.message || error?.message || '신청서 저장에 실패했습니다.';
    throw new Error(message);
  }
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

  const { error } = await supabase.rpc('update_application_review_for_session', {
    next_payment_deadline: values.paymentDeadline ?? application.paymentDeadline ?? null,
    next_payment_notice_sent_at: values.paymentNoticeSentAt ?? application.paymentNoticeSentAt ?? null,
    next_review_reason: values.reason ?? null,
    next_reviewed_at: values.reviewedAt ?? application.reviewedAt ?? new Date().toISOString(),
    next_status: status,
    session_token: adminSession.token,
    target_application_id: application.dbId,
  });

  if (error) throw error;
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

export async function fetchPublicEventsFromSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_public_event_summaries');
  if (error) throw error;

  return (data as PublicEventSummaryRow[]).map((event) => ({
    applicationDeadline: event.application_deadline ?? undefined,
    currentParticipants: event.current_participants,
    date: event.event_date,
    earlyBirdDeadline: event.early_bird_deadline ?? undefined,
    earlyBirdDiscountMale: event.early_bird_discount_male ?? 0,
    earlyBirdDiscountFemale: event.early_bird_discount_female ?? 0,
    endTime: event.end_time.slice(0, 5),
    id: event.id,
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
  })) satisfies EventData[];
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
    maleCapacity: row.male_capacity,
    malePrice: row.male_price,
    shortName: row.short_name,
    startTime: row.start_time.slice(0, 5),
    title: row.title,
    venueBooked: row.venue_booked,
    venueDetail: row.venue_detail ?? '',
  };
}

interface PublicParticipantMediaRow {
  id: string;
  audioUrl: string | null;
  photoUrl: string | null;
  representativeCrop: { scale: number; offsetX: number; offsetY: number } | null;
}

export async function fetchPublicParticipantsFromSupabase(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const [previewResult, mediaResult] = await Promise.all([
    supabase.rpc('get_public_participant_previews', { target_event_id: eventId }),
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
    id: event.id,
    isTestEvent: event.is_test_event,
    location: event.location,
    requiredTablets: event.required_tablets,
    startTime: event.start_time.slice(0, 5),
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
      id: event.id,
      isTestEvent: false,
      location: event.location,
      requiredTablets: 10,
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

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽을 수 없습니다.'));
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
