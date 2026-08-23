import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import HeartRatingInput from '../components/HeartRatingInput';
import PrimaryButton from '../components/PrimaryButton';
import {
  createParticipantPauseRequest,
  fetchFinalSelectionCandidatePhotos,
  fetchFinalSelectionCandidates,
  fetchMyBonusRating,
  fetchMyEventTickets,
  fetchMyRoundRating,
  fetchParticipantPartnerPhoto,
  fetchParticipantRoundProgress,
  submitFinalSelection,
  submitMyBonusRating,
  submitRoundRating,
  type FinalSelectionCandidate,
  type FinalSelectionData,
  type MyEventTicket,
  type ParticipantRoundProgress,
} from '../services/supabaseApplications';
import { BONUS_RATING_PHASE_SECONDS, computeLiveElapsedSeconds, formatCountdown, phaseDurationSeconds } from '../utils/roundTimerSync';

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
    return <BonusSeatGuideScreen eventId={eventId} onBack={onBack} progress={progress} />;
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'conversation') {
    return <ConversationScreen eventId={eventId} onBack={onBack} progress={progress} />;
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'transition') {
    return <RatingScreen eventId={eventId} mode="regular" onBack={onBack} progress={progress} />;
  }

  // 추가시간 대화가 끝난 뒤 1분간 기존(정규 라운드) 호감도를 수정하는
  // phase - 새 화면을 만들지 않고 정규 라운드와 같은 RatingScreen을
  // mode="bonus"로 재사용한다(폼 UI 동일, fetch/submit 대상만 다름).
  if (progress.stage === 'bonus_rating') {
    return <RatingScreen eventId={eventId} mode="bonus" onBack={onBack} progress={progress} />;
  }

  // 마지막 추가시간까지 끝난 뒤(또는 추가시간 0회 설정 시 정규 라운드
  // 종료 직후) 도달하는 단계.
  if (progress.stage === 'final_selection') {
    return <FinalSelectionScreen eventId={eventId} onBack={onBack} />;
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

  const phaseDuration = phaseDurationSeconds(progress.roundPhase, progress.isBonusRound, progress.conversationDurationSeconds);
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

// Nickname length has no server-side cap, so font-size is tiered by
// character count rather than assumed short - short nicknames get the big
// wireframe-scale font, long ones shrink and are allowed to wrap onto a
// second line (capped there as a safety net, never overflowing the card).
function nicknameFontStyle(nickname: string): CSSProperties {
  const length = nickname.length;
  const fontSize = length <= 6 ? 'clamp(34px, 11vw, 46px)' : length <= 10 ? 'clamp(26px, 8.5vw, 36px)' : 'clamp(20px, 7vw, 28px)';
  return {
    display: '-webkit-box',
    fontSize,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  };
}

function guidanceFontStyle(text: string): CSSProperties {
  const length = text.length;
  const fontSize = length <= 14 ? 'clamp(19px, 5.6vw, 23px)' : length <= 20 ? 'clamp(16px, 4.8vw, 19px)' : 'clamp(14px, 4.2vw, 16px)';
  return { fontSize };
}

// 첨부 와이어프레임이 이 화면(자리 이동 2분 phase)의 최종 디자인이므로
// 카드 구조/색감/배치를 그대로 재현한다. 남/여 안내 문구만 성별에 따라
// 분기하고, 참가자에게는 숫자 테이블 번호를 절대 노출하지 않는다 -
// event_table_assignments.table_number는 useHelpRequest로 운영자 호출
// 컨텍스트에만 조용히 전달된다.
function BonusSeatGuideScreen({
  eventId,
  onBack,
  progress,
}: {
  eventId: string;
  onBack: () => void;
  progress: ParticipantRoundProgress;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const { errorMessage, sendingType, sendRequest, toast } = useHelpRequest(eventId, progress.tableNumber);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Keyed on partnerApplicationId so a refresh, or landing on a later
  // 추가시간 for a different partner, always re-fetches the right photo
  // rather than keeping a stale one from the previous reveal.
  useEffect(() => {
    let active = true;
    setPhotoUrl(null);
    void fetchParticipantPartnerPhoto(eventId)
      .then((url) => {
        if (active) setPhotoUrl(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId, progress.partnerApplicationId]);

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

  const isFemale = progress.gender === '여성';
  const nickname = progress.partnerNickname ?? '상대 확인 중';
  const moveGuidanceText = `${nickname}님의 테이블로 이동해주세요`;

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-9 text-center shadow-calendar">
          <span className="mx-auto flex w-fit items-center rounded-full bg-meet-blueSoft px-4 py-1.5 text-[13px] font-black text-meet-blue">
            추가시간
          </span>
          <h1 className="mt-4 break-keep text-[26px] font-black leading-tight">다시 만나게 된 행운의 상대</h1>

          <div className="mx-auto mt-6 h-[168px] w-[168px] overflow-hidden rounded-full bg-[#f5f7fa] shadow-[0_10px_24px_rgba(30,43,63,0.12)]">
            {photoUrl ? (
              <img alt="" className="h-full w-full object-cover" src={photoUrl} />
            ) : (
              <div className="grid h-full w-full place-items-center text-[#c3cad1]">
                <PersonPlaceholderGlyph />
              </div>
            )}
          </div>

          <p className="mx-auto mt-5 max-w-full break-words font-black leading-tight" style={nicknameFontStyle(nickname)}>
            {nickname}
          </p>
          <p className="mt-2 text-[15px] font-bold text-[#888]">
            {[progress.partnerAge ? `${progress.partnerAge}세` : null, progress.partnerJob].filter(Boolean).join(' | ')}
          </p>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-[16px] font-extrabold text-[#333]">
            <SmallHeartGlyph />
            곧 이분과 <span className="font-black text-meet-blue">7분간</span> 다시 대화해요
          </p>

          <div className="mt-6 flex items-center gap-3 rounded-[18px] bg-meet-blueSoft px-4 py-4 text-left">
            <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-meet-blue shadow-sm">
              {isFemale ? <SeatedPersonGlyph /> : <ChairGlyph />}
              {!isFemale ? (
                <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-meet-blue text-white">
                  <ArrowRightGlyph />
                </span>
              ) : null}
            </span>
            <p
              className="min-w-0 flex-1 break-keep font-black leading-snug text-[#1c2541]"
              style={guidanceFontStyle(isFemale ? '자리에서 잠시 기다려주세요' : moveGuidanceText)}
            >
              {isFemale ? (
                '자리에서 잠시 기다려주세요'
              ) : (
                <>
                  <span className="break-words">{nickname}</span>님의 테이블로 이동해주세요
                </>
              )}
            </p>
          </div>

          {progress.timerUpdatedAt ? (
            <div className="mt-6 flex flex-col items-center gap-1">
              <p className="flex items-center gap-1.5 text-[13px] font-black text-meet-blue">
                <ClockGlyph />
              </p>
              <p className="text-[40px] font-black tabular-nums leading-none text-meet-blue">{formatCountdown(remaining)}</p>
              <p className="mt-1 text-[13px] font-bold text-[#888]">
                {isFemale ? '자리에서 기다리며 다음 대화를 준비해주세요' : '안내에 따라 이동한 뒤 대화를 준비해주세요'}
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
          <h2 className="text-[16px] font-black">도움이 필요하신가요?</h2>
          <div className="mt-4">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-meet-blue text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'call_staff'}
              onClick={() => void sendRequest('call_staff')}
              type="button"
            >
              <HeadsetGlyph />
              운영자 호출
            </button>
          </div>
          {errorMessage ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{errorMessage}</p> : null}
        </section>
      </div>

      <ToastBanner toast={toast} />
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

// 2분 이동 및 호감도 작성 phase(mode="regular"): the participant rates the
// partner they were just matched with (progress.roundPhase === 'transition'
// still resolves to that just-finished round's match, since current_round
// only advances once this phase itself expires). Editing is allowed for as
// long as the server still reports this same round as current -
// submit_round_rating enforces that server-side too.
//
// 추가시간 1분 호감도 수정 phase(mode="bonus"): 새 rating을 만드는 게
// 아니라 정규 라운드에서 이미 이 상대에게 남긴 점수를 서버가 찾아 수정하는
// 구조라, "기존 값이 이미 있음 = 방금 제출 완료"로 취급하면 안 된다(항상
// 값이 있을 수밖에 없음) - submitted는 이 phase에서 실제로 제출 버튼을
// 눌렀을 때만 true가 된다. 폼 UI 자체는 정규/추가시간 모두 동일하게
// 재사용한다.
function RatingScreen({
  eventId,
  mode,
  onBack,
  progress,
}: {
  eventId: string;
  mode: 'bonus' | 'regular';
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

  // Reloads on (eventId, mode, roundNumber) change - covers first entry,
  // refresh, AND landing back on this phase for a new round/추가시간 without
  // a full page reload in between (RatingScreen doesn't unmount between a
  // regular rating and a bonus rating, or between two bonus ratings - same
  // component type, just re-rendered with new props).
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
    const fetchExisting = mode === 'bonus' ? fetchMyBonusRating(eventId) : fetchMyRoundRating(eventId, roundNumber);
    void fetchExisting
      .then((existing) => {
        if (!active) return;
        if (existing.score !== undefined) setScore(existing.score);
        if (existing.memo) setMemo(existing.memo);
        setSubmitted(mode === 'bonus' ? false : existing.score !== undefined);
      })
      .catch(() => {
        if (active) setSubmitted(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, mode, roundNumber]);

  const phaseDuration = mode === 'bonus' ? BONUS_RATING_PHASE_SECONDS : phaseDurationSeconds('transition');
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
      if (mode === 'bonus') {
        await submitMyBonusRating(eventId, score, memo);
      } else {
        await submitRoundRating(eventId, roundNumber, score, memo);
      }
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
            {mode === 'bonus' ? '다음 단계까지' : '다음 라운드 진행까지'}{' '}
            <span className="font-black text-meet-blue tabular-nums">{formatCountdown(remaining)}</span>
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

// 최종 선택(5단계: 안내 -> 선택하기 -> 선택 확인 -> 제출 확인 -> 완료).
// stage는 서버가 'final_selection' 하나만 보고하므로, 5단계 중 어디에 있는지는
// 이 컴포넌트 안의 로컬 상태로 관리한다 - 단 "이미 제출했는가"만큼은 절대
// 로컬 상태로 판단하지 않고 매번 서버(get_final_selection_candidates의
// submitted)를 기준으로 삼는다. 그래야 새로고침/뒤로가기/직접 URL 접근 어떤
// 경로로 이 화면에 재진입해도 이미 제출한 사람은 항상 곧바로 완료 화면만
// 보고, 선택을 다시 바꿀 수 없다.
function FinalSelectionScreen({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<FinalSelectionData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [photoMap, setPhotoMap] = useState<Map<string, string>>(new Map());
  const [step, setStep] = useState<'announce' | 'pick' | 'review'>('announce');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void fetchFinalSelectionCandidates(eventId)
      .then((result) => {
        if (!active) return;
        setData(result);
        setSelectedIds(result.selectedApplicationIds);
      })
      .catch((caughtError) => {
        if (active) setLoadError(caughtError instanceof Error ? caughtError.message : '불러오지 못했습니다.');
      });
    void fetchFinalSelectionCandidatePhotos(eventId)
      .then((map) => {
        if (active) setPhotoMap(map);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    return () => window.clearTimeout(toastTimerRef.current);
  }, []);

  if (!data) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">{loadError || '불러오는 중'}</p>
        </div>
      </div>
    );
  }

  if (data.submitted || justSubmitted) {
    return <FinalSelectionCompleteScreen onGoHome={() => navigate('/my-events')} />;
  }

  const limit = data.finalSelectionLimit;

  const handleToggle = (applicationId: string) => {
    setSelectedIds((current) => {
      if (current.includes(applicationId)) return current.filter((id) => id !== applicationId);
      if (current.length >= limit) {
        window.clearTimeout(toastTimerRef.current);
        setToast(`최대 ${limit}명까지 선택할 수 있어요`);
        toastTimerRef.current = window.setTimeout(() => setToast(''), toastDisplayMs);
        return current;
      }
      return [...current, applicationId];
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitFinalSelection(eventId, selectedIds);
      setConfirmOpen(false);
      setJustSubmitted(true);
    } catch (caughtError) {
      setSubmitError(caughtError instanceof Error ? caughtError.message : '제출하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'announce') {
    return <FinalSelectionAnnounceScreen limit={limit} onBack={onBack} onStart={() => setStep('pick')} />;
  }

  if (step === 'pick') {
    return (
      <>
        <FinalSelectionPickScreen
          candidates={data.candidates}
          limit={limit}
          onBack={() => setStep('announce')}
          onNext={() => setStep('review')}
          onToggle={handleToggle}
          photoMap={photoMap}
          selectedIds={selectedIds}
        />
        <ToastBanner toast={toast} />
      </>
    );
  }

  const selectedCandidates = data.candidates.filter((candidate) => selectedIds.includes(candidate.applicationId));

  return (
    <>
      <FinalSelectionReviewScreen
        onBack={() => setStep('pick')}
        onReselect={() => setStep('pick')}
        onSubmitClick={() => setConfirmOpen(true)}
        photoMap={photoMap}
        selectedCandidates={selectedCandidates}
      />
      {confirmOpen ? (
        <FinalSelectionSubmitConfirmModal
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void handleSubmit()}
          submitError={submitError}
          submitting={submitting}
        />
      ) : null}
    </>
  );
}

function FinalSelectionAnnounceScreen({ limit, onBack, onStart }: { limit: number; onBack: () => void; onStart: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />
      <div className="mobile-container mx-auto mt-6 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-10 text-center shadow-calendar">
          <p className="text-[15px] font-black text-meet-blue">이제 마지막 단계예요!</p>
          <h1 className="mt-3 break-keep text-[26px] font-black leading-tight">
            마음에 드는 분을
            <br />
            최대 {limit}명 선택해주세요
          </h1>

          <div className="mt-8 space-y-4 border-t border-[#f0f0f0] pt-6 text-left">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fdeef2] text-[#ef4d7a]">
                <SmallHeartGlyph />
              </span>
              <p className="mt-1.5 text-[14px] font-extrabold leading-snug text-[#333]">
                추가시간까지 함께한 모든 분 중<br />
                마음에 드는 분을 선택해주세요
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-meet-blueSoft text-meet-blue">
                <PencilGlyph />
              </span>
              <p className="mt-1.5 text-[14px] font-extrabold leading-snug text-[#333]">
                최대 {limit}명까지 선택할 수 있어요
                <br />
                (선택하지 않아도 괜찮아요)
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f5f7fa] text-[#666]">
                <LockGlyph />
              </span>
              <p className="mt-1.5 text-[14px] font-extrabold leading-snug text-[#333]">
                선택 결과는 매칭이 된 상대에게만
                <br />
                공개됩니다.
              </p>
            </div>
          </div>

          <button
            className="mt-8 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
            onClick={onStart}
            type="button"
          >
            선택 시작하기
          </button>
        </section>
      </div>
    </div>
  );
}

function FinalSelectionPickScreen({
  candidates,
  limit,
  onBack,
  onNext,
  onToggle,
  photoMap,
  selectedIds,
}: {
  candidates: FinalSelectionCandidate[];
  limit: number;
  onBack: () => void;
  onNext: () => void;
  onToggle: (applicationId: string) => void;
  photoMap: Map<string, string>;
  selectedIds: string[];
}) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="최종 선택" />

      <div className="mobile-container mx-auto mt-5 flex flex-col gap-3 pb-32">
        <p className="text-center text-[14px] font-bold text-[#888]">
          마음에 드는 분을 선택해주세요
          <br />
          <span className="text-[12px] text-[#aaa]">최대 {limit}명 선택 가능</span>
        </p>

        {candidates.map((candidate) => (
          <FinalSelectionCandidateCard
            candidate={candidate}
            key={candidate.applicationId}
            onToggle={() => onToggle(candidate.applicationId)}
            photoUrl={photoMap.get(candidate.applicationId)}
            selected={selectedIds.includes(candidate.applicationId)}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-[#f0f0f0] bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 min-[380px]:px-5">
        <div className="mobile-container mx-auto flex items-center gap-3">
          <p className="shrink-0 text-[14px] font-black text-[#333]">
            선택 {selectedIds.length} / {limit}명
          </p>
          <button
            className="h-12 flex-1 rounded-[14px] bg-meet-blue text-[15px] font-black text-white transition active:scale-[0.99]"
            onClick={onNext}
            type="button"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  );
}

function FinalSelectionCandidateCard({
  candidate,
  onToggle,
  photoUrl,
  selected,
}: {
  candidate: FinalSelectionCandidate;
  onToggle: () => void;
  photoUrl?: string;
  selected: boolean;
}) {
  return (
    <div className="rounded-[20px] border border-[#f0f3f6] bg-white p-3 shadow-calendar">
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-[#f5f7fa]">
          {photoUrl ? (
            <img alt="" className="h-full w-full object-cover" src={photoUrl} />
          ) : (
            <div className="grid h-full w-full place-items-center text-[#c3cad1]">
              <PersonPlaceholderGlyph />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {candidate.rank ? (
                  <span className="shrink-0 rounded-full bg-[#fdeef2] px-2 py-0.5 text-[11px] font-black text-[#ef4d7a]">{candidate.rank}위</span>
                ) : null}
                <p className="truncate text-[16px] font-black">{candidate.nickname}</p>
              </div>
              <p className="mt-0.5 text-[13px] font-bold text-[#999]">
                {[candidate.age ? `${candidate.age}세` : null, candidate.job].filter(Boolean).join(' · ')}
              </p>
            </div>

            <button
              aria-label={selected ? '선택 해제' : '선택하기'}
              className={[
                'grid h-9 w-9 shrink-0 place-items-center rounded-full transition active:scale-95',
                selected ? 'bg-[#ef4d7a] text-white' : 'bg-[#f5f7fa] text-[#c3cad1]',
              ].join(' ')}
              onClick={onToggle}
              type="button"
            >
              <HeartToggleGlyph filled={selected} />
            </button>
          </div>

          {candidate.score !== undefined ? (
            <p className="mt-2 flex items-center gap-1 text-[12px] font-black text-[#ef4d7a]">
              <SmallHeartGlyph />
              내 호감도 {candidate.score.toFixed(1)}
            </p>
          ) : null}

          {candidate.memo ? <p className="mt-1.5 line-clamp-2 text-[12px] font-bold leading-snug text-[#888]">{candidate.memo}</p> : null}
        </div>
      </div>
    </div>
  );
}

// 선택 확인 화면(3번) - 문구는 요청대로 최소화: "최종 선택" 타이틀 하나와
// 선택한 사람 목록뿐, "선택을 완료했어요" 류 설명 문구는 추가하지 않는다.
function FinalSelectionReviewScreen({
  onBack,
  onReselect,
  onSubmitClick,
  photoMap,
  selectedCandidates,
}: {
  onBack: () => void;
  onReselect: () => void;
  onSubmitClick: () => void;
  photoMap: Map<string, string>;
  selectedCandidates: FinalSelectionCandidate[];
}) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="최종 선택" />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-4 pb-8">
        {selectedCandidates.length === 0 ? (
          <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-12 text-center shadow-calendar">
            <p className="text-[15px] font-extrabold text-[#888]">선택한 분이 없어요</p>
          </section>
        ) : (
          <div className="flex flex-col gap-2.5">
            {selectedCandidates.map((candidate, index) => (
              <div className="flex items-center gap-3 rounded-[18px] border border-[#f0f3f6] bg-white p-3 shadow-calendar" key={candidate.applicationId}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fdeef2] text-[11px] font-black text-[#ef4d7a]">
                  {index + 1}
                </span>
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[#f5f7fa]">
                  {photoMap.get(candidate.applicationId) ? (
                    <img alt="" className="h-full w-full object-cover" src={photoMap.get(candidate.applicationId)} />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[#c3cad1]">
                      <PersonPlaceholderGlyph />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-black">{candidate.nickname}</p>
                  <p className="text-[12px] font-bold text-[#999]">
                    {[candidate.age ? `${candidate.age}세` : null, candidate.job].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <SmallHeartGlyph />
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2">
          <button
            className="h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
            onClick={onSubmitClick}
            type="button"
          >
            제출하기
          </button>
          <button
            className="h-12 w-full rounded-[16px] border border-[#e5e5e5] text-[14px] font-black text-[#555] transition active:scale-[0.99]"
            onClick={onReselect}
            type="button"
          >
            다시 선택하기
          </button>
        </div>
      </div>
    </div>
  );
}

function FinalSelectionSubmitConfirmModal({
  onCancel,
  onConfirm,
  submitError,
  submitting,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  submitError: string;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div
        className="w-full max-w-[520px] rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <h3 className="mt-4 text-center text-[18px] font-black">선택을 제출하시겠어요?</h3>
        <p className="mt-2 text-center text-[13px] font-bold text-[#999]">제출 후에는 수정할 수 없어요.</p>

        {submitError ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{submitError}</p> : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            className="h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99] disabled:opacity-60"
            disabled={submitting}
            onClick={onConfirm}
            type="button"
          >
            {submitting ? '제출하는 중' : '제출하기'}
          </button>
          <button
            className="h-12 w-full rounded-[16px] text-[14px] font-black text-[#999] disabled:opacity-60"
            disabled={submitting}
            onClick={onCancel}
            type="button"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// 완료 화면(5번) - 요청대로 문구/버튼 딱 두 개만: 완료 문구 + 메인화면으로
// 돌아가기. 결과 공개/마이페이지 안내 등은 이번 범위에서 의도적으로 제외.
function FinalSelectionCompleteScreen({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <div className="mobile-container mx-auto mt-16 pb-8">
        <img alt="" className="mx-auto h-[180px] w-[180px] object-contain" src="/assets/rating-complete-heart.png" />
        <p className="mt-8 text-center text-[24px] font-black leading-tight">최종 선택이 완료되었어요!</p>
        <button
          className="mt-10 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
          onClick={onGoHome}
          type="button"
        >
          메인화면으로 돌아가기
        </button>
      </div>
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="m13 7 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function HeartToggleGlyph({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path
        d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z"
        strokeLinejoin="round"
      />
    </svg>
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

function SmallHeartGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-meet-blue" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

function ArrowRightGlyph() {
  return (
    <svg aria-hidden="true" className="h-3 w-3" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h13M13 6l7 6-7 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function SeatedPersonGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 18v-3.5a5 5 0 0 1 10 0V18M6 20h12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
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
