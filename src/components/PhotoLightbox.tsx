import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 사진 여러 장을 원본 비율 그대로 크게 보여주는 갤러리 라이트박스.
// HomeReviewsSection의 ReviewModal과 같은 상호작용 관례(어두운 오버레이
// + ESC로 닫기 + 배경 스크롤 잠금 + 바깥 클릭으로 닫기)를 그대로 따르되,
// 그 모달들은 사진 한 장/텍스트만 다뤄 여러 장 탐색 기능이 없다 - 프로젝트
// 안에 "이전/다음으로 넘기는" 이미지 뷰어는 관리자 전용 화면(예:
// AdminApplicationsPage의 PhotoViewer)에만 있고 버튼 방식이라, 참가자
// 화면에서 기대하는 스와이프 탐색을 그대로 가져다 쓸 수 없어 새로 만들었다.
// 스와이프는 HomeCarousel과 동일한 철학(네이티브 스크롤 스냅에 맡기고
// 별도 포인터 드래그 로직을 만들지 않음)으로 구현한다.
//
// createPortal로 document.body에 직접 붙인다 - 홈 화면 쪽 조상 중 하나
// (mobile-container에 걸린 overflow-x-hidden)가 fixed 오버레이를 실제
// 뷰포트 전체가 아니라 그 조상의 박스 안쪽으로 잘라버리는 문제가 실제로
// 있었다(라이브 스크린샷으로 확인 - 사진 주변 좁은 띠만 어두워지고 화면
// 나머지는 그대로 보임). 포털로 body 바로 아래에 렌더링하면 그 조상들과
// 완전히 무관해져 항상 전체 화면을 정확히 덮는다.
export interface LightboxImage {
  id: string;
  url: string;
  caption?: string;
}

export default function PhotoLightbox({
  images,
  startIndex,
  onClose,
}: {
  images: LightboxImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(Math.max(0, Math.min(startIndex, images.length - 1)));

  // 배경 스크롤 잠금 + ESC로 닫기 - ReviewModal과 동일한 처리.
  useEffect(() => {
    const scrollY = window.scrollY;
    const { body } = document;
    const previous = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') moveTo(index - 1);
      if (event.key === 'ArrowRight') moveTo(index + 1);
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
      window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, onClose]);

  // 열리자마자 클릭했던 사진으로 즉시(애니메이션 없이) 스크롤 위치를 맞춘다.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollLeft = index * track.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveTo = (nextIndex: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(images.length - 1, nextIndex));
    track.scrollTo({ behavior: 'smooth', left: clamped * track.clientWidth });
  };

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const nextIndex = Math.max(0, Math.min(images.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
    if (nextIndex !== index) setIndex(nextIndex);
  };

  if (images.length === 0) return null;
  const current = images[index];

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/90" onClick={onClose} role="presentation">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
        <p className="text-[13px] font-black text-white/80">
          {current?.caption ? <span className="mr-2 text-white">{current.caption}</span> : null}
          {index + 1} / {images.length}
        </p>
        <button
          aria-label="닫기"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:scale-90"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
          </svg>
        </button>
      </div>

      <div
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
        onClick={(event) => event.stopPropagation()}
        onScroll={handleScroll}
        ref={trackRef}
      >
        {images.map((image) => (
          <div className="grid h-full w-full shrink-0 snap-center place-items-center px-4" key={image.id}>
            <img alt={image.caption ?? ''} className="max-h-[80dvh] max-w-full select-none object-contain" draggable={false} src={image.url} />
          </div>
        ))}
      </div>

      {images.length > 1 ? (
        <>
          <button
            aria-label="이전 사진"
            className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition disabled:opacity-0 active:scale-90"
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation();
              moveTo(index - 1);
            }}
            type="button"
          >
            <ChevronGlyph direction="left" />
          </button>
          <button
            aria-label="다음 사진"
            className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition disabled:opacity-0 active:scale-90"
            disabled={index === images.length - 1}
            onClick={(event) => {
              event.stopPropagation();
              moveTo(index + 1);
            }}
            type="button"
          >
            <ChevronGlyph direction="right" />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function ChevronGlyph({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path
        d={direction === 'left' ? 'M15 5l-8 7 8 7' : 'M9 5l8 7-8 7'}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}
