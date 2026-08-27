import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { representativeCropTransform, type RepresentativeCrop } from '../utils/representativeCrop';

// Single shared renderer for "a participant's representative photo,
// cropped exactly the way they framed it during profile setup" - every
// screen that shows a real (non-mosaicked) representative photo should use
// this instead of a plain `object-cover` <img>, so the same participant's
// photo always shows the same face/framing everywhere (테이블 현황, 참가자
// 리스트, 체크인 현황, 호감도 작성, 추가시간 상대 공개, 최종 선택 등).
//
// Mirrors the exact positioning technique already used in
// ProfileFormPage.tsx's own preview/editor (absolute + left/top 50% + the
// transform from representativeCropTransform). Shape/sizing is left
// entirely to the caller's `className` (rounded-full for an avatar,
// rounded-[20px] aspect-[4/3] for a card, etc.) so every screen keeps its
// own existing card design - this component only ever standardizes how the
// crop itself is applied.
//
// `sizePx` is optional: pass it for a fixed-size avatar (the offset
// fractions are applied against that exact pixel size), or omit it to let
// the component measure its own rendered box height and use that instead -
// needed for a responsive/aspect-ratio box like RatingScreen's 4:3 card,
// since offsetX/offsetY are fractions of the box the image is scaled
// against (height, since the image itself is sized via h-full).
export default function ParticipantPhoto({
  className = '',
  crop,
  fallback,
  photoUrl,
  sizePx,
  style,
}: {
  className?: string;
  crop?: RepresentativeCrop | null;
  fallback?: ReactNode;
  photoUrl?: string | null;
  sizePx?: number;
  style?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState(sizePx ?? 0);
  // crossOrigin='anonymous' is needed so a save-as-image feature (e.g. the
  // 프로필카드 저장 button) can actually read this photo's pixels into a
  // canvas - without it, the browser silently treats a cross-origin image
  // (Supabase Storage) as tainted and canvas export tools skip/blank it.
  // If the storage response ever lacks the CORS header this needs, the
  // crossOrigin load itself fails - fall back to a plain (non-CORS) load so
  // the photo still just displays normally, matching today's behavior.
  const [useCrossOrigin, setUseCrossOrigin] = useState(true);

  useEffect(() => {
    setUseCrossOrigin(true);
  }, [photoUrl]);

  useEffect(() => {
    if (sizePx !== undefined) {
      setMeasuredSize(sizePx);
      return undefined;
    }
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => setMeasuredSize(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sizePx]);

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${className}`}
      ref={containerRef}
      style={{ ...(sizePx !== undefined ? { height: sizePx, width: sizePx } : undefined), ...style }}
    >
      {photoUrl ? (
        measuredSize > 0 ? (
          <img
            alt=""
            className="absolute left-1/2 top-1/2 h-full max-w-none select-none"
            crossOrigin={useCrossOrigin ? 'anonymous' : undefined}
            key={useCrossOrigin ? 'cors' : 'plain'}
            onError={() => {
              if (useCrossOrigin) setUseCrossOrigin(false);
            }}
            src={photoUrl}
            style={representativeCropTransform(crop, measuredSize)}
          />
        ) : null
      ) : (
        <div className="grid h-full w-full place-items-center text-[#c3cad1]">{fallback}</div>
      )}
    </div>
  );
}
