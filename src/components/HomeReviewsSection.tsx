import { useEffect, useRef, useState } from 'react';
import HomeCarousel from './HomeCarousel';
import { fetchPublicHomeReviews, type PublicHomeReview } from '../services/supabaseApplications';

// 관리자 "홈 콘텐츠 관리 > 참가자 후기"에서 고른 후기만 좌우 스와이프로
// 보여준다. 카드에는 별점 · 성별 · 나이 · 후기 내용(고정 줄 수, 넘치면 말줄임
// + 전체보기 모달). 고른 후기가 없으면 섹션 자체를 비운다.
const REVIEW_CARD_HEIGHT = 'h-[168px]';

export default function HomeReviewsSection() {
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

  if (!reviews || reviews.length === 0) return null;

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">참가자 후기 🌸</h2>
        <span className="text-[12px] font-bold text-[#9a9a9a]">더보기 ›</span>
      </div>
      <HomeCarousel
        ariaLabel="참가자 후기"
        dotStyle="windowed"
        getKey={(review) => review.id}
        items={reviews}
        slideClassName="w-[74vw] max-w-[300px]"
        trackClassName="-mr-5 pr-5"
        renderItem={(review) => <ReviewCard onOpen={() => setOpenReview(review)} review={review} />}
      />
      {openReview ? <ReviewModal onClose={() => setOpenReview(null)} review={openReview} /> : null}
    </section>
  );
}

function ReviewCard({ onOpen, review }: { onOpen: () => void; review: PublicHomeReview }) {
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;
    const check = () => setTruncated(element.scrollHeight - element.clientHeight > 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [review.content]);

  return (
    <div
      className={`flex ${REVIEW_CARD_HEIGHT} w-full flex-col rounded-[16px] bg-white p-4 shadow-[0_6px_16px_rgba(30,43,63,0.08)] ring-1 ring-[#f0f1f3]`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-black text-meet-pink">{formatWho(review)}</p>
        <StarRow className="text-[13px]" rating={review.rating} />
      </div>
      <p
        className="mt-2 line-clamp-4 whitespace-pre-line text-[12.5px] font-bold leading-relaxed text-[#333]"
        ref={contentRef}
      >
        {review.content}
      </p>
      {truncated ? (
        <button className="mt-auto self-end pt-1 text-[11px] font-black text-meet-blue active:scale-95" onClick={onOpen} type="button">
          전체보기
        </button>
      ) : null}
    </div>
  );
}

function ReviewModal({ onClose, review }: { onClose: () => void; review: PublicHomeReview }) {
  useEffect(() => {
    const scrollY = window.scrollY;
    const { body } = document;
    const previous = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-5" onClick={onClose} role="presentation">
      <div
        className="relative flex max-h-[72vh] w-full max-w-[340px] flex-col rounded-[20px] bg-white p-5 shadow-calendar"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="후기 닫기"
          className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full text-[#9aa0a6] active:scale-90"
          onClick={onClose}
          type="button"
        >
          <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
          </svg>
        </button>
        <div className="shrink-0 pr-7">
          <StarRow className="text-[15px]" rating={review.rating} />
          <p className="mt-1.5 text-[12px] font-black text-meet-pink">{formatWho(review)}</p>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <p className="whitespace-pre-line text-[13.5px] font-bold leading-relaxed text-[#333]">{review.content}</p>
        </div>
      </div>
    </div>
  );
}

function StarRow({ className = '', rating }: { className?: string; rating: number }) {
  return (
    <span aria-label={`별점 ${rating}점`} className={`flex shrink-0 items-center gap-px leading-none ${className}`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span aria-hidden="true" className={star <= rating ? 'text-meet-pink' : 'text-[#e2e2e2]'} key={star}>
          ★
        </span>
      ))}
    </span>
  );
}

function formatWho(review: PublicHomeReview) {
  const parts: string[] = [];
  if (review.gender) parts.push(review.gender);
  if (review.age != null) parts.push(`${review.age}세`);
  return parts.join(' · ') || '참가자';
}
