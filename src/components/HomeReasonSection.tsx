import { useEffect, useState } from 'react';
import HomeCarousel, { HOME_MAIN_CARD_HEIGHT_CLASS } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 타임투밋이 사랑받는 이유"에 등록된 공개 이미지만
// sort_order 순서대로 보여준다. 데이터가 없거나 조회 실패 시엔 섹션 자체를
// 숨겨(빈 캐러셀/깨진 이미지 노출 없음) 홈이 항상 안정적으로 뜨게 한다.
export default function HomeReasonSection() {
  const [contents, setContents] = useState<PublicHomeContent[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeContents('love_reason').then((rows) => {
      if (active) setContents(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!contents || contents.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-[19px] font-black text-black">타임투밋이 사랑받는 이유 ♥</h2>
      <HomeCarousel
        ariaLabel="타임투밋이 사랑받는 이유"
        dotStyle="windowed"
        getKey={(content) => content.id}
        items={contents}
        renderItem={(content, index) => (
          <ParticipantPhoto
            className={`w-full rounded-[22px] shadow-[0_10px_30px_rgba(30,43,63,0.08)] ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
            crop={content.cropPosition}
            fallback={<span className="text-[12px] font-bold">이미지 {index + 1}</span>}
            photoUrl={content.imageUrl}
          />
        )}
      />
    </section>
  );
}
