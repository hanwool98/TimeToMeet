import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeCarousel, { HOME_BANNER_ASPECT } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 타임투밋이 사랑받는 이유"에 등록된 공개 이미지를
// sort_order 순서대로 가로 배너 캐러셀로 보여준다. 등록 전이거나 조회 실패
// 시엔 레퍼런스 시안과 동일한 히어로 배너(배경 + ROTATION DATING / 타이틀
// 오버레이)를 임시로 표시한다.
const heroImage = '/assets/home/love-reason-hero.svg';

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
      {contents && contents.length > 0 ? (
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
      ) : (
        <div className="-mr-5 pr-5">
          <ReasonHeroCard loading={!contents} />
        </div>
      )}
    </section>
  );
}

function ReasonHeroCard({ loading }: { loading: boolean }) {
  return (
    <div
      className="relative w-[87vw] max-w-[372px] overflow-hidden rounded-[16px] shadow-card"
      style={{ aspectRatio: HOME_BANNER_ASPECT }}
    >
      <img alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" src={heroImage} />
      <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/15 to-transparent" />
      <div className="relative flex h-full flex-col items-start justify-between p-3">
        <img alt="time2meet" className="h-[15px] w-auto self-start object-contain" src="/assets/time2meet-logo-transparent.png" />
        <div>
          <p className="text-[8.5px] font-black uppercase tracking-[0.22em] text-white/85">Rotation Dating</p>
          <p className="mt-0.5 text-[11px] font-bold text-white/90">타임투밋 로테이션 소개팅이</p>
          <p className="text-[21px] font-black leading-tight text-white">사랑받는 이유</p>
          <span className="mt-1.5 block h-[3px] w-9 rounded-full bg-meet-pink" />
        </div>
      </div>
      {!loading ? (
        <span className="absolute bottom-3 right-3.5 text-[10px] font-black tracking-wide text-white/80">SWIPE ›</span>
      ) : null}
    </div>
  );
}
