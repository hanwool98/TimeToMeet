import HomeCarousel from './HomeCarousel';
import ParticipantPhoto from './ParticipantPhoto';
import { homeContentAspectRatio, type PublicHomeContent } from '../services/supabaseApplications';

// 행사 신청 화면(EventDetailPage)에서 참가자 리스트가 아직 공개되지 않은
// "행사 시작 72시간 이전" 구간에 그 자리를 대신 채우는 후기 콘텐츠.
//
// 예전에는 <img>를 원본 비율 그대로(가로폭만 맞추고 세로는 auto) 보여줬는데,
// 후기 이미지가 세로로 매우 긴 경우가 많아 하단 신청 버튼이 화면 밖으로
// 밀려나는 문제가 있었다(요청 사항) - 이제는 관리자 콘텐츠 관리에서 지정한
// 고정 비율(homeContentAspectRatio('event_application_reviews')) 박스 안에,
// 관리자가 크롭 편집기로 잡아둔 확대/위치(cropPosition) 그대로 보여준다.
// 크롭 렌더링 자체는 참가자 대표사진과 완전히 같은 방식(ParticipantPhoto)을
// 그대로 재사용해, 새로운 이미지 표시 로직을 따로 만들지 않는다.
//
// 여러 장일 때는 홈 카드 섹션들과 동일하게 HomeCarousel(네이티브 스크롤
// 스냅)로 자동 슬라이드되고(기본 간격 그대로 재사용 - HomeCarousel의
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
        <ParticipantPhoto
          className="w-full rounded-[14px] bg-[#f1f3f5]"
          crop={content.cropPosition}
          loading={index === 0 ? 'eager' : 'lazy'}
          photoUrl={content.imageUrl}
          style={{ aspectRatio: homeContentAspectRatio('event_application_reviews') }}
        />
      )}
      slideClassName="w-full"
      trackClassName="items-start"
    />
  );
}
