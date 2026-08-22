import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import PrimaryButton from '../components/PrimaryButton';
import {
  createParticipantPauseRequest,
  fetchMyEventTickets,
  fetchParticipantRoundProgress,
  type MyEventTicket,
  type ParticipantRoundProgress,
} from '../services/supabaseApplications';

const progressPollIntervalMs = 4_000;

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
  // typed-in URL can't skip it.
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
      <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-10rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
        <BottomTabs />
      </main>
    );
  }

  if (!ticket) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-10rem)] place-items-center">
          <section className="w-full rounded-[30px] bg-white p-6 text-center shadow-calendar">
            <p className="text-[14px] font-black text-meet-blue">입장 확인 필요</p>
            <h1 className="mt-3 text-[27px] font-black leading-tight">아직 입장할 수 없어요</h1>
            <p className="mt-4 text-[15px] font-extrabold leading-relaxed text-[#777]">행사 당일 운영자의 QR 인증 후 입장할 수 있어요.</p>
            <PrimaryButton className="mt-6" onClick={() => navigate('/my-events')}>
              내 행사로 돌아가기
            </PrimaryButton>
          </section>
        </div>
        <BottomTabs />
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-white with-bottom-tabs text-black">
      <ParticipantEventScreen eventId={ticket.eventId} progress={progress} />
      <BottomTabs />
    </main>
  );
}

function ParticipantEventScreen({ eventId, progress }: { eventId: string; progress: ParticipantRoundProgress | null }) {
  const navigate = useNavigate();

  if (!progress) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-10rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </div>
    );
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'conversation') {
    return <ConversationScreen eventId={eventId} onBack={() => navigate(`/my-events/ticket/${eventId}`)} progress={progress} />;
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'transition') {
    return <TransitionScreen onBack={() => navigate(`/my-events/ticket/${eventId}`)} progress={progress} />;
  }

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={() => navigate(`/my-events/ticket/${eventId}`)} />
      <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
        <section className="w-full rounded-[30px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
          <p className="text-[18px] font-black leading-tight">
            {progress.stage === 'round_complete' || progress.stage === 'ended' ? '행사가 마무리되었습니다' : '곧 라운드가 시작됩니다'}
          </p>
          <p className="mt-3 text-[14px] font-extrabold text-[#888]">잠시만 기다려주세요</p>
        </section>
      </div>
    </div>
  );
}

function ScreenHeader({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  return (
    <header className="mx-auto flex w-full max-w-[520px] items-center justify-between">
      <button aria-label="뒤로가기" className="grid h-10 w-10 place-items-center text-[#333]" onClick={onBack} type="button">
        <BackIcon />
      </button>
      <button
        className="rounded-[10px] border border-[#e5e5e5] px-3 py-2 text-[13px] font-black text-[#777]"
        onClick={() => navigate('/my-events')}
        type="button"
      >
        나가기
      </button>
    </header>
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
  const [pauseState, setPauseState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [callState, setCallState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const roundKey = useRef(`${progress.currentRound ?? 0}-${progress.roundPhase ?? ''}`);

  // A new round/phase is a legitimately new context - let the buttons be
  // pressed again rather than staying permanently "요청 완료" from a
  // previous round.
  useEffect(() => {
    const key = `${progress.currentRound ?? 0}-${progress.roundPhase ?? ''}`;
    if (roundKey.current !== key) {
      roundKey.current = key;
      setPauseState('idle');
      setCallState('idle');
    }
  }, [progress.currentRound, progress.roundPhase]);

  const sendRequest = async (type: 'call_staff' | 'pause') => {
    if (!progress.tableNumber) return;
    const setState = type === 'pause' ? setPauseState : setCallState;
    setState('sending');
    setErrorMessage('');
    try {
      await createParticipantPauseRequest(eventId, progress.tableNumber, type);
      setState('sent');
    } catch (caughtError) {
      setState('idle');
      setErrorMessage(caughtError instanceof Error ? caughtError.message : '요청을 전달하지 못했습니다.');
    }
  };

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        <section className="rounded-[28px] border border-[#f0f3f6] bg-white px-6 py-10 text-center shadow-calendar">
          <p className="text-[15px] font-black text-meet-blue">현재 대화 중</p>
          <p className="text-fluid-safe mt-4 break-keep text-[clamp(40px,11vw,56px)] font-black leading-none">
            {progress.partnerNickname ?? '상대 확인 중'}
          </p>
        </section>

        <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
          <h2 className="text-[16px] font-black">도움이 필요할 때</h2>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-meet-blueSoft text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={pauseState !== 'idle'}
              onClick={() => void sendRequest('pause')}
              type="button"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-meet-blue text-white">
                <PauseGlyph />
              </span>
              {pauseState === 'sent' ? '요청 완료' : '일시정지 요청'}
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">
              {pauseState === 'sent' ? '운영자에게 요청이 전달되었습니다' : '운영자에게 일시정지 요청이 전달됩니다'}
            </p>
          </div>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-meet-blue text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={callState !== 'idle'}
              onClick={() => void sendRequest('call_staff')}
              type="button"
            >
              <HeadsetGlyph />
              {callState === 'sent' ? '요청 완료' : '운영자 호출'}
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">
              {callState === 'sent' ? '운영자에게 요청이 전달되었습니다' : '운영자가 직접 테이블로 와서 도와드립니다'}
            </p>
          </div>

          {errorMessage ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{errorMessage}</p> : null}

          <div className="mt-4 flex items-center gap-2 rounded-[16px] bg-[#f5f7fa] px-4 py-3 text-[12px] font-bold text-[#888]">
            <InfoGlyph />
            대화가 끝나면 호감도 작성 및 자리 이동 화면으로 자동 전환됩니다
          </div>
        </section>
      </div>
    </div>
  );
}

// The 2분 이동 및 호감도 작성 phase gets its own real screen later - this is
// just enough to prove the phase-driven auto-switch works end to end.
function TransitionScreen({ onBack }: { onBack: () => void; progress: ParticipantRoundProgress }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />
      <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
        <section className="w-full rounded-[30px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
          <p className="text-[18px] font-black leading-tight">호감도 작성 및 자리 이동 중이에요</p>
          <p className="mt-3 text-[14px] font-extrabold text-[#888]">잠시 후 다음 라운드 대화가 시작됩니다</p>
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
