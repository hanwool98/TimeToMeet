import { supabase } from '../lib/supabase';
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

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return sessionData.session.user;

  throw new Error('로그인이 필요합니다.');
}

export async function submitApplicationToSupabase(input: SubmitApplicationInput) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const user = await ensureApplicationSession();
  await ensureAccountRow(user.id, await getCurrentAccountType(user.id));
  const basePath = `${user.id}/${crypto.randomUUID()}`;
  const idPhotoPath = await uploadPrivateFile(`${basePath}/id-${sanitizeFileName(input.idPhoto.name)}`, input.idPhoto);
  const employmentProofPath = await uploadPrivateFile(`${basePath}/employment-${sanitizeFileName(input.employmentProof.name)}`, input.employmentProof);
  const voiceIntroPath = await uploadPrivateFile(`${basePath}/voice-intro.webm`, input.voiceIntro);
  const profilePhotoPaths = await Promise.all(
    input.profilePhotos.map((file, index) =>
      uploadPrivateFile(`${basePath}/profile-${index + 1}-${sanitizeFileName(file.name)}`, file),
    ),
  );

  const { error } = await supabase.from('applications').insert({
    access_route: input.accessRoute,
    applicant_kind: 'guest',
    birth_date: input.birthDate,
    consents: input.consents,
    employment_proof_path: employmentProofPath,
    event_id: input.eventId,
    filming_consent: input.filmingConsent,
    gender: input.gender,
    height: input.height,
    id_photo_path: idPhotoPath,
    inquiry: input.inquiry,
    interview_consent: input.interviewConsent,
    job: input.job,
    name: input.name,
    nickname: input.nickname,
    phone: input.phone,
    profile_photo_paths: profilePhotoPaths,
    refund_agreement: input.refundAgreement,
    relationship_status: input.relationshipStatus,
    representative_crop: input.representativeCrop,
    representative_photo_index: input.representativeIndex,
    residence: input.residence,
    is_returning: input.returning,
    review_notice_confirmed: true,
    user_id: user.id,
    voice_intro_path: voiceIntroPath,
  });

  if (error) throw error;
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

  const { data, error } = await supabase
    .rpc('get_admin_applications');

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

  const { error } = await supabase
    .from('applications')
    .update({
      is_new: false,
      payment_deadline: values.paymentDeadline ?? application.paymentDeadline ?? null,
      payment_notice_sent_at: values.paymentNoticeSentAt ?? application.paymentNoticeSentAt ?? null,
      reviewed_at: values.reviewedAt ?? application.reviewedAt ?? new Date().toISOString(),
      status,
    })
    .eq('id', application.dbId);

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

  const { error } = await supabase.from('events').upsert({
    end_time: event.endTime,
    event_date: event.date,
    female_capacity: event.targetParticipants / 2,
    id: event.id,
    location: event.location,
    male_capacity: event.targetParticipants / 2,
    short_name: event.shortName,
    start_time: event.startTime,
    title: event.title,
    venue_booked: event.venueBooked,
  });

  if (error) throw error;
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

async function uploadPrivateFile(path: string, file: Blob) {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { error } = await supabase.storage.from('application-files').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) throw error;
  return path;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getAge(birthDate: string) {
  const eventDate = new Date(2026, 7, 16);
  const birth = new Date(birthDate);
  let age = eventDate.getFullYear() - birth.getFullYear();
  const monthDiff = eventDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && eventDate.getDate() < birth.getDate())) age -= 1;
  return age;
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
