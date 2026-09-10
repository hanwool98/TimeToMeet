// 실제 후기 API 연동 없이 임시 데이터로 구현 - 홈에 노출할 후기를 고르는
// 기능은 다음 요청("후기 홈 노출 관리")에서 진행.
const previewReviews = [
  { heartColor: '#f5709a', tone: 'pk', quote: '생각보다 정말 자연스러웠어요!', text: '처음엔 긴장했는데, 10분씩 대화하다 보니 편하게 이야기할 수 있었어요.' },
  { heartColor: '#6db2ef', tone: 'bl', quote: '새로운 만남이 즐거운 경험이었어요', text: '대화 주제가 있어서 어색하지 않았고, 운영도 매끄러웠어요.' },
];

export default function HomeReviewsSection() {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">참가자 후기 🌸</h2>
        <span className="text-[12px] font-bold text-[#9a9a9a]">더보기 ›</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {previewReviews.map((review) => (
          <div className="rounded-[14px] bg-white p-3 shadow-[0_5px_14px_rgba(30,43,63,0.07)] ring-1 ring-[#f0f1f3]" key={review.quote}>
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-full"
              style={{ backgroundColor: review.tone === 'pk' ? '#ffe3ec' : '#e5f1fb' }}
            >
              <svg fill={review.heartColor} height="12" viewBox="0 0 24 24" width="12">
                <path d="M12 21s-7.5-4.7-10.2-9.1C.4 9.4 1.4 6 4.6 5c2.1-.6 4 .3 5.4 2.1C11.4 5.3 13.3 4.4 15.4 5c3.2 1 4.2 4.4 2.8 6.9C20.3 16.3 12 21 12 21z" />
              </svg>
            </span>
            <p className="mt-2 text-[11.5px] font-black leading-snug text-black">“{review.quote}”</p>
            <p className="mt-1 text-[9.5px] font-bold leading-relaxed text-[#8a8a8a]">{review.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
