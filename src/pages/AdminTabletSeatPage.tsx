import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConnectionStatusBanner from '../components/ConnectionStatusBanner';
import ConversationTopicDeck from '../components/ConversationTopicDeck';
import { DataLoadingState } from '../components/DataState';
import TimerAlertToast from '../components/TimerAlertToast';
import { useTabletTimerAlerts } from '../hooks/useTabletTimerAlerts';
import {
  fetchEventProgressForTablet,
  fetchEventTableSeatGuide,
  fetchRoundProgressForTablet,
  type EventProgress,
  type EventTableSeatGuide,
  type TabletRoundProgress,
} from '../services/supabaseApplications';
import { isConnectionStale } from '../utils/connectionStatus';
import { computeLiveVideoPosition, VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS } from '../utils/introVideoSync';
import { createRequestGuard } from '../utils/requestGuard';
import { BONUS_RATING_PHASE_SECONDS, computeLiveElapsedSeconds, formatCountdown, phaseDurationSeconds } from '../utils/roundTimerSync';

const storageKey = 'time2meet.tabletConnection';
const progressPollIntervalMs = 3_000;
const seatPollIntervalMs = 5_000;
const roundPollIntervalMs = 3_000;
const tabletConnectionBannerLines = ['인터넷에 연결되어 있지 않습니다.', '연결을 확인해주세요.'];

// Near-white with only a whisper of warm pink (top-left) and lavender
// (bottom-right) - deliberately not a solid peach/pink fill.
const tabletBackground: React.CSSProperties = {
  background: [
    'radial-gradient(58% 50% at 16% 8%, rgba(255,214,203,0.4) 0%, rgba(255,214,203,0) 70%)',
    'radial-gradient(50% 45% at 88% 92%, rgba(222,212,244,0.28) 0%, rgba(222,212,244,0) 72%)',
    '#fffdfc',
  ].join(', '),
};

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
  // Distinguishes "haven't heard back yet" from "asked and there's really
  // nothing there" - without this, a genuinely missing assignment renders
  // identically to the brief moment before the first poll resolves, which is
  // exactly the "looks normal but isn't" failure mode this screen must not
  // have.
  const [seatGuideAttempted, setSeatGuideAttempted] = useState(false);
  const [seatGuideRetryTick, setSeatGuideRetryTick] = useState(0);
  const [roundProgress, setRoundProgress] = useState<TabletRoundProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoMuted, setVideoMuted] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [connTick, setConnTick] = useState(() => Date.now());
  const progressGuardRef = useRef(createRequestGuard());
  const seatGuideGuardRef = useRef(createRequestGuard());
  const roundGuardRef = useRef(createRequestGuard());

  // Always-on 1s tick for the connection-status banner, independent of the
  // round-stage-gated countdown tick below.
  useEffect(() => {
    const intervalId = window.setInterval(() => setConnTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const isStale = isConnectionStale(lastSuccessAt, connTick);

  // "연결이 복구되었습니다" fires once on the true->false edge, not on every
  // render while connected - a ref (not state) tracks the previous value so
  // this doesn't re-trigger itself.
  const wasStaleRef = useRef(false);
  const [showRecoveredToast, setShowRecoveredToast] = useState(false);
  useEffect(() => {
    if (wasStaleRef.current && !isStale) {
      setShowRecoveredToast(true);
      const timeoutId = window.setTimeout(() => setShowRecoveredToast(false), 2_500);
      wasStaleRef.current = isStale;
      return () => window.clearTimeout(timeoutId);
    }
    wasStaleRef.current = isStale;
    return undefined;
  }, [isStale]);

  // Landscape is the only supported layout. orientation.lock is best-effort
  // (many older/kiosk-mode tablets reject it, don't expose it, or the OS
  // simply never rotates the raster at all for any app). The real guarantee
  // is this: whenever the viewport itself is still portrait, the whole
  // screen is rendered rotated 90deg via CSS transform instead - the
  // operator physically turns the tablet sideways and the content appears
  // upright to them, independent of whatever the OS/orientation-sensor is
  // doing. CSS transforms don't affect hit-testing (touch/pointer events
  // already resolve against the rotated on-screen position), so no manual
  // touch-coordinate remapping is needed.
  const [isPortraitViewport, setIsPortraitViewport] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth,
  );
  useEffect(() => {
    const update = () => setIsPortraitViewport(window.innerHeight > window.innerWidth);
    update();
    window.addEventListener('resize', update);
    let mediaQuery: MediaQueryList | undefined;
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(orientation: portrait)');
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', update);
      } else {
        // Older WebView: MediaQueryList only supports the deprecated
        // addListener/removeListener pair.
        mediaQuery.addListener(update);
      }
    }
    return () => {
      window.removeEventListener('resize', update);
      if (!mediaQuery) return;
      if (typeof mediaQuery.removeEventListener === 'function') mediaQuery.removeEventListener('change', update);
      else mediaQuery.removeListener(update);
    };
  }, []);
  useEffect(() => {
    const orientation = (screen as unknown as { orientation?: { lock?: (type: string) => Promise<void> } }).orientation;
    if (!orientation?.lock) return;
    orientation.lock('landscape').catch(() => {
      // Expected to fail on many tablets (no fullscreen, unsupported, kiosk
      // policy) - the CSS rotate above is the real guard, this is purely a
      // nice-to-have when it happens to work (native rotation is smoother).
    });
  }, []);

  // Merged into every screen's <main style={...}> below - rotates the
  // fixed-full-viewport root 90deg and swaps its own box to
  // 100vh(width) x 100vw(height) so the rotated box's landscape-designed
  // content exactly fills the (still-portrait) physical screen.
  const landscapeRotateStyle: React.CSSProperties = isPortraitViewport
    ? {
        bottom: 'auto',
        height: '100vw',
        left: '50%',
        position: 'fixed',
        right: 'auto',
        top: '50%',
        transform: 'translate(-50%, -50%) rotate(90deg)',
        width: '100vh',
      }
    : {};

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
        await progressGuardRef.current.run(
          () => fetchEventProgressForTablet(eventId, tableNumber, stored.connectionToken),
          (result) => {
            if (!active) return;
            if (!result.ok) {
              goToConnect();
              return;
            }
            setProgress(result);
            setLoading(false);
            setLastSuccessAt(Date.now());
          },
          { skipIfInFlight: true },
        );
      } catch {
        if (active) setLoading(false);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), progressPollIntervalMs);
    const handleReconnectSignal = () => void poll();
    window.addEventListener('online', handleReconnectSignal);
    window.addEventListener('focus', handleReconnectSignal);
    document.addEventListener('visibilitychange', handleReconnectSignal);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleReconnectSignal);
      window.removeEventListener('focus', handleReconnectSignal);
      document.removeEventListener('visibilitychange', handleReconnectSignal);
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
        await seatGuideGuardRef.current.run(
          () => fetchEventTableSeatGuide(eventId, tableNumber, stored.connectionToken),
          (result) => {
            if (!active) return;
            if (result.ok) setLastSuccessAt(Date.now());
            if (!result.ok || !result.maleNickname || !result.femaleNickname) {
              console.error('[tablet-seat-guide] assignment missing or fetch not ok', {
                eventId,
                result,
                tableNumber,
              });
            }
            setSeatGuide(result);
            setSeatGuideAttempted(true);
          },
          { skipIfInFlight: true },
        );
      } catch (caughtError) {
        // Connectivity failures are already surfaced by the progress poll
        // above via the "연결 확인 중" banner - this only needs to unblock
        // the loading -> error decision below.
        console.error('[tablet-seat-guide] fetch threw', { eventId, error: caughtError, tableNumber });
        if (active) setSeatGuideAttempted(true);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), seatPollIntervalMs);
    const handleReconnectSignal = () => void poll();
    window.addEventListener('online', handleReconnectSignal);
    window.addEventListener('focus', handleReconnectSignal);
    document.addEventListener('visibilitychange', handleReconnectSignal);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleReconnectSignal);
      window.removeEventListener('focus', handleReconnectSignal);
      document.removeEventListener('visibilitychange', handleReconnectSignal);
    };
  }, [eventId, tableNumber, progress?.stage, seatGuideRetryTick]);

  // Round timer/matching only matters once the round stage is reached -
  // this now also covers every 추가시간 sub-stage, which all carry their
  // own timer snapshot on the same round-progress RPC.
  const isRoundStage =
    progress?.stage === 'round_active' ||
    progress?.stage === 'round_complete' ||
    progress?.stage === 'bonus_matching' ||
    progress?.stage === 'bonus_seat_guide' ||
    progress?.stage === 'bonus_rating';
  useEffect(() => {
    if (!eventId || !Number.isFinite(tableNumber) || !isRoundStage) return undefined;
    let active = true;

    const poll = async () => {
      const stored = readStoredConnection(eventId, tableNumber);
      if (!stored) return;
      try {
        await roundGuardRef.current.run(
          () => fetchRoundProgressForTablet(eventId, tableNumber, stored.connectionToken),
          (result) => {
            if (active && result.ok) {
              setRoundProgress(result);
              setLastSuccessAt(Date.now());
            }
          },
          { skipIfInFlight: true },
        );
      } catch {
        // Connectivity failures are already handled by the progress poll above.
      }
    };

    // progress?.currentRound is in the dependency array below purely to
    // force an immediate poll (not to reset anything) the moment the
    // OTHER, independently-scheduled progress poll notices the round
    // advanced - without it, the last round's roundProgress snapshot (and
    // its partner names) can keep showing on-screen for up to
    // roundPollIntervalMs after the round actually changed. roundProgress
    // itself is deliberately never cleared here - swapping to a loading
    // state for that gap would trade stale-but-plausible data for a worse
    // "정상 상태처럼 안 보이는" flicker.
    void poll();
    const intervalId = window.setInterval(() => void poll(), roundPollIntervalMs);
    const handleReconnectSignal = () => void poll();
    window.addEventListener('online', handleReconnectSignal);
    window.addEventListener('focus', handleReconnectSignal);
    document.addEventListener('visibilitychange', handleReconnectSignal);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleReconnectSignal);
      window.removeEventListener('focus', handleReconnectSignal);
      document.removeEventListener('visibilitychange', handleReconnectSignal);
    };
  }, [eventId, tableNumber, isRoundStage, progress?.currentRound]);

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

  // `progress` and `roundProgress` come from two INDEPENDENT polls (see the
  // two effects above) that can land at different times - deriving phase
  // duration from progress.stage while deriving elapsed time from
  // roundProgress's timer snapshot let those two disagree for one render
  // right at a stage transition (e.g. progress.stage already flipped to
  // bonus_rating while roundProgress still held the just-finished
  // conversation's snapshot), which briefly clamped `remaining` to 0 and
  // fired a spurious "finish" chime. roundProgress carries its own `stage`
  // field from the SAME snapshot as its timer data - preferring that (and
  // only falling back to progress.stage before roundProgress has loaded at
  // all) keeps duration and elapsed-time always sourced from one snapshot.
  const effectiveStage = roundProgress?.stage ?? progress?.stage;

  // Timer-bearing phases only - round_complete/bonus_matching are part of
  // isRoundStage (for polling) but have no countdown to warn about.
  const hasTimerPhase =
    effectiveStage === 'round_active' || effectiveStage === 'bonus_seat_guide' || effectiveStage === 'bonus_rating';

  const timerPhaseDuration = !hasTimerPhase
    ? 0
    : effectiveStage === 'bonus_seat_guide'
      ? phaseDurationSeconds('transition')
      : effectiveStage === 'bonus_rating'
        ? BONUS_RATING_PHASE_SECONDS
        : phaseDurationSeconds(roundProgress?.roundPhase, roundProgress?.isBonusRound, roundProgress?.conversationDurationSeconds);

  const timerRemaining =
    !hasTimerPhase || !roundProgress
      ? 0
      : Math.max(
          0,
          timerPhaseDuration -
            computeLiveElapsedSeconds(
              {
                timerPositionSeconds: roundProgress.timerPositionSeconds ?? 0,
                timerStatus: roundProgress.timerStatus ?? 'paused',
                timerUpdatedAt: roundProgress.timerUpdatedAt,
              },
              nowTick + (roundProgress.clockOffsetMs ?? 0),
            ),
        );

  // bonus_rating is itself only 1 minute long, so a "1 minute left" warning
  // would fire immediately at phase start - skipped there per spec.
  const shouldWarnForPhase = effectiveStage !== 'bonus_rating';

  const timerNotificationKey =
    eventId && hasTimerPhase && roundProgress
      ? [eventId, effectiveStage, roundProgress.currentRound ?? '', roundProgress.isBonusRound ? 1 : 0, roundProgress.roundPhase ?? ''].join(':')
      : '';

  const timerAlertToast = useTabletTimerAlerts({
    enabled: hasTimerPhase && Boolean(roundProgress) && Boolean(timerNotificationKey),
    notificationKey: timerNotificationKey,
    playWarning: shouldWarnForPhase,
    remaining: timerRemaining,
  });

  if (loading || !progress) return <DataLoadingState />;

  if (progress.stage === 'intro_video') {
    return (
      <main className="fixed inset-0 bg-black" style={landscapeRotateStyle}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
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
      <main className="fixed inset-0 grid place-items-center bg-white px-10 text-center text-[#1f292d]" style={landscapeRotateStyle}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
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
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white" style={landscapeRotateStyle}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <div>
          <p className="text-[20px] font-black text-[#ff8a80]">잠시 쉬어가는 시간이에요</p>
          <p className="mt-4 text-[24px] font-black">운영자의 안내를 기다려주세요</p>
        </div>
      </main>
    );
  }

  // 추가시간 매칭 계산 중 - 순간적이라 타이머 없이 짧게만 보여진다.
  if (progress.stage === 'bonus_matching') {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white" style={landscapeRotateStyle}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <div>
          <p className="text-[20px] font-black text-[#ff8a80]">추가시간 매칭 중</p>
          <p className="mt-4 text-[22px] font-black">잠시만 기다려주세요</p>
        </div>
      </main>
    );
  }

  // 추가시간 통합 2분 - 참가자 폰에서는 방금 상대 호감도 수정 + 다음 상대
  // 안내를 같이 보여주지만, 태블릿은 원래도 이름을 노출하지 않던 화면이라
  // 문구만 "다음 라운드가 있는지"에 따라 조건 분기한다. current_round는
  // 이 phase 동안 아직 방금 끝난 라운드를 가리키므로 bonusRoundIndex도
  // 그 라운드 기준 - 그게 곧 마지막 추가시간이면 다음 이동 안내가 없다.
  if (progress.stage === 'bonus_seat_guide') {
    if (!roundProgress) return <DataLoadingState />;
    const isLastBonusRound = (roundProgress.bonusRoundIndex ?? 0) >= (roundProgress.bonusRoundCount ?? 0);
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-10 overflow-hidden text-[#1f292d]" style={{ ...tabletBackground, ...landscapeRotateStyle }}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <TimerAlertToast toast={timerAlertToast} />
        <PetalDecor />
        <RoundTimerRing offline={isStale} phaseDuration={timerPhaseDuration} remaining={timerRemaining} />
        <p className="px-6 text-center" style={{ color: '#c07f87', fontSize: 'clamp(14px,1.9vh,19px)', fontWeight: 600 }}>
          {isLastBonusRound ? '곧 최종 선택으로 넘어갑니다' : '2분 안에 자리 이동을 완료해주세요'}
        </p>
      </main>
    );
  }

  // 추가시간 대화 종료 후 1분 기존 호감도 수정 phase.
  if (progress.stage === 'bonus_rating') {
    if (!roundProgress) return <DataLoadingState />;
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-10 overflow-hidden text-[#1f292d]" style={{ ...tabletBackground, ...landscapeRotateStyle }}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <TimerAlertToast toast={timerAlertToast} />
        <PetalDecor />
        <RoundTimerRing offline={isStale} phaseDuration={timerPhaseDuration} remaining={timerRemaining} />
        <p className="px-6 text-center" style={{ color: '#c07f87', fontSize: 'clamp(14px,1.9vh,19px)', fontWeight: 600 }}>
          1분 안에 호감도 수정을 완료해주세요
        </p>
      </main>
    );
  }

  if (progress.stage === 'round_active') {
    if (!roundProgress) return <DataLoadingState />;
    const currentRound = roundProgress.currentRound ?? progress.currentRound ?? 1;
    const roundLabel =
      roundProgress.isBonusRound && roundProgress.bonusRoundIndex ? `추가시간 ${roundProgress.bonusRoundIndex} 진행 중` : `${currentRound}라운드 진행 중`;

    if (roundProgress.roundPhase === 'transition') {
      // Deliberately bare compared to the conversation-phase screen (no
      // round label, no partner names, no card deck) - this phase is just
      // "move + rate on your phone," per the wireframe. Only ever fires for
      // regular rounds now - the bonus equivalent is the bonus_seat_guide
      // stage branch above.
      return (
        <main className="fixed inset-0 flex flex-col items-center justify-center gap-10 overflow-hidden text-[#1f292d]" style={{ ...tabletBackground, ...landscapeRotateStyle }}>
          <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
          <ReconnectedToast visible={showRecoveredToast} />
          <TimerAlertToast toast={timerAlertToast} />
          <PetalDecor />
          <RoundTimerRing offline={isStale} phaseDuration={timerPhaseDuration} remaining={timerRemaining} />
          <p className="px-6 text-center" style={{ color: '#c07f87', fontSize: 'clamp(14px,1.9vh,19px)', fontWeight: 600 }}>
            2분 안에 자리 이동 및 호감도 작성을 완료해주세요
          </p>
        </main>
      );
    }

    // 성비 불균형으로 이번 라운드에 이 테이블에 실제 pair가 없는 경우
    // (남/여 닉네임 중 하나라도 null) - 잘못된 닉네임이나 빈 pair를 그대로
    // 보여주는 대신 명시적으로 안내한다. 다음 라운드부터 서버가 다시
    // 배정하므로 새로고침 없이 폴링만으로 자동 복귀된다.
    if (roundProgress.isResting) {
      return (
        <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white" style={landscapeRotateStyle}>
          <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
          <ReconnectedToast visible={showRecoveredToast} />
          <div>
            <p className="text-[20px] font-black text-[#ff8a80]">이번 라운드는 잠시 쉬어가는 시간이에요</p>
            <p className="mt-4 text-[24px] font-black">다음 라운드부터 다시 진행됩니다</p>
          </div>
        </main>
      );
    }

    const stored = readStoredConnection(eventId ?? '', tableNumber);
    const partnerNames = [roundProgress.maleNickname, roundProgress.femaleNickname].filter(Boolean).join(' · ');

    return (
      <main className="fixed inset-0 flex items-center overflow-hidden text-[#1f292d]" style={{ ...tabletBackground, ...landscapeRotateStyle }}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <TimerAlertToast toast={timerAlertToast} />
        <PetalDecor />
        {partnerNames ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 px-6 pt-6 text-center">
            <p className="max-w-[70vw] truncate text-[15px] font-black tracking-wide" style={{ color: '#a35850' }}>
              {partnerNames}
            </p>
            <p className="text-[12px] font-bold tracking-[0.2em]" style={{ color: '#c07f87' }}>
              TABLE {tableNumber}
            </p>
          </div>
        ) : null}
        <div className="flex h-full w-full items-center px-[5vw]">
          <div className="flex flex-[68] items-center justify-center">
            <RoundTimerRing
              offline={isStale}
              phaseLabel={`${Math.round(timerPhaseDuration / 60)}분 대화`}
              phaseDuration={timerPhaseDuration}
              remaining={timerRemaining}
              roundLabel={roundLabel}
            />
          </div>
          <div className="flex flex-[32] justify-center">
            {stored?.connectionToken && eventId ? (
              <ConversationTopicDeck connectionToken={stored.connectionToken} eventId={eventId} tableNumber={tableNumber} />
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  if (progress.stage === 'final_selection') {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white" style={landscapeRotateStyle}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <div>
          <p className="text-[20px] font-black text-[#ff8a80]">모든 대화 종료</p>
          <p className="mt-4 text-[28px] font-black">최종 선택 진행 중</p>
        </div>
      </main>
    );
  }

  if (progress.stage === 'ended') {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white" style={landscapeRotateStyle}>
        <div>
          <p className="text-[22px] font-black">오늘의 모든 일정이 종료되었습니다</p>
          <p className="mt-4 text-[18px] font-black text-white/80">수고하셨습니다</p>
        </div>
      </main>
    );
  }

  const seatGuideNamesReady = Boolean(seatGuide?.maleNickname && seatGuide?.femaleNickname);

  // Genuinely nothing has come back yet (first poll still in flight) - the
  // only state where a plain loading indicator is honest.
  if (!seatGuideAttempted) return <DataLoadingState />;

  // A real fetch attempt happened and there's still no pairing - this event
  // always assigns every table at once, at event start, so this can only
  // mean the assignment step failed or hasn't been reached (event not
  // started yet) - never a normal "please wait" moment, so it must not look
  // like one.
  if (!seatGuideNamesReady) {
    return (
      <main className="fixed inset-0 grid place-items-center bg-[#1f292d] px-10 text-center text-white" style={landscapeRotateStyle}>
        <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
        <ReconnectedToast visible={showRecoveredToast} />
        <div>
          <p className="text-[20px] font-black text-[#ff8a80]">자리 배정을 불러오지 못했습니다</p>
          <p className="mt-4 text-[15px] font-bold text-white/70">
            테이블 {Number.isFinite(tableNumber) ? tableNumber : '-'}번의 배정 정보가 없습니다.
            <br />
            행사가 아직 시작되지 않았거나 배정에 실패했을 수 있어요.
          </p>
          <button
            className="mt-6 rounded-full bg-white px-6 py-3 text-[14px] font-black text-[#1f292d]"
            onClick={() => setSeatGuideRetryTick((tick) => tick + 1)}
            type="button"
          >
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 flex overflow-hidden" style={landscapeRotateStyle}>
      <ConnectionStatusBanner lines={tabletConnectionBannerLines} visible={isStale} />
      <ReconnectedToast visible={showRecoveredToast} />
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

// Elegant thin-serif countdown ring - track/arc/dot colors and the
// warming-up-as-time-runs-out digit color are all fixed to the cherry
// blossom palette (not caller-configurable) so every stage that shows a
// timer reads as the same screen.
const ringTrackColor = '#f6dee1';
const ringArcColor = '#e0a0a9';
const ringDotColor = '#e5949f';
const digitColorNormal = { b: 0x6d, g: 0x64, r: 0xb5 };
const digitColorUrgent = { b: 0x5a, g: 0x4f, r: 0xa8 };

function mixDigitColor(t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(digitColorNormal.r + (digitColorUrgent.r - digitColorNormal.r) * clamped);
  const g = Math.round(digitColorNormal.g + (digitColorUrgent.g - digitColorNormal.g) * clamped);
  const b = Math.round(digitColorNormal.b + (digitColorUrgent.b - digitColorNormal.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

function RoundTimerRing({
  phaseDuration,
  offline = false,
  phaseLabel,
  remaining,
  roundLabel,
}: {
  offline?: boolean;
  phaseDuration: number;
  phaseLabel?: string;
  remaining: number;
  roundLabel?: string;
}) {
  const elapsedFraction = phaseDuration > 0 ? Math.min(1, Math.max(0, 1 - remaining / phaseDuration)) : 0;
  const size = 100;
  const trackStrokeWidth = 0.45;
  const arcStrokeWidth = 0.56;
  const radius = (size - arcStrokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - elapsedFraction);
  const angleRad = ((-90 + 360 * elapsedFraction) * Math.PI) / 180;
  const dotX = size / 2 + radius * Math.cos(angleRad);
  const dotY = size / 2 + radius * Math.sin(angleRad);

  const timeText = formatCountdown(remaining);
  const minuteChars = timeText.slice(0, 2).split('');
  const secondChars = timeText.slice(3, 5).split('');
  const digitColor = mixDigitColor(remaining <= 60 ? (60 - remaining) / 60 : 0);

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ height: 'clamp(420px, 72vh, 760px)', width: 'clamp(420px, 72vh, 760px)' }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} fill="none" r={radius} stroke={ringTrackColor} strokeWidth={trackStrokeWidth} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={ringArcColor}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth={arcStrokeWidth}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </g>
      </svg>
      {elapsedFraction > 0 ? (
        <span
          className="absolute h-[1.4%] w-[1.4%] rounded-full"
          style={{
            backgroundColor: ringDotColor,
            left: `${dotX}%`,
            top: `${dotY}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ) : null}
      <div className="px-[12%] text-center">
        {roundLabel ? (
          <p style={{ color: '#c07f87', fontSize: 'clamp(14px,1.7vh,19px)', fontWeight: 600, letterSpacing: '0.01em' }}>{roundLabel}</p>
        ) : null}
        {phaseLabel ? (
          <p className="mt-1" style={{ color: '#d6ab9f', fontSize: 'clamp(11px,1.25vh,14px)', fontWeight: 500 }}>
            {phaseLabel}
          </p>
        ) : null}
        {offline ? (
          <p
            style={{
              color: '#a35850',
              fontSize: 'clamp(24px,4.2vh,40px)',
              fontWeight: 700,
              letterSpacing: '0.01em',
              lineHeight: 1.3,
              marginTop: roundLabel || phaseLabel ? '1.1rem' : 0,
            }}
          >
            연결 확인 중
          </p>
        ) : (
          <p
            className="flex items-baseline justify-center"
            style={{
              color: digitColor,
              fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', Georgia, 'Times New Roman', serif",
              fontSize: 'clamp(84px,14.5vh,180px)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 300,
              letterSpacing: '0.01em',
              lineHeight: 1,
              marginTop: roundLabel || phaseLabel ? '1.1rem' : 0,
              transition: 'color 1s linear',
            }}
          >
            {minuteChars.map((char, index) => (
              <span className="inline-block text-center" key={`m${index}`} style={{ minWidth: '0.66em' }}>
                {char}
              </span>
            ))}
            <span
              className="inline-block"
              style={{ color: '#cf8b93', fontSize: '0.55em', margin: '0 0.02em', transform: 'translateY(-0.28em)' }}
            >
              :
            </span>
            {secondChars.map((char, index) => (
              <span className="inline-block text-center" key={`s${index}`} style={{ minWidth: '0.66em' }}>
                {char}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

// One-shot "connection restored" confirmation - fires only on the stale ->
// not-stale edge (see wasStaleRef in AdminTabletSeatPage), auto-dismisses.
function ReconnectedToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#2f7d4f] px-4 py-2.5 text-[13px] font-bold text-white shadow-lg">
        연결이 복구되었습니다
      </div>
    </div>
  );
}

// Sparse, low-opacity SVG petals/leaves in the corners (a static branch),
// plus a handful of petals that drift down the whole screen. Only
// transform/opacity are animated (GPU-cheap) and there are at most 5
// falling petals at once, matching the tablet-friendly performance budget
// used everywhere else in this file.
function PetalDecor() {
  const fallingPetals = [
    { delay: 0, duration: 19, left: 12, size: 13 },
    { delay: 4.5, duration: 22, left: 34, size: 10 },
    { delay: 9, duration: 20, left: 58, size: 14 },
    { delay: 13.5, duration: 24, left: 76, size: 11 },
    { delay: 18, duration: 21, left: 92, size: 12 },
  ];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute -left-6 -top-6 h-[230px] w-[230px]" fill="none" style={{ opacity: 0.24 }} viewBox="0 0 200 200">
        <path d="M14 8 C40 28, 55 46, 62 78" stroke="#e9b7bf" strokeLinecap="round" strokeWidth="1.4" />
        <path d="M20 12 C34 20, 44 30, 50 46" stroke="#e9b7bf" strokeLinecap="round" strokeWidth="1.1" />
        <path d="M10 20 C26 26, 38 36, 44 52" stroke="#e9b7bf" strokeLinecap="round" strokeWidth="1" />
        <ellipse cx="34" cy="22" fill="#f5c3cb" rx="9" ry="6" transform="rotate(-28 34 22)" />
        <ellipse cx="46" cy="16" fill="#f5c3cb" rx="8" ry="5.4" transform="rotate(4 46 16)" />
        <ellipse cx="52" cy="44" fill="#f5c3cb" rx="8.5" ry="5.6" transform="rotate(-10 52 44)" />
        <ellipse cx="30" cy="56" fill="#f5c3cb" rx="8" ry="5.2" transform="rotate(24 30 56)" />
        <ellipse cx="66" cy="30" fill="#f5c3cb" rx="7" ry="4.6" transform="rotate(8 66 30)" />
        <ellipse cx="22" cy="38" fill="#f5c3cb" rx="7.5" ry="5" transform="rotate(-42 22 38)" />
        <ellipse cx="40" cy="8" fill="#f5c3cb" rx="6.5" ry="4.4" transform="rotate(18 40 8)" />
        <ellipse cx="58" cy="58" fill="#f5c3cb" rx="6" ry="4" transform="rotate(-16 58 58)" />
        <ellipse cx="14" cy="26" fill="#f5c3cb" rx="6.5" ry="4.3" transform="rotate(30 14 26)" />
        <ellipse cx="60" cy="12" fill="#f5c3cb" rx="6" ry="4" transform="rotate(-6 60 12)" />
      </svg>
      <svg className="absolute right-24 top-28 h-5 w-5" fill="none" style={{ opacity: 0.2 }} viewBox="0 0 20 20">
        <ellipse cx="10" cy="8" fill="#f5c3cb" rx="6" ry="3.4" transform="rotate(-24 10 8)" />
      </svg>
      <svg className="absolute bottom-10 left-16 h-5 w-5" fill="none" style={{ opacity: 0.18 }} viewBox="0 0 20 20">
        <ellipse cx="10" cy="8" fill="#f5c3cb" rx="6" ry="3.4" transform="rotate(52 10 8)" />
      </svg>

      {fallingPetals.map((petal, index) => (
        <span
          className="tt-falling-petal absolute top-[-6%]"
          key={index}
          style={{
            animationDelay: `${petal.delay}s`,
            animationDuration: `${petal.duration}s`,
            background: 'linear-gradient(160deg, #f8d3d9 0%, #eeb2ab 100%)',
            borderRadius: '0 100% 0 100%',
            height: petal.size,
            left: `${petal.left}%`,
            width: petal.size,
          }}
        />
      ))}
      <style>{`
        @keyframes tt-petal-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          8% { opacity: 0.65; }
          50% { opacity: 0.5; }
          92% { opacity: 0.6; }
          100% { transform: translateY(112vh) rotate(320deg); opacity: 0; }
        }
        .tt-falling-petal {
          animation-name: tt-petal-fall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          will-change: transform, opacity;
        }
      `}</style>
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
