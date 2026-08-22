import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConversationTopicDeck from '../components/ConversationTopicDeck';
import { DataLoadingState } from '../components/DataState';
import {
  fetchEventProgressForTablet,
  fetchEventTableSeatGuide,
  fetchRoundProgressForTablet,
  type EventProgress,
  type EventTableSeatGuide,
  type TabletRoundProgress,
} from '../services/supabaseApplications';
import { computeLiveVideoPosition, VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS } from '../utils/introVideoSync';
import { computeLiveElapsedSeconds, formatCountdown, phaseDurationSeconds } from '../utils/roundTimerSync';

const storageKey = 'time2meet.tabletConnection';
const progressPollIntervalMs = 3_000;
const seatPollIntervalMs = 5_000;
const roundPollIntervalMs = 3_000;

interface StoredTabletConnection {
  connectionToken: string;
  eventId: string;
  tableNumber: number;
}

function readStoredConnection(eventId: string, tableNumber: number): StoredTabletConnection | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabletConnection;
    if (parsed.eventId !== eventId || parsed.tableNumber !== tableNumber || !parsed.connectionToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStoredConnection() {
  window.localStorage.removeItem(storageKey);
}

// The tablet's whole "what am I showing right now" lives here, driven by the
// server-side event stage: 자리유도 -> 소개영상 -> 라운드대기 -> 라운드진행 ->
// 종료. Each stage renders its own small view below rather than routing to
// separate pages, so the transition is automatic (no tap required on the
// tablet) - matching how a physical table tablet needs to behave unattended.
export default function AdminTabletSeatPage() {
  const navigate = useNavigate();
  const { eventId, tableNumber: tableNumberParam } = useParams();
  const tableNumber = Number(tableNumberParam);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [progress, setProgress] = useState<EventProgress | null>(null);
  const [seatGuide, setSeatGuide] = useState<EventTableSeatGuide | null>(null);
  const [roundProgress, setRoundProgress] = useState<TabletRoundProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoMuted, setVideoMuted] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Primary heartbeat + stage driver. This is also what proves the
  // connection is still valid server-side, so an admin disconnect bounces
  // the tablet back to the number-selection screen within one poll tick.
  useEffect(() => {
    if (!eventId || !Number.isFinite(tableNumber)) return;
    let active = true;

    const goToConnect = () => {
      clearStoredConnection();
      navigate(`/admin/events/${eventId}/tablet-connect`, { replace: true });
    };

    const poll = async () => {
      const stored = readStoredConnection(eventId, tableNumber);
      if (!stored) {
        goToConnect();
        return;
      }
      try {
        const result = await fetchEventProgressForTablet(eventId, tableNumber, stored.connectionToken);
        if (!active) return;
        if (!result.ok) {
          goToConnect();
          return;
        }
        setProgress(result);
        setLoading(false);
      } catch {
        if (active) setLoading(false);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), progressPollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, navigate, tableNumber]);

  // Seat-guide participant names only matter (and are only fetched) while
  // actually on that stage.
  useEffect(() => {
    if (!eventId || !Number.isFinite(tableNumber) || progress?.stage !== 'seat_guide') return;
    let active = true;

    const poll = async () => {
      const stored = readStoredConnection(eventId, tableNumber);
      if (!stored) return;
      try {
        const result = await fetchEventTableSeatGuide(eventId, tableNumber, stored.connectionToken);
        if (active && result.ok) setSeatGuide(result);
      } catch {
        // Connectivity failures are already handled by the progress poll above.
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), seatPollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, tableNumber, progress?.stage]);

  // Round timer/matching only matters once the round stage is reached.
  const isRoundStage = progress?.stage === 'round_active' || progress?.stage === 'round_complete';
  useEffect(() => {
    if (!eventId || !Number.isFinite(tableNumber) || !isRoundStage) return undefined;
    let active = true;

    const poll = async () => {
      const stored = readStoredConnection(eventId, tableNumber);
      if (!stored) return;
      try {
        const result = await fetchRoundProgressForTablet(eventId, tableNumber, stored.connectionToken);
        if (active && result.ok) setRoundProgress(result);
      } catch {
        // Connectivity failures are already handled by the progress poll above.
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), roundPollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, tableNumber, isRoundStage]);

  useEffect(() => {
    if (!isRoundStage) return undefined;
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [isRoundStage]);

  // Keep the <video> element in step with the server snapshot: correct
  // noticeable drift, and mirror play/pause without fighting local playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !progress || progress.stage !== 'intro_video' || !progress.introVideoUrl) return;

    const livePosition = computeLiveVideoPosition(progress);
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - livePosition) > VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS) {
      video.currentTime = livePosition;
    }
    if (progress.introVideoStatus === 'playing' && video.paused) {
      video.play().catch(() => {
        // Autoplay-with-sound is commonly blocked without a fresh user
        // gesture on a tablet sitting unattended - fall back to muted
        // playback so the video still starts, and offer a tap to unmute.
        video.muted = true;
        setVideoMuted(true);
        void video.play().catch(() => undefined);
      });
    } else if (progress.introVideoStatus === 'paused' && !video.paused) {
      video.pause();
    }
  }, [progress]);

  if (loading || !progress) return <DataLoadingState />;

  if (progress.stage === 'intro_video') {
    return (
      <main className="fixed inset-0 bg-black">
        {progress.introVideoUrl ? (
          <video
            className="h-full w-full object-contain"
            onLoadedMetadata={(changeEvent) => setVideoDuration(changeEvent.currentTarget.duration)}
            onTimeUpdate={(changeEvent) => setDisplayTime(changeEvent.currentTarget.currentTime)}
            playsInline
            ref={videoRef}
            src={progress.introVideoUrl}
          />
        ) : (
          <div className="grid h-full w-full place-items-center px-10 text-center">
            <p className="text-[16px] font-bold text-white/70">소개영상을 준비 중이에요</p>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-6 pt-5 text-white">
          <span className="flex items-center gap-2 text-[13px] font-black tracking-wide">
            {progress.introVideoStatus === 'playing' ? <PlayGlyph /> : <PauseGlyph />}
            {progress.introVideoStatus === 'playing' ? '소개영상 재생 중' : '일시정지'}
          </span>
          {videoDuration > 0 ? <span className="text-[13px] font-black tabular-nums">{formatDuration(displayTime)}</span> : null}
        </div>

        {videoDuration > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-6">
            <div className="flex items-center justify-between text-[12px] font-bold text-white/80">
              <span>{formatDuration(displayTime)}</span>
              <span>{formatDuration(videoDuration)}</span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-[#ef554a]" style={{ width: `${Math.min(100, (displayTime / videoDuration) * 100)}%` }} />
            </div>
          </div>
        ) : null}

        {videoMuted ? (
          <button
            className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-5 py-2.5 text-[14px] font-black text-black"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                setVideoMuted(false);
              }
            }}
            type="button"
          >
            🔇 탭하여 소리 켜기
          </button>
        ) : null}
      </main>
    );
  }

  if (progress.stage === 'round_waiting') {
    return (
      <main className="fixed inset-0 grid place-items-center bg-white px-10 text-center text-[#1f292d]">
        <div>
          <p className="text-[20px] font-black text-[#ef554a]">소개영상 종료</p>
          <p className="mt-4 text-[32px] font-black leading-snug">소개팅 시작 대기 중</p>
          <p className="mt-3 text-[14px] font-bold text-[#888]">운영자가 라운드를 시작하면 자동으로 전환됩니다</p>
        </div>
      </main>
    );
  }

  if (progress.stage === 'round_complete') {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white">
        <div>
          <p className="text-[20px] font-black text-[#ff8a80]">모든 라운드 종료</p>
          <p className="mt-4 text-[28px] font-black">수고하셨습니다</p>
        </div>
      </main>
    );
  }

  if (progress.stage === 'round_active') {
    if (!roundProgress) return <DataLoadingState />;
    const phaseDuration = phaseDurationSeconds(roundProgress.roundPhase);
    const remaining = Math.max(0, phaseDuration - computeLiveElapsedSeconds({
      timerPositionSeconds: roundProgress.timerPositionSeconds ?? 0,
      timerStatus: roundProgress.timerStatus ?? 'paused',
      timerUpdatedAt: roundProgress.timerUpdatedAt,
    }, nowTick));
    const currentRound = roundProgress.currentRound ?? progress.currentRound ?? 1;

    if (roundProgress.roundPhase === 'transition') {
      return (
        <main className="fixed inset-0 flex overflow-hidden bg-[#1f292d] text-white">
          <div className="m-auto text-center">
            <p className="text-[18px] font-black text-[#ff8a80]">{currentRound}라운드 · 이동 및 호감도 작성</p>
            <p className="mt-6 text-[64px] font-black leading-none tabular-nums">{formatCountdown(remaining)}</p>
            <div className="mt-10 flex items-center justify-center gap-8">
              <p className="text-[clamp(36px,8vw,90px)] font-black leading-none text-[#8ec7ff]">{roundProgress.maleNickname ?? '미배정'}</p>
              <span className="text-[28px] font-black text-white/40">&amp;</span>
              <p className="text-[clamp(36px,8vw,90px)] font-black leading-none text-[#ffb0c4]">{roundProgress.femaleNickname ?? '미배정'}</p>
            </div>
          </div>
        </main>
      );
    }

    const stored = readStoredConnection(eventId ?? '', tableNumber);

    return (
      <main
        className="fixed inset-0 flex items-center overflow-hidden text-[#1f292d]"
        style={{ background: 'radial-gradient(120% 140% at 12% 0%, #fff6f2 0%, #ffeae3 45%, #ffe0d8 100%)' }}
      >
        <div className="flex h-full w-full items-center justify-between gap-[3vw] px-[6vw]">
          <div className="flex flex-1 items-center justify-center">
            <RoundTimerRing
              phaseLabel="10분 대화"
              phaseDuration={phaseDuration}
              remaining={remaining}
              roundLabel={`${currentRound}라운드 진행 중`}
            />
          </div>
          <div className="w-[24vw] max-w-[300px] min-w-[190px] shrink-0">
            {stored?.connectionToken && eventId ? (
              <ConversationTopicDeck connectionToken={stored.connectionToken} eventId={eventId} tableNumber={tableNumber} />
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  if (progress.stage === 'ended') {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white">
        <p className="text-[22px] font-black">행사가 종료되었습니다</p>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 flex overflow-hidden">
      <span className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-[13px] font-black tracking-[0.35em] text-[#8a94a6]">
        <span className="mr-3">—</span>
        SEAT GUIDE
        <span className="ml-3">—</span>
      </span>

      <SeatSide gradient="linear-gradient(135deg,#cfe0f5,#eef4fc)" nickname={seatGuide?.maleNickname} textColor="#1f3a6b" />
      <div className="relative w-px shrink-0 bg-black/10">
        <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center text-[15px] font-black text-[#999]">&amp;</span>
      </div>
      <SeatSide gradient="linear-gradient(225deg,#f7d7e2,#fbeaf0)" nickname={seatGuide?.femaleNickname} textColor="#7a2145" />
    </main>
  );
}

function RoundTimerRing({
  phaseDuration,
  phaseLabel,
  remaining,
  roundLabel,
}: {
  phaseDuration: number;
  phaseLabel: string;
  remaining: number;
  roundLabel: string;
}) {
  const elapsedFraction = phaseDuration > 0 ? Math.min(1, Math.max(0, 1 - remaining / phaseDuration)) : 0;
  const size = 100;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - elapsedFraction);
  const angleRad = ((-90 + 360 * elapsedFraction) * Math.PI) / 180;
  const dotX = size / 2 + radius * Math.cos(angleRad);
  const dotY = size / 2 + radius * Math.sin(angleRad);

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ height: 'clamp(340px, 62vh, 620px)', width: 'clamp(340px, 62vh, 620px)' }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} fill="none" r={radius} stroke="#f6dcd6" strokeWidth={strokeWidth} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke="#e17b6b"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </g>
      </svg>
      {elapsedFraction > 0 ? (
        <span
          className="absolute h-[3%] w-[3%] rounded-full bg-[#e17b6b] shadow-[0_0_0_5px_rgba(225,123,107,0.18)]"
          style={{ left: `${dotX}%`, top: `${dotY}%`, transform: 'translate(-50%, -50%)' }}
        />
      ) : null}
      <div className="px-[8%] text-center">
        <p className="text-[clamp(13px,1.9vh,19px)] font-black tracking-wide text-[#c98276]">{roundLabel}</p>
        <p className="mt-1 text-[clamp(10px,1.4vh,14px)] font-bold text-[#d9a79d]">{phaseLabel}</p>
        <p className="mt-3 text-[clamp(56px,10.2vh,124px)] font-black leading-none text-[#a34237]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCountdown(remaining)}
        </p>
      </div>
    </div>
  );
}

function SeatSide({ gradient, nickname, textColor }: { gradient: string; nickname?: string; textColor: string }) {
  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center px-6" style={{ backgroundImage: gradient }}>
      {nickname ? (
        <p className="text-fluid-safe max-w-full break-keep text-center text-[clamp(40px,9vw,120px)] font-black leading-none" style={{ color: textColor }}>
          {nickname}
        </p>
      ) : (
        <p className="text-[clamp(16px,2.4vw,22px)] font-black" style={{ color: `${textColor}99` }}>
          자리 배정 대기 중
        </p>
      )}
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function PlayGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
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
