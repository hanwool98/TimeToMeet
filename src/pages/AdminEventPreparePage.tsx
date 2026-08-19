import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  disconnectAdminEventTablet,
  fetchAdminEventModeSummaries,
  fetchAdminEventTabletStatus,
  startAdminEvent,
  subscribeToAdminEventModeChanges,
  type AdminEventModeSummary,
  type AdminEventTabletStatus,
} from '../services/supabaseApplications';

const KOREA_TIME_ZONE = 'Asia/Seoul';

export default function AdminEventPreparePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [events, setEvents] = useState<AdminEventModeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [tabletPanelOpen, setTabletPanelOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEvents(await fetchAdminEventModeSummaries());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '행사 데이터를 불러오지 못했습니다.');
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

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [load]);

  const event = events.find((item) => item.id === eventId);
  const isToday = event ? event.date === getKoreaTodayKey() : false;
  const operationsActive = Boolean(event) && (event!.isTestEvent || isToday);
  const eventStarted = Boolean(event?.startedAt);

  const handleStart = async () => {
    if (!eventId || starting) return;
    setStarting(true);
    setStartError('');
    try {
      await startAdminEvent(eventId);
      await load();
    } catch (caughtError) {
      setStartError(caughtError instanceof Error ? caughtError.message : '행사를 시작하지 못했습니다.');
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;

  if (!event) {
    return (
      <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
        <div className="mobile-container mx-auto grid min-h-screen place-items-center px-5">
          <section className="w-full rounded-[28px] border border-[#f0f3f6] bg-white px-5 py-8 text-center shadow-calendar">
            <p className="text-[18px] font-black">행사를 찾을 수 없습니다</p>
            <button
              className="mt-5 text-[14px] font-black text-[#ef554a]"
              onClick={() => navigate('/admin/event-mode')}
              type="button"
            >
              행사모드로 돌아가기
            </button>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-[#fffaf4] text-[#1f292d]">
      <div className="mx-auto min-h-screen w-full max-w-[430px] px-5 pb-[calc(32px+env(safe-area-inset-bottom))] pt-[calc(18px+env(safe-area-inset-top))]">
        <header className="flex items-center gap-3">
          <button
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#333]"
            onClick={() => navigate('/admin/event-mode')}
            type="button"
          >
            <BackIcon />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-[19px] font-black">행사 준비</h1>
          <span className="w-10 shrink-0" />
        </header>

        <section className="mt-6 rounded-[24px] border border-[#f2d8d1] bg-white px-5 py-5 shadow-calendar">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {isToday ? (
                <span className="rounded-[10px] bg-[#ef554a] px-3 py-1.5 text-[13px] font-black text-white">오늘 진행</span>
              ) : (
                <span className="rounded-[10px] border border-[#ef554a] px-3 py-1.5 text-[13px] font-black text-[#ef554a]">
                  {formatDDayLabel(event.date)}
                </span>
              )}
              {event.isTestEvent ? (
                <span className="rounded-[10px] border border-[#ef554a]/40 bg-[#fff6f1] px-3 py-1.5 text-[12px] font-black text-[#ef554a]">
                  🧪 TEST
                </span>
              ) : null}
            </div>
            <span className="shrink-0 rounded-[10px] border border-[#ddd] px-3 py-1.5 text-[12px] font-black text-[#888]">
              {eventStarted ? '행사 진행 중' : '운영 준비 중'}
            </span>
          </div>

          <h2 className="mt-4 text-fluid-safe text-[26px] font-black leading-tight">{event.title}</h2>
          <p className="mt-2 text-[15px] font-bold text-[#777]">
            {formatFullDate(event.date)} · {event.startTime}-{event.endTime}
          </p>
        </section>

        <section className="mt-5 rounded-[24px] bg-white px-5 py-5 shadow-calendar">
          <h3 className="text-[17px] font-black">준비 현황</h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <StatBlock current={event.checkinCount} label="체크인" total={event.confirmedCount} unit="명" />
            <StatBlock current={event.tabletCount} label="태블릿" total={event.requiredTablets} unit="대" />
          </div>
          <p className="mt-3 text-[13px] font-bold text-[#999]">참가자 체크인과 태블릿 연결 상태를 확인해주세요</p>
        </section>

        <section className="mt-5 space-y-3">
          <ActionRow
            active={operationsActive}
            badge="QR 체크인"
            description="도착한 참가자의 QR을 스캔해주세요"
            icon={<QrIcon />}
            onClick={() => navigate(`/admin/events/${event.id}/check-in`)}
            subtitle={`${event.checkinCount} / ${event.confirmedCount}명`}
            title="참가자 체크인"
          />
          <ActionRow
            active={operationsActive}
            badge="연결 현황"
            description={`태블릿에서 1~${event.requiredTablets}번을 선택해 연결해주세요`}
            icon={<TabletIcon />}
            onClick={() => setTabletPanelOpen(true)}
            subtitle={`${event.tabletCount} / ${event.requiredTablets}대`}
            title="테이블 태블릿 연결"
          />
        </section>

        <section className="mt-5 rounded-[20px] bg-[#fff1ee] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-[#ef554a]">
              <InfoIcon />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-black text-[#1f292d]">초기 테이블은 자동으로 정해져요</p>
              <p className="mt-1 text-[13px] font-bold text-[#a35850]">남자 1번 + 여자 1번 → 1번 테이블</p>
              <p className="mt-1 text-[12px] font-bold text-[#b98680]">참가자 목록의 남녀 순번이 같은 번호의 테이블에 표시됩니다</p>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-[17px] font-black">참가자 현황</h3>
            <Link className="text-[14px] font-black text-[#ef554a]" to={`/admin/events/${event.id}`}>
              전체보기 ›
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <GenderStatCard checkin={event.maleCheckinCount} color="#5aa7e9" label="남성" total={event.maleConfirmedCount} />
            <GenderStatCard checkin={event.femaleCheckinCount} color="#ef8fa0" label="여성" total={event.femaleConfirmedCount} />
          </div>
        </section>

        <div className="mt-7">
          {!operationsActive ? (
            <p className="mb-3 text-center text-[13px] font-bold text-[#a35850]">
              {formatMonthDayKorean(event.date)}부터 체크인 및 행사 운영 기능을 사용할 수 있어요.
            </p>
          ) : event.tabletCount < event.requiredTablets ? (
            <p className="mb-3 text-center text-[13px] font-bold text-[#a35850]">
              ⚠ 태블릿이 모두 연결되지 않았어요 ({event.tabletCount}/{event.requiredTablets})
            </p>
          ) : null}
          {startError ? <p className="mb-3 text-center text-[13px] font-bold text-[#ef554a]">{startError}</p> : null}
          <button
            className={[
              'flex h-16 w-full items-center justify-center gap-3 rounded-[14px] text-[20px] font-black text-white shadow-sm transition active:scale-[0.99]',
              eventStarted ? 'cursor-default bg-[#8fae7f]' : operationsActive ? 'bg-[#ef4039]' : 'cursor-not-allowed bg-[#e2c3bc]',
            ].join(' ')}
            disabled={!operationsActive || starting || eventStarted}
            onClick={() => void handleStart()}
            type="button"
          >
            {eventStarted ? '행사 진행 중' : starting ? '시작하는 중' : '행사 시작'}
          </button>
        </div>
      </div>

      {tabletPanelOpen ? (
        <TabletStatusPanel eventId={event.id} onClose={() => setTabletPanelOpen(false)} requiredTablets={event.requiredTablets} />
      ) : null}
    </main>
  );
}

function TabletStatusPanel({ eventId, onClose, requiredTablets }: { eventId: string; onClose: () => void; requiredTablets: number }) {
  const [status, setStatus] = useState<AdminEventTabletStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disconnectingTable, setDisconnectingTable] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setStatus(await fetchAdminEventTabletStatus(eventId));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '태블릿 연결 현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    let active = true;
    const safeLoad = async () => {
      if (active) await load();
    };
    void safeLoad();
    return () => {
      active = false;
    };
  }, [load]);

  const handleDisconnect = async (tableNumber: number) => {
    if (disconnectingTable !== null) return;
    if (!window.confirm(`${tableNumber}번 태블릿 연결을 해제할까요? 다른 기기가 다시 이 번호를 선택할 수 있게 됩니다.`)) return;
    setDisconnectingTable(tableNumber);
    try {
      await disconnectAdminEventTablet(eventId, tableNumber);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '연결을 해제하지 못했습니다.');
    } finally {
      setDisconnectingTable(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-[18px] font-black">태블릿 연결 현황</h3>
          <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        {loading ? (
          <p className="mt-6 text-center text-[14px] font-bold text-[#999]">불러오는 중</p>
        ) : error ? (
          <p className="mt-6 text-center text-[14px] font-bold text-[#ef554a]">{error}</p>
        ) : (
          <div className="mt-4 space-y-2">
            {status.map((tablet) => (
              <div
                key={tablet.tableNumber}
                className={[
                  'flex items-center justify-between rounded-[14px] border px-4 py-3',
                  tablet.connected ? 'border-[#c9e6c0] bg-[#f2fbef]' : 'border-[#f0f0f0] bg-[#fafafa]',
                ].join(' ')}
              >
                <span className="text-[15px] font-black">{tablet.tableNumber}번 테이블</span>
                <div className="flex items-center gap-2">
                  <span className={['text-[13px] font-black', tablet.connected ? 'text-[#3f9142]' : 'text-[#bbb]'].join(' ')}>
                    {tablet.connected ? '연결됨' : '미연결'}
                  </span>
                  {tablet.connected ? (
                    <button
                      className="rounded-[8px] border border-[#ef554a]/40 px-2.5 py-1 text-[12px] font-black text-[#ef554a] disabled:opacity-50"
                      disabled={disconnectingTable === tablet.tableNumber}
                      onClick={() => void handleDisconnect(tablet.tableNumber)}
                      type="button"
                    >
                      {disconnectingTable === tablet.tableNumber ? '해제 중' : '연결 해제'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-center text-[12px] font-bold text-[#aaa]">필요한 태블릿 {requiredTablets}대 기준</p>
        <Link
          className="mt-4 block text-center text-[13px] font-black text-[#ef554a] underline"
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          to={`/admin/events/${eventId}/tablet-connect`}
        >
          이 기기를 태블릿으로 연결하기
        </Link>
      </div>
    </div>
  );
}

function ActionRow({
  active,
  badge,
  description,
  icon,
  onClick,
  subtitle,
  title,
}: {
  active: boolean;
  badge: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div
      className={[
        'flex items-center gap-3 rounded-[20px] border px-4 py-4 shadow-sm',
        active ? 'border-[#f2d8d1] bg-white' : 'border-[#eee] bg-[#fafafa]',
      ].join(' ')}
    >
      <span
        className={[
          'grid h-14 w-14 shrink-0 place-items-center rounded-[14px]',
          active ? 'bg-[#fff1ee] text-[#ef554a]' : 'bg-[#f0f0f0] text-[#bbb]',
        ].join(' ')}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={['text-[16px] font-black', active ? 'text-[#1f292d]' : 'text-[#aaa]'].join(' ')}>{title}</p>
        <p className={['text-[15px] font-black', active ? 'text-[#ef554a]' : 'text-[#bbb]'].join(' ')}>{subtitle}</p>
        <p className="mt-1 truncate text-[12px] font-bold text-[#999]">{description}</p>
      </div>
      <button
        className={[
          'shrink-0 rounded-[10px] border px-3 py-2 text-[12px] font-black transition active:scale-[0.97]',
          active ? 'border-[#ef554a] text-[#ef554a]' : 'cursor-not-allowed border-[#ddd] text-[#ccc]',
        ].join(' ')}
        disabled={!active}
        onClick={onClick}
        type="button"
      >
        {badge}
      </button>
    </div>
  );
}

function StatBlock({ current, label, total, unit }: { current: number; label: string; total: number; unit: string }) {
  return (
    <div className="text-center">
      <p className="text-[13px] font-bold text-[#999]">{label}</p>
      <p className="mt-1 text-[22px] font-black">
        <span className="text-[#ef554a]">{current}</span>
        <span className="text-[#ccc]"> / {total}</span>
        <span className="ml-1 text-[14px] font-bold text-[#999]">{unit}</span>
      </p>
    </div>
  );
}

function GenderStatCard({ checkin, color, label, total }: { checkin: number; color: string; label: string; total: number }) {
  return (
    <div className="rounded-[18px] border border-[#f0f0f0] bg-white px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[14px] font-black text-[#555]">{label}</span>
      </div>
      <p className="mt-2 text-[18px] font-black">
        {checkin} / {total} <span className="text-[13px] font-bold text-[#999]">체크인</span>
      </p>
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

function formatFullDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+09:00`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')} (${dayNames[date.getDay()]})`;
}

function formatMonthDayKorean(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+09:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" fill="none" viewBox="0 0 32 32">
      <rect height="9" rx="1.5" stroke="currentColor" strokeWidth="2.2" width="9" x="4" y="4" />
      <rect height="9" rx="1.5" stroke="currentColor" strokeWidth="2.2" width="9" x="19" y="4" />
      <rect height="9" rx="1.5" stroke="currentColor" strokeWidth="2.2" width="9" x="4" y="19" />
      <path d="M20 20h3v3h-3zM26 20h2M20 26h2M26 26h2v-3" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}

function TabletIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" fill="none" viewBox="0 0 32 32">
      <rect height="24" rx="3" stroke="currentColor" strokeWidth="2.3" width="16" x="8" y="4" />
      <path d="M15 24.5h2" stroke="currentColor" strokeLinecap="round" strokeWidth="2.3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5.5M12 8v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}
