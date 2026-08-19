import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import { getAdminSession, loginAdminSession, verifyAdminSession } from '../services/adminAuth';
import {
  connectEventTablet,
  fetchAdminEventModeSummaries,
  fetchAdminEventTabletStatus,
  verifyEventTabletConnection,
  type AdminEventModeSummary,
  type AdminEventTabletStatus,
} from '../services/supabaseApplications';

const KOREA_TIME_ZONE = 'Asia/Seoul';
const storageKey = 'time2meet.tabletConnection';

interface StoredTabletConnection {
  connectionToken: string;
  eventId: string;
  tableNumber: number;
}

function readStoredConnection(eventId: string): StoredTabletConnection | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabletConnection;
    if (parsed.eventId !== eventId || !parsed.connectionToken || !parsed.tableNumber) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredConnection(connection: StoredTabletConnection) {
  window.localStorage.setItem(storageKey, JSON.stringify(connection));
}

function clearStoredConnection() {
  window.localStorage.removeItem(storageKey);
}

type PageStage = 'checking' | 'need-admin-auth' | 'select' | 'connected' | 'restoring';

export default function AdminTabletConnectPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();

  const [stage, setStage] = useState<PageStage>('checking');
  const [event, setEvent] = useState<AdminEventModeSummary | null>(null);
  const [tabletStatus, setTabletStatus] = useState<AdminEventTabletStatus[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState('');
  const [connectingNumber, setConnectingNumber] = useState<number | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<{ connectedAt: string; tableNumber: number } | null>(null);
  const [adminCode, setAdminCode] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [adminError, setAdminError] = useState('');

  const loadEventAndStatus = useCallback(async () => {
    if (!eventId) return;
    setLoadError(null);
    try {
      const [summaries, tablets] = await Promise.all([fetchAdminEventModeSummaries(), fetchAdminEventTabletStatus(eventId)]);
      setEvent(summaries.find((item) => item.id === eventId) ?? null);
      setTabletStatus(tablets);
    } catch (caughtError) {
      setLoadError(caughtError instanceof Error ? caughtError.message : '행사 데이터를 불러오지 못했습니다.');
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let active = true;

    const init = async () => {
      const stored = readStoredConnection(eventId);
      if (stored) {
        const result = await verifyEventTabletConnection(eventId, stored.tableNumber, stored.connectionToken);
        if (!active) return;
        if (result.ok) {
          navigate(`/admin/events/${eventId}/tablet/${stored.tableNumber}/seat`, { replace: true });
          return;
        }
        clearStoredConnection();
      }

      const adminSession = getAdminSession();
      const adminValid = adminSession ? await verifyAdminSession() : false;
      if (!active) return;

      if (!adminValid) {
        setStage('need-admin-auth');
        return;
      }

      await loadEventAndStatus();
      if (active) setStage('select');
    };

    void init();
    return () => {
      active = false;
    };
  }, [eventId, loadEventAndStatus, navigate]);

  const handleAdminSubmit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setAdminSubmitting(true);
    setAdminError('');
    try {
      await loginAdminSession(adminCode);
      await loadEventAndStatus();
      setStage('select');
    } catch {
      setAdminError('관리자 코드가 올바르지 않습니다.');
    } finally {
      setAdminSubmitting(false);
    }
  };

  const handleSelect = async (tableNumber: number) => {
    if (!eventId || connectingNumber !== null) return;
    setConnectError('');
    setConnectingNumber(tableNumber);
    try {
      const connection = await connectEventTablet(eventId, tableNumber);
      writeStoredConnection({ connectionToken: connection.connectionToken, eventId, tableNumber: connection.tableNumber });
      setConnectedInfo({ connectedAt: connection.connectedAt, tableNumber: connection.tableNumber });
      setStage('connected');
    } catch (caughtError) {
      setConnectError(caughtError instanceof Error ? caughtError.message : '태블릿을 연결하지 못했습니다.');
      await loadEventAndStatus();
    } finally {
      setConnectingNumber(null);
    }
  };

  if (stage === 'checking' || stage === 'restoring') return <DataLoadingState />;

  if (stage === 'need-admin-auth') {
    return (
      <main className="min-h-screen w-full overflow-x-hidden bg-[#fffaf4] text-[#1f292d]">
        <div className="grid min-h-screen w-full place-items-center px-6">
          <form className="w-full max-w-[420px] rounded-[26px] bg-white p-8 shadow-calendar" onSubmit={(submitEvent) => void handleAdminSubmit(submitEvent)}>
            <h1 className="text-[24px] font-black">태블릿 연결</h1>
            <p className="mt-2 text-[14px] font-bold text-[#888]">이 태블릿을 등록하려면 관리자 코드를 입력해주세요</p>
            <label className="mt-6 block">
              <input
                autoFocus
                className="h-14 w-full rounded-[16px] bg-[#fff1ee] px-4 text-[18px] font-bold outline-none focus:ring-2 focus:ring-[#ef554a]"
                onChange={(changeEvent) => setAdminCode(changeEvent.target.value)}
                type="password"
                value={adminCode}
              />
            </label>
            {adminError ? <p className="mt-3 text-[13px] font-bold text-[#ef554a]">{adminError}</p> : null}
            <button
              className="mt-6 h-14 w-full rounded-[16px] bg-[#ef4039] text-[17px] font-black text-white disabled:opacity-50"
              disabled={adminSubmitting}
              type="submit"
            >
              {adminSubmitting ? '확인 중' : '확인'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (loadError) return <DataErrorState message={loadError} onRetry={() => void loadEventAndStatus()} />;
  if (!event || !eventId) {
    return (
      <main className="min-h-screen w-full overflow-x-hidden bg-white text-black">
        <div className="grid min-h-screen w-full place-items-center px-6">
          <p className="text-[18px] font-black">행사를 찾을 수 없습니다</p>
        </div>
      </main>
    );
  }

  const isToday = event.date === getKoreaTodayKey();
  const operationsActive = event.isTestEvent || isToday;

  if (stage === 'connected' && connectedInfo) {
    return (
      <main className="min-h-screen w-full overflow-x-hidden bg-white text-[#1f292d]">
        <div className="grid min-h-screen w-full place-items-center px-6">
          <section className="w-full max-w-[560px] rounded-[28px] bg-white px-8 py-10 text-center shadow-calendar">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#fff1ee]">
              <CheckMarkIcon />
            </span>
            <h1 className="mt-6 text-[26px] font-black leading-snug">
              {connectedInfo.tableNumber}번 태블릿이
              <br />
              연결되었습니다
            </h1>

            <div className="mt-7 divide-y divide-[#f0f0f0] rounded-[18px] border border-[#f0f0f0] text-left">
              <InfoRow icon={<TabletIcon />} label="태블릿 번호" value={`${connectedInfo.tableNumber}번`} />
              <InfoRow icon={<TableIcon />} label="연결 테이블" value={`${connectedInfo.tableNumber}번 테이블`} />
              <InfoRow icon={<ClockIcon />} label="연결 시간" value={formatKstTime(connectedInfo.connectedAt)} />
            </div>

            <button
              className="mt-8 h-14 w-full rounded-[16px] bg-[#ef4039] text-[17px] font-black text-white"
              onClick={() => navigate(`/admin/events/${eventId}/tablet/${connectedInfo.tableNumber}/seat`)}
              type="button"
            >
              자리 유도 화면으로 이동
            </button>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#fffaf4] text-[#1f292d]">
      <div className="mx-auto min-h-screen w-full max-w-[1100px] px-8 py-8">
        <header>
          <h1 className="text-[34px] font-black leading-none">태블릿 연결</h1>
          <p className="mt-2 text-[16px] font-bold text-[#666]">사용할 태블릿 번호를 선택해주세요</p>
        </header>

        <div className="mt-5 flex items-start gap-3 rounded-[16px] bg-[#fff1ee] px-5 py-4">
          <span className="mt-0.5 shrink-0 text-[#ef554a]">
            <AlertIcon />
          </span>
          <p className="text-[14px] font-bold text-[#a35850]">태블릿 번호와 테이블 번호는 동일하게 운영됩니다.</p>
        </div>

        {!operationsActive ? (
          <section className="mt-6 rounded-[20px] border border-[#f0d9d3] bg-white px-6 py-10 text-center">
            <p className="text-[17px] font-black text-[#a35850]">{formatMonthDayKorean(event.date)}부터 태블릿 연결을 사용할 수 있어요.</p>
          </section>
        ) : (
          <>
            {connectError ? <p className="mt-4 text-center text-[14px] font-bold text-[#ef554a]">{connectError}</p> : null}
            <div className="mt-6 grid grid-cols-5 gap-4">
              {Array.from({ length: event.requiredTablets }, (_, index) => index + 1).map((tableNumber) => {
                const info = tabletStatus.find((item) => item.tableNumber === tableNumber);
                const connected = info?.connected ?? false;
                return (
                  <button
                    className={[
                      'flex aspect-square flex-col items-center justify-center gap-2 rounded-[20px] border-2 text-center transition active:scale-[0.97] disabled:cursor-not-allowed',
                      connected ? 'border-[#e5e5e5] bg-[#f5f5f5]' : 'border-[#ef554a] bg-white',
                    ].join(' ')}
                    disabled={connected || connectingNumber !== null}
                    key={tableNumber}
                    onClick={() => void handleSelect(tableNumber)}
                    type="button"
                  >
                    <span className={['text-[44px] font-black leading-none', connected ? 'text-[#bbb]' : 'text-[#ef554a]'].join(' ')}>{tableNumber}</span>
                    <span className={['text-[14px] font-black', connected ? 'text-[#999]' : 'text-[#c98a83]'].join(' ')}>
                      {connectingNumber === tableNumber ? '연결 중' : connected ? '연결됨' : '연결 안됨'}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <button
          className="mt-8 flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-[#e5e5e5] bg-white text-[15px] font-black text-[#555]"
          onClick={() => void loadEventAndStatus()}
          type="button"
        >
          <RefreshIcon />
          연결 상태 확인
        </button>
      </div>
    </main>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-4">
      <span className="flex items-center gap-2 text-[14px] font-black text-[#777]">
        {icon}
        {label}
      </span>
      <span className="text-[16px] font-black text-[#ef554a]">{value}</span>
    </div>
  );
}

function getKoreaTodayKey() {
  const formatter = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: KOREA_TIME_ZONE, year: 'numeric' });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function formatMonthDayKorean(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+09:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatKstTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit', timeZone: KOREA_TIME_ZONE });
}

function CheckMarkIcon() {
  return (
    <svg aria-hidden="true" className="h-10 w-10 text-[#ef554a]" fill="none" viewBox="0 0 24 24">
      <path d="m6 12.5 4 4L18 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function TabletIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <rect height="18" rx="2.2" stroke="currentColor" strokeWidth="1.8" width="13" x="5.5" y="3" />
      <path d="M11 18.5h2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M3 8h18M6 8v11M18 8v11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M2 8c0-2 2-4 4-4h12c2 0 4 2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v5.5M12 16v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 12a8 8 0 0 1 13.66-5.66L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.66 5.66L4 16M4 20v-4h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
