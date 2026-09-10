// 참가자용 참가자 리스트는 "행사 시작 7일 전"부터만 공개한다.
// 기준: 행사 시작 일시(event_date + start_time)를 Asia/Seoul 벽시계로 해석.
// 서버(get_public_participant_previews / public-participant-media /
// event_participant_list_public_at)와 동일한 계산을 클라이언트에서도 해서
// 공개 전에는 리스트 UI 대신 안내를 보여준다(데이터 차단은 서버가 담당).
const KST_OFFSET = '+09:00';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function participantListPublicAt(dateValue: string, startTime: string): number {
  const time = (startTime || '00:00').slice(0, 5);
  return new Date(`${dateValue}T${time}:00${KST_OFFSET}`).getTime() - SEVEN_DAYS_MS;
}

export function isParticipantListPublic(dateValue?: string | null, startTime?: string | null): boolean {
  if (!dateValue) return true;
  const publicAt = participantListPublicAt(dateValue, startTime ?? '00:00');
  return Number.isFinite(publicAt) ? Date.now() >= publicAt : true;
}

export const PARTICIPANT_LIST_LOCKED_NOTICE = '참가자 리스트는 행사 1주일 전부터 공개됩니다.';
