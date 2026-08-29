import { useEffect, useRef, useState } from 'react';
import { playTabletAlertSound } from '../utils/tabletAlertAudio';

const WARNING_THRESHOLD_SECONDS = 60;
const TOAST_VISIBLE_MS = 3_000;
// no_change 평가는 남은 시간이 이 범위 안일 때만 로그를 남긴다 - 10분짜리
// 라운드 내내 매초 로그를 남기면 정작 진짜 원인(경계 부근의 흔들림)을
// 찾기 어려워지므로, 경계 근처만 촘촘히 기록한다. baseline/실제 재생은
// 이 범위와 무관하게 항상 기록한다.
const NEAR_BOUNDARY_LOG_WINDOW_SECONDS = WARNING_THRESHOLD_SECONDS + 10;

export interface TabletTimerAlertToast {
  key: number;
  type: 'finish' | 'warning';
}

interface NotificationState {
  firedFinish: boolean;
  firedWarning: boolean;
  lastRemaining: number;
}

export interface TabletTimerAlertDebugContext {
  eventId: string;
  isBonusRound: boolean;
  phase: string;
  round: number | null;
  serverEndAt: string | null;
  timerRunning: boolean;
}

type CrossingResult =
  | { type: 'baseline' }
  | { type: 'no_change' }
  | { reason: 'threshold_crossed'; type: 'finish' | 'warning' };

// 판정(threshold crossing 여부)과 실행(소리 재생/토스트)을 분리한 순수
// 함수 - 이 함수는 상태를 읽기만 하고 아무것도 바꾸지 않는다. 실제 상태
// 갱신과 사이드이펙트(playTabletAlertSound/showToast)는 호출부의 단
// 한 곳(아래 useEffect)에서만 일어난다 - "왜 울렸는지 알 수 없는 채로
// audio.play()가 실행되는" 경로 자체가 없도록 트리거를 여기 하나로
// 정리했다.
function detectTimerThresholdCrossing({
  existing,
  playWarning,
  remaining,
}: {
  existing: NotificationState | undefined;
  playWarning: boolean;
  remaining: number;
}): CrossingResult {
  if (!existing) return { type: 'baseline' };

  const previousRemaining = existing.lastRemaining;

  if (
    playWarning &&
    !existing.firedWarning &&
    previousRemaining > WARNING_THRESHOLD_SECONDS &&
    remaining > 0 &&
    remaining <= WARNING_THRESHOLD_SECONDS
  ) {
    return { reason: 'threshold_crossed', type: 'warning' };
  }

  if (!existing.firedFinish && previousRemaining > 0 && remaining <= 0) {
    return { reason: 'threshold_crossed', type: 'finish' };
  }

  return { type: 'no_change' };
}

// 실제 태블릿에서 소리가 이상한 타이밍에 울리는 문제를 조건식 재추측이
// 아니라 실측으로 확인하기 위한 진단 로그. import.meta.env.DEV로 막지
// 않는다 - 실제 문제 재현은 로컬 dev 서버가 아니라 배포된 태블릿에서
// 일어나므로, DEV 빌드 전용으로 막으면 정작 필요할 때 아무것도 안 남는다.
// 대신 console.debug를 써서 브라우저 콘솔 기본 필터(Info 이상)에는 안
// 보이고, devtools를 열어 verbose 레벨을 켰을 때만 보이게 한다.
function logTimerAlertEvaluation({
  context,
  previousRemaining,
  remaining,
  result,
}: {
  context: TabletTimerAlertDebugContext | undefined;
  previousRemaining: number | null;
  remaining: number;
  result: CrossingResult;
}) {
  const shouldLog =
    result.type !== 'no_change' || previousRemaining === null || previousRemaining <= NEAR_BOUNDARY_LOG_WINDOW_SECONDS;
  if (!shouldLog) return;

  console.debug('[TABLET_TIMER_ALERT]', {
    current: remaining,
    event: context?.eventId ?? null,
    isBonusRound: context?.isBonusRound ?? null,
    paused: context ? !context.timerRunning : null,
    phase: context?.phase ?? null,
    prev: previousRemaining,
    reason: result.type === 'baseline' ? 'first_observation' : result.type === 'no_change' ? 'no_crossing' : result.reason,
    round: context?.round ?? null,
    serverEndAt: context?.serverEndAt ?? null,
    timerRunning: context?.timerRunning ?? null,
    type: result.type,
  });
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
  debugContext,
  enabled,
  notificationKey,
  playWarning,
  remaining,
}: {
  debugContext?: TabletTimerAlertDebugContext;
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
    const previousRemaining = existing?.lastRemaining ?? null;

    const result = detectTimerThresholdCrossing({ existing, playWarning, remaining });
    logTimerAlertEvaluation({ context: debugContext, previousRemaining, remaining, result });

    if (result.type === 'baseline') {
      // 이 phase 인스턴스를 처음 관측 - 지금 값을 기준선으로만 기록하고
      // 아무것도 재생하지 않는다.
      stateByKey.set(notificationKey, { firedFinish: false, firedWarning: false, lastRemaining: remaining });
      return;
    }

    if (result.type === 'warning') {
      existing!.firedWarning = true;
      playTabletAlertSound('warning');
      showToast('warning');
    } else if (result.type === 'finish') {
      existing!.firedFinish = true;
      playTabletAlertSound('finish');
      showToast('finish');
    }

    existing!.lastRemaining = remaining;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, notificationKey, playWarning, remaining]);

  useEffect(
    () => () => {
      if (toastTimeoutRef.current !== undefined) clearTimeout(toastTimeoutRef.current);
    },
    [],
  );

  return toast;
}
