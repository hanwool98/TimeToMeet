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
// 쉬는시간 재개 직후, 첫 추가시간 대화 전에 보여주는 "다시 만나게 된
// 행운의 상대 + 자리이동 안내" 전용 1분 - 호감도 수정이 없는 phase라
// transition(2분)보다 짧다.
export const BONUS_REVEAL_PHASE_SECONDS = 60;
// 다음 추가시간이 없는 마지막 transition은 이동할 다음 자리가 없으므로
// 2분이 아니라 1분 남짓만 준다. 정확히 60초가 아니라 70초인 이유: 제출
// 응답이 서버에 도착하는 바로 그 순간 poll이 "시간 다 됐다"고 먼저
// 판단해버리는 경쟁 상태 여지를 줄이기 위한 여유분(실제 행사에서 이
// 경쟁 상태로 마지막 추가시간 호감도가 전원 누락된 적 있음 - 클라이언트
// 쪽 경쟁 상태 자체는 별도로 막아뒀고, 이건 그와 별개로 남는 극히 드문
// 케이스에 대한 완충일 뿐이라 눈에 띄지 않을 만큼만 늘렸다).
export const BONUS_LAST_TRANSITION_PHASE_SECONDS = 70;

export function phaseDurationSeconds(
  phase?: 'conversation' | 'reveal' | 'transition',
  isBonusRound = false,
  regularConversationSeconds = CONVERSATION_PHASE_SECONDS,
  hasNextBonusPartner = true,
) {
  if (phase === 'reveal') return BONUS_REVEAL_PHASE_SECONDS;
  if (phase === 'transition') {
    return isBonusRound && !hasNextBonusPartner ? BONUS_LAST_TRANSITION_PHASE_SECONDS : TRANSITION_PHASE_SECONDS;
  }
  return isBonusRound ? BONUS_CONVERSATION_PHASE_SECONDS : regularConversationSeconds;
}

export function formatCountdown(totalSeconds: number) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
