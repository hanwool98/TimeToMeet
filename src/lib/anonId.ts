const anonIdKey = 'time2meet.funnelAnonId';

/**
 * 로그인 여부와 무관하게 브라우저(기기)를 구분하기 위한 임의 식별자.
 * 신청 퍼널 단계별 도달 인원을 세기 위한 용도로만 쓰이며, 이름/전화번호
 * 등 개인정보와는 무관한 무작위 값이다 - 이미 이 프로젝트가 같은 목적
 * (동일 방문자 식별)으로 Meta Pixel의 _fbp 쿠키를 그대로 읽어 쓰는 것과
 * 같은 성격이다(src/lib/metaPixel.ts의 getMetaBrowserId 참고).
 *
 * localStorage 접근이 실패할 수 있는 환경(프라이빗 모드 등)에서도 절대
 * 예외를 던지지 않는다 - 계측 실패가 실제 화면 동작에 영향을 주면
 * 안 된다.
 */
export function getFunnelAnonId(): string {
  try {
    const existing = window.localStorage.getItem(anonIdKey);
    if (existing) return existing;

    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(anonIdKey, generated);
    return generated;
  } catch {
    return 'anon-unavailable';
  }
}
