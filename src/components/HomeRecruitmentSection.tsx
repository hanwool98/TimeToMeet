import HomeCarousel, { HOME_MAIN_CARD_HEIGHT_CLASS } from './HomeCarousel';

// 관리자/DB 연동 없이 임시 이미지 배열로 구현(이번 1차 작업 범위) - 실제
// 콘텐츠 관리 기능은 다음 요청에서 진행.
const recruitmentSlides = Array.from({ length: 10 }, (_, index) => `/assets/home/recruit-${index + 1}.svg`);

export default function HomeRecruitmentSection() {
  return (
    <section>
      <h2 className="mb-3 text-[19px] font-black text-black">모집방식 &amp; 신청방식 💧</h2>
      <HomeCarousel
        ariaLabel="모집방식 & 신청방식"
        dotStyle="windowed"
        getKey={(src) => src}
        items={recruitmentSlides}
        trackClassName="-mr-5 pr-5"
        renderItem={(src, index) => (
          <div
            className={`w-full overflow-hidden rounded-[22px] shadow-[0_10px_28px_rgba(30,43,63,0.09)] ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
          >
            <img
              alt={`모집방식 & 신청방식 ${index + 1}`}
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
