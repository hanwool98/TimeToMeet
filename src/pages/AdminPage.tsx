import { useNavigate } from 'react-router-dom';
import useSharedAdminData from '../hooks/useSharedAdminData';
import type { EventData } from '../types/event';
import { getEventGenderCounts, getEventsWithParticipantCounts, loadApplications } from '../utils/adminApplications';

const adminActions = ['행사모드', '회원·신고 관리', '콘텐츠 관리'];

export default function AdminPage() {
  const navigate = useNavigate();
  useSharedAdminData();
  const events = getEventsWithParticipantCounts();
  const upcomingEvents = events
    .filter((event) => {
      const daysUntil = getDaysUntilEvent(event.date);
      return daysUntil >= 0 && daysUntil <= 14;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const showPreparing = () => {
    window.alert('준비중!');
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-3 pt-2">
        <header className="mb-1 flex items-center gap-1">
          <img alt="time2meet" className="h-auto w-[150px] object-contain" src="/assets/time2meet-logo.png" />
          <span className="translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <section className="rounded-[30px] border border-[#f0f3f6] bg-white px-5 py-6 shadow-calendar">
          <div className="overflow-x-auto rounded-[28px] bg-meet-blueSoft p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <div className="flex snap-x snap-mandatory gap-3">
              {upcomingEvents.map((event) => (
                <DashboardEventCard event={event} key={event.id} />
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-3.5">
            <button
              className="h-[68px] w-full rounded-[22px] border border-[#f0f3f6] bg-white text-[19px] font-black text-black shadow-calendar transition active:scale-[0.99]"
              onClick={() => navigate('/admin/events')}
              type="button"
            >
              행사 관리
            </button>
            <button
              className="h-[68px] w-full rounded-[22px] border border-[#f0f3f6] bg-white text-[19px] font-black text-black shadow-calendar transition active:scale-[0.99]"
              onClick={() => navigate('/admin/applications')}
              type="button"
            >
              참가신청 관리
            </button>
            {adminActions.map((label) => (
              <button
                className="h-[68px] w-full rounded-[22px] border border-[#f0f3f6] bg-white text-[19px] font-black text-black shadow-calendar transition active:scale-[0.99]"
                key={label}
                onClick={showPreparing}
                type="button"
              >
                {label}
              </button>
            ))}
            <button
              className="h-[68px] w-full rounded-[22px] bg-meet-blue text-[19px] font-black text-white shadow-calendar transition active:scale-[0.99]"
              onClick={() => navigate('/')}
              type="button"
            >
              관리자페이지 나가기
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function DashboardEventCard({ event }: { event: EventData }) {
  const counts = getEventGenderCounts(event.id);
  const applications = loadApplications().filter((application) => application.eventDate === '8월 16일' && application.eventType === event.shortName);
  const reviewCount = applications.filter((application) => application.status === '심사 대기').length;
  const waitingCount = applications.filter((application) => application.status === '참여 보류').length;
  const paymentCount = applications.filter((application) => application.status === '결제 대기').length;

  return (
    <div className="w-full min-w-full snap-center rounded-[24px] border border-[#f0f3f6] bg-white px-5 py-6 shadow-calendar">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[22px] font-black leading-none">다가오는 행사</h1>
        <p className="text-[18px] font-black italic leading-none text-meet-blue">D-{getDaysUntilEvent(event.date)}</p>
      </div>
      <div className="mt-6 flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[16px] font-extrabold leading-snug">
          타임투밋 로테이션 소개팅 {formatShortDate(event.date)} {event.startTime}
        </p>
        <span
          aria-label={event.venueBooked ? '대관 완료' : '대관 미완료'}
          className={['mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full', event.venueBooked ? 'bg-green-500' : 'bg-red-500'].join(' ')}
        />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 text-[15px] font-black leading-none">
        <p>남성&nbsp; {counts.male}/10</p>
        <p>여성&nbsp; {counts.female}/10</p>
      </div>
      <p className="mt-6 break-keep text-[15px] font-extrabold leading-snug text-[#555]">
        심사 대기 {reviewCount} · 대기자 리스트 {waitingCount} · 결제 대기 {paymentCount}
      </p>
    </div>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date(2026, 7, 7);
  const eventDate = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((eventDate.getTime() - today.getTime()) / 86_400_000);
}

function formatShortDate(dateValue: string) {
  const [, month, day] = dateValue.split('-');
  return `${month}.${day}`;
}
