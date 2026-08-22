import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import HeartRatingInput from '../components/HeartRatingInput';
import PrimaryButton from '../components/PrimaryButton';
import {
  createParticipantPauseRequest,
  fetchMyEventTickets,
  fetchMyRoundRating,
  fetchParticipantPartnerPhoto,
  fetchParticipantRoundProgress,
  submitRoundRating,
  type MyEventTicket,
  type ParticipantRoundProgress,
} from '../services/supabaseApplications';
import { computeLiveElapsedSeconds, formatCountdown, phaseDurationSeconds } from '../utils/roundTimerSync';

const progressPollIntervalMs = 4_000;

// The entire /events/:eventId/mode route is "행사모드" - it intentionally
// never renders <BottomTabs/> on any sub-screen (wait screen, conversation,
// transition, fallback), so a participant who entered via "행사 입장" only
// sees the regular app nav again after tapping "나가기" back to /my-events.
export default function EventModePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [ticket, setTicket] = useState<MyEventTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ParticipantRoundProgress | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const tickets = await fetchMyEventTickets();
        if (!active) return;
        setTicket(tickets.find((item) => item.eventId === eventId && item.status === '참가 확정' && Boolean(item.checkedInAt)) ?? null);
      } catch {
        if (active) setTicket(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [eventId]);

  // Only starts once entry is confirmed (checked-in, 참가 확정) - this is the
  // sole gate today, matching TicketDetailPage's "행사 입장" button, and is
  // re-verified here rather than trusted from a route param so a
  // typed-in URL can't skip it. Before the operator presses 행사 시작 on
  // AdminEventPreparePage, no event_progress row exists yet, so the server
  // reports stage: undefined and the wait screen renders below.
  useEffect(() => {
    if (!eventId || !ticket) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await fetchParticipantRoundProgress(eventId);
        if (active) setProgress(next);
      } catch {
        // Keep showing the last known state on a transient failure.
      }
    };
    void poll();
    const intervalId = window.setInterval(() => void poll(), progressPollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, ticket]);

  if (loading) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-white px-4 pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-6rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </main>
    );
  }

  if (!ticket) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-white px-4 pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-6rem)] place-items-center">
          <section className="w-full rounded-[30px] bg-white p-6 text-center shadow-calendar">
            <p className="text-[14px] font-black text-meet-blue">입장 확인 필요</p>
            <h1 className="mt-3 text-[27px] font-black leading-tight">아직 입장할 수 없어요</h1>
            <p className="mt-4 text-[15px] font-extrabold leading-relaxed text-[#777]">행사 당일 운영자의 QR 인증 후 입장할 수 있어요.</p>
            <PrimaryButton className="mt-6" onClick={() => navigate('/my-events')}>
              내 행사로 돌아가기
            </PrimaryButton>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <ParticipantEventScreen eventId={ticket.eventId} eventTitle={ticket.eventTitle} progress={progress} />
    </main>
  );
}

function ParticipantEventScreen({
  eventId,
  eventTitle,
  progress,
}: {
  eventId: string;
  eventTitle: string;
  progress: ParticipantRoundProgress | null;
}) {
  const navigate = useNavigate();
  const onBack = () => navigate(`/my-events/ticket/${eventId}`);

  if (!progress) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-6rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </div>
    );
  }

  // No event_progress row yet (행사 시작 전), or the operator has started
  // the event but is still on 자리유도/소개영상/라운드 대기 - the participant
  // has nothing device-specific to do in any of these until the first round
  // actually goes active, so they all share the same wait screen rather than
  // flashing through separate "지금은 이 단계입니다" screens.
  if (!progress.stage || progress.stage === 'seat_guide' || progress.stage === 'intro_video' || progress.stage === 'round_waiting') {
    return <WaitingScreen eventId={eventId} eventTitle={eventTitle} onBack={onBack} />;
  }

  if (progress.stage === 'bonus_matching') {
    return <BonusMatchingScreen onBack={onBack} />;
  }

  if (progress.stage === 'bonus_seat_guide') {
    return <BonusSeatGuideScreen onBack={onBack} progress={progress} />;
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'conversation') {
    return <ConversationScreen eventId={eventId} onBack={onBack} progress={progress} />;
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'transition') {
    return <RatingScreen eventId={eventId} onBack={onBack} progress={progress} />;
  }

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />
      <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
        <section className="w-full rounded-[30px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
          <p className="text-[18px] font-black leading-tight">행사가 마무리되었습니다</p>
          <p className="mt-3 text-[14px] font-extrabold text-[#888]">잠시만 기다려주세요</p>
        </section>
      </div>
    </div>
  );
}

function ScreenHeader({ onBack, title }: { onBack: () => void; title?: string }) {
  const navigate = useNavigate();
  return (
    <header className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-2">
      <button aria-label="뒤로가기" className="grid h-10 w-10 shrink-0 place-items-center text-[#333]" onClick={onBack} type="button">
        <BackIcon />
      </button>
      {title ? <h1 className="min-w-0 flex-1 truncate text-center text-[18px] font-black">{title}</h1> : <span className="flex-1" />}
      <button
        className="shrink-0 rounded-[10px] border border-[#e5e5e5] px-3 py-2 text-[13px] font-black text-[#777]"
        onClick={() => navigate('/my-events')}
        type="button"
      >
        나가기
      </button>
    </header>
  );
}

const toastDisplayMs = 2_400;

// Shared by the wait screen (call_staff only) and the conversation screen
// (pause + call_staff) - a toast confirms the request landed, and buttons
// stay enabled the whole time since a participant may need to ask again.
function useHelpRequest(eventId: string, tableNumber: number | undefined) {
  const [sendingType, setSendingType] = useState<'call_staff' | 'pause' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(toastTimerRef.current);
  }, []);

  const sendRequest = async (type: 'call_staff' | 'pause') => {
    if (sendingType) return;
    setSendingType(type);
    setErrorMessage('');
    try {
      await createParticipantPauseRequest(eventId, tableNumber, type);
      window.clearTimeout(toastTimerRef.current);
      setToast('요청이 완료되었습니다');
      toastTimerRef.current = window.setTimeout(() => setToast(''), toastDisplayMs);
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : '요청을 전달하지 못했습니다.');
    } finally {
      setSendingType(null);
    }
  };

  return { errorMessage, sendingType, sendRequest, toast };
}

function ToastBanner({ toast }: { toast: string }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-[14px] bg-[#1f292d] px-4 py-3 text-[13px] font-black text-white shadow-lg">
        <CheckGlyph />
        {toast}
      </div>
    </div>
  );
}

function WaitingScreen({ eventId, eventTitle, onBack }: { eventId: string; eventTitle: string; onBack: () => void }) {
  const { errorMessage, sendingType, sendRequest, toast } = useHelpRequest(eventId, undefined);

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
          <img alt="time2meet" className="mx-auto h-[110px] w-[110px] rounded-full object-cover" src="/assets/time2meet-app-logo.png" />
          <h1 className="mt-5 text-[24px] font-black leading-tight">잠시만 기다려주세요</h1>
          <p className="mt-1.5 text-[15px] font-bold text-[#888]">행사가 곧 시작됩니다</p>

          <p className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full bg-meet-blueSoft px-4 py-2 text-[13px] font-black text-meet-blue">
            <CalendarGlyph />
            {eventTitle}
          </p>

          <div className="mt-5 flex items-center gap-3 border-t border-[#f0f0f0] pt-5 text-left">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-meet-blueSoft text-meet-blue">
              <ChairGlyph />
            </span>
            <p className="text-[14px] font-extrabold leading-snug text-[#333]">
              안내에 따라 착석 후
              <br />
              테이블 화면을 확인해주세요
            </p>
          </div>
        </section>

        <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
          <h2 className="text-[16px] font-black">도움이 필요할 때</h2>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-meet-blue text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'call_staff'}
              onClick={() => void sendRequest('call_staff')}
              type="button"
            >
              <HeadsetGlyph />
              운영자 호출
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">운영자가 직접 테이블로 와서 도와드립니다</p>
          </div>

          {errorMessage ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{errorMessage}</p> : null}

          <div className="mt-4 flex items-center gap-2 rounded-[16px] bg-[#f5f7fa] px-4 py-3 text-[12px] font-bold text-[#888]">
            <InfoGlyph />
            행사 시작 전까지 이 화면에서 대기해주세요
          </div>
        </section>
      </div>

      <ToastBanner toast={toast} />
    </div>
  );
}

function ConversationScreen({
  eventId,
  onBack,
  progress,
}: {
  eventId: string;
  onBack: () => void;
  progress: ParticipantRoundProgress;
}) {
  const { errorMessage, sendingType, sendRequest, toast } = useHelpRequest(eventId, progress.tableNumber);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const phaseDuration = phaseDurationSeconds(progress.roundPhase);
  const remaining = Math.max(
    0,
    phaseDuration -
      computeLiveElapsedSeconds(
        {
          timerPositionSeconds: progress.timerPositionSeconds ?? 0,
          timerStatus: progress.timerStatus ?? 'paused',
          timerUpdatedAt: progress.timerUpdatedAt,
        },
        nowTick,
      ),
  );

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-10 text-center shadow-calendar">
          <p className="text-[15px] font-black text-meet-blue">현재 대화 중</p>
          <p className="text-fluid-safe mt-4 break-keep text-[clamp(40px,11vw,56px)] font-black leading-none">
            {progress.partnerNickname ?? '상대 확인 중'}
          </p>
          {progress.timerUpdatedAt ? (
            <p className="mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-full bg-[#f5f7fa] px-3.5 py-1.5 text-[13px] font-black tabular-nums text-[#666]">
              <ClockGlyph />
              남은 시간 {formatCountdown(remaining)}
            </p>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
          <h2 className="text-[16px] font-black">도움이 필요할 때</h2>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-meet-blueSoft text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'pause'}
              onClick={() => void sendRequest('pause')}
              type="button"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-meet-blue text-white">
                <PauseGlyph />
              </span>
              일시정지 요청
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">운영자에게 일시정지 요청이 전달됩니다</p>
          </div>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-meet-blue text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'call_staff'}
              onClick={() => void sendRequest('call_staff')}
              type="button"
            >
              <HeadsetGlyph />
              운영자 호출
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">운영자가 직접 테이블로 와서 도와드립니다</p>
          </div>

          {errorMessage ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{errorMessage}</p> : null}

          <div className="mt-4 flex items-center gap-2 rounded-[16px] bg-[#f5f7fa] px-4 py-3 text-[12px] font-bold text-[#888]">
            <InfoGlyph />
            대화가 끝나면 호감도 작성 및 자리 이동 화면으로 자동 전환됩니다
          </div>
        </section>
      </div>

      <ToastBanner toast={toast} />
    </div>
  );
}

// 첨부 와이어프레임이 이 화면의 최종 디자인이므로 배치/여백/문구를 그대로
// 재현한다 - 다른 화면들처럼 구조를 재해석하지 않는다.
function BonusMatchingScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="보너스 매칭" />
      <div className="mobile-container mx-auto mt-6 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-10 text-center shadow-calendar">
          <BonusMatchingIllustration />

          <p className="mt-8 text-[24px] font-black leading-tight">
            <span style={{ color: '#1c2541' }}>보너스 대화 </span>
            <span style={{ color: '#ef4d7a' }}>매칭 중</span>
          </p>
          <p className="mt-4 text-[15px] font-bold leading-relaxed" style={{ color: '#4b5468' }}>
            지금까지의 만남을 바탕으로
            <br />
            조금 더 이야기해보고 싶은 상대를 찾고 있어요.
          </p>

          <BonusMatchingDots />

          <p className="mx-auto mt-10 flex w-fit items-center gap-2 rounded-full bg-[#fdeef2] px-4 py-2 text-[13px] font-black text-[#ef4d7a]">
            <ClockGlyph />
            잠시만 기다려주세요
          </p>
        </section>
      </div>
    </div>
  );
}

function BonusMatchingIllustration() {
  return (
    <div className="relative mx-auto h-[230px] w-full max-w-[300px]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(45% 55% at 32% 42%, rgba(130,175,255,0.22), transparent 70%), radial-gradient(45% 55% at 68% 42%, rgba(255,140,175,0.22), transparent 70%)',
        }}
      />

      <SparkleGlyph className="absolute left-[6%] top-[4%] h-6 w-6" color="#8fb3f5" />
      <SparkleGlyph className="absolute right-[10%] top-[9%] h-4 w-4" color="#f39db5" />
      <span className="absolute left-[4%] top-[52%] h-2 w-2 rounded-full bg-[#a9c6f7]" />

      <svg className="absolute inset-0 h-full w-full" fill="none" viewBox="0 0 300 230">
        <path d="M78 128 C95 78 130 62 150 82" stroke="#a9c6f7" strokeDasharray="5 6" strokeLinecap="round" strokeWidth="2" />
        <path d="M150 82 C170 62 205 78 222 128" stroke="#f3aec1" strokeDasharray="5 6" strokeLinecap="round" strokeWidth="2" />
      </svg>

      <div className="absolute bottom-[6%] left-1/2 h-5 w-[62%] -translate-x-1/2 rounded-full bg-black/[0.06] blur-md" />

      <div className="absolute bottom-[10%] left-[7%] z-0 flex h-[68%] w-[38%] -rotate-3 flex-col items-center rounded-[16px] border border-[#dbe7fb] bg-[#f2f6ff] p-2.5 shadow-[0_10px_20px_rgba(120,150,220,0.15)]">
        <span className="relative mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#cddbfa]">
          <PersonSilhouetteGlyph color="#6f96e6" />
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white shadow-sm">
            <TinyHeartGlyph color="#ef7a9a" />
          </span>
        </span>
        <span className="mt-2.5 h-1 w-[70%] rounded-full bg-[#cddbfa]" />
        <span className="mt-1.5 h-1 w-[50%] rounded-full bg-[#dbe7fb]" />
      </div>

      <div className="absolute bottom-[16%] left-1/2 z-10 flex h-[76%] w-[40%] -translate-x-1/2 flex-col items-center justify-center rounded-[18px] border border-[#f4f0f6] bg-white p-2.5 shadow-[0_14px_26px_rgba(200,150,180,0.2)]">
        <HeartGlyph className="h-12 w-12" />
      </div>

      <div className="absolute bottom-[10%] right-[7%] z-0 flex h-[68%] w-[38%] rotate-3 flex-col items-center rounded-[16px] border border-[#fbdde6] bg-[#fff1f5] p-2.5 shadow-[0_10px_20px_rgba(230,150,180,0.15)]">
        <span className="relative mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fbd0dd]">
          <PersonSilhouetteGlyph color="#ef7a9a" />
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white shadow-sm">
            <TinyHeartGlyph color="#ef7a9a" />
          </span>
        </span>
        <span className="mt-2.5 h-1 w-[70%] rounded-full bg-[#fbd0dd]" />
        <span className="mt-1.5 h-1 w-[50%] rounded-full bg-[#fce3ea]" />
      </div>
    </div>
  );
}

function BonusMatchingDots() {
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full bg-[#9db8f0]" style={{ animation: 'bonus-dot-pulse 1.2s ease-in-out infinite' }} />
      <span className="h-2.5 w-2.5 rounded-full bg-[#ef7a9a]" style={{ animation: 'bonus-dot-pulse 1.2s ease-in-out 0.2s infinite' }} />
      <span className="h-2.5 w-2.5 rounded-full bg-[#9db8f0]" style={{ animation: 'bonus-dot-pulse 1.2s ease-in-out 0.4s infinite' }} />
      <style>{`
        @keyframes bonus-dot-pulse {
          0%, 80%, 100% { opacity: 0.35; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// No wireframe was provided for this step (only the bonus-matching screen
// was) - kept intentionally minimal and consistent with the existing
// transition/wait screens rather than inventing a new design.
function BonusSeatGuideScreen({ onBack, progress }: { onBack: () => void; progress: ParticipantRoundProgress }) {
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const phaseDuration = phaseDurationSeconds('transition');
  const remaining = Math.max(
    0,
    phaseDuration -
      computeLiveElapsedSeconds(
        {
          timerPositionSeconds: progress.timerPositionSeconds ?? 0,
          timerStatus: progress.timerStatus ?? 'paused',
          timerUpdatedAt: progress.timerUpdatedAt,
        },
        nowTick,
      ),
  );

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="보너스 매칭" />
      <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
        <section className="w-full rounded-[30px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
          <p className="text-[18px] font-black leading-tight">보너스 라운드 자리를 안내하고 있어요</p>
          <p className="mt-3 text-[14px] font-extrabold text-[#888]">안내에 따라 이동해주세요</p>
          {progress.timerUpdatedAt ? (
            <p className="mx-auto mt-5 flex w-fit items-center gap-1.5 rounded-full bg-[#f5f7fa] px-3.5 py-1.5 text-[13px] font-black tabular-nums text-[#666]">
              <ClockGlyph />
              {formatCountdown(remaining)}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SparkleGlyph({ className, color }: { className?: string; color: string }) {
  return (
    <svg aria-hidden="true" className={className} fill={color} viewBox="0 0 24 24">
      <path d="M12 2c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" />
    </svg>
  );
}

function PersonSilhouetteGlyph({ color }: { color: string }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.4" stroke={color} strokeWidth="1.8" />
      <path d="M5 20c1.3-3.8 4-5.6 7-5.6s5.7 1.8 7 5.6" stroke={color} strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function TinyHeartGlyph({ color }: { color: string }) {
  return (
    <svg aria-hidden="true" className="h-2.5 w-2.5" fill={color} viewBox="0 0 24 24">
      <path d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

function HeartGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z"
        fill="#ef7a9a"
        stroke="#ef7a9a"
        strokeWidth="0.5"
      />
    </svg>
  );
}

const ratingMemoMaxLength = 200;

function ratingCopy(score: number): { subtitle: string; title: string } {
  if (score <= 1) return { subtitle: '조금 더 시간을 가져봐도 좋을 것 같아요.', title: '아직은 잘 모르겠어요' };
  if (score <= 2) return { subtitle: '다음에 또 이야기해보고 싶어요.', title: '조금 더 알아가면 좋을 것 같아요' };
  if (score <= 3) return { subtitle: '무난하고 좋은 시간이었어요.', title: '편안한 대화였어요' };
  if (score <= 4) return { subtitle: '다시 만나면 반가울 것 같아요.', title: '좋은 인상을 받았어요!' };
  if (score < 5) return { subtitle: '한 번 더 대화하고 싶은 마음이에요.', title: '한 번 더 대화하고 싶어요!' };
  return { subtitle: '정말 특별한 느낌이었어요.', title: '내가 찾던 사람이에요!' };
}

// 2분 이동 및 호감도 작성 phase: the participant rates the partner they were
// just matched with (progress.roundPhase === 'transition' still resolves to
// that just-finished round's match, since current_round only advances once
// this phase itself expires). Editing is allowed for as long as the server
// still reports this same round as current - submit_round_rating enforces
// that server-side too, so a stale tab can't sneak in a late edit.
function RatingScreen({
  eventId,
  onBack,
  progress,
}: {
  eventId: string;
  onBack: () => void;
  progress: ParticipantRoundProgress;
}) {
  const roundNumber = progress.currentRound ?? 1;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  // null while checking the server for an existing submission (avoids
  // flashing the form before immediately swapping to the complete screen).
  const [submitted, setSubmitted] = useState<boolean | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Reloads on (eventId, roundNumber) change - covers first entry, refresh,
  // AND the rare case of landing back on this phase for a new round without
  // a full page reload in between. Whether a rating already exists for this
  // round is the server-side source of truth for showing the complete
  // screen vs. the form - never inferred from local state alone, so a
  // refresh or re-entry lands on the right screen.
  useEffect(() => {
    let active = true;
    setScore(null);
    setMemo('');
    setPhotoUrl(null);
    setSubmitted(null);
    void fetchParticipantPartnerPhoto(eventId)
      .then((url) => {
        if (active) setPhotoUrl(url);
      })
      .catch(() => undefined);
    void fetchMyRoundRating(eventId, roundNumber)
      .then((existing) => {
        if (!active) return;
        if (existing.score !== undefined) setScore(existing.score);
        if (existing.memo) setMemo(existing.memo);
        setSubmitted(existing.score !== undefined);
      })
      .catch(() => {
        if (active) setSubmitted(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, roundNumber]);

  const phaseDuration = phaseDurationSeconds('transition');
  const remaining = Math.max(
    0,
    phaseDuration -
      computeLiveElapsedSeconds(
        {
          timerPositionSeconds: progress.timerPositionSeconds ?? 0,
          timerStatus: progress.timerStatus ?? 'paused',
          timerUpdatedAt: progress.timerUpdatedAt,
        },
        nowTick,
      ),
  );

  const handleSubmit = async () => {
    if (score === null || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitRoundRating(eventId, roundNumber, score, memo);
      setSubmitted(true);
    } catch (caughtError) {
      setSubmitError(caughtError instanceof Error ? caughtError.message : '저장하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted === null) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} title="호감도 작성" />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return <RatingCompleteScreen onBack={onBack} />;
  }

  const copy = score !== null ? ratingCopy(score) : null;

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="호감도 작성" />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-4 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
          <p className="text-center text-[17px] font-black leading-snug">
            지금 대화를 나눈 분에게
            <br />
            호감도를 남겨주세요 💗
          </p>

          <div className="mt-4 aspect-[4/3] w-full overflow-hidden rounded-[20px] bg-[#f5f7fa]">
            {photoUrl ? (
              <img alt="" className="h-full w-full object-cover" src={photoUrl} />
            ) : (
              <div className="grid h-full w-full place-items-center text-[#c3cad1]">
                <PersonPlaceholderGlyph />
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-[16px] font-black">
            {[progress.partnerNickname ?? '상대 확인 중', progress.partnerAge ? `${progress.partnerAge}세` : null, progress.partnerJob]
              .filter(Boolean)
              .join(' / ')}
          </p>

          <p className="mt-6 text-center text-[15px] font-black text-[#333]">마음에 드셨나요?</p>
          <HeartRatingInput onChange={setScore} value={score} />
          {score !== null ? (
            <p className="mx-auto mt-1 w-fit rounded-full bg-[#fdeef2] px-3 py-1 text-[13px] font-black text-[#ef4d7a]">
              {score.toFixed(1)}/5 선택
            </p>
          ) : null}

          {copy ? (
            <div className="mt-4 rounded-[16px] bg-[#fdeef2] px-4 py-3 text-center">
              <p className="text-[14px] font-black text-[#ef4d7a]">{copy.title}</p>
              <p className="mt-1 text-[12px] font-bold text-[#c77b93]">{copy.subtitle}</p>
            </div>
          ) : null}

          <div className="mt-5">
            <label className="text-[13px] font-black text-[#555]" htmlFor="rating-memo">
              메모
            </label>
            <textarea
              className="mt-1.5 h-20 w-full resize-none rounded-[14px] border border-[#eee] bg-[#f9fafb] p-3 text-[14px] font-bold outline-none"
              id="rating-memo"
              maxLength={ratingMemoMaxLength}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="상대방에 대한 메모를 작성해보세요 (선택)"
              value={memo}
            />
            <p className="mt-1 text-right text-[11px] font-bold text-[#aaa]">
              {memo.length}/{ratingMemoMaxLength}
            </p>
          </div>

          {submitError ? <p className="mt-2 text-center text-[12px] font-bold text-[#ef554a]">{submitError}</p> : null}

          <button
            className="mt-2 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            disabled={score === null || submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            제출하기
          </button>
        </section>

        {progress.timerUpdatedAt ? (
          <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-[#888]">
            <ClockGlyph />
            다음 라운드 진행까지 <span className="font-black text-meet-blue tabular-nums">{formatCountdown(remaining)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Shown once the server confirms this round's rating is saved. Deliberately
// minimal by design request - no status text, no progress/count of other
// participants, no timer, no buttons - the next-phase transition is handled
// entirely by the outer polling in ParticipantEventScreen re-rendering past
// this component once the server round phase moves on.
function RatingCompleteScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="호감도 작성" />
      <div className="mobile-container mx-auto mt-6 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-14 text-center shadow-calendar">
          <img alt="" className="mx-auto h-[200px] w-[200px] object-contain" src="/assets/rating-complete-heart.png" />
          <p className="mt-6 text-[26px] font-black leading-tight">
            <span style={{ color: '#1c2541' }}>호감도 제출 </span>
            <span style={{ color: '#ef4d7a' }}>완료!</span>
          </p>
          <p className="mt-4 text-[15px] font-bold leading-relaxed" style={{ color: '#4b5468' }}>
            다른 참가자들이 호감도를 작성하는 동안
            <br />
            잠시만 기다려주세요.
          </p>
        </section>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
      <rect height="14" rx="1.5" width="4.5" x="6" y="5" />
      <rect height="14" rx="1.5" width="4.5" x="13.5" y="5" />
    </svg>
  );
}

function HeadsetGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 13v-1a8 8 0 1 1 16 0v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <rect height="7" rx="2" width="4" x="3" y="12" stroke="currentColor" strokeWidth="1.8" />
      <rect height="7" rx="2" width="4" x="17" y="12" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19 19v.5a2.5 2.5 0 0 1-2.5 2.5H13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5.5M12 8v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 12.5 2.5 2.5L16 9.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.2 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <rect height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="5" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ChairGlyph() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M5 10h14l-1 4H6l-1-4Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M6.5 14 6 20M17.5 14l.5 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function PersonPlaceholderGlyph() {
  return (
    <svg aria-hidden="true" className="h-12 w-12" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
