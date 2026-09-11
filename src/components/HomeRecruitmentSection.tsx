import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeCarousel, { HOME_BANNER_ASPECT } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 모집방식 & 신청방식"에 등록된 공개 이미지를
// sort_order 순서대로 좌우 스와이프 배너 캐러셀로 보여준다(사랑받는 이유와
// 완전히 동일한 크기/구조). 로딩 중이거나 등록된 콘텐츠가 없으면 옛
// 시안형 안내 배너를 잠깐이라도 보여주지 않고 섹션 자체를 비운다 -
// HomeReviewsSection/HomeReasonSection과 동일한 원칙.
// 홈에 노출되는 제목은 "모집방식 & 진행방식"(관리자 메뉴 라벨은 그대로).
export default function HomeRecruitmentSection() {
  const navigate = useNavigate();
  const [contents, setContents] = useState<PublicHomeContent[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeContents('recruitment_application').then((rows) => {
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
        <h2 className="text-[16px] font-black text-black">모집방식 &amp; 진행방식 📋</h2>
        <button className="text-[12px] font-bold text-[#9a9a9a]" onClick={() => navigate('/event-info')} type="button">
          행사 소개 보기 ›
        </button>
      </div>
      <HomeCarousel
        ariaLabel="모집방식 & 진행방식"
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
