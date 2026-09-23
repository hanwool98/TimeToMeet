import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import EventApplicationReviewGallery from '../components/EventApplicationReviewGallery';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import LogoMark from '../components/LogoMark';
import useOperationalData from '../hooks/useOperationalData';
import { useParticipantListGate } from '../hooks/useParticipantListGate';
import { cacheTestEventPreviewToken, fetchPublicHomeContents, getCachedTestEventPreviewToken, logFunnelEvent, type PublicHomeContent } from '../services/supabaseApplications';

export default function EventDetailPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const previewToken = searchParams.get('previewToken') ?? getCachedTestEventPreviewToken(eventId);
  const { error, events, loading, participants, reload } = useOperationalData({ eventId, previewToken });
  const event = events.find((item) => item.id === eventId);

  useEffect(() => {
    if (eventId && event?.isTestEvent && previewToken) cacheTestEventPreviewToken(eventId, previewToken);
  }, [event?.isTestEvent, eventId, previewToken]);

  // 신청 퍼널 2단계(행사정보 확인 도달) 계측 - eventId당 1회.
  useEffect(() => {
    if (eventId) void logFunnelEvent('event_detail_view', { eventId });
  }, [eventId]);
  const maleParticipants = participants.filter((participant) => participant.gender === 'male');
  const femaleParticipants = participants.filter((participant) => participant.gender === 'female');
  // 남녀 정원을 따로 저장하지 않은 아주 오래된 행사를 위한 fallback만
  // targetParticipants(총 정원)를 반으로 나눈다 - 다른 화면(TicketDetailPage,
  // AdminEventParticipantsPage)과 완전히 동일한 계산이라 여기서 새로
  // 규칙을 만들지 않았다. 이 값은 행사 규격(정원)이라 실제 확정 참가자
  // 수(3일 공개 정책 대상)와 무관하게 항상 표시해도 된다.
  const maleCapacity = event ? Math.max(1, event.maleCapacity ?? Math.ceil(event.targetParticipants / 2)) : 0;
  const femaleCapacity = event ? Math.max(1, event.femaleCapacity ?? Math.floor(event.targetParticipants / 2)) : 0;

  // 관리자가 발급한 previewToken으로 테스트 행사를 미리 보는 경우는 서버
  // (get_public_participant_previews 등)가 이미 72시간 제한을 건너뛰고 실제
  // 데이터를 내려준다 - 화면도 같은 기준으로 "공개됨"으로 취급해야 실제
  // 참가자 리스트가 보인다(후기 콘텐츠로 가려지면 안 됨). previewToken이
  // test event가 아닌 경우까지 이 예외를 넓히지 않는다(서버도 정확히 이
  // 조건에서만 우회함).
  const previewBypass = Boolean(event?.isTestEvent) && Boolean(previewToken);
  const isParticipantListRevealed = useParticipantListGate(event?.date, event?.startTime, previewBypass);

  // 후기 콘텐츠는 "아직 공개 전"일 때만 필요하므로 그때만 가져온다 - 공개된
  // 뒤에는 두 번 다시 쓰이지 않을 데이터라 미리 받아둘 이유가 없다.
  const [reviewContents, setReviewContents] = useState<PublicHomeContent[] | null>(null);
  useEffect(() => {
    if (isParticipantListRevealed) return undefined;
    let active = true;
    void fetchPublicHomeContents('event_application_reviews').then((rows) => {
      if (active) setReviewContents(rows);
    });
    return () => {
      active = false;
    };
  }, [isParticipantListRevealed]);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  // 참가자 리스트와 후기 콘텐츠는 절대 동시에 렌더링되지 않는다 - 이 삼항이
  // 셋 중 정확히 하나만 고른다(리스트 / 후기 / 아무것도 없음). 후기가 아직
  // 로딩 중이거나(reviewContents === null) 등록된 게 하나도 없으면 이 박스
  // 자체를 렌더링하지 않아 아래 CTA 버튼이 자연스럽게 올라온다 - 옛
  // "3일부터 공개" 안내 문구를 다시 보여주지 않는다.
  const participantAreaContent = !event ? (
    <div className="rounded-[16px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
      <div className="px-6 py-16 text-center text-[18px] font-black">행사를 찾을 수 없습니다</div>
    </div>
  ) : isParticipantListRevealed ? (
    <div className="rounded-[16px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
      <div className="grid grid-cols-2 gap-1.5">
        <ParticipantList capacity={maleCapacity} participants={maleParticipants} title="남" />
        <ParticipantList capacity={femaleCapacity} participants={femaleParticipants} title="여" />
      </div>
    </div>
  ) : reviewContents && reviewContents.length > 0 ? (
    // 액자(파란 배경 박스)와 사진을 같이 줄인다 - 박스는 그대로 두고
    // 사진만 안에서 작게 넣으면 액자만 커서 빈 공간이 남는다(요청 사항).
    // 박스 자체를 87.5% 폭으로 줄이고 가운데 정렬해, 사진은 그 안을 항상
    // 꽉 채우게 한다(EventApplicationReviewGallery는 슬라이드를 100%로 채움).
    <div className="mx-auto w-[87.5%] rounded-[16px] bg-meet-blueSoft p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
      <EventApplicationReviewGallery contents={reviewContents} />
    </div>
  ) : null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-2 py-12 text-black">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-6rem)] flex-col justify-center">
        <section className="relative rounded-[24px] bg-white px-2.5 pb-6 pt-16 shadow-calendar">
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <div className="text-center">
            {/* 예전엔 "타임투밋 로테이션소개팅"으로 고정돼 있었다 - 관리자가
                실제로 지정한 행사명(event.title)이 있으면 그걸 그대로
                보여주고, 아주 오래된 데이터라 제목이 비어 있을 때만 이
                문구로 대체한다. text-fluid-safe(overflow-wrap: anywhere;
                word-break: keep-all)가 이미 있어 긴 행사명도 말줄임 없이
                자연스럽게 줄바꿈된다. */}
            <h1 className="text-fluid-safe text-[25px] font-black leading-tight tracking-normal">
              {event?.title || '타임투밋 로테이션소개팅'}
            </h1>
            <p className="mt-4 rounded-[18px] bg-meet-blueSoft px-2 py-3 text-[15px] font-black leading-snug">
              {/* "체험단 소개팅"은 과거 체험단 행사 때 남은 하드코딩 문구였다
                  - 이벤트 타입을 구분하는 실제 플래그는 없어서(이 서비스에
                  "체험단"은 그냥 행사명일 뿐, 별도 종류가 아니다) 일반
                  행사에도 그대로 붙어 있었다. 실제 참가 인원(3일 공개
                  정책 대상)이 아니라 행사 규격인 남녀 정원으로 대체한다. */}
              {event ? `${formatShortKoreanDate(event.date)} ${event.startTime} ${maleCapacity}:${femaleCapacity} 로테이션소개팅` : '행사 정보를 불러올 수 없습니다'}
            </p>
          </div>

          {participantAreaContent ? <div className="mt-5">{participantAreaContent}</div> : null}

          <div className="space-y-2.5 pt-5">
            {/* 메인 CTA: 행사소개를 거치지 않고 바로 프로필 작성으로
                이동한다(요청 사항: 광고 유입자가 최소 단계로 신청을 시작할
                수 있어야 함). */}
            <PrimaryButton onClick={() => navigate(`/events/${eventId}/apply/profile`)}>
              1분만에 프로필 작성하기
            </PrimaryButton>
            {/* 서브 CTA: 자세한 내용을 먼저 보고 싶은 사람을 위한 기존
                행사소개 페이지 - 삭제하지 않고 그대로 유지, 메인 버튼보다
                시각적 강조만 낮춘다. */}
            <button
              className="h-14 w-full rounded-[18px] bg-meet-blueSoft px-5 text-[16px] font-extrabold text-meet-blue transition active:scale-[0.99]"
              onClick={() => navigate(`/events/${eventId}/info`)}
              type="button"
            >
              행사내용 확인하고 계속하기
            </button>
          </div>
        </section>
        <Link className="mx-auto mt-5 text-sm font-extrabold text-meet-blue" to="/">
          캘린더로 돌아가기
        </Link>
      </div>
    </main>
  );
}

function formatShortKoreanDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(year, month - 1, day);
  return `${String(year).slice(2)}년 ${month}월 ${day}일 (${dayNames[date.getDay()]})`;
}
