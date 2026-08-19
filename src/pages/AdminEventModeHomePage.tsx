import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import { fetchAdminEventModeSummaries, subscribeToAdminEventModeChanges, type AdminEventModeSummary } from '../services/supabaseApplications';

const KOREA_TIME_ZONE = 'Asia/Seoul';

export default function AdminEventModeHomePage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<AdminEventModeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEvents(await fetchAdminEventModeSummaries());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '행사모드 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const safeLoad = async () => {
      if (active) await load();
    };

    void safeLoad();
    const unsubscribe = subscribeToAdminEventModeChanges(() => void safeLoad());
    const intervalId = window.setInterval(() => void safeLoad(), 30_000);
    const handleRefresh = () => void safeLoad();
    window.addEventListener('online', handleRefresh);
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', handleRefresh);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, [load]);

  const groupedEvents = useMemo(() => {
    const upcoming = events
      .filter((event) => getDDay(event.date) >= 0)
      .sort((a, b) => toEventDateTime(a).getTime() - toEventDateTime(b).getTime());

    return {
      today: upcoming.filter((event) => getDDay(event.date) === 0),
      future: upcoming.filter((event) => getDDay(event.date) > 0),
    };
  }, [events]);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-[#fffaf4] text-[#1f292d]">
      <div className="mx-auto min-h-screen w-full max-w-[430px] px-6 pb-[calc(32px+env(safe-area-inset-bottom))] pt-[calc(18px+env(safe-area-inset-top))]">
        <header>
          <img alt="time2meet" className="h-auto w-[150px] max-w-[56%] object-contain" src="/assets/time2meet-logo.png" />
          <h1 className="mt-12 text-[42px] font-black leading-none tracking-normal">행사 모드</h1>
          <p className="mt-4 text-[20px] font-bold leading-none text-[#555]">진행할 행사를 선택해주세요</p>
        </header>

        <section className="mt-9 space-y-5">
          {groupedEvents.today.length > 0 ? (
            groupedEvents.today.map((event) => (
              <TodayEventCard key={event.id} event={event} onPrepare={() => navigate(`/admin/events/${event.id}/prepare`)} />
            ))
          ) : (
            <div className="rounded-[24px] border border-[#f2d8d1] bg-white px-5 py-8 text-center shadow-calendar">
              <p className="text-[18px] font-black text-[#777]">오늘 진행할 행사가 없습니다</p>
            </div>
          )}
        </section>

        <section className="mt-9">
          <h2 className="text-[26px] font-black leading-none">진행 예정 행사</h2>
          <div className="mt-5 space-y-4">
            {groupedEvents.future.length > 0 ? (
              groupedEvents.future.map((event) => (
                <UpcomingEventCard key={event.id} event={event} onClick={() => navigate(`/admin/events/${event.id}/prepare`)} />
              ))
            ) : (
              <div className="rounded-[22px] border border-[#ececec] bg-white px-5 py-7 text-center shadow-sm">
                <p className="text-[16px] font-black text-[#888]">진행 예정 행사가 없습니다</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function TodayEventCard({ event, onPrepare }: { event: AdminEventModeSummary; onPrepare: () => void }) {
  return (
    <article className="rounded-[24px] border border-[#ef554a] bg-[#fff6f1] px-5 py-5 shadow-[0_16px_34px_rgba(226,75,64,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[12px] bg-[#ef554a] px-4 py-2 text-[17px] font-black text-white">오늘 진행</span>
          {event.isTestEvent ? (
            <span className="rounded-[12px] border border-[#ef554a]/40 bg-white px-3 py-2 text-[13px] font-black text-[#ef554a]">🧪 TEST</span>
          ) : null}
        </div>
        <span className="rounded-[12px] border border-[#ef554a] bg-white px-4 py-2 text-[17px] font-black text-[#ef554a]">D-DAY</span>
      </div>

      <h2 className="mt-6 text-fluid-safe text-[35px] font-black leading-tight">{event.title}</h2>

      <dl className="mt-5 space-y-3 text-[20px] font-bold leading-none">
        <InfoLine icon={<CalendarIcon />} text={formatFullDate(event.date)} />
        <InfoLine icon={<ClockIcon />} text={`${event.startTime}-${event.endTime}`} />
        <InfoLine icon={<PinIcon />} text={event.location} />
      </dl>

      <div className="my-6 h-px bg-[#ef554a]/20" />

      <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <UsersIcon className="h-10 w-10 shrink-0 text-[#ef554a]" />
          <div className="min-w-0 text-[18px] font-black leading-snug">
            <p>참가 확정 <span className="text-[#ef554a]">{event.confirmedCount}</span>명</p>
            <p className="text-[14px] font-extrabold text-[#a35850]">(남 {event.maleConfirmedCount} / 여 {event.femaleConfirmedCount})</p>
            <p>체크인 <span className="text-[#ef554a]">{event.checkinCount}</span>명</p>
          </div>
        </div>
        <div className="h-full min-h-[54px] w-px bg-[#ef554a]/20" />
        <div className="flex min-w-0 items-center gap-3">
          <TabletIcon className="h-10 w-10 shrink-0 text-[#ef554a]" />
          <div className="min-w-0 text-[18px] font-black leading-snug">
            <p>태블릿</p>
            <p><span className="text-[#ef554a]">{event.tabletCount}/{event.requiredTablets}</span> 연결</p>
          </div>
        </div>
      </div>

      <button
        className="mt-7 flex h-16 w-full items-center justify-center gap-3 rounded-[14px] bg-[#ef4039] text-[22px] font-black text-white shadow-sm transition active:scale-[0.99]"
        onClick={onPrepare}
        type="button"
      >
        <CalendarIcon className="h-8 w-8 text-white" />
        행사 준비하기
      </button>
    </article>
  );
}

function UpcomingEventCard({ event, onClick }: { event: AdminEventModeSummary; onClick: () => void }) {
  return (
    <button
      className="grid w-full grid-cols-[82px_minmax(0,1fr)_28px] items-center gap-4 rounded-[18px] border border-[#eadbd5] bg-white px-4 py-4 text-left shadow-sm transition active:scale-[0.99]"
      onClick={onClick}
      type="button"
    >
      <span className="grid h-[68px] w-[68px] place-items-center rounded-[10px] border border-[#ffd0c7] bg-[#fff8f5] text-[21px] font-black text-[#ef554a]">
        {formatDDayLabel(event.date)}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="block truncate text-[22px] font-black leading-tight text-[#1f292d]">{event.title}</span>
          {event.isTestEvent ? <span className="shrink-0 text-[13px] font-black text-[#ef554a]">🧪</span> : null}
        </span>
        <span className="mt-2 flex min-w-0 items-center gap-2 text-[16px] font-bold text-[#666]">
          <CalendarIcon className="h-5 w-5 shrink-0 text-[#777]" />
          <span className="min-w-0 truncate">{formatFullDate(event.date)} · {event.startTime}</span>
        </span>
        <span className="mt-2 flex items-center gap-2 text-[16px] font-bold text-[#666]">
          <UsersIcon className="h-5 w-5 shrink-0 text-[#777]" />
          <span>참가 확정 <strong className="text-[#ef554a]">{event.confirmedCount}</strong>명</span>
        </span>
      </span>
      <ChevronRight className="h-8 w-8 text-[#606060]" />
    </button>
  );
}

function InfoLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="shrink-0 text-[#ef554a]">{icon}</span>
      <span className="min-w-0 text-fluid-safe">{text}</span>
    </div>
  );
}

function getKoreaTodayKey() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getDDay(dateValue: string) {
  const today = new Date(`${getKoreaTodayKey()}T00:00:00+09:00`).getTime();
  const eventDate = new Date(`${dateValue}T00:00:00+09:00`).getTime();
  return Math.round((eventDate - today) / 86_400_000);
}

function formatDDayLabel(dateValue: string) {
  const dday = getDDay(dateValue);
  if (dday === 0) return 'D-DAY';
  return `D-${dday}`;
}

function toEventDateTime(event: AdminEventModeSummary) {
  return new Date(`${event.date}T${event.startTime}:00+09:00`);
}

function formatFullDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+09:00`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')} (${dayNames[date.getDay()]})`;
}

function CalendarIcon({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 32 32">
      <rect height="22" rx="4" stroke="currentColor" strokeWidth="2.3" width="23" x="4.5" y="6.5" />
      <path d="M10 4v6M22 4v6M5 13h22" stroke="currentColor" strokeLinecap="round" strokeWidth="2.3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="2.3" />
      <path d="M16 9.5v7l5 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 32 32">
      <path d="M25 13.8c0 7-9 14-9 14s-9-7-9-14a9 9 0 1 1 18 0Z" stroke="currentColor" strokeWidth="2.3" />
      <circle cx="16" cy="13.8" r="3.2" stroke="currentColor" strokeWidth="2.3" />
    </svg>
  );
}

function UsersIcon({ className = 'h-8 w-8 text-current' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 32 32">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2.3" />
      <circle cx="22" cy="13" r="3" stroke="currentColor" strokeWidth="2.3" />
      <path d="M4 26c1.5-5 4.2-7 8-7s6.5 2 8 7M20 20c3 0 5.5 1.8 7 5" stroke="currentColor" strokeLinecap="round" strokeWidth="2.3" />
    </svg>
  );
}

function TabletIcon({ className = 'h-8 w-8 text-current' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 32 32">
      <rect height="24" rx="3" stroke="currentColor" strokeWidth="2.3" width="16" x="8" y="4" />
      <path d="M15 24.5h2" stroke="currentColor" strokeLinecap="round" strokeWidth="2.3" />
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
