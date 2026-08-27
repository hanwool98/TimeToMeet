import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  deleteAdminEventOpenChatQr,
  disconnectAdminEventTablet,
  fetchAdminEventModeSummaries,
  fetchAdminEventOpenChatQr,
  fetchAdminEventSettings,
  fetchAdminEventTabletStatus,
  startAdminEvent,
  subscribeToAdminEventModeChanges,
  updateAdminEventSettings,
  uploadAdminEventOpenChatQr,
  type AdminEventModeSummary,
  type AdminEventSettings,
  type AdminEventTabletStatus,
} from '../services/supabaseApplications';

const conversationDurationOptions = [
  { label: '7분', value: 420 },
  { label: '8분', value: 480 },
  { label: '10분', value: 600 },
];
const bonusRoundCountOptions = [0, 1, 2, 3];
const finalSelectionLimitOptions = [1, 2, 3];

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
  const [settings, setSettings] = useState<AdminEventSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [savingSetting, setSavingSetting] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [openChatQrUrl, setOpenChatQrUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrError, setQrError] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const qrFileInputRef = useRef<HTMLInputElement>(null);

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

  const loadSettings = useCallback(async () => {
    if (!eventId) return;
    setSettingsError('');
    try {
      setSettings(await fetchAdminEventSettings(eventId));
    } catch (caughtError) {
      setSettingsError(caughtError instanceof Error ? caughtError.message : '진행 설정을 불러오지 못했습니다.');
    }
  }, [eventId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadOpenChatQr = useCallback(async () => {
    if (!eventId) return;
    setQrLoading(true);
    setQrError('');
    try {
      const result = await fetchAdminEventOpenChatQr(eventId);
      setOpenChatQrUrl(result.qrUrl);
    } catch (caughtError) {
      setQrError(caughtError instanceof Error ? caughtError.message : 'QR 코드를 불러오지 못했습니다.');
    } finally {
      setQrLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadOpenChatQr();
  }, [loadOpenChatQr]);

  const handleQrFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !eventId || qrBusy) return;
    setQrBusy(true);
    setQrError('');
    try {
      const result = await uploadAdminEventOpenChatQr(eventId, file);
      setOpenChatQrUrl(result.qrUrl);
    } catch (caughtError) {
      setQrError(caughtError instanceof Error ? caughtError.message : 'QR 코드 업로드에 실패했습니다.');
    } finally {
      setQrBusy(false);
    }
  };

  const handleDeleteQr = async () => {
    if (!eventId || qrBusy) return;
    if (!window.confirm('오픈채팅방 QR 코드를 삭제할까요?')) return;
    setQrBusy(true);
    setQrError('');
    try {
      await deleteAdminEventOpenChatQr(eventId);
      setOpenChatQrUrl(null);
    } catch (caughtError) {
      setQrError(caughtError instanceof Error ? caughtError.message : 'QR 코드 삭제에 실패했습니다.');
    } finally {
      setQrBusy(false);
    }
  };

  const handleSettingChange = async (patch: Partial<Pick<AdminEventSettings, 'bonusRoundCount' | 'conversationDurationSeconds' | 'finalSelectionLimit'>>) => {
    if (!eventId || !settings || savingSetting || eventStarted) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSetting(true);
    setSettingsError('');
    try {
      await updateAdminEventSettings(eventId, {
        bonusRoundCount: next.bonusRoundCount,
        conversationDurationSeconds: next.conversationDurationSeconds,
        finalSelectionLimit: next.finalSelectionLimit,
      });
    } catch (caughtError) {
      setSettingsError(caughtError instanceof Error ? caughtError.message : '진행 설정을 저장하지 못했습니다.');
      await loadSettings();
    } finally {
      setSavingSetting(false);
    }
  };

  const handleStartClick = () => {
    if (!eventId || starting) return;
    if (eventStarted) {
      navigate(`/admin/events/${eventId}/live`);
      return;
    }
    setStartConfirmOpen(true);
  };

  const handleConfirmStart = async () => {
    if (!eventId || starting) return;
    setStarting(true);
    setStartError('');
    try {
      await startAdminEvent(eventId);
      navigate(`/admin/events/${eventId}/live`);
    } catch (caughtError) {
      setStartError(caughtError instanceof Error ? caughtError.message : '행사를 시작하지 못했습니다.');
      setStartConfirmOpen(false);
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
          <ActionRow
            active={operationsActive}
            badge="배치 확인"
            description="지각/참여취소 처리 및 자리 직접 수정"
            icon={<SeatsIcon />}
            onClick={() => navigate(`/admin/events/${event.id}/prepare/seats`)}
            subtitle="행사 시작 전까지 수정 가능"
            title="자리배치 확인"
          />
        </section>

        <section className="mt-5 rounded-[20px] bg-[#fff1ee] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-[#ef554a]">
              <InfoIcon />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-black text-[#1f292d]">초기 테이블은 자동으로 정해져요</p>
              <p className="mt-1 text-[13px] font-bold text-[#a35850]">참가자 목록의 남녀 순번이 같은 번호의 테이블에 배정돼요</p>
              <p className="mt-1 text-[12px] font-bold text-[#b98680]">체크인 즉시 자리가 안내되고, 자리배치 확인 화면에서 행사 시작 전까지 지각/참여취소·자리 수정이 가능합니다</p>
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

        <section className="mt-6 rounded-[20px] border border-[#f0f0f0] bg-white px-5 py-5">
          <h3 className="text-[17px] font-black">진행 설정</h3>

          {!settings ? (
            <p className="mt-4 text-[13px] font-bold text-[#999]">{settingsError || '불러오는 중'}</p>
          ) : (
            <div className="mt-4 space-y-3">
              <SettingRow label="기본 라운드">
                <select
                  className="rounded-[10px] border border-[#ddd] bg-white px-3 py-1.5 text-[14px] font-black text-[#1f292d] disabled:cursor-not-allowed disabled:text-[#bbb]"
                  disabled={eventStarted || savingSetting}
                  onChange={(changeEvent) => void handleSettingChange({ conversationDurationSeconds: Number(changeEvent.target.value) })}
                  value={settings.conversationDurationSeconds}
                >
                  {conversationDurationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow label="추가시간">
                <select
                  className="rounded-[10px] border border-[#ddd] bg-white px-3 py-1.5 text-[14px] font-black text-[#1f292d] disabled:cursor-not-allowed disabled:text-[#bbb]"
                  disabled={eventStarted || savingSetting}
                  onChange={(changeEvent) => void handleSettingChange({ bonusRoundCount: Number(changeEvent.target.value) })}
                  value={settings.bonusRoundCount}
                >
                  {bonusRoundCountOptions.map((count) => (
                    <option key={count} value={count}>
                      {count}회
                    </option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow label="최종 선택">
                <select
                  className="rounded-[10px] border border-[#ddd] bg-white px-3 py-1.5 text-[14px] font-black text-[#1f292d] disabled:cursor-not-allowed disabled:text-[#bbb]"
                  disabled={eventStarted || savingSetting}
                  onChange={(changeEvent) => void handleSettingChange({ finalSelectionLimit: Number(changeEvent.target.value) })}
                  value={settings.finalSelectionLimit}
                >
                  {finalSelectionLimitOptions.map((count) => (
                    <option key={count} value={count}>
                      최대 {count}명
                    </option>
                  ))}
                </select>
              </SettingRow>
            </div>
          )}

          {settingsError && settings ? <p className="mt-3 text-[12px] font-bold text-[#ef554a]">{settingsError}</p> : null}
          <p className="mt-4 text-[12px] font-bold text-[#aaa]">행사 시작 후에는 진행 설정을 변경할 수 없습니다.</p>
        </section>

        <section className="mt-6 rounded-[20px] border border-[#f0f0f0] bg-white px-5 py-5">
          <h3 className="text-[17px] font-black">오픈채팅방 QR 코드</h3>
          <p className="mt-1 text-[12px] font-bold text-[#999]">최종 선택 단계에서 태블릿에 크게 보여줄 QR 코드예요.</p>

          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-[#eee] bg-[#fafafa]">
              {qrLoading ? (
                <span className="text-[11px] font-bold text-[#bbb]">불러오는 중</span>
              ) : openChatQrUrl ? (
                <img alt="오픈채팅방 QR 코드" className="h-full w-full object-contain" src={openChatQrUrl} />
              ) : (
                <span className="px-1 text-center text-[10px] font-bold text-[#bbb]">미등록</span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <button
                className="h-10 rounded-[10px] bg-meet-blueSoft text-[13px] font-black text-meet-blue disabled:opacity-50"
                disabled={qrBusy || qrLoading}
                onClick={() => qrFileInputRef.current?.click()}
                type="button"
              >
                {qrBusy ? '처리 중' : openChatQrUrl ? '다른 이미지로 변경' : '이미지 업로드'}
              </button>
              {openChatQrUrl ? (
                <button
                  className="h-10 rounded-[10px] bg-meet-pinkSoft text-[13px] font-black text-meet-pink disabled:opacity-50"
                  disabled={qrBusy}
                  onClick={() => void handleDeleteQr()}
                  type="button"
                >
                  삭제
                </button>
              ) : null}
            </div>
            <input
              accept="image/*"
              className="hidden"
              onChange={(event) => void handleQrFileChosen(event)}
              ref={qrFileInputRef}
              type="file"
            />
          </div>

          {qrError ? <p className="mt-3 text-[12px] font-bold text-[#ef554a]">{qrError}</p> : null}
          {!qrLoading && !openChatQrUrl && !qrError ? (
            <p className="mt-3 text-[12px] font-bold text-[#a35850]">⚠ 아직 QR 코드가 등록되지 않았어요. 최종 선택 단계 전까지 등록해주세요.</p>
          ) : null}
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
            disabled={!operationsActive || starting}
            onClick={handleStartClick}
            type="button"
          >
            {eventStarted ? '행사 진행 중 · 이어서 보기' : starting ? '시작하는 중' : '행사 시작'}
          </button>
        </div>
      </div>

      {tabletPanelOpen ? (
        <TabletStatusPanel eventId={event.id} onClose={() => setTabletPanelOpen(false)} requiredTablets={event.requiredTablets} />
      ) : null}

      {startConfirmOpen && settings && event ? (
        <StartConfirmPanel
          event={event}
          onCancel={() => setStartConfirmOpen(false)}
          onConfirm={() => void handleConfirmStart()}
          settings={settings}
          starting={starting}
        />
      ) : null}
    </main>
  );
}

function SettingRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] bg-[#fafafa] px-4 py-3">
      <span className="shrink-0 whitespace-nowrap text-[14px] font-black text-[#555]">{label}</span>
      {children}
    </div>
  );
}

function StartConfirmPanel({
  event,
  onCancel,
  onConfirm,
  settings,
  starting,
}: {
  event: AdminEventModeSummary;
  onCancel: () => void;
  onConfirm: () => void;
  settings: AdminEventSettings;
  starting: boolean;
}) {
  const conversationLabel = conversationDurationOptions.find((option) => option.value === settings.conversationDurationSeconds)?.label ?? '10분';
  const hasUncheckedParticipant = event.checkinCount < event.confirmedCount;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div
        className="w-full max-w-[430px] rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <h3 className="mt-4 text-[18px] font-black">{hasUncheckedParticipant ? '행사를 시작하시겠습니까?' : '이 설정으로 행사를 시작할까요?'}</h3>

        {hasUncheckedParticipant ? (
          <div className="mt-4 space-y-2 rounded-[16px] bg-[#fff1ee] px-4 py-3 text-[14px] font-bold text-[#555]">
            <p>
              현재 체크인 남성 <span className="font-black text-[#1f292d]">{event.maleCheckinCount}/{event.maleConfirmedCount}명</span>
              {' · '}
              여성 <span className="font-black text-[#1f292d]">{event.femaleCheckinCount}/{event.femaleConfirmedCount}명</span>
            </p>
            <p className="text-[#a35850]">아직 체크인하지 않은 참가자가 있습니다. 지금 행사를 시작하면 현재 참가자를 기준으로 진행됩니다.</p>
          </div>
        ) : null}

        <div className="mt-4 space-y-2 rounded-[16px] bg-[#fafafa] px-4 py-3 text-[14px] font-bold text-[#555]">
          <p>
            기본 라운드: <span className="font-black text-[#1f292d]">{conversationLabel}</span>
          </p>
          <p>
            추가시간: <span className="font-black text-[#1f292d]">{settings.bonusRoundCount}회</span>
          </p>
          <p>
            최종 선택: <span className="font-black text-[#1f292d]">최대 {settings.finalSelectionLimit}명</span>
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            className="flex h-12 w-full items-center justify-center rounded-[12px] border border-[#ddd] text-[15px] font-black text-[#555] disabled:opacity-50"
            disabled={starting}
            onClick={onCancel}
            type="button"
          >
            취소
          </button>
          <button
            className="flex h-12 w-full items-center justify-center rounded-[12px] bg-[#ef4039] text-[15px] font-black text-white disabled:opacity-60"
            disabled={starting}
            onClick={onConfirm}
            type="button"
          >
            {starting ? '시작하는 중' : hasUncheckedParticipant ? '그래도 시작' : '행사 시작'}
          </button>
        </div>
      </div>
    </div>
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

function SeatsIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" fill="none" viewBox="0 0 32 32">
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="2.2" width="24" x="4" y="9" />
      <circle cx="11" cy="14" fill="currentColor" r="1.6" />
      <circle cx="21" cy="14" fill="currentColor" r="1.6" />
      <path d="M4 24h24" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
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
