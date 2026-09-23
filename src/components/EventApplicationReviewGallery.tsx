import HomeCarousel from './HomeCarousel';
import type { PublicHomeContent } from '../services/supabaseApplications';

// 행사 신청 화면(EventDetailPage)에서 참가자 리스트가 아직 공개되지 않은
// "행사 시작 72시간 이전" 구간에 그 자리를 대신 채우는 후기 콘텐츠.
//
// 후기 이미지는 세로로 긴 카드가 많고 안에 글자가 많다(요청 사항) - 그래서
// ParticipantPhoto(고정 비율로 crop해서 채우는 렌더러)를 쓰지 않고, 그냥
// <img>를 원본 비율 그대로(가로폭만 맞추고 세로는 auto) 보여준다. 여러 장일
// 때는 홈 카드 섹션들과 동일하게 HomeCarousel(네이티브 스크롤 스냅)로 자동
// 슬라이드되고(기본 간격 그대로 재사용 - HomeCarousel의
// DEFAULT_AUTOPLAY_MS), 손가락으로 건드리면 잠시 멈췄다가 다시 자동으로
// 넘어간다(HomeCarousel 자체 동작, 홈과 완전히 동일).
export default function EventApplicationReviewGallery({ contents }: { contents: PublicHomeContent[] }) {
  if (contents.length === 0) return null;

  return (
    <HomeCarousel
      ariaLabel="참가 후기"
      dotStyle="windowed"
      getKey={(content) => content.id}
      items={contents}
      renderItem={(content, index) => (
        <img
          alt={content.caption || '참가 후기'}
          className="w-full rounded-[14px]"
          loading={index === 0 ? 'eager' : 'lazy'}
          src={content.imageUrl ?? undefined}
        />
      )}
      slideClassName="w-[87.5%]"
      trackClassName="items-start"
    />
  );
}
