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
}

interface PublicParticipantPreviewRow {
  id: string;
  gender: '남성' | '여성';
  nickname: string;
  age: number;
  job: string;
  avatar_index: number;
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

  const { data, error } = await supabase
    .from('applications')
    .select('id, status')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchApplicationDraft(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase
    .from('application_drafts')
    .select('draft_data')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) throw error;
  return (data?.draft_data ?? null) as Record<string, unknown> | null;
}

export async function saveApplicationDraft(eventId: string, draftData: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const user = await ensureApplicationSession();
  const { error } = await supabase.from('application_drafts').upsert({
    draft_data: draftData,
    event_id: eventId,
    user_id: user.id,
  });

  if (error) throw error;
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
  status: '결제 대기' | '참여 보류' | '반려' | '참가 확정',
  values: {
    paymentDeadline?: string;
    paymentNoticeSentAt?: string;
    reviewedAt?: string;
  } = {},
) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!application.dbId) throw new Error('Supabase 신청서 ID가 없습니다.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('update_application_review_for_session', {
    application_id: application.dbId,
    next_payment_deadline: values.paymentDeadline ?? application.paymentDeadline ?? null,
    next_payment_notice_sent_at: values.paymentNoticeSentAt ?? application.paymentNoticeSentAt ?? null,
    next_reviewed_at: values.reviewedAt ?? application.reviewedAt ?? new Date().toISOString(),
    next_status: status,
    session_token: adminSession.token,
  });

  if (error) throw error;
}

export async function fetchPublicEventsFromSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_public_event_summaries');
  if (error) throw error;

  return (data as PublicEventSummaryRow[]).map((event) => ({
    currentParticipants: event.current_participants,
    date: event.event_date,
    endTime: event.end_time.slice(0, 5),
    id: event.id,
    location: event.location,
    malePrice: event.male_price ?? 50000,
    femalePrice: event.female_price ?? 40000,
    femaleApplications: event.female_applications,
    femaleConfirmed: event.female_confirmed,
    maleApplications: event.male_applications,
    maleConfirmed: event.male_confirmed,
    shortName: event.short_name,
    startTime: event.start_time.slice(0, 5),
    targetParticipants: event.target_participants,
    title: event.title,
    venueBooked: event.venue_booked,
  })) satisfies EventData[];
}

export async function fetchPublicParticipantsFromSupabase(eventId: string) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('get_public_participant_previews', {
    target_event_id: eventId,
  });

  if (error) throw error;

  return (data as PublicParticipantPreviewRow[]).map((participant) => ({
    avatarIndex: participant.avatar_index,
    gender: participant.gender === '여성' ? 'female' : 'male',
    id: participant.id,
    nickname: participant.nickname,
    tags: [`${participant.age}세`, participant.job],
  })) satisfies ParticipantData[];
}

export async function upsertEventToSupabase(event: EventData) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const adminSession = getAdminSession();
  if (!adminSession) throw new Error('관리자 세션이 필요합니다.');

  const { error } = await supabase.rpc('upsert_event_for_admin_session', {
    event_id_value: event.id,
    event_title: event.title,
    event_short_name: event.shortName,
    event_date_value: event.date,
    event_start_time: event.startTime,
    event_end_time: event.endTime,
    event_location: event.location,
    event_male_price: event.malePrice,
    event_female_price: event.femalePrice,
    event_venue_booked: event.venueBooked,
    female_capacity_value: event.targetParticipants / 2,
    male_capacity_value: event.targetParticipants / 2,
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

function mapApplicationRow(row: SupabaseApplicationRow): StoredApplication {
  const age = getAge(row.birth_date);
  const profile = mapProfile(row);

  return {
    age,
    appliedAt: formatShortDateTime(row.submitted_at),
    dbId: row.id,
    accountType: row.account_type ?? 'member',
    eventDate: formatApplicationEventDate(row.event_date ?? '2026-08-16'),
    eventType: row.short_name ?? '로테이션',
    gender: row.gender,
    id: row.application_no,
    isNew: row.is_new,
    paymentDeadline: row.payment_deadline ?? undefined,
    paymentNoticeSentAt: row.payment_notice_sent_at ?? undefined,
    profile,
    returning: row.is_returning ? '재참여' : '첫 참여',
    reviewedAt: row.reviewed_at ?? undefined,
    status: row.status,
    userId: row.user_display_id ?? row.nickname,
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

function getAge(birthDate: string) {
  const eventDate = new Date(2026, 7, 16);
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
