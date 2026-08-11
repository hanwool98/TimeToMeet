import { events } from '../data/events';
import { participants } from '../data/participants';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchAdminApplicationsFromSupabase, fetchPublicEventsFromSupabase, upsertEventToSupabase } from '../services/supabaseApplications';
import type { EventData } from '../types/event';
import type { ParticipantData, ParticipantProfile } from '../types/participant';

export type ApplicationStatus = '심사 대기' | '결제 대기' | '참가 확정' | '반려' | '참여 보류' | '환불 완료' | '자동 취소';

export interface StoredApplication {
  dbId?: string;
  accountType?: 'member' | 'guest';
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
  profile?: ParticipantProfile;
}

export const applicationsStorageKey = 'time2meet-admin-applications';
export const eventOverridesStorageKey = 'time2meet-admin-event-overrides';

export const initialApplications: StoredApplication[] = [
  { id: 'TTM_000', userId: 'test_woman', gender: '여성', age: 28, eventDate: '8월 16일', eventType: '로테이션', returning: '첫 참여', appliedAt: '08.07 15:05', status: '심사 대기', isNew: true },
];

export function loadApplications(): StoredApplication[] {
  if (typeof window === 'undefined') return initialApplications;

  const savedApplications = window.localStorage.getItem(applicationsStorageKey);
  if (!savedApplications) return initialApplications;

  try {
    return JSON.parse(savedApplications) as StoredApplication[];
  } catch {
    return initialApplications;
  }
}

export function saveApplications(applications: StoredApplication[]): StoredApplication[] {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(applicationsStorageKey, JSON.stringify(applications));
    void saveSharedAdminState({ applications });
  }
  return applications;
}

export async function syncSharedAdminState() {
  if (typeof window === 'undefined') return false;

  let changed = false;

  try {
    const publicEvents = await fetchPublicEventsFromSupabase();
    if (publicEvents) {
      window.localStorage.setItem(eventOverridesStorageKey, JSON.stringify(publicEvents));
      changed = true;
    }
  } catch {
    // The local mock state remains visible until Supabase is ready or permissions are fixed.
  }

  if (window.location.pathname.startsWith('/admin')) {
    try {
      const adminApplications = await fetchAdminApplicationsFromSupabase();
      if (adminApplications) {
        window.localStorage.setItem(applicationsStorageKey, JSON.stringify(adminApplications));
        changed = true;
      }
    } catch {
      // Admin RLS may reject this until the signed-in user is registered in admin_users.
    }
  }

  if (isSupabaseConfigured) return changed;

  try {
    const response = await fetch('/api/admin-state', { cache: 'no-store' });
    if (!response.ok) return false;

    const state = (await response.json()) as { applications?: StoredApplication[] | null; eventOverrides?: EventData[] };
    if (state.applications) {
      window.localStorage.setItem(applicationsStorageKey, JSON.stringify(state.applications));
      changed = true;
    }
    if (state.eventOverrides) {
      window.localStorage.setItem(eventOverridesStorageKey, JSON.stringify(state.eventOverrides));
      changed = true;
    }
  } catch {
    // The Vite mock endpoint only exists in local development.
  }

  return changed;
}

async function saveSharedAdminState(patch: { applications?: StoredApplication[]; eventOverrides?: EventData[] }) {
  try {
    await fetch('/api/admin-state', {
      body: JSON.stringify(patch),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    // localStorage remains the fallback while a real database is not connected.
  }
}

export function loadEventOverrides(): EventData[] {
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
  void upsertEventToSupabase(event);
  void saveSharedAdminState({ eventOverrides: nextEvents });
}

export function getStoredEvents(): EventData[] {
  const overrides = loadEventOverrides();
  const baseEvents = events.map((event) => overrides.find((item) => item.id === event.id) ?? event);
  const newEvents = overrides.filter((event) => !events.some((baseEvent) => baseEvent.id === event.id));
  return [...baseEvents, ...newEvents];
}

export function getConfirmedApplicationParticipants(eventId = 'seongnam-rotation-2026-08-16'): ParticipantData[] {
  if (isSupabaseConfigured && typeof window !== 'undefined' && !window.location.pathname.startsWith('/admin')) {
    return [];
  }

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

export function getParticipantsForEvent(eventId = 'seongnam-rotation-2026-08-16'): ParticipantData[] {
  const confirmedApplications = getConfirmedApplicationParticipants(eventId);
  return [...participants, ...confirmedApplications];
}

export function getEventGenderCounts(eventId = 'seongnam-rotation-2026-08-16'): { male: number; female: number } {
  const event = getStoredEvents().find((item) => item.id === eventId);
  if (isSupabaseConfigured) {
    return {
      male: event?.maleConfirmed ?? 0,
      female: event?.femaleConfirmed ?? 0,
    };
  }

  const eventParticipants = getParticipantsForEvent(eventId);
  return {
    male: eventParticipants.filter((participant) => participant.gender === 'male').length,
    female: eventParticipants.filter((participant) => participant.gender === 'female').length,
  };
}

export function getEventsWithParticipantCounts(): EventData[] {
  if (isSupabaseConfigured) {
    return getStoredEvents();
  }

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
