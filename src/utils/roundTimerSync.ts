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

// Default/fallback only - the real regular-round duration is operator-
// configured per event (events.conversation_duration_seconds, 7/8/10분) and
// comes down through every progress RPC as conversationDurationSeconds.
export const CONVERSATION_PHASE_SECONDS = 600;
export const BONUS_CONVERSATION_PHASE_SECONDS = 420;
export const TRANSITION_PHASE_SECONDS = 120;
export const BONUS_RATING_PHASE_SECONDS = 60;
// 추가시간의 상대 공개, 호감도 수정, 자리이동은 모두 같은 서버 phase에서
// 1분 동안 진행한다. 정규 라운드 transition은 위의 120초를 그대로 쓴다.
export const BONUS_REVEAL_PHASE_SECONDS = 60;

export function phaseDurationSeconds(
  phase?: 'conversation' | 'reveal' | 'transition',
  isBonusRound = false,
  regularConversationSeconds = CONVERSATION_PHASE_SECONDS,
  _hasNextBonusPartner = true,
) {
  if (phase === 'reveal') return BONUS_REVEAL_PHASE_SECONDS;
  if (phase === 'transition') {
    return isBonusRound ? BONUS_RATING_PHASE_SECONDS : TRANSITION_PHASE_SECONDS;
  }
  return isBonusRound ? BONUS_CONVERSATION_PHASE_SECONDS : regularConversationSeconds;
}

export function formatCountdown(totalSeconds: number) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
