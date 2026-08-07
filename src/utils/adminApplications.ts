import { events } from '../data/events';
import { participants } from '../data/participants';
import type { EventData } from '../types/event';
import type { ParticipantData, ParticipantProfile } from '../types/participant';

export type ApplicationStatus = '심사 대기' | '결제 대기' | '참가 확정' | '반려' | '참여 보류' | '환불 완료' | '자동 취소';

export interface StoredApplication {
  id: string;
  userId: string;
  gender: '남성' | '여성';
  age: number;
  eventDate: string;
  eventType: string;
  returning: '첫 참여' | '재참여';
  appliedAt: string;
  status: ApplicationStatus;
  isNew?: boolean;
  paymentDeadline?: string;
  paymentNoticeSentAt?: string;
  reviewedAt?: string;
}

export const applicationsStorageKey = 'time2meet-admin-applications';
export const eventOverridesStorageKey = 'time2meet-admin-event-overrides';

export const initialApplications: StoredApplication[] = [
  { id: 'TTM_000', userId: 'test_woman', gender: '여성', age: 28, eventDate: '8월 16일', eventType: '로테이션', returning: '첫 참여', appliedAt: '08.07 15:05', status: '심사 대기', isNew: true },
];

export function loadApplications() {
  if (typeof window === 'undefined') return initialApplications;

  const savedApplications = window.localStorage.getItem(applicationsStorageKey);
  if (!savedApplications) return initialApplications;

  try {
    return JSON.parse(savedApplications) as StoredApplication[];
  } catch {
    return initialApplications;
  }
}

export function saveApplications(applications: StoredApplication[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(applicationsStorageKey, JSON.stringify(applications));
  }
  return applications;
}

export function loadEventOverrides() {
  if (typeof window === 'undefined') return [];

  const savedEvents = window.localStorage.getItem(eventOverridesStorageKey);
  if (!savedEvents) return [];

  try {
    return JSON.parse(savedEvents) as EventData[];
  } catch {
    return [];
  }
}

export function saveEventOverride(event: EventData) {
  if (typeof window === 'undefined') return;

  const currentEvents = loadEventOverrides();
  const nextEvents = [...currentEvents.filter((item) => item.id !== event.id), event];
  window.localStorage.setItem(eventOverridesStorageKey, JSON.stringify(nextEvents));
}

export function getStoredEvents() {
  const overrides = loadEventOverrides();
  const baseEvents = events.map((event) => overrides.find((item) => item.id === event.id) ?? event);
  const newEvents = overrides.filter((event) => !events.some((baseEvent) => baseEvent.id === event.id));
  return [...baseEvents, ...newEvents];
}

export function getConfirmedApplicationParticipants(eventId = 'seongnam-rotation-2026-08-16') {
  const event = getStoredEvents().find((item) => item.id === eventId);
  if (!event) return [];

  return loadApplications()
    .filter(
      (application) =>
        application.status === '참가 확정' &&
        application.eventDate === formatApplicationEventDate(event.date) &&
        application.eventType === event.shortName,
    )
    .map((application, index) => createParticipantFromApplication(application, index));
}

export function getParticipantsForEvent(eventId = 'seongnam-rotation-2026-08-16') {
  const confirmedApplications = getConfirmedApplicationParticipants(eventId);
  return [...participants, ...confirmedApplications];
}

export function getEventGenderCounts(eventId = 'seongnam-rotation-2026-08-16') {
  const eventParticipants = getParticipantsForEvent(eventId);
  return {
    male: eventParticipants.filter((participant) => participant.gender === 'male').length,
    female: eventParticipants.filter((participant) => participant.gender === 'female').length,
  };
}

export function getEventsWithParticipantCounts() {
  return getStoredEvents().map((event) => {
    const counts = getEventGenderCounts(event.id);
    return {
      ...event,
      currentParticipants: counts.male + counts.female,
    };
  });
}

function createParticipantFromApplication(application: StoredApplication, index: number): ParticipantData {
  const baseParticipant = participants.find((participant) => participant.id === (application.gender === '여성' ? 'female-01' : 'male-01'));
  const profile = createProfileFromApplication(application, baseParticipant?.profile);

  return {
    id: `application-${application.id}`,
    gender: application.gender === '여성' ? 'female' : 'male',
    nickname: profile.nickname,
    tags: [`${application.age}세`, profile.job],
    avatarIndex: 11 + index,
    profile,
  };
}

function createProfileFromApplication(application: StoredApplication, baseProfile?: ParticipantProfile): ParticipantProfile {
  const birthYear = 2026 - application.age + 1;

  return {
    name: application.gender === '여성' ? '테스트 여성' : '테스트 남성',
    birthDate: `${birthYear}-06-18`,
    genderLabel: application.gender,
    residence: baseProfile?.residence ?? '성남시 수정구',
    phone: baseProfile?.phone ?? '010-0000-0000',
    relationshipStatus: baseProfile?.relationshipStatus ?? '동의',
    idPhotoStatus: baseProfile?.idPhotoStatus ?? '첨부',
    nickname: application.userId,
    profilePhotos: baseProfile?.profilePhotos ?? '사진 3장 업로드 · 대표사진 지정 완료',
    voiceIntro: baseProfile?.voiceIntro ?? '녹음 완료',
    height: baseProfile?.height ?? (application.gender === '여성' ? '164cm' : '176cm'),
    job: baseProfile?.job ?? '테스트 직업',
    employmentProof: baseProfile?.employmentProof ?? '첨부',
    accessRoute: baseProfile?.accessRoute ?? '테스트',
    shootingConsent: baseProfile?.shootingConsent ?? '동의',
    interviewConsent: baseProfile?.interviewConsent ?? '참여',
    refundAgreement: baseProfile?.refundAgreement ?? '동의',
    inquiry: baseProfile?.inquiry ?? '특이사항 없음',
    reviewNotice: baseProfile?.reviewNotice ?? '확인',
  };
}

function formatApplicationEventDate(dateValue: string) {
  const [, month, day] = dateValue.split('-').map(Number);
  return `${month}월 ${day}일`;
}
