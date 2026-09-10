import { useEffect, useRef } from 'react';

// 티켓 행사명처럼 좁은 영역에서 텍스트가 넘칠 때만 "앞부분 → 잠깐 멈춤 →
// 가려진 뒷부분이 보이도록 왼쪽으로 천천히 이동 → 잠깐 멈춤 → 처음으로
// 복귀 → 반복" 하는 자동 스크롤. 넘치지 않으면 아무 애니메이션도 하지 않고
// 정적으로 표시한다. overflow는 컨테이너에서 마스킹되어 규격 밖으로 절대
// 나가지 않는다. <marquee> 대신 Web Animations API 사용.
export default function MarqueeText({ className = '', text }: { className?: string; text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return undefined;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animation: Animation | undefined;

    const sync = () => {
      animation?.cancel();
      animation = undefined;
      inner.style.transform = 'translateX(0)';

      const overflow = inner.scrollWidth - container.clientWidth;
      if (prefersReducedMotion || overflow <= 2) return; // 다 보이면 애니메이션 없음

      // 방향당 이동 시간(자연스러운 속도 ~22px/s, 최소 1.4초) + 앞/뒤 정지 구간.
      const travelMs = Math.max(1400, Math.round(overflow * 45));
      const holdMs = 1300;
      const totalMs = travelMs * 2 + holdMs * 2;

      animation = inner.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: holdMs / totalMs },
          { transform: `translateX(-${overflow}px)`, offset: (holdMs + travelMs) / totalMs },
          { transform: `translateX(-${overflow}px)`, offset: (holdMs * 2 + travelMs) / totalMs },
          { transform: 'translateX(0)', offset: 1 },
        ],
        { duration: totalMs, easing: 'ease-in-out', iterations: Infinity },
      );
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(container);

    return () => {
      animation?.cancel();
      resizeObserver.disconnect();
    };
  }, [text]);

  return (
    <div className={`overflow-hidden ${className}`} ref={containerRef}>
      <span className="inline-block whitespace-nowrap will-change-transform" ref={innerRef}>
        {text}
      </span>
    </div>
  );
}
