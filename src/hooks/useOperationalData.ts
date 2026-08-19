import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAdminApplicationsFromSupabase,
  fetchAdminEventSummariesFromSupabase,
  fetchPublicEventsFromSupabase,
  fetchPublicParticipantsFromSupabase,
  subscribeToSupabaseChanges,
} from '../services/supabaseApplications';
import type { EventData } from '../types/event';
import type { ParticipantData } from '../types/participant';
import type { StoredApplication } from '../utils/adminApplications';

interface UseOperationalDataOptions {
  admin?: boolean;
  eventId?: string;
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
}: UseOperationalDataOptions = {}): OperationalDataState {
  const [events, setEvents] = useState<EventData[]>([]);
  const [participants, setParticipants] = useState<ParticipantData[]>([]);
  const [applications, setApplications] = useState<StoredApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextEvents, nextParticipants, nextApplications] = await Promise.all([
        admin ? fetchAdminEventSummariesFromSupabase() : fetchPublicEventsFromSupabase(),
        eventId ? fetchPublicParticipantsFromSupabase(eventId) : Promise.resolve([]),
        admin ? fetchAdminApplicationsFromSupabase() : Promise.resolve([]),
      ]);

      setEvents(nextEvents);
      setParticipants(nextParticipants);
      setApplications(nextApplications ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Supabase 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [admin, eventId]);

  useEffect(() => {
    let active = true;
    const safeLoad = async () => {
      if (!active) return;
      await load();
    };

    void safeLoad();
    const unsubscribe = subscribeToSupabaseChanges(() => {
      void safeLoad();
    });
    const intervalId = window.setInterval(() => {
      void safeLoad();
    }, 30_000);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
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
