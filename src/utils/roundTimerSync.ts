// Same "snapshot + extrapolate" idea as introVideoSync.ts, but for the
// round/phase countdown: the server stores (elapsed-so-far, updated-at,
// running/paused) and every device computes "how much time has actually
// elapsed" the same way, so the countdown shown stays in step without
// needing a tick from the server every second.
export function computeLiveElapsedSeconds(
  snapshot: { timerPositionSeconds: number; timerStatus: 'paused' | 'running'; timerUpdatedAt?: string },
  nowMs = Date.now(),
) {
  if (snapshot.timerStatus !== 'running' || !snapshot.timerUpdatedAt) {
    return snapshot.timerPositionSeconds;
  }
  const elapsedSinceUpdate = (nowMs - new Date(snapshot.timerUpdatedAt).getTime()) / 1000;
  return Math.max(0, snapshot.timerPositionSeconds + elapsedSinceUpdate);
}

export const CONVERSATION_PHASE_SECONDS = 600;
export const TRANSITION_PHASE_SECONDS = 120;

export function phaseDurationSeconds(phase?: 'conversation' | 'transition') {
  return phase === 'transition' ? TRANSITION_PHASE_SECONDS : CONVERSATION_PHASE_SECONDS;
}

export function formatCountdown(totalSeconds: number) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
