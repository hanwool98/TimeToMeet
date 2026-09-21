// Meta Pixel(브라우저) Lead 이벤트 전송 헬퍼.
//
// Pixel 자체(fbq 초기화)는 index.html에 표준 스니펫으로 심어뒀다 - React
// Router의 클라이언트 사이드 네비게이션은 전체 페이지를 다시 로드하지
// 않으므로, 이 앱 안에서 화면을 아무리 옮겨다녀도 index.html은 딱 한 번만
// 로드되고 fbq도 그때 한 번만 초기화된다. 그래서 여기서는 별도의
// "초기화됐는지" 체크 없이 이미 떠 있는 window.fbq만 사용한다.
//
// Pixel ID는 비밀값이 아니다(Meta Pixel은 원래 페이지 소스에 그대로
// 노출되는 공개 스크립트다) - 그래서 별도 환경변수 없이 상수로 둔다.
// index.html에 박아둔 값과 반드시 같아야 한다.
export const META_PIXEL_ID = '1090793103739228';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Meta Pixel이 첫 방문 때 자동으로 심어두는 브라우저 식별 쿠키(_fbp).
 * 서버 Conversions API 호출에도 그대로 실어 보내 브라우저 Pixel 이벤트와
 * 매칭 품질을 높인다 - 광고 전환 측정을 위해 새로 수집하는 게 아니라
 * Pixel이 이미 만들어둔 값을 읽기만 한다.
 */
export function getMetaBrowserId(): string | null {
  return readCookie('_fbp');
}

/**
 * Meta 광고 클릭(URL의 fbclid)이 있었을 때만 Pixel이 자동으로 심어두는
 * 클릭 식별 쿠키(_fbc). 광고를 통해 들어온 게 아니면 없는 게 정상이라 그
 * 경우엔 그냥 안 보낸다(억지로 만들어내지 않는다).
 */
export function getMetaClickId(): string | null {
  return readCookie('_fbc');
}

/**
 * 실제 행사 신청이 Supabase에 저장 완료된 직후에만 호출해야 한다 - 행사
 * 상세 방문/신청 버튼 클릭/신청 폼 진입 시점에는 절대 호출하면 안 된다.
 *
 * applicationId를 eventID로 그대로 써서, 같은 신청 건에 대해 서버
 * Conversions API가 보내는 Lead 이벤트와 event_id가 정확히 일치하게
 * 한다 - Meta가 이 값 기준으로 두 채널의 이벤트를 하나로 중복 제거한다.
 */
export function trackMetaLead(applicationId: string) {
  try {
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    window.fbq('track', 'Lead', {}, { eventID: applicationId });
  } catch (error) {
    // 광고 전환 측정 실패가 실제 신청 완료 흐름에 영향을 주면 안 된다.
    console.error('Meta Pixel Lead tracking failed', error);
  }
}
