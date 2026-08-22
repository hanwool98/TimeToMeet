import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  controlEventIntroVideo,
  endAdminEvent,
  fetchAdminEventModeSummaries,
  fetchAdminEventProgress,
  startFirstRound,
  subscribeToAdminEventModeChanges,
  type AdminEventModeSummary,
  type EventProgress,
  type IntroVideoAction,
} from '../services/supabaseApplications';
import { computeLiveVideoPosition, VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS } from '../utils/introVideoSync';

const pollIntervalMs = 2_000;

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

        {progress.stage === 'round_active' ? (
          <section className="mt-8 rounded-[24px] border border-[#f0d9d3] bg-white px-6 py-16 text-center">
            <p className="text-[15px] font-black text-[#ef554a]">라운드 진행 중</p>
            <p className="mt-2 text-[28px] font-black">{progress.currentRound ?? 1}라운드</p>
            <p className="mt-4 text-[13px] font-bold text-[#999]">라운드 진행 화면은 다음 단계에서 이어서 구현됩니다.</p>
          </section>
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
