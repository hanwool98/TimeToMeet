import HomeCarousel, { HOME_MAIN_CARD_HEIGHT_CLASS } from './HomeCarousel';

// 관리자/DB 연동 없이 임시 이미지 배열로 구현(이번 1차 작업 범위) - 실제
// 콘텐츠 관리 기능은 다음 요청에서 진행.
const reasonSlides = Array.from({ length: 8 }, (_, index) => `/assets/home/reason-${index + 1}.svg`);

export default function HomeReasonSection() {
  return (
    <section>
      <h2 className="mb-3 text-[19px] font-black text-black">타임투밋이 사랑받는 이유 ♥</h2>
      <HomeCarousel
        ariaLabel="타임투밋이 사랑받는 이유"
        dotStyle="windowed"
        getKey={(src) => src}
        items={reasonSlides}
        renderItem={(src, index) => (
          <div
            className={`w-full overflow-hidden rounded-[22px] shadow-[0_10px_30px_rgba(30,43,63,0.08)] ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
          >
            <img
              alt={`타임투밋이 사랑받는 이유 ${index + 1}`}
              className="h-full w-full object-cover"
              loading="lazy"
              src={src}
            />
          </div>
        )}
      />
    </section>
  );
}
