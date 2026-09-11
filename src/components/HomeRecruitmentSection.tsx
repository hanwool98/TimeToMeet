import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeCarousel, { HOME_BANNER_ASPECT } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 모집방식 & 신청방식"에 등록된 공개 이미지를
// sort_order 순서대로 좌우 스와이프 배너 캐러셀로 보여준다(사랑받는 이유와
// 완전히 동일한 크기/구조). 등록 전이면 시안형 안내 배너 1장을 임시 표시.
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

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">모집방식 &amp; 진행방식 📋</h2>
        <button className="text-[12px] font-bold text-[#9a9a9a]" onClick={() => navigate('/event-info')} type="button">
          행사 소개 보기 ›
        </button>
      </div>
      {contents && contents.length > 0 ? (
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
      ) : (
        <div
          className="relative -mr-5 overflow-hidden rounded-[16px] bg-[#efe7da] shadow-card"
          style={{ aspectRatio: HOME_BANNER_ASPECT }}
        >
          <span className="pointer-events-none absolute -bottom-3 right-10 text-[64px] leading-none text-[#e3dbcc]">♥</span>
          <span className="pointer-events-none absolute right-4 top-3 text-[18px]">💗</span>
          <div className="relative flex h-full flex-col justify-center p-3.5">
            <p className="text-[12px] font-black italic">
              <span className="text-meet-pink">time</span>
              <span className="text-black">2</span>
              <span className="text-meet-blue">meet</span>
            </p>
            <p className="mt-1 text-[20px] font-black leading-tight text-[#1c1c1e]">모집방식 &amp; 진행방식</p>
            <p className="mt-1 text-[10.5px] font-bold leading-[1.5] text-[#8a8a8a]">
              {contents ? '콘텐츠 준비 중입니다' : '처음이라도, 어렵지 않아요!'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
