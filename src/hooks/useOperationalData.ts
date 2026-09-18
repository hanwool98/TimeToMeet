import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAdminApplicationsFromSupabase,
  fetchAdminEventSummariesFromSupabase,
  fetchPublicEventsFromSupabase,
  fetchPublicParticipantMedia,
  fetchPublicParticipantPreviews,
  fetchTestEventPreview,
  mergeParticipantMedia,
  subscribeToSupabaseChanges,
  type PublicParticipantMediaRow,
} from '../services/supabaseApplications';
import type { EventData } from '../types/event';
import type { ParticipantData } from '../types/participant';
import type { StoredApplication } from '../utils/adminApplications';
import { createRequestGuard, debounce } from '../utils/requestGuard';

interface UseOperationalDataOptions {
  admin?: boolean;
  eventId?: string;
  previewToken?: string;
}

interface OperationalDataState {
  applications: StoredApplication[];
  error: string | null;
  events: EventData[];
  loading: boolean;
  participants: ParticipantData[];
  reload: () => Promise<void>;
}

// 참가자 사진(Storage signed URL) 재발급 백스톱 주기. applications 테이블의
// postgres_changes를 Realtime으로 직접 걸어보려 했으나, 이 테이블의 RLS
// 정책이 전부 {authenticated} + auth.uid()/is_admin() 기준인데 이 프로젝트는
// Supabase Auth를 쓰지 않는 custom session-token 인증 구조라(CLAUDE.md 13장)
// anon 연결은 어떤 정책과도 매치되지 않는다 - 라이브로 직접 확인한 결과
// 채널은 "Subscribed to PostgreSQL"까지 정상 연결되지만 실제 행을 바꿔도
// 이벤트 프레임 자체가 브로드캐스트되지 않았다(RLS가 anon 클라이언트에는
// 애초에 broadcast 대상에서 제외함). 그래서 참가자 사진 신선도는 Realtime이
// 아니라 아래 세 가지로만 보장한다:
//   1) mount 시점(eventId/previewToken 변경 포함)
//   2) 30초마다 계속 도는 참가자 "텍스트" 미리보기 조회에서 참가자 구성
//      (id 집합)이 바뀐 걸 감지하면 즉시(performLoad 안의 idsKey 비교 참고) -
//      새 참가자 승인/체크인 등 "누가 보이는지"가 바뀌는 경우는 이 경로로
//      30초 안에 반영된다.
//   3) 백그라운드→포그라운드 복귀, 네트워크 재연결(온라인/포커스/가시성)
//   4) 위 신호가 전혀 없어도(같은 참가자의 사진만 조용히 바뀐 경우 등) 화면을
//      아주 오래 켜둔 경우를 위한 안전 백스톱 - signed URL 만료(600초)보다
//      충분히 짧게 잡아 사진이 깨질 걱정이 없게 한다.
const PARTICIPANT_MEDIA_BACKSTOP_MS = 5 * 60 * 1000;

// 관리자 화면(admin: true)은 이 hook의 participants를 아무도 쓰지 않는다 -
// 각자 fetchAdminEventParticipantMedia로 직접 조회한다(AdminEventLivePage,
// AdminCheckInPage, AdminEventParticipantsPage 확인 완료). 그런데도 기존
// 코드는 admin 여부와 무관하게 eventId만 있으면 참가자 미리보기+사진을 매번
// 조회하고 있었다 - 아무도 안 쓰는 조회를 30초마다 반복한 것도 egress
// 낭비였으므로, admin일 땐 아예 조회하지 않는다.
export default function useOperationalData({
  admin = false,
  eventId,
  previewToken,
}: UseOperationalDataOptions = {}): OperationalDataState {
  const [events, setEvents] = useState<EventData[]>([]);
  const [participantPreviews, setParticipantPreviews] = useState<ParticipantData[]>([]);
  const [participantMedia, setParticipantMedia] = useState<Map<string, PublicParticipantMediaRow>>(new Map());
  const [applications, setApplications] = useState<StoredApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const guardRef = useRef(createRequestGuard());
  const mediaGuardRef = useRef(createRequestGuard());
  const knownParticipantIdsRef = useRef<string | null>(null);

  const shouldLoadParticipants = !admin && Boolean(eventId);

  const loadParticipantMedia = useCallback(async () => {
    if (!shouldLoadParticipants || !eventId) return;
    await mediaGuardRef.current.run(
      () => fetchPublicParticipantMedia(eventId, previewToken),
      (next) => setParticipantMedia(next),
      { skipIfInFlight: true },
    );
  }, [eventId, previewToken, shouldLoadParticipants]);

  const performLoad = useCallback(async () => {
    setError(null);
    try {
      const [nextEvents, nextPreviews, nextApplications] = await Promise.all([
        admin ? fetchAdminEventSummariesFromSupabase() : fetchPublicEventsFromSupabase(),
        shouldLoadParticipants ? fetchPublicParticipantPreviews(eventId as string, previewToken) : Promise.resolve([]),
        admin ? fetchAdminApplicationsFromSupabase() : Promise.resolve([]),
      ]);

      // A test event never appears in the normal (public or admin) listing
      // response for a non-admin caller - if a valid preview token was
      // supplied for this specific event, fetch and splice it in so every
      // page reading `events` (event detail, profile form, ...) just works
      // without each needing its own test-event fallback.
      let mergedEvents = nextEvents;
      if (!admin && eventId && previewToken && !nextEvents.some((event) => event.id === eventId)) {
        try {
          const previewEvent = await fetchTestEventPreview(eventId, previewToken);
          if (previewEvent) mergedEvents = [...nextEvents, previewEvent];
        } catch {
          // Invalid/expired token - leave the event absent, same as if it
          // simply didn't exist for this visitor.
        }
      }

      setEvents(mergedEvents);
      setParticipantPreviews(nextPreviews);
      setApplications(nextApplications ?? []);

      // 새 참가자가 승인되거나 명단에서 빠지는 등 "누가 보이는지"가 바뀐
      // 순간을 30초 텍스트 폴링에서 그대로 감지해 사진도 바로 따라가게
      // 한다(위 PARTICIPANT_MEDIA_BACKSTOP_MS 주석 2번 참고) - RLS 때문에
      // Realtime으로는 이 신호를 받을 수 없어 대신 쓰는 경로다.
      if (shouldLoadParticipants) {
        const idsKey = nextPreviews.map((participant) => participant.id).sort().join(',');
        if (knownParticipantIdsRef.current !== null && knownParticipantIdsRef.current !== idsKey) {
          void loadParticipantMedia();
        }
        knownParticipantIdsRef.current = idsKey;
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Supabase 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [admin, eventId, loadParticipantMedia, previewToken, shouldLoadParticipants]);

  const load = useCallback(
    () => guardRef.current.run(performLoad, () => {}, { skipIfInFlight: true }),
    [performLoad],
  );

  useEffect(() => {
    let active = true;
    const safeLoad = async () => {
      if (!active) return;
      await load();
    };

    void safeLoad();
    const debouncedLoad = debounce(() => void safeLoad(), 300);
    const unsubscribe = subscribeToSupabaseChanges(() => {
      debouncedLoad();
    });
    const intervalId = window.setInterval(() => {
      void safeLoad();
    }, 30_000);

    // A device that was offline/backgrounded shouldn't have to wait for its
    // next 30s poll tick to catch up once it's reachable again - refetch
    // immediately on any reconnect signal (guarded by the same requestGuard,
    // so this just piggybacks on whichever fetch is already in flight if
    // one happens to be running).
    const handleReconnectSignal = () => void safeLoad();
    window.addEventListener('online', handleReconnectSignal);
    window.addEventListener('focus', handleReconnectSignal);
    document.addEventListener('visibilitychange', handleReconnectSignal);

    return () => {
      active = false;
      debouncedLoad.cancel();
      unsubscribe();
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleReconnectSignal);
      window.removeEventListener('focus', handleReconnectSignal);
      document.removeEventListener('visibilitychange', handleReconnectSignal);
    };
  }, [load]);

  // 참가자 "사진"은 위 30초 polling/전역 Realtime 사이클에서 완전히
  // 떼어낸다. 텍스트 미리보기와 달리 사진은 매번 새 Storage signed URL을
  // 발급받는 작업이라, 30초마다 반복하면 같은 사진을 계속 새로
  // 다운로드하게 된다 - 이번 egress 원인 분석에서 확인된 핵심 문제. 대신
  // mount/재연결 시점과 안전 백스톱, 그리고 위 performLoad의 참가자 구성
  // 변경 감지에만 반응한다(자세한 이유는 PARTICIPANT_MEDIA_BACKSTOP_MS
  // 주석 참고).
  useEffect(() => {
    if (!shouldLoadParticipants || !eventId) {
      setParticipantMedia(new Map());
      return undefined;
    }

    let active = true;
    const safeLoadMedia = async () => {
      if (!active) return;
      await loadParticipantMedia();
    };

    void safeLoadMedia();
    const intervalId = window.setInterval(() => void safeLoadMedia(), PARTICIPANT_MEDIA_BACKSTOP_MS);
    const handleReconnectSignal = () => void safeLoadMedia();
    window.addEventListener('online', handleReconnectSignal);
    window.addEventListener('focus', handleReconnectSignal);
    document.addEventListener('visibilitychange', handleReconnectSignal);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleReconnectSignal);
      window.removeEventListener('focus', handleReconnectSignal);
      document.removeEventListener('visibilitychange', handleReconnectSignal);
    };
  }, [eventId, loadParticipantMedia, shouldLoadParticipants]);

  const participants = useMemo(() => {
    if (!shouldLoadParticipants) return [];
    return participantPreviews.map((participant) => mergeParticipantMedia(participant, participantMedia.get(participant.id)));
  }, [participantMedia, participantPreviews, shouldLoadParticipants]);

  // 수동 재조회(에러 화면의 "다시 불러오기", 승인/체크인 등 뮤테이션 직후
  // 호출되는 reload)는 텍스트와 사진을 둘 다 새로 받아온다.
  const reload = useCallback(async () => {
    await Promise.all([load(), loadParticipantMedia()]);
  }, [load, loadParticipantMedia]);

  return useMemo(
    () => ({
      applications,
      error,
      events,
      loading,
      participants,
      reload,
    }),
    [applications, error, events, loading, participants, reload],
  );
}
