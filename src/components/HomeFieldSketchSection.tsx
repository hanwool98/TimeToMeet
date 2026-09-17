import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeCarousel from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import PhotoLightbox from './PhotoLightbox';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 현장 스케치"에 등록된 공개 이미지를 sort_order
// 순서 그대로 보여준다(fetchPublicHomeContents가 이미 그 순서로 내려줌).
// 3장 이하는 기존 디자인 그대로 정적으로 나열하고, 4장을 넘으면 다른 홈
// 카드 섹션(참가자 후기 등)과 동일한 HomeCarousel로 전환해 한 장씩 자동
// 슬라이드된다 - 새 캐러셀 로직을 따로 만들지 않고 그 컴포넌트를 그대로
// 재사용한다. 사진을 누르면 PhotoLightbox로 원본 비율 그대로 확대해서
// 보여주고, 그 안에서 좌우로 다른 사진도 계속 탐색할 수 있다.
const STATIC_GRID_MAX = 3;
// "약 3개가 보이도록" - HomeCarousel의 기본 카드 간격(gap-3=12px)을 그대로
// 쓰면서 3장 폭에 맞춘 값. 정확히 3.0장이 아니라 살짝 다음 장이 보이게
// 해서(peek) "더 있다"는 걸 스와이프 전에도 알 수 있게 한다 - 다른 홈
// 캐러셀(참가자 후기 등)도 다음 카드가 살짝 보이는 동일한 방식을 쓴다.
const CAROUSEL_SLIDE_CLASSNAME = 'w-[30%] min-w-[104px]';

export default function HomeFieldSketchSection() {
  const navigate = useNavigate();
  const [contents, setContents] = useState<PublicHomeContent[] | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeContents('field_sketch').then((rows) => {
      if (active) setContents(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  const sketches = contents ?? [];
  const useCarousel = sketches.length > STATIC_GRID_MAX;

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">현장 스케치 📸</h2>
        <button className="text-[12px] font-bold text-[#9a9a9a]" onClick={() => navigate('/field-sketches')} type="button">
          더보기 ›
        </button>
      </div>
      {sketches.length === 0 ? (
        <div className="grid h-[92px] w-full place-items-center rounded-[12px] bg-meet-blueSoft">
          <p className="text-[12px] font-bold text-[#8a8a8a]">{contents ? '현장 스케치 준비 중입니다' : '불러오는 중'}</p>
        </div>
      ) : useCarousel ? (
        <HomeCarousel
          ariaLabel="현장 스케치"
          dotStyle="windowed"
          getKey={(sketch) => sketch.id}
          items={sketches}
          renderItem={(sketch, index) => (
            <FieldSketchThumbnail onOpen={() => setOpenIndex(index)} sketch={sketch} />
          )}
          slideClassName={CAROUSEL_SLIDE_CLASSNAME}
        />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {sketches.map((sketch, index) => (
            <FieldSketchThumbnail key={sketch.id} onOpen={() => setOpenIndex(index)} sketch={sketch} />
          ))}
        </div>
      )}

      {openIndex != null ? (
        <PhotoLightbox
          images={sketches.map((sketch) => ({ id: sketch.id, url: sketch.imageUrl ?? '', caption: sketch.caption }))}
          onClose={() => setOpenIndex(null)}
          startIndex={openIndex}
        />
      ) : null}
    </section>
  );
}

function FieldSketchThumbnail({ onOpen, sketch }: { onOpen: () => void; sketch: PublicHomeContent }) {
  return (
    <button
      aria-label={sketch.caption || '현장 스케치 사진 확대'}
      className="relative block w-full overflow-hidden rounded-[12px] shadow-card active:scale-[0.98]"
      onClick={onOpen}
      type="button"
    >
      <ParticipantPhoto
        className="w-full bg-[#f1f3f5]"
        crop={sketch.cropPosition}
        loading="lazy"
        photoUrl={sketch.imageUrl}
        style={{ aspectRatio: '4 / 3' }}
      />
      {sketch.caption ? (
        <p className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[9.5px] font-black text-white">
          {sketch.caption}
        </p>
      ) : null}
    </button>
  );
}
