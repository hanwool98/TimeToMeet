import { useEffect, useState } from 'react';
import HomeCarousel from './HomeCarousel';
import { fetchPublicHomeReviews, type PublicHomeReview } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 참가자 후기"에서 직접 고른 후기만 좌우 스와이프로
// 보여준다. 카드에는 성별 · 나이 · 후기 내용만 노출(닉네임/사진/행사명 없음).
// 고른 후기가 없으면 섹션 자체를 비운다(요청: "후기칸은 비워두고").
export default function HomeReviewsSection() {
  const [reviews, setReviews] = useState<PublicHomeReview[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeReviews().then((rows) => {
      if (active) setReviews(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!reviews || reviews.length === 0) return null;

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">참가자 후기 🌸</h2>
        <span className="text-[12px] font-bold text-[#9a9a9a]">더보기 ›</span>
      </div>
      <HomeCarousel
        ariaLabel="참가자 후기"
        getKey={(review) => review.id}
        items={reviews}
        slideClassName="w-[72vw] max-w-[300px]"
        trackClassName="-mr-5 pr-5"
        renderItem={(review) => (
          <div className="h-full rounded-[16px] bg-white p-4 shadow-[0_6px_16px_rgba(30,43,63,0.08)] ring-1 ring-[#f0f1f3]">
            <p className="text-[11px] font-black text-meet-pink">{formatWho(review)}</p>
            <p className="mt-2 whitespace-pre-line text-[12.5px] font-bold leading-relaxed text-[#333]">{review.content}</p>
          </div>
        )}
      />
    </section>
  );
}

function formatWho(review: PublicHomeReview) {
  const parts: string[] = [];
  if (review.gender) parts.push(review.gender);
  if (review.age != null) parts.push(`${review.age}세`);
  return parts.join(' · ') || '참가자';
}
