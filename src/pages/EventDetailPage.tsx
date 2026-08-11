import { Link, useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import LogoMark from '../components/LogoMark';
import useOperationalData from '../hooks/useOperationalData';

export default function EventDetailPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { error, events, loading, participants, reload } = useOperationalData({ eventId });
  const event = events.find((item) => item.id === eventId);
  const maleParticipants = participants.filter((participant) => participant.gender === 'male');
  const femaleParticipants = participants.filter((participant) => participant.gender === 'female');

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-2 py-12 text-black">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-6rem)] flex-col justify-center">
        <section className="relative rounded-[30px] border border-[#f0f3f6] bg-white px-2.5 pb-6 pt-16 shadow-calendar">
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <div className="text-center">
            <h1 className="text-fluid-safe text-[25px] font-black leading-tight tracking-normal">
              타임투밋 로테이션소개팅
            </h1>
            <p className="mt-4 rounded-[18px] bg-meet-blueSoft px-2 py-3 text-[15px] font-black leading-snug">
              {event ? `${formatShortKoreanDate(event.date)} ${event.startTime} 체험단 소개팅` : '행사 정보를 불러올 수 없습니다'}
            </p>
          </div>

          <div className="mt-5 rounded-[26px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            {event ? (
              <div className="grid grid-cols-2 gap-1.5">
                <ParticipantList
                  participants={maleParticipants}
                  title="남"
                />
                <ParticipantList
                  participants={femaleParticipants}
                  title="여"
                />
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-[18px] font-black">행사를 찾을 수 없습니다</div>
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
