import { useEffect, useState } from 'react';
import HomeCarousel, { HOME_MAIN_CARD_HEIGHT_CLASS } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 타임투밋이 사랑받는 이유"에 등록된 공개 이미지만
// sort_order 순서대로 보여준다. 아직 등록 전이거나 조회에 실패해도 섹션
// 자체는 그대로 두고(제목 유지) 같은 높이의 안내 카드만 표시해 홈 레이아웃이
// 흔들리지 않게 한다.
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

  return (
    <section>
      <h2 className="mb-3 text-[19px] font-black text-black">타임투밋이 사랑받는 이유 ♥</h2>
      {contents && contents.length > 0 ? (
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
      ) : (
        <div
          className={`grid w-full place-items-center rounded-[22px] bg-meet-blueSoft ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
        >
          <p className="text-[13px] font-bold text-[#8a8a8a]">{contents ? '콘텐츠 준비 중입니다' : '불러오는 중'}</p>
        </div>
      )}
    </section>
  );
}
