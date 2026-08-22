import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import HeartRating from '../components/HeartRating';
import useOperationalData from '../hooks/useOperationalData';
import {
  controlEventIntroVideo,
  controlRoundTimer,
  endAdminEvent,
  fetchAdminEventModeSummaries,
  fetchAdminEventParticipantMedia,
  fetchAdminEventProgress,
  fetchAdminParticipantRatings,
  fetchAdminPauseRequests,
  fetchAdminRoundProgress,
  startFirstRound,
  subscribeToAdminEventModeChanges,
  updatePauseRequestStatus,
  type AdminEventModeSummary,
  type EventPauseRequest,
  type EventProgress,
  type IntroVideoAction,
  type ParticipantRating,
  type PublicParticipantMediaRow,
  type RoundProgress,
} from '../services/supabaseApplications';
import type { StoredApplication } from '../utils/adminApplications';
import { computeLiveVideoPosition, VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS } from '../utils/introVideoSync';
import { computeLiveElapsedSeconds, formatCountdown, phaseDurationSeconds } from '../utils/roundTimerSync';

const pollIntervalMs = 2_000;
const pauseRequestPollIntervalMs = 5_000;

export default function AdminEventLivePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [event, setEvent] = useState<AdminEventModeSummary | null>(null);
  const [progress, setProgress] = useState<EventProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);
  const [ending, setEnding] = useState(false);

  const [roundProgress, setRoundProgress] = useState<RoundProgress | null>(null);
  const [participantMedia, setParticipantMedia] = useState<Map<string, PublicParticipantMediaRow>>(new Map());
  const [timerActionPending, setTimerActionPending] = useState(false);
  const [pauseRequests, setPauseRequests] = useState<EventPauseRequest[]>([]);
  const [pauseRequestsPanelOpen, setPauseRequestsPanelOpen] = useState(false);
  const [participantListPanelOpen, setParticipantListPanelOpen] = useState(false);

  const { applications } = useOperationalData({ admin: true, eventId });
  const eventApplications = useMemo(() => applications.filter((item) => item.eventId === eventId), [applications, eventId]);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const [summaries, nextProgress] = await Promise.all([fetchAdminEventModeSummaries(), fetchAdminEventProgress(eventId)]);
      setEvent(summaries.find((item) => item.id === eventId) ?? null);
      setProgress(nextProgress);
      setLoadError(null);
    } catch (caughtError) {
      setLoadError(caughtError instanceof Error ? caughtError.message : '행사 진행 상태를 불러오지 못했습니다.');
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
    const unsubscribe = subscribeToAdminEventModeChanges(() => void safeLoad());
    const intervalId = window.setInterval(() => void safeLoad(), pollIntervalMs);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [load]);

  // Reconcile the actual <video> element with the polled server state: only
  // resync playback position once drift is noticeable, and only touch
  // play/pause when it disagrees with the server (so remote pause/play from
  // another admin session or a resumed poll doesn't fight local playback).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !progress || progress.stage !== 'intro_video' || !progress.introVideoUrl) return;

    const livePosition = computeLiveVideoPosition(progress);
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - livePosition) > VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS) {
      video.currentTime = livePosition;
    }
    if (progress.introVideoStatus === 'playing' && video.paused) {
      video.play().catch(() => {
        // Autoplay-with-sound can be blocked even right after a tap (the
        // gesture doesn't always carry through the async start-event round
        // trip) - fall back to muted playback so it still starts, and let
        // the operator tap to unmute.
        video.muted = true;
        setVideoMuted(true);
        void video.play().catch(() => undefined);
      });
    } else if (progress.introVideoStatus === 'paused' && !video.paused) {
      video.pause();
    }
  }, [progress]);

  const isRoundStage = progress?.stage === 'round_active' || progress?.stage === 'round_complete';

  // Round-specific state (timer, current table matches, pending pause
  // requests) only matters once the round stage is reached, so it's polled
  // separately from the general intro-video progress above.
  useEffect(() => {
    if (!eventId || !isRoundStage) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await fetchAdminRoundProgress(eventId);
        if (active) setRoundProgress(next);
      } catch {
        // Transient failures just keep showing the last known state.
      }
    };
    void poll();
    const intervalId = window.setInterval(() => void poll(), pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, isRoundStage]);

  // Representative photos rarely change mid-event, so this is fetched once
  // per round stage entry rather than on every 2s poll.
  useEffect(() => {
    if (!eventId || !isRoundStage) return undefined;
    let active = true;
    void fetchAdminEventParticipantMedia(eventId).then((media) => {
      if (active) setParticipantMedia(media);
    });
    return () => {
      active = false;
    };
  }, [eventId, isRoundStage]);

  useEffect(() => {
    if (!eventId || !pauseRequestsPanelOpen) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await fetchAdminPauseRequests(eventId);
        if (active) setPauseRequests(next);
      } catch {
        // keep last known list on transient failure
      }
    };
    void poll();
    const intervalId = window.setInterval(() => void poll(), pauseRequestPollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, pauseRequestsPanelOpen]);

  const runAction = async (action: IntroVideoAction) => {
    if (!eventId || actionPending) return;
    setActionPending(true);
    setActionError('');
    try {
      const result = await controlEventIntroVideo(eventId, action);
      setProgress((current) => (current ? { ...current, ...result } : current));
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '영상 상태를 변경하지 못했습니다.');
    } finally {
      setActionPending(false);
    }
  };

  const handleSkipOrComplete = (action: 'complete' | 'skip') => {
    if (!window.confirm('소개영상을 종료하고 다음 단계로 이동하시겠습니까?')) return;
    void runAction(action);
  };

  const handleStartRound = async () => {
    if (!eventId || actionPending) return;
    setActionPending(true);
    setActionError('');
    try {
      await startFirstRound(eventId);
      await load();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '라운드를 시작하지 못했습니다.');
    } finally {
      setActionPending(false);
    }
  };

  const handleToggleRoundTimer = async () => {
    if (!eventId || !roundProgress || timerActionPending) return;
    setTimerActionPending(true);
    try {
      await controlRoundTimer(eventId, roundProgress.timerStatus === 'running' ? 'pause' : 'resume');
      setRoundProgress(await fetchAdminRoundProgress(eventId));
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '타이머를 변경하지 못했습니다.');
    } finally {
      setTimerActionPending(false);
    }
  };

  const handleResolvePauseRequest = async (requestId: string) => {
    if (!eventId) return;
    try {
      await updatePauseRequestStatus(requestId, 'resolved');
      setPauseRequests(await fetchAdminPauseRequests(eventId));
      setRoundProgress(await fetchAdminRoundProgress(eventId));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '요청을 처리하지 못했습니다.');
    }
  };

  const handleEndEvent = async () => {
    if (!eventId || ending) return;
    if (!window.confirm('행사를 종료하시겠습니까?')) return;
    setEnding(true);
    try {
      await endAdminEvent(eventId);
      navigate('/admin/event-mode');
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '행사를 종료하지 못했습니다.');
      setEnding(false);
    }
  };

  if (loading) return <DataLoadingState />;
  if (loadError) return <DataErrorState message={loadError} onRetry={load} />;
  if (!event || !eventId || !progress) {
    return (
      <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
        <div className="mobile-container mx-auto grid min-h-screen place-items-center px-5">
          <section className="w-full rounded-[28px] border border-[#f0f3f6] bg-white px-5 py-8 text-center shadow-calendar">
            <p className="text-[18px] font-black">행사를 찾을 수 없습니다</p>
            <button className="mt-5 text-[14px] font-black text-[#ef554a]" onClick={() => navigate('/admin/event-mode')} type="button">
              행사모드로 돌아가기
            </button>
          </section>
        </div>
      </main>
    );
  }

  const tabletConnected = event.tabletCount;
  const tabletRequired = event.requiredTablets;
  const allTabletsConnected = tabletConnected >= tabletRequired;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-[#fffaf4] text-[#1f292d]">
      <div className="mx-auto min-h-screen w-full max-w-[520px] px-5 pb-[calc(28px+env(safe-area-inset-bottom))] pt-[calc(16px+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="grid h-9 w-9 shrink-0 place-items-center text-[#333]"
              onClick={() => navigate(`/admin/events/${eventId}/prepare`)}
              type="button"
            >
              <BackIcon />
            </button>
            <div className="min-w-0">
              <h1 className="text-[19px] font-black leading-tight">행사 진행</h1>
              <p className="truncate text-[13px] font-bold text-[#888]">{event.title}</p>
            </div>
          </div>
          <button
            className="shrink-0 rounded-[10px] border border-[#e5e5e5] px-3 py-2 text-[13px] font-black text-[#777] disabled:opacity-50"
            disabled={ending}
            onClick={() => void handleEndEvent()}
            type="button"
          >
            {ending ? '종료 중' : '행사 종료'}
          </button>
        </header>

        {isRoundStage ? (
          <RoundProgressSection
            onOpenParticipantList={() => setParticipantListPanelOpen(true)}
            onOpenPauseRequests={() => setPauseRequestsPanelOpen(true)}
            onToggleTimer={() => void handleToggleRoundTimer()}
            participantMedia={participantMedia}
            roundProgress={roundProgress}
            timerActionPending={timerActionPending}
            totalTables={tabletRequired}
          />
        ) : progress.stage === 'ended' ? (
          <section className="mt-8 rounded-[24px] border border-[#f0d9d3] bg-white px-6 py-16 text-center">
            <p className="text-[20px] font-black">행사가 종료되었습니다</p>
          </section>
        ) : (
          <>
            <section className="mt-5 rounded-[24px] border border-[#f0d9d3] bg-white p-4 shadow-calendar">
              <h2 className="text-[18px] font-black leading-snug">{progress.introVideoTitle || '소개영상'}</h2>
              {progress.introVideoDescription ? <p className="mt-1 text-[13px] font-bold text-[#888]">{progress.introVideoDescription}</p> : null}

              <div className="relative mt-4 overflow-hidden rounded-[16px] bg-black">
                {progress.introVideoUrl ? (
                  <video
                    className="aspect-video w-full"
                    onEnded={() => void runAction('complete')}
                    onLoadedMetadata={(changeEvent) => setVideoDuration(changeEvent.currentTarget.duration)}
                    onTimeUpdate={(changeEvent) => setDisplayTime(changeEvent.currentTarget.currentTime)}
                    playsInline
                    ref={videoRef}
                    src={progress.introVideoUrl}
                  />
                ) : (
                  <div className="grid aspect-video w-full place-items-center px-6 text-center">
                    <p className="text-[14px] font-bold text-white/70">등록된 소개영상이 없습니다. 건너뛰기로 다음 단계로 진행할 수 있어요.</p>
                  </div>
                )}
                {videoMuted ? (
                  <button
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-2 text-[13px] font-black text-black"
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
              </div>

              <div className="mt-3 flex items-center justify-between text-[12px] font-bold text-[#999]">
                <span>{formatDuration(displayTime)}</span>
                <span>{formatDuration(videoDuration)}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#f0e3dc]">
                <div
                  className="h-full rounded-full bg-[#ef554a] transition-[width]"
                  style={{ width: `${videoDuration > 0 ? Math.min(100, (displayTime / videoDuration) * 100) : 0}%` }}
                />
              </div>

              {progress.stage === 'intro_video' ? (
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <ControlButton disabled={actionPending} label="처음부터" onClick={() => void runAction('restart')}>
                    <RestartIcon />
                  </ControlButton>
                  <ControlButton disabled={actionPending} label={progress.introVideoStatus === 'playing' ? '일시정지' : '재생'} onClick={() => void runAction(progress.introVideoStatus === 'playing' ? 'pause' : 'play')} primary>
                    {progress.introVideoStatus === 'playing' ? <PauseIcon /> : <PlayIcon />}
                  </ControlButton>
                  <ControlButton disabled={actionPending} label="건너뛰기" onClick={() => handleSkipOrComplete('skip')}>
                    <SkipIcon />
                  </ControlButton>
                </div>
              ) : (
                <p className="mt-5 rounded-[14px] bg-[#eaf6e8] px-4 py-3 text-center text-[13px] font-black text-[#3f9142]">소개영상이 종료되었습니다</p>
              )}

              {progress.stage === 'intro_video' ? (
                <button
                  className="mt-3 h-11 w-full rounded-[12px] border border-[#ef554a]/40 text-[13px] font-black text-[#ef554a] disabled:opacity-50"
                  disabled={actionPending}
                  onClick={() => handleSkipOrComplete('complete')}
                  type="button"
                >
                  영상 종료
                </button>
              ) : null}
            </section>

            {actionError ? <p className="mt-3 text-center text-[13px] font-bold text-[#ef554a]">{actionError}</p> : null}

            <div className="mt-6">
              {progress.stage === 'intro_video' ? (
                <p className="mb-2 text-center text-[13px] font-bold text-[#999]">영상 종료 후 활성화</p>
              ) : null}
              <button
                className={[
                  'flex h-16 w-full items-center justify-center gap-2 rounded-[14px] text-[20px] font-black text-white transition active:scale-[0.99]',
                  progress.stage === 'round_waiting' ? 'bg-[#ef4039]' : 'cursor-not-allowed bg-[#e2c3bc]',
                ].join(' ')}
                disabled={progress.stage !== 'round_waiting' || actionPending}
                onClick={() => void handleStartRound()}
                type="button"
              >
                라운드 시작
              </button>
            </div>
          </>
        )}

        <section className="mt-6 rounded-[16px] bg-[#fff1ee] px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-black text-[#1f292d]">태블릿 연결 상태</span>
            <span className="text-[16px] font-black text-[#ef554a]">
              {tabletConnected}/{tabletRequired}
            </span>
          </div>
          {!allTabletsConnected ? <p className="mt-2 text-[12px] font-bold text-[#a35850]">연결되지 않은 태블릿이 있습니다.</p> : null}
        </section>
      </div>

      {pauseRequestsPanelOpen ? (
        <PauseRequestsPanel onClose={() => setPauseRequestsPanelOpen(false)} onResolve={(id) => void handleResolvePauseRequest(id)} requests={pauseRequests} />
      ) : null}

      {participantListPanelOpen && eventId ? (
        <ParticipantListPanel applications={eventApplications} eventId={eventId} onClose={() => setParticipantListPanelOpen(false)} />
      ) : null}
    </main>
  );
}

function ControlButton({ children, disabled, label, onClick, primary }: { children: React.ReactNode; disabled?: boolean; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      className={[
        'flex flex-col items-center justify-center gap-1.5 rounded-[14px] py-3 text-[12px] font-black transition active:scale-[0.97] disabled:opacity-50',
        primary ? 'bg-[#ef4039] text-white' : 'border border-[#ef554a]/30 text-[#ef554a]',
      ].join(' ')}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      {label}
    </button>
  );
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
      <rect height="14" rx="1.5" width="4.5" x="6" y="5" />
      <rect height="14" rx="1.5" width="4.5" x="13.5" y="5" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 12a8 8 0 0 1 13.66-5.66L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.66 5.66L4 16M4 20v-4h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 5.5v13l9-6.5-9-6.5Z" />
      <rect height="13" rx="1" width="2.4" x="16.5" y="5.5" />
    </svg>
  );
}

function RoundProgressSection({
  onOpenParticipantList,
  onOpenPauseRequests,
  onToggleTimer,
  participantMedia,
  roundProgress,
  timerActionPending,
  totalTables,
}: {
  onOpenParticipantList: () => void;
  onOpenPauseRequests: () => void;
  onToggleTimer: () => void;
  participantMedia: Map<string, PublicParticipantMediaRow>;
  roundProgress: RoundProgress | null;
  timerActionPending: boolean;
  totalTables: number;
}) {
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  if (!roundProgress) {
    return (
      <section className="mt-8 rounded-[24px] border border-[#f0d9d3] bg-white px-6 py-16 text-center">
        <p className="text-[14px] font-bold text-[#999]">라운드 진행 상태를 불러오는 중</p>
      </section>
    );
  }

  if (roundProgress.stage === 'round_complete') {
    return (
      <section className="mt-8 rounded-[24px] border border-[#f0d9d3] bg-white px-6 py-16 text-center">
        <p className="text-[15px] font-black text-[#ef554a]">모든 라운드 종료</p>
        <p className="mt-2 text-[24px] font-black">수고하셨습니다</p>
        <p className="mt-3 text-[13px] font-bold text-[#999]">전체 {roundProgress.totalRounds}라운드가 모두 완료되었습니다</p>
      </section>
    );
  }

  const phaseDuration = phaseDurationSeconds(roundProgress.roundPhase);
  const liveElapsed = computeLiveElapsedSeconds(roundProgress, nowTick);
  const remaining = Math.max(0, phaseDuration - liveElapsed);
  const phaseLabel = roundProgress.roundPhase === 'transition' ? '이동 및 호감도 작성' : '10분 대화';

  const matchByTable = new Map(roundProgress.matches.map((match) => [match.tableNumber, match]));
  const tableNumbers = Array.from({ length: Math.max(totalTables, roundProgress.matches.length) }, (_, index) => index + 1);

  return (
    <>
      <section className="mt-5 rounded-[24px] border border-[#f0d9d3] bg-white p-4 shadow-calendar">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h2 className="truncate text-[14px] font-black leading-tight">{roundProgress.currentRound ?? 1}라운드 진행 중</h2>
            <span className="shrink-0 rounded-[6px] bg-[#fff1ee] px-2 py-0.5 text-[11px] font-black text-[#ef554a]">{phaseLabel}</span>
          </div>
          <button
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fff1ee] text-[#ef554a]"
            onClick={onOpenPauseRequests}
            type="button"
          >
            <BellIcon />
            {roundProgress.pendingPauseCount > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-[#ef4039] px-1 text-[11px] font-black text-white">
                {roundProgress.pendingPauseCount}
              </span>
            ) : null}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[1.15fr_1fr] items-stretch gap-2.5">
          <div className="min-w-0 rounded-[16px] bg-[#fff8f5] p-3">
            <p className="text-[11px] font-bold text-[#999]">남은 시간</p>
            <p className="mt-0.5 text-[28px] font-black leading-none tabular-nums text-[#ef554a]">{formatCountdown(remaining)}</p>
            <button
              className="mt-2.5 flex h-9 w-full items-center justify-center gap-1 rounded-[10px] border border-[#ef554a] text-[12px] font-black text-[#ef554a] disabled:opacity-50"
              disabled={timerActionPending}
              onClick={onToggleTimer}
              type="button"
            >
              {roundProgress.timerStatus === 'running' ? <PauseIcon /> : <PlayIcon />}
              {roundProgress.timerStatus === 'running' ? '일시정지' : '재개'}
            </button>
          </div>

          <div className="min-w-0 rounded-[16px] border border-[#f0f0f0] p-3">
            <h3 className="text-[12px] font-black">전체 진행 현황</h3>
            <dl className="mt-2 space-y-2 text-[12px] font-bold">
              <StatRow label="총 참가자" value={`${roundProgress.totalParticipants}명`} />
              <StatRow label="진행 테이블" value={`${roundProgress.activeTables}개`} />
              <StatRow label="완료 라운드" value={`${roundProgress.completedRounds}/${roundProgress.totalRounds}`} />
            </dl>
          </div>
        </div>
      </section>

      <section className="mt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-black">테이블 현황</h3>
          <p className="text-[11px] font-bold text-[#999]">각 테이블의 현재 대화 상대</p>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {tableNumbers.map((tableNumber) => (
            <TableMatchCard key={tableNumber} match={matchByTable.get(tableNumber)} participantMedia={participantMedia} tableNumber={tableNumber} />
          ))}
        </div>
      </section>

      <button
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[#e5e5e5] bg-white text-[15px] font-black text-[#333]"
        onClick={onOpenParticipantList}
        type="button"
      >
        <PeopleIcon />
        참가자 리스트
      </button>

      <p className="mt-4 flex items-center gap-2 rounded-[12px] bg-[#f5f5f5] px-4 py-3 text-[12px] font-bold text-[#888]">
        <InfoIcon />
        타이머는 모든 테이블에 실시간으로 동기화됩니다
      </p>
    </>
  );
}

function TableMatchCard({
  match,
  participantMedia,
  tableNumber,
}: {
  match: RoundProgress['matches'][number] | undefined;
  participantMedia: Map<string, PublicParticipantMediaRow>;
  tableNumber: number;
}) {
  if (!match) {
    return (
      <div className="flex min-h-[92px] flex-col items-center justify-center rounded-[12px] border border-dashed border-[#e5d9d3] bg-[#fafafa] p-2 text-center">
        <p className="text-[11px] font-black text-[#bbb]">{tableNumber}번</p>
        <p className="mt-1 text-[10px] font-bold text-[#bbb]">배정 대기</p>
      </div>
    );
  }

  const malePhoto = (match.maleApplicationId ? participantMedia.get(match.maleApplicationId)?.photoUrl : undefined) ?? undefined;
  const femalePhoto = (match.femaleApplicationId ? participantMedia.get(match.femaleApplicationId)?.photoUrl : undefined) ?? undefined;

  return (
    <div className="rounded-[12px] border border-[#f0f0f0] bg-white p-2">
      <p className="text-center text-[11px] font-black text-[#999]">{tableNumber}번</p>
      <div className="mt-1 flex items-center justify-center -space-x-1.5">
        <PhotoAvatar fallbackColor="#5aa7e9" photoUrl={malePhoto} size={30} />
        <PhotoAvatar fallbackColor="#ef8fa0" photoUrl={femalePhoto} size={30} />
      </div>
      <p className="mt-1 truncate text-center text-[10.5px] font-black">
        {match.maleNickname ?? '대기'} · {match.femaleNickname ?? '대기'}
      </p>
    </div>
  );
}

function PhotoAvatar({ fallbackColor, photoUrl, size = 48 }: { fallbackColor: string; photoUrl?: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border-2 border-white"
      style={{ backgroundColor: `${fallbackColor}22`, height: size, width: size }}
    >
      {photoUrl ? <img alt="" className="h-full w-full object-cover" src={photoUrl} /> : <PersonGlyph color={fallbackColor} />}
    </span>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-[#777]">{label}</span>
      <span className="text-[#1f292d]">{value}</span>
    </div>
  );
}

function PauseRequestsPanel({
  onClose,
  onResolve,
  requests,
}: {
  onClose: () => void;
  onResolve: (id: string) => void;
  requests: EventPauseRequest[];
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-[18px] font-black">참가자 요청</h3>
          <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        {requests.length === 0 ? (
          <p className="mt-6 text-center text-[14px] font-bold text-[#999]">요청이 없습니다</p>
        ) : (
          <div className="mt-4 space-y-2">
            {requests.map((request) => (
              <div
                className={[
                  'rounded-[14px] border px-4 py-3',
                  request.status === 'pending' ? 'border-[#ef554a]/40 bg-[#fff1ee]' : 'border-[#f0f0f0] bg-white',
                ].join(' ')}
                key={request.id}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-black">{request.tableNumber ? `${request.tableNumber}번 테이블` : '테이블 미정 (입장 대기)'}</p>
                    <span
                      className={[
                        'rounded-[6px] px-1.5 py-0.5 text-[10px] font-black',
                        request.requestType === 'call_staff' ? 'bg-[#eef1ff] text-[#4f5fd6]' : 'bg-[#fff1ee] text-[#ef554a]',
                      ].join(' ')}
                    >
                      {request.requestType === 'call_staff' ? '운영자 호출' : '일시정지 요청'}
                    </span>
                  </div>
                  {request.status === 'pending' ? (
                    <span className="text-[11px] font-black text-[#ef554a]">미확인</span>
                  ) : (
                    <span className="text-[11px] font-black text-[#3f9142]">처리됨</span>
                  )}
                </div>
                <p className="mt-1 text-[14px] font-bold">{request.nickname}님</p>
                <p className="mt-0.5 text-[12px] font-bold text-[#999]">{formatKstTime(request.requestedAt)} 요청</p>
                {request.status === 'pending' ? (
                  <button
                    className="mt-2 h-9 rounded-[10px] bg-[#ef4039] px-4 text-[12px] font-black text-white"
                    onClick={() => onResolve(request.id)}
                    type="button"
                  >
                    확인 처리
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ParticipantListPanel({
  applications,
  eventId,
  onClose,
}: {
  applications: StoredApplication[];
  eventId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StoredApplication | null>(null);
  const [ratings, setRatings] = useState<ParticipantRating[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);

  const confirmedApplicants = useMemo(() => applications.filter((item) => item.status === '참가 확정'), [applications]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return confirmedApplicants;
    return confirmedApplicants.filter(
      (item) => (item.profile?.nickname ?? '').toLowerCase().includes(keyword) || item.id.toLowerCase().includes(keyword),
    );
  }, [confirmedApplicants, search]);

  const selectParticipant = async (application: StoredApplication) => {
    setSelected(application);
    if (!application.dbId) return;
    setRatingsLoading(true);
    try {
      setRatings(await fetchAdminParticipantRatings(eventId, application.dbId));
    } catch {
      setRatings([]);
    } finally {
      setRatingsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] bg-white pb-[calc(20px+env(safe-area-inset-bottom))]"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-[18px] font-black">참가자 리스트</h3>
            <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
              닫기
            </button>
          </div>
        </div>

        {selected ? (
          <div className="overflow-y-auto px-5 pt-4">
            <button className="text-[13px] font-black text-[#999]" onClick={() => setSelected(null)} type="button">
              ‹ 목록으로
            </button>
            <div className="mt-3 flex items-center gap-3">
              <Avatar gender={selected.gender} />
              <div className="min-w-0">
                <p className="truncate text-[18px] font-black">{selected.profile?.nickname || selected.userId}님</p>
                <p className="text-[13px] font-bold text-[#999]">{selected.id}</p>
              </div>
            </div>

            <h4 className="mt-6 text-[14px] font-black text-[#555]">호감도 작성 기록</h4>
            {ratingsLoading ? (
              <p className="mt-3 text-[13px] font-bold text-[#999]">불러오는 중</p>
            ) : ratings.length === 0 ? (
              <p className="mt-3 text-[13px] font-bold text-[#999]">아직 작성한 호감도 기록이 없습니다</p>
            ) : (
              <div className="mt-3 space-y-2 pb-6">
                {ratings.map((rating) => (
                  <div className="rounded-[14px] border border-[#f0f0f0] px-4 py-3" key={rating.roundNumber}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-[#999]">{rating.roundNumber}라운드</p>
                        <p className="truncate text-[14px] font-black">{rating.partnerNickname}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <HeartRating score={rating.score} />
                        <span className="text-[13px] font-black text-[#ef4d7a]">{rating.score.toFixed(1)}</span>
                      </div>
                    </div>
                    {rating.memo ? <p className="mt-2 whitespace-pre-wrap text-[12px] font-bold text-[#888]">{rating.memo}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-1 shrink-0 px-5">
              <input
                className="h-12 w-full rounded-[14px] bg-[#f5f5f5] px-4 text-[15px] font-bold outline-none"
                onChange={(changeEvent) => setSearch(changeEvent.target.value)}
                placeholder="닉네임 또는 신청번호로 검색"
                value={search}
              />
            </div>
            <div className="mt-3 flex-1 overflow-y-auto px-5">
              {filtered.length === 0 ? (
                <p className="mt-6 text-center text-[14px] font-bold text-[#999]">참가확정된 참가자가 없습니다</p>
              ) : (
                <div className="space-y-2 pb-4">
                  {filtered.map((item) => (
                    <button
                      className="flex w-full items-center gap-3 rounded-[14px] border border-[#f0f0f0] px-3 py-2.5 text-left active:scale-[0.99]"
                      key={item.dbId}
                      onClick={() => void selectParticipant(item)}
                      type="button"
                    >
                      <Avatar gender={item.gender} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-black">{item.profile?.nickname || item.userId}님</p>
                        <p className="text-[12px] font-bold text-[#999]">{item.id}</p>
                      </div>
                      <ChevronRightIcon />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Avatar({ gender }: { gender?: '남성' | '여성' }) {
  const color = gender === '남성' ? '#5aa7e9' : gender === '여성' ? '#ef8fa0' : '#ccc';
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${color}22` }}>
      <PersonGlyph color={color} />
    </span>
  );
}

function PersonGlyph({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.6" stroke={color} strokeWidth="1.8" />
      <path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke={color} strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function formatKstTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit', timeZone: 'Asia/Seoul' });
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-[#ccc]" fill="none" viewBox="0 0 24 24">
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 16Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M9.5 21a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="9.5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5M15.5 15.5c2.3.2 3.8 1.7 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5.5M12 8v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}
