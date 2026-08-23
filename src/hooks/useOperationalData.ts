import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAdminApplicationsFromSupabase,
  fetchAdminEventSummariesFromSupabase,
  fetchPublicEventsFromSupabase,
  fetchPublicParticipantsFromSupabase,
  fetchTestEventPreview,
  subscribeToSupabaseChanges,
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

export default function useOperationalData({
  admin = false,
  eventId,
  previewToken,
}: UseOperationalDataOptions = {}): OperationalDataState {
  const [events, setEvents] = useState<EventData[]>([]);
  const [participants, setParticipants] = useState<ParticipantData[]>([]);
  const [applications, setApplications] = useState<StoredApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const guardRef = useRef(createRequestGuard());

  const performLoad = useCallback(async () => {
    setError(null);
    try {
      const [nextEvents, nextParticipants, nextApplications] = await Promise.all([
        admin ? fetchAdminEventSummariesFromSupabase() : fetchPublicEventsFromSupabase(),
        eventId ? fetchPublicParticipantsFromSupabase(eventId, previewToken) : Promise.resolve([]),
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
      setParticipants(nextParticipants);
      setApplications(nextApplications ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Supabase 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [admin, eventId, previewToken]);

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

  return useMemo(
    () => ({
      applications,
      error,
      events,
      loading,
      participants,
      reload: load,
    }),
    [applications, error, events, loading, load, participants],
  );
}
