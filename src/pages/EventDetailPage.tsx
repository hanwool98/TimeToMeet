import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import LogoMark from '../components/LogoMark';
import useOperationalData from '../hooks/useOperationalData';
import { cacheTestEventPreviewToken, getCachedTestEventPreviewToken } from '../services/supabaseApplications';
import { isParticipantListPublic, PARTICIPANT_LIST_LOCKED_NOTICE } from '../utils/participantListGate';

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
  const maleParticipants = participants.filter((participant) => participant.gender === 'male');
  const femaleParticipants = participants.filter((participant) => participant.gender === 'female');
  // 남녀 정원을 따로 저장하지 않은 아주 오래된 행사를 위한 fallback만
  // targetParticipants(총 정원)를 반으로 나눈다 - 다른 화면(TicketDetailPage,
  // AdminEventParticipantsPage)과 완전히 동일한 계산이라 여기서 새로
  // 규칙을 만들지 않았다. 이 값은 행사 규격(정원)이라 실제 확정 참가자
  // 수(3일 공개 정책 대상)와 무관하게 항상 표시해도 된다.
  const maleCapacity = event ? Math.max(1, event.maleCapacity ?? Math.ceil(event.targetParticipants / 2)) : 0;
  const femaleCapacity = event ? Math.max(1, event.femaleCapacity ?? Math.floor(event.targetParticipants / 2)) : 0;

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

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

          <div className="mt-5 rounded-[16px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            {!event ? (
              <div className="px-6 py-16 text-center text-[18px] font-black">행사를 찾을 수 없습니다</div>
            ) : isParticipantListPublic(event.date, event.startTime) ? (
              <div className="grid grid-cols-2 gap-1.5">
                <ParticipantList capacity={maleCapacity} participants={maleParticipants} title="남" />
                <ParticipantList capacity={femaleCapacity} participants={femaleParticipants} title="여" />
              </div>
            ) : (
              <p className="px-5 py-14 text-center text-[14px] font-black leading-relaxed text-[#8a94a0]">
                {PARTICIPANT_LIST_LOCKED_NOTICE}
              </p>
            )}
          </div>

          <div className="pt-5">
            <PrimaryButton onClick={() => navigate(`/events/${eventId}/info`)}>
              행사내용 확인하고 나만의 프로필 만들기
            </PrimaryButton>
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
