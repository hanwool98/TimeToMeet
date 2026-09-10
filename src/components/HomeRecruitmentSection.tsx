import { HOME_BANNER_ASPECT } from './HomeCarousel';

// 실제 이미지 콘텐츠는 다음 요청에서 전달 예정(2차 작업 합의). 그때까지는
// 레퍼런스 시안과 같은 가로 배너 비율의 임시 안내 카드 1장만 둔다. 이미지가
// 등록되면 HomeReasonSection처럼 home_contents(recruitment_application)
// 캐러셀로 교체한다.
export default function HomeRecruitmentSection() {
  return (
    <section>
      <h2 className="mb-2.5 text-[16px] font-black text-black">모집방식 &amp; 신청방식 💧</h2>
      <div
        className="relative -mr-5 overflow-hidden rounded-[16px] bg-[#efe7da] shadow-[0_8px_22px_rgba(30,43,63,0.08)]"
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
          <p className="mt-1 text-[20px] font-black leading-tight text-[#1c1c1e]">모집방식 &amp; 신청방식</p>
          <p className="mt-1 text-[10.5px] font-bold leading-[1.5] text-[#8a8a8a]">
            처음이라도, 어렵지 않아요!
            <br />
            지금 바로 확인해보세요.
          </p>
        </div>
      </div>
    </section>
  );
}
