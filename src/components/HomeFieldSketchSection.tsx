import { useEffect, useState } from 'react';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 현장 스케치"에 등록된 공개 이미지 중 앞쪽 순서
// 3개만 홈 미리보기에 보여준다. 데이터가 없으면 섹션을 숨긴다.
// "더보기"는 이번 단계에서는 실제 페이지 이동을 붙이지 않는다(정적 표시).
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

  if (!contents || contents.length === 0) return null;

  const preview = contents.slice(0, HOME_PREVIEW_COUNT);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[19px] font-black text-black">현장 스케치 💧</h2>
        <span className="text-[13px] font-bold text-[#9a9a9a]">더보기 ›</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {preview.map((sketch) => (
          <div className="overflow-hidden rounded-[16px] shadow-[0_6px_16px_rgba(30,43,63,0.08)]" key={sketch.id}>
            <ParticipantPhoto
              className="w-full bg-[#f1f3f5]"
              crop={sketch.cropPosition}
              photoUrl={sketch.imageUrl}
              style={{ aspectRatio: '3 / 4' }}
            />
            {sketch.caption ? (
              <p className="truncate bg-white px-1.5 py-1.5 text-center text-[11px] font-black text-[#666]">{sketch.caption}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
