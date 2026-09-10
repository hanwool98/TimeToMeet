import { useEffect, useState } from 'react';
import HomeCarousel, { HOME_MAIN_CARD_HEIGHT_CLASS } from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 타임투밋이 사랑받는 이유"에 등록된 공개 이미지를
// sort_order 순서대로 캐러셀로 보여준다. 아직 등록 전이거나 조회 실패 시엔
// 레퍼런스 시안과 동일한 히어로 카드(배경 이미지 + ROTATION DATING / 타이틀
// 오버레이)를 임시로 표시해 섹션이 비어 보이지 않게 한다.
const heroImage = '/assets/home/love-reason-hero.svg';

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
      <h2 className="mb-3 text-[19px] font-black text-black">
        타임투밋이 사랑받는 이유 <span className="text-meet-pink">♥</span>
      </h2>
      {contents && contents.length > 0 ? (
        <HomeCarousel
          ariaLabel="타임투밋이 사랑받는 이유"
          dotStyle="windowed"
          getKey={(content) => content.id}
          items={contents}
          trackClassName="-mr-5 pr-5"
          renderItem={(content, index) => (
            <ParticipantPhoto
              className={`w-full rounded-[22px] shadow-[0_10px_28px_rgba(30,43,63,0.09)] ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
              crop={content.cropPosition}
              fallback={<span className="text-[12px] font-bold">이미지 {index + 1}</span>}
              photoUrl={content.imageUrl}
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
      className={`relative w-[87vw] max-w-[372px] overflow-hidden rounded-[22px] shadow-[0_10px_28px_rgba(30,43,63,0.09)] ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
    >
      <img alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" src={heroImage} />
      <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/15 to-transparent" />
      <div className="relative flex h-full flex-col items-start justify-between p-4">
        <img alt="time2meet" className="h-[18px] w-auto self-start object-contain" src="/assets/time2meet-logo-transparent.png" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/85">Rotation Dating</p>
          <p className="mt-1 text-[13px] font-bold text-white/90">타임투밋 로테이션 소개팅이</p>
          <p className="text-[26px] font-black leading-tight text-white">사랑받는 이유</p>
          <span className="mt-2 block h-1 w-10 rounded-full bg-meet-pink" />
        </div>
        <span className="self-end text-[11px] font-black tracking-wide text-white/80">
          {loading ? '' : 'SWIPE ›'}
        </span>
      </div>
    </div>
  );
}
