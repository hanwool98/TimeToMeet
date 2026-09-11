import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { ReviewCard, ReviewModal } from '../components/HomeReviewsSection';
import LogoMark from '../components/LogoMark';
import { fetchPublicHomeReviews, type PublicHomeReview } from '../services/supabaseApplications';

// 메인페이지 "참가자 후기 › 더보기" 진입 화면. 관리자가 홈 노출로 고른
// 후기(get_public_home_reviews, 즉 home_featured=true)를 전부 스크롤
// 목록으로 보여준다 - 카드/모달은 HomeReviewsSection과 동일 컴포넌트를
// 재사용해 스타일을 이원화하지 않는다. 정렬도 홈 캐러셀과 동일하게 서버가
// 내려주는 순서(관리자 지정 순서 → 최신순)를 그대로 따른다.
export default function AllReviewsPage() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<PublicHomeReview[] | null>(null);
  const [openReview, setOpenReview] = useState<PublicHomeReview | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeReviews().then((rows) => {
      if (active) setReviews(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 py-10 with-bottom-tabs text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <header className="flex items-center justify-between">
          <button aria-label="뒤로 가기" className="grid h-11 w-11 place-items-center text-black" onClick={() => navigate(-1)} type="button">
            <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
              <path d="M18 12L7 23L18 34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
              <path
                d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="6"
              />
            </svg>
          </button>
          <LogoMark className="h-14 w-14 rounded-full" />
        </header>

        <h1 className="mt-6 text-[24px] font-black leading-tight">참가자 후기 🌸</h1>

        <div className="mt-6">
          {!reviews ? null : reviews.length === 0 ? (
            <p className="py-14 text-center text-[14px] font-bold text-[#9a9a9a]">아직 등록된 후기가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {reviews.map((review) => (
                <li key={review.id}>
                  <ReviewCard onOpen={() => setOpenReview(review)} review={review} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {openReview ? <ReviewModal onClose={() => setOpenReview(null)} review={openReview} /> : null}
      <BottomTabs />
    </main>
  );
}
