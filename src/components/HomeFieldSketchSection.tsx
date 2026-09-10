import { useEffect, useState } from 'react';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 현장 스케치"에 등록된 공개 이미지 중 앞쪽 순서
// 3개만 가로 썸네일(4:3)로 보여준다. 등록 전이면 제목은 유지하고 안내
// 카드만 표시. "더보기"는 이번 단계에서는 페이지 이동을 붙이지 않는다.
const HOME_PREVIEW_COUNT = 3;

export default function HomeFieldSketchSection() {
  const [contents, setContents] = useState<PublicHomeContent[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeContents('field_sketch').then((rows) => {
      if (active) setContents(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  const preview = (contents ?? []).slice(0, HOME_PREVIEW_COUNT);

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">현장 스케치 💧</h2>
        <span className="text-[12px] font-bold text-[#9a9a9a]">더보기 ›</span>
      </div>
      {preview.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {preview.map((sketch) => (
            <div className="relative overflow-hidden rounded-[12px] shadow-[0_5px_14px_rgba(30,43,63,0.09)]" key={sketch.id}>
              <ParticipantPhoto
                className="w-full bg-[#f1f3f5]"
                crop={sketch.cropPosition}
                photoUrl={sketch.imageUrl}
                style={{ aspectRatio: '4 / 3' }}
              />
              {sketch.caption ? (
                <p className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[9.5px] font-black text-white">
                  {sketch.caption}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-[92px] w-full place-items-center rounded-[12px] bg-meet-blueSoft">
          <p className="text-[12px] font-bold text-[#8a8a8a]">{contents ? '현장 스케치 준비 중입니다' : '불러오는 중'}</p>
        </div>
      )}
    </section>
  );
}
