import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// 홈 대시보드의 "다가오는 행사 / 타임투밋이 사랑받는 이유 / 모집방식 & 신청방식"
// 세 캐러셀이 전부 동일한 메인 카드 높이를 쓰도록 공유하는 상수 - 개별 섹션이
// 각자 다른 높이를 쓰면 스와이프 중 카드 높이가 들쭉날쭉해 보인다.
export const HOME_MAIN_CARD_HEIGHT_CLASS = 'h-[228px]';

const DEFAULT_AUTOPLAY_MS = 4500;
const RESUME_AFTER_INTERACTION_MS = 4500;

interface HomeCarouselProps<T> {
  ariaLabel: string;
  autoPlayIntervalMs?: number;
  dotStyle?: 'plain' | 'windowed';
  getKey: (item: T, index: number) => string;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  slideClassName?: string;
}

// 이 프로젝트에는 별도 캐러셀/스와이퍼 라이브러리가 없어(package.json 확인
// 완료), 새 의존성을 추가하는 대신 네이티브 스크롤 스냅만으로 스와이프를
// 구현한다 - 브라우저가 이미 손가락 스와이프/탭 구분을 처리해주므로 별도
// 포인터 드래그 로직이 필요 없고, 자동재생은 setInterval로 다음 카드까지
// scrollTo만 호출하면 된다.
export default function HomeCarousel<T>({
  ariaLabel,
  autoPlayIntervalMs = DEFAULT_AUTOPLAY_MS,
  dotStyle = 'plain',
  getKey,
  items,
  renderItem,
  slideClassName = 'w-[84%] min-[380px]:w-[82%]',
}: HomeCarouselProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(0);
  const activeIndexRef = useRef(0);
  const autoplayTimerRef = useRef<number | null>(null);
  const resumeTimeoutRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const measureStep = () => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.children[0] as HTMLElement | undefined;
    const second = track.children[1] as HTMLElement | undefined;
    if (!first) return;
    stepRef.current = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  };

  useLayoutEffect(() => {
    measureStep();
    const handleResize = () => measureStep();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const scrollToIndex = (index: number) => {
    const track = trackRef.current;
    if (!track || !stepRef.current) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    track.scrollTo({ behavior: 'smooth', left: clamped * stepRef.current });
  };

  const clearAutoplay = () => {
    if (autoplayTimerRef.current == null) return;
    window.clearInterval(autoplayTimerRef.current);
    autoplayTimerRef.current = null;
  };

  const startAutoplay = () => {
    clearAutoplay();
    if (!autoPlayIntervalMs || items.length <= 1) return;
    autoplayTimerRef.current = window.setInterval(() => {
      scrollToIndex((activeIndexRef.current + 1) % items.length);
    }, autoPlayIntervalMs);
  };

  useEffect(() => {
    startAutoplay();
    return clearAutoplay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, autoPlayIntervalMs]);

  useEffect(
    () => () => {
      clearAutoplay();
      if (resumeTimeoutRef.current != null) window.clearTimeout(resumeTimeoutRef.current);
    },
    [],
  );

  // 사용자가 직접 스와이프하는 동안에는 자동재생이 끼어들어 손가락 밑에서
  // 카드가 튀지 않도록 잠시 멈추고, 조작이 멎으면 그때부터 다시 카운트해
  // 재개한다 - 스와이프 한 번으로 자동재생이 완전히 멈춰버리지 않게 한다.
  const pauseThenResume = () => {
    clearAutoplay();
    if (resumeTimeoutRef.current != null) window.clearTimeout(resumeTimeoutRef.current);
    resumeTimeoutRef.current = window.setTimeout(startAutoplay, RESUME_AFTER_INTERACTION_MS);
  };

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track || !stepRef.current) return;
    const index = Math.max(0, Math.min(items.length - 1, Math.round(track.scrollLeft / stepRef.current)));
    if (index !== activeIndexRef.current) {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
  };

  if (items.length === 0) return null;

  return (
    <div>
      <div
        aria-label={ariaLabel}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 pr-6"
        onPointerDown={pauseThenResume}
        onScroll={handleScroll}
        ref={trackRef}
        role="group"
      >
        {items.map((item, index) => (
          <div className={`shrink-0 snap-start ${slideClassName}`} key={getKey(item, index)}>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
      {items.length > 1 ? <CarouselDots activeIndex={activeIndex} style={dotStyle} total={items.length} /> : null}
    </div>
  );
}

// windowed 스타일에서 현재 카드 뒤로 갈수록 점점 작아지는 5단계 크기표 -
// "● • • · ·"처럼 뒤에 더 남아있다는 느낌만 주고 전체 개수를 다 나열하지
// 않는다(요청: 8/10페이지 전부를 점으로 나열하면 너무 빽빽해 보임).
const WINDOWED_DOT_SIZES = [
  'h-2 w-2 bg-meet-blue',
  'h-1.5 w-1.5 bg-meet-blue/50',
  'h-1.5 w-1.5 bg-[#c9c9c9]',
  'h-1 w-1 bg-[#d9d9d9]',
  'h-1 w-1 bg-[#e4e4e4]',
];

function CarouselDots({ activeIndex, style, total }: { activeIndex: number; style: 'plain' | 'windowed'; total: number }) {
  if (style === 'windowed') {
    const visibleCount = Math.min(WINDOWED_DOT_SIZES.length, total - activeIndex);
    return (
      <div aria-hidden="true" className="mt-3 flex items-center justify-center gap-1.5">
        {Array.from({ length: visibleCount }, (_, offset) => (
          <span className={`rounded-full ${WINDOWED_DOT_SIZES[offset]}`} key={offset} />
        ))}
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="mt-3 flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, index) => (
        <span
          className={
            index === activeIndex
              ? 'h-2 w-5 rounded-full bg-meet-blue transition-all'
              : 'h-2 w-2 rounded-full bg-[#d9d9d9] transition-all'
          }
          key={index}
        />
      ))}
    </div>
  );
}
