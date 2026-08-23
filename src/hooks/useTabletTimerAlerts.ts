import { useEffect, useRef, useState } from 'react';
import { playTabletAlertSound } from '../utils/tabletAlertAudio';

const WARNING_THRESHOLD_SECONDS = 60;
const TOAST_VISIBLE_MS = 3_000;

export interface TabletTimerAlertToast {
  key: number;
  type: 'finish' | 'warning';
}

// Fires the "1 minute left" / "time's up" chime+toast exactly once per real
// phase instance, no matter how many times the component re-renders or
// re-polls. `notificationKey` must uniquely identify the current phase
// occurrence (event + stage + round + bonus flag + roundPhase) - each key
// is recorded in a ref that lives for the component's whole mount, so
// pause/resume, realtime/poll re-fetches, and ordinary re-renders can never
// replay an alert that already fired for that exact phase instance.
export function useTabletTimerAlerts({
  enabled,
  notificationKey,
  playWarning,
  remaining,
}: {
  enabled: boolean;
  notificationKey: string;
  playWarning: boolean;
  remaining: number;
}): TabletTimerAlertToast | null {
  const playedRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<TabletTimerAlertToast | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = (type: TabletTimerAlertToast['type']) => {
    setToast({ key: Date.now(), type });
    if (toastTimeoutRef.current !== undefined) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_VISIBLE_MS);
  };

  useEffect(() => {
    if (!enabled || !notificationKey) return;

    const warningKey = `${notificationKey}:warning`;
    if (playWarning && remaining > 0 && remaining <= WARNING_THRESHOLD_SECONDS && !playedRef.current.has(warningKey)) {
      playedRef.current.add(warningKey);
      playTabletAlertSound('warning');
      showToast('warning');
    }

    const finishKey = `${notificationKey}:finish`;
    if (remaining <= 0 && !playedRef.current.has(finishKey)) {
      playedRef.current.add(finishKey);
      playTabletAlertSound('finish');
      showToast('finish');
    }
  }, [enabled, notificationKey, playWarning, remaining]);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== undefined) clearTimeout(toastTimeoutRef.current);
    },
    [],
  );

  return toast;
}
