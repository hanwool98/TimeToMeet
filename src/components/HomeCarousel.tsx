import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// "타임투밋이 사랑받는 이유 / 모집방식 & 진행방식" 배너 카드의 통일 비율.
// 두 섹션이 반드시 같은 크기로 보이도록 이 한 값만 공유한다.
// 11:4 = 2.75:1. 권장 원본 이미지: 1100 x 400 px (더 고해상도로 1650 x 600).
export const HOME_BANNER_ASPECT = '11 / 4';

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
  // 트랙 자체에 얹는 클래스(예: 홈 컨테이너 좌우 패딩을 뚫고 카드가 화면
  // 오른쪽 끝까지 차도록 "-mr-5 pr-5"). 레퍼런스처럼 카드 1장이 폭에 꽉 차고
  // 다음 카드가 살짝만 보이게 하기 위함.
  trackClassName?: string;
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
  slideClassName = 'w-[87vw] max-w-[372px]',
  trackClassName = '',
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
        className={`no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 ${trackClassName}`}
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

// windowed 스타일: 실제 슬라이드가 6개 이상이어도 하단 점은 항상 최대 5개만
// 보여준다. 현재 슬라이드를 중심으로 5칸 창이 이동하며(첫/끝 구간은 고정),
// 창 안에서 활성 점 위치와의 거리에 따라 크기를 3단계(큼/중간/작음)로 준다.
//   거리 0 = 큼(활성) · 1 = 중간 · 2+ = 작음
// key를 창 안 위치(0~4)로 잡아 창이 밀릴 때 같은 DOM이 유지돼 크기가
// transition으로 부드럽게 바뀐다.
const WINDOWED_DOT_MAX = 5;

function windowedDotClass(distance: number, active: boolean) {
  const size = distance === 0 ? 'h-2 w-2' : distance === 1 ? 'h-1.5 w-1.5' : 'h-1 w-1';
  const color = active ? 'bg-meet-blue' : 'bg-[#d5d5d5]';
  return `rounded-full transition-all duration-200 ${size} ${color}`;
}

function CarouselDots({ activeIndex, style, total }: { activeIndex: number; style: 'plain' | 'windowed'; total: number }) {
  if (style === 'windowed') {
    const dotCount = Math.min(WINDOWED_DOT_MAX, total);
    const windowStart =
      total <= WINDOWED_DOT_MAX ? 0 : Math.min(Math.max(activeIndex - 2, 0), total - WINDOWED_DOT_MAX);
    const activePos = activeIndex - windowStart; // 0 ~ dotCount-1
    return (
      <div aria-hidden="true" className="mt-2.5 flex items-center justify-center gap-1.5">
        {Array.from({ length: dotCount }, (_, position) => {
          const distance = Math.abs(position - activePos);
          return <span className={windowedDotClass(distance, distance === 0)} key={position} />;
        })}
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="mt-2.5 flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, index) => (
        <span
          className={
            index === activeIndex
              ? 'h-1.5 w-4 rounded-full bg-meet-blue transition-all'
              : 'h-1.5 w-1.5 rounded-full bg-[#d5d5d5] transition-all'
          }
          key={index}
        />
      ))}
    </div>
  );
}
