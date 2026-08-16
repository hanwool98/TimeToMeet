import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import useOperationalData from '../hooks/useOperationalData';
import { clearAdminSession } from '../services/adminAuth';
import type { EventData } from '../types/event';
import type { StoredApplication } from '../utils/adminApplications';

export default function AdminPage() {
  const navigate = useNavigate();
  const { applications, error, events, loading, reload } = useOperationalData({ admin: true });
  const upcomingEvents = events
    .filter((event) => {
      const daysUntil = getDaysUntilEvent(event.date);
      return daysUntil >= 0 && daysUntil <= 14;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const primaryEvent = upcomingEvents[0];

  const reviewCount = applications.filter((application) => application.status === '심사 대기').length;
  const waitingCount = applications.filter((application) => application.status === '참여 보류').length;
  const paymentCount = applications.filter((application) => application.status === '결제 대기' || application.status === '결제중' || application.status === '입금 확인 중').length;

  const showPreparing = () => {
    window.alert('준비중!');
  };

  const leaveAdmin = () => {
    clearAdminSession();
    navigate('/');
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-8 pt-4 min-[390px]:px-5">
        <header className="flex max-w-full min-w-0 items-center justify-between gap-3">
          <div className="flex max-w-full min-w-0 items-center gap-2 overflow-hidden">
            <img alt="time2meet" className="h-auto w-[150px] max-w-[68%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
            <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
          </div>
          <button
            aria-label="관리자페이지 나가기"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-[#5f6670] transition active:scale-[0.96]"
            onClick={leaveAdmin}
            type="button"
          >
            <Icon name="logout" />
          </button>
        </header>

        {primaryEvent ? (
          <DashboardEventCard applications={applications} event={primaryEvent} onClick={() => navigate(`/admin/events/${primaryEvent.id}`)} />
        ) : (
          <section className="mt-8 rounded-[28px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
            <p className="text-[18px] font-black text-[#777]">다가오는 행사가 없습니다</p>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-[22px] font-black">처리할 일</h2>
          <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
            <TaskCard count={reviewCount} icon={<Icon name="clipboard" />} label="심사 대기" onClick={() => navigate('/admin/applications')} />
            <TaskCard count={waitingCount} icon={<Icon name="users" />} label="참여대기" onClick={() => navigate('/admin/applications')} />
            <TaskCard count={paymentCount} icon={<Icon name="card" />} label="결제대기" onClick={() => navigate('/admin/applications')} />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[22px] font-black">관리 메뉴</h2>
          <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
            <MenuCard icon={<Icon name="calendar" />} label="행사 관리" onClick={() => navigate('/admin/events')} />
            <MenuCard icon={<Icon name="file" />} label="참가신청 관리" onClick={() => navigate('/admin/applications')} />
            <MenuCard
              active
              icon={<Icon name="radio" />}
              label="행사 모드"
              onClick={() => navigate('/admin/event-mode')}
            />
            <MenuCard icon={<Icon name="user" />} label="회원 관리" onClick={showPreparing} />
            <MenuCard icon={<Icon name="shield" />} label="신고 관리" onClick={showPreparing} />
            <MenuCard icon={<Icon name="video" />} label="콘텐츠 관리" onClick={showPreparing} />
          </div>
          <button
            className="mt-5 h-14 w-full rounded-[18px] border border-[#dce8f4] bg-white text-[17px] font-black text-[#555] shadow-sm transition active:scale-[0.99]"
            onClick={leaveAdmin}
            type="button"
          >
            관리자페이지 나가기
          </button>
        </section>
      </div>
    </main>
  );
}

function DashboardEventCard({ applications, event, onClick }: { applications: StoredApplication[]; event: EventData; onClick: () => void }) {
  const eventApplications = applications.filter((application) => application.eventId === event.id);
  const reviewCount = eventApplications.filter((application) => application.status === '심사 대기').length;
  const waitingCount = eventApplications.filter((application) => application.status === '참여 보류').length;
  const paymentCount = eventApplications.filter((application) => application.status === '결제 대기' || application.status === '결제중' || application.status === '입금 확인 중').length;
  const maleCapacity = Math.max(1, event.maleCapacity ?? Math.ceil(event.targetParticipants / 2));
  const femaleCapacity = Math.max(1, event.femaleCapacity ?? Math.floor(event.targetParticipants / 2));
  const maleConfirmed = event.maleConfirmed ?? 0;
  const femaleConfirmed = event.femaleConfirmed ?? 0;
  const isRecruiting = maleConfirmed < maleCapacity || femaleConfirmed < femaleCapacity;

  return (
    <button
      className="mt-8 w-full max-w-full min-w-0 rounded-[28px] border border-[#eef3f7] bg-white p-6 text-left shadow-calendar transition active:scale-[0.99]"
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[19px] font-black text-meet-blue">다가오는 행사</p>
        <span className="rounded-[16px] bg-meet-blueSoft px-4 py-2 text-[18px] font-black italic text-meet-blue">{formatDDay(event.date)}</span>
      </div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_32px] items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-fluid-safe text-[28px] font-black leading-tight">{event.title}</h1>
          <p className="mt-2 text-[22px] font-black leading-none">{formatShortDate(event.date)} {formatDayName(event.date)} {event.startTime}</p>
          {isRecruiting ? (
            <span className="mt-4 inline-flex rounded-[12px] bg-meet-pinkSoft px-4 py-2 text-[16px] font-black text-meet-pink">모집 중</span>
          ) : null}
        </div>
        <ChevronRight className="h-8 w-8 text-[#9aa0a7]" />
      </div>
      <div className="mt-7 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-6">
        <GenderProgress color="blue" current={maleConfirmed} label="남성" total={maleCapacity} />
        <GenderProgress color="pink" current={femaleConfirmed} label="여성" total={femaleCapacity} />
      </div>
      <p className="mt-5 text-[13px] font-extrabold text-[#8a8a8a]">
        심사 대기 {reviewCount} · 참여대기 {waitingCount} · 결제대기 {paymentCount}
      </p>
    </button>
  );
}

function GenderProgress({ color, current, label, total }: { color: 'blue' | 'pink'; current: number; label: string; total: number }) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  return (
    <div className="min-w-0">
      <p className="text-[16px] font-black">
        {label} <span className="ml-2 text-[22px]">{current}/{total}</span>
      </p>
      <div className={['mt-3 h-2.5 w-full overflow-hidden rounded-full', color === 'blue' ? 'bg-meet-blueSoft' : 'bg-meet-pinkSoft'].join(' ')}>
        <div
          className={['h-full rounded-full transition-[width]', color === 'blue' ? 'bg-meet-blue' : 'bg-meet-pink'].join(' ')}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

function TaskCard({ count, icon, label, onClick }: { count: number; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="min-h-[112px] rounded-[18px] border border-[#eef3f7] bg-white p-4 text-left shadow-calendar transition active:scale-[0.98]"
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-2 text-meet-blue">
        {icon}
        <ChevronRight className="h-5 w-5 text-[#a7adb5]" />
      </div>
      <p className="mt-4 text-[15px] font-black text-black">{label}</p>
      <p className="mt-2 text-[28px] font-black leading-none">{count}</p>
    </button>
  );
}

function MenuCard({ active = false, icon, label, onClick }: { active?: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={[
        'flex min-h-[76px] w-full max-w-full min-w-0 items-center gap-4 rounded-[18px] border bg-white px-4 py-3 text-left shadow-calendar transition active:scale-[0.98]',
        active ? 'border-meet-blue/25 bg-meet-blueSoft/30' : 'border-[#eef3f7]',
      ].join(' ')}
      onClick={onClick}
      type="button"
    >
      <span className="shrink-0 text-meet-blue">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[16px] font-black text-black">{label}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#a7adb5]" />
    </button>
  );
}

function Icon({ name }: { name: 'calendar' | 'card' | 'clipboard' | 'file' | 'logout' | 'radio' | 'shield' | 'user' | 'users' | 'video' }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
  };

  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 32 32">
      {name === 'calendar' ? (
        <>
          <rect {...common} height="21" rx="3" width="22" x="5" y="7" />
          <path {...common} d="M10 4v6M22 4v6M5 13h22" />
        </>
      ) : null}
      {name === 'clipboard' ? (
        <>
          <path {...common} d="M11 6h10l1.5 3h3.5v19H6V9h3.5L11 6Z" />
          <path {...common} d="M11 14h10M11 19h8" />
        </>
      ) : null}
      {name === 'card' ? (
        <>
          <rect {...common} height="18" rx="3" width="24" x="4" y="8" />
          <path {...common} d="M4 14h24M9 21h5" />
        </>
      ) : null}
      {name === 'file' ? (
        <>
          <path {...common} d="M8 4h11l5 5v19H8V4Z" />
          <path {...common} d="M19 4v6h6M12 17h8M12 22h5" />
        </>
      ) : null}
      {name === 'radio' ? (
        <>
          <path {...common} d="M12 12a6 6 0 0 0 0 8M20 12a6 6 0 0 1 0 8M8 8a12 12 0 0 0 0 16M24 8a12 12 0 0 1 0 16" />
          <circle {...common} cx="16" cy="16" r="2.5" />
        </>
      ) : null}
      {name === 'user' ? (
        <>
          <circle {...common} cx="16" cy="11" r="5" />
          <path {...common} d="M7 27c1.6-5 5-8 9-8s7.4 3 9 8" />
        </>
      ) : null}
      {name === 'users' ? (
        <>
          <circle {...common} cx="12" cy="12" r="4" />
          <circle {...common} cx="22" cy="13" r="3" />
          <path {...common} d="M4 26c1.5-5 4.2-7 8-7s6.5 2 8 7M20 20c3 0 5.5 1.8 7 5" />
        </>
      ) : null}
      {name === 'shield' ? (
        <>
          <path {...common} d="M16 4 26 8v7c0 6-4 10-10 13C10 25 6 21 6 15V8l10-4Z" />
          <path {...common} d="m12 16 3 3 6-7" />
        </>
      ) : null}
      {name === 'video' ? (
        <>
          <rect {...common} height="18" rx="3" width="22" x="5" y="7" />
          <path {...common} d="m14 12 7 4-7 4v-8Z" />
        </>
      ) : null}
      {name === 'logout' ? (
        <>
          <path {...common} d="M14 6H7v20h7M18 11l5 5-5 5M11 16h12" />
        </>
      ) : null}
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" />
    </svg>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()).getTime();
  const eventDate = new Date(`${dateValue}T00:00:00`).getTime();
  return Math.ceil((eventDate - today) / 86_400_000);
}

function formatDDay(dateValue: string) {
  const days = getDaysUntilEvent(dateValue);
  if (days < 0) return '종료';
  if (days === 0) return 'D-DAY';
  return `D-${days}`;
}

function formatShortDate(dateValue: string) {
  const [, month, day] = dateValue.split('-');
  return `${month}.${day}`;
}

function formatDayName(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  const dayNames = ['(일)', '(월)', '(화)', '(수)', '(목)', '(금)', '(토)'];
  return dayNames[date.getDay()];
}
