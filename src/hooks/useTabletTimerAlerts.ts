import { useEffect, useRef, useState } from 'react';
import { playTabletAlertSound } from '../utils/tabletAlertAudio';

const WARNING_THRESHOLD_SECONDS = 60;
const TOAST_VISIBLE_MS = 3_000;

export interface TabletTimerAlertToast {
  key: number;
  type: 'finish' | 'warning';
}

interface NotificationState {
  firedFinish: boolean;
  firedWarning: boolean;
  lastRemaining: number;
}

// Fires the "1 minute left" / "time's up" chime+toast exactly once per real
// phase instance, no matter how many times the component re-renders or
// re-polls. `notificationKey` must uniquely identify the current phase
// occurrence (event + stage + round + bonus flag + roundPhase).
//
// This only fires on an actual threshold *crossing* - the previously
// observed `remaining` for this key was above the threshold and the newly
// observed one is at/below it - never on a bare `remaining <= threshold`
// check. The very first observation for a given `notificationKey` (a fresh
// mount, a reconnect, a component remount, restoring an in-progress phase)
// only records that value as the baseline and never plays anything, because
// there is no "previous" value yet to have crossed the threshold from. That
// single rule is what keeps an already-low remaining time (mount at 0:45,
// a test "skip ahead" from 5:00 to 0:30, reconnecting after time is already
// up) from replaying an alert that a real participant never actually missed.
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
  const stateByKeyRef = useRef<Map<string, NotificationState>>(new Map());
  const [toast, setToast] = useState<TabletTimerAlertToast | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = (type: TabletTimerAlertToast['type']) => {
    setToast({ key: Date.now(), type });
    if (toastTimeoutRef.current !== undefined) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_VISIBLE_MS);
  };

  useEffect(() => {
    if (!enabled || !notificationKey) return;

    const stateByKey = stateByKeyRef.current;
    const existing = stateByKey.get(notificationKey);

    if (!existing) {
      // 이 phase 인스턴스를 처음 관측 - 지금 값을 기준선으로만 기록하고
      // 아무것도 재생하지 않는다.
      stateByKey.set(notificationKey, { firedFinish: false, firedWarning: false, lastRemaining: remaining });
      return;
    }

    const previousRemaining = existing.lastRemaining;

    if (
      playWarning &&
      !existing.firedWarning &&
      previousRemaining > WARNING_THRESHOLD_SECONDS &&
      remaining > 0 &&
      remaining <= WARNING_THRESHOLD_SECONDS
    ) {
      existing.firedWarning = true;
      playTabletAlertSound('warning');
      showToast('warning');
    }

    if (!existing.firedFinish && previousRemaining > 0 && remaining <= 0) {
      existing.firedFinish = true;
      playTabletAlertSound('finish');
      showToast('finish');
    }

    existing.lastRemaining = remaining;
  }, [enabled, notificationKey, playWarning, remaining]);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== undefined) clearTimeout(toastTimeoutRef.current);
    },
    [],
  );

  return toast;
}
