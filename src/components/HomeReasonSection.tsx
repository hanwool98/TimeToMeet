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
            // HomeCarousel은 전체 카드를 한 번에 DOM에 렌더한다(스크롤
            // 스냅 방식 - HomeCarousel.tsx 주석 참고). loading="lazy"가
            // 없으면 화면에 아직 안 보이는 뒤쪽 카드까지 처음부터 전부
            // 다운로드된다 - 현장 스케치 섹션에는 이미 적용돼 있던 것과
            // 동일하게 여기도 적용한다(egress 원인 분석에서 확인된 문제).
            // 첫 화면에 보이는 카드는 브라우저가 lazy여도 즉시 로드하므로
            // 첫 카드가 늦게 뜨는 문제는 없다.
            loading="lazy"
            photoUrl={content.imageUrl}
            style={{ aspectRatio: HOME_BANNER_ASPECT }}
          />
        )}
      />
    </section>
  );
}
