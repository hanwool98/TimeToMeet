// 관리자/DB 연동 없이 임시 이미지 데이터로만 구현(이번 1차 작업 범위) -
// 실제 콘텐츠 관리 기능은 다음 요청에서 진행.
const fieldSketches = [
  { alt: '#편안한 분위기', src: '/assets/home/sketch-1.svg' },
  { alt: '#자연스러운 대화', src: '/assets/home/sketch-2.svg' },
  { alt: '#태블릿으로 더 쉽게', src: '/assets/home/sketch-3.svg' },
];

export default function HomeFieldSketchSection() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[19px] font-black text-black">현장 스케치 💧</h2>
        <span className="text-[13px] font-bold text-[#9a9a9a]">더보기 ›</span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {fieldSketches.map((sketch) => (
          <div className="overflow-hidden rounded-[16px] shadow-[0_6px_16px_rgba(30,43,63,0.08)]" key={sketch.src}>
            <img alt={sketch.alt} className="aspect-[3/4] w-full object-cover" loading="lazy" src={sketch.src} />
            <p className="truncate bg-white px-1.5 py-1.5 text-center text-[11px] font-black text-[#666]">
              {sketch.alt}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
