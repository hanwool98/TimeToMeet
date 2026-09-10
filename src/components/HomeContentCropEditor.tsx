import { useEffect, useRef, useState } from 'react';
import { representativeCropTransform, type RepresentativeCrop } from '../utils/representativeCrop';

const MIN_SCALE = 1;
const MAX_SCALE = 3;

// 표시 박스가 scale일 때 좌우로 (scale - 1) / 2 박스만큼만 이동 여유가 있다
// (그 이상은 빈 공간이 노출됨). ProfileFormPage의 clampRepresentativeOffset과
// 동일한 로직.
function clampOffset(offset: number, scale: number) {
  const maxOffsetFraction = Math.max(0, (scale - 1) / 2);
  return Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, offset));
}

// 관리자 "홈 콘텐츠 관리"에서 업로드한 이미지의 바깥 흰 여백을 잘라내고
// 실제 디자인 영역만 홈 카드에 꽉 차게 보이도록 확대/이동값을 잡는 편집기.
// 저장값은 RepresentativeCrop({scale, offsetX, offsetY} - 오프셋은 표시 박스
// 높이 대비 비율)이고, 홈에서는 ParticipantPhoto가 같은 방식으로 렌더한다.
export default function HomeContentCropEditor({
  aspectRatio = '335 / 228',
  imageUrl,
  onChange,
  value,
}: {
  aspectRatio?: string;
  imageUrl: string;
  onChange: (next: RepresentativeCrop) => void;
  value: RepresentativeCrop;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxHeight, setBoxHeight] = useState(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return undefined;
    const update = () => setBoxHeight(element.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startOffsetX: value.offsetX,
      startOffsetY: value.offsetY,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || boxHeight <= 0) return;
    const nextOffsetX = clampOffset(drag.startOffsetX + (event.clientX - drag.startX) / boxHeight, value.scale);
    const nextOffsetY = clampOffset(drag.startOffsetY + (event.clientY - drag.startY) / boxHeight, value.scale);
    onChange({ offsetX: nextOffsetX, offsetY: nextOffsetY, scale: value.scale });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleScaleChange = (nextScaleRaw: number) => {
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(nextScaleRaw.toFixed(2))));
    onChange({
      offsetX: clampOffset(value.offsetX, nextScale),
      offsetY: clampOffset(value.offsetY, nextScale),
      scale: nextScale,
    });
  };

  return (
    <div>
      <div
        className="relative w-full touch-none select-none overflow-hidden rounded-[18px] bg-[#f1f3f5]"
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        ref={boxRef}
        style={{ aspectRatio }}
      >
        {boxHeight > 0 ? (
          <img
            alt=""
            className="absolute left-1/2 top-1/2 h-full max-w-none"
            draggable={false}
            src={imageUrl}
            style={representativeCropTransform(value, boxHeight)}
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 rounded-[18px] ring-1 ring-inset ring-black/10" />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-[12px] font-black text-[#8a8a8a]">확대</span>
        <input
          className="h-1.5 flex-1 accent-meet-blue"
          max={MAX_SCALE}
          min={MIN_SCALE}
          onChange={(event) => handleScaleChange(Number(event.target.value))}
          step={0.01}
          type="range"
          value={value.scale}
        />
        <button
          className="shrink-0 rounded-[10px] bg-[#eef0f2] px-3 py-1.5 text-[12px] font-black text-[#555]"
          onClick={() => onChange({ offsetX: 0, offsetY: 0, scale: 1 })}
          type="button"
        >
          초기화
        </button>
      </div>
      <p className="mt-1.5 text-[11px] font-bold text-[#a0a0a0]">이미지를 드래그해 위치를 맞추고, 확대로 바깥 여백을 잘라내세요.</p>
    </div>
  );
}
