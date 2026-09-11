import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeCarousel, { HOME_BANNER_ASPECT } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 타임투밋이 사랑받는 이유"에 등록된 공개 이미지를
// sort_order 순서대로 가로 배너 캐러셀로 보여준다. 로딩 중(contents===null)
// 이거나 등록된 콘텐츠가 없으면 옛 하드코딩 배너를 잠깐이라도 보여주지
// 않고 섹션 자체를 비운다 - HomeReviewsSection과 동일한 원칙.
export default function HomeReasonSection() {
  const navigate = useNavigate();
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
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">
          타임투밋이 사랑받는 이유 <span className="text-meet-pink">♥</span>
        </h2>
        <button className="text-[12px] font-bold text-[#9a9a9a]" onClick={() => navigate('/event-info')} type="button">
          행사 소개 보기 ›
        </button>
      </div>
      <HomeCarousel
        ariaLabel="타임투밋이 사랑받는 이유"
        dotStyle="windowed"
        getKey={(content) => content.id}
        items={contents}
        trackClassName="-mr-5 pr-5"
        renderItem={(content, index) => (
          <ParticipantPhoto
            className="w-full rounded-[16px] shadow-card"
            crop={content.cropPosition}
            fallback={<span className="text-[11px] font-bold">이미지 {index + 1}</span>}
            photoUrl={content.imageUrl}
            style={{ aspectRatio: HOME_BANNER_ASPECT }}
          />
        )}
      />
    </section>
  );
}
