import { useEffect, useState } from 'react';
import { isParticipantListPublic, participantListPublicAt } from '../utils/participantListGate';

// setTimeout이 실제로 안전하게 예약할 수 있는 사실상의 상한(32비트 부호
// 있는 정수 범위 - 이보다 큰 delay를 넘기면 브라우저가 0으로 clamp해서
// 곧바로 실행해버리는 구현이 있어 위험하다). 행사 시작이 이보다 훨씬 먼
// 미래인 경우(약 24.8일 이상)에는 이 값만큼만 기다렸다가 다시 남은 시간을
// 계산해서 재예약한다.
const MAX_TIMEOUT_MS = 2_147_483_000;

/**
 * 참가자 리스트 공개 여부(행사 시작 72시간 전)를 판단하고, 화면을 켜둔 채로
 * 그 경계 시점을 지나가는 순간에도 새로고침 없이 정확히 그 시점에 자동으로
 * 전환되게 한다(참가자 사진 30초 polling 같은 다른 갱신 주기에 얹혀가지
 * 않고, 이 경계만을 위한 전용 타이머로 처리 - 최대 30초까지 늦어질 수 있는
 * 우연한 갱신에 기대지 않는다).
 *
 * previewBypass가 true면(관리자 발급 previewToken으로 테스트 행사를 미리
 * 보는 경우) 시간과 무관하게 항상 공개된 것으로 취급한다 - 서버
 * (get_public_participant_previews 등)가 이미 같은 조건으로 실제 데이터를
 * 내려주는 것과 동일한 판단 기준을 화면에도 반영해, 관리자 preview에서는
 * 후기 콘텐츠가 아니라 실제 참가자 리스트가 보이게 한다.
 *
 * 반환값은 항상 "이미 로드된 event 정보"만으로 동기적으로 계산되므로(비동기
 * 단계 없음), 잘못된 임시값이 먼저 그려졌다가 바뀌는 flicker 자체가 구조적으로
 * 발생하지 않는다.
 */
export function useParticipantListGate(
  dateValue: string | null | undefined,
  startTime: string | null | undefined,
  previewBypass = false,
): boolean {
  const [isPublic, setIsPublic] = useState(() => previewBypass || isParticipantListPublic(dateValue, startTime));
  const [rescheduleTick, setRescheduleTick] = useState(0);

  useEffect(() => {
    if (previewBypass) {
      setIsPublic(true);
      return undefined;
    }
    if (!dateValue) {
      setIsPublic(true);
      return undefined;
    }

    const publicAt = participantListPublicAt(dateValue, startTime ?? '00:00');
    const now = Date.now();
    if (!Number.isFinite(publicAt) || now >= publicAt) {
      setIsPublic(true);
      return undefined;
    }

    setIsPublic(false);
    const remaining = publicAt - now;
    const delay = Math.min(remaining, MAX_TIMEOUT_MS);
    const timeoutId = window.setTimeout(() => {
      if (Date.now() >= publicAt) {
        setIsPublic(true);
      } else {
        // 아주 먼 미래 행사라 한 번에 다 기다리지 못한 경우 - 남은 시간을
        // 다시 계산해 재예약하도록 이 effect를 다시 돌린다.
        setRescheduleTick((tick) => tick + 1);
      }
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [dateValue, startTime, previewBypass, rescheduleTick]);

  // 백그라운드 탭에서는 브라우저가 setTimeout을 늦게 실행시킬 수 있다 -
  // 포그라운드로 돌아오거나 네트워크가 재연결되는 시점에 즉시 다시 계산해
  // 지연 없이 맞는 상태로 보정한다. 이미 맞는 상태였다면 재계산 결과가
  // 같아 아무 것도 바뀌지 않는다(뒤집히거나 중복 렌더링되지 않음).
  useEffect(() => {
    const handleReconnect = () => setRescheduleTick((tick) => tick + 1);
    window.addEventListener('focus', handleReconnect);
    window.addEventListener('online', handleReconnect);
    document.addEventListener('visibilitychange', handleReconnect);
    return () => {
      window.removeEventListener('focus', handleReconnect);
      window.removeEventListener('online', handleReconnect);
      document.removeEventListener('visibilitychange', handleReconnect);
    };
  }, []);

  return isPublic;
}
