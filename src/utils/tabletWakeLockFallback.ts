// Old-Android fallback for keeping the tablet screen on when the Screen
// Wake Lock API (Chrome 84+) isn't available at all - which is the likely
// case on Android 6.0.1-class tablets whose bundled WebView/Chrome predates
// it. Same idea NoSleep.js uses for its "video" strategy: an invisible,
// muted, looping video keeps the browser treating the page as "playing
// media", which Android Chrome/WebView treats as a reason not to dim/sleep
// the screen. No external library and no video asset to fetch - the source
// is a stream captured from a 1x1 canvas, so nothing is ever visible or
// audible and there's no network/decode cost.
let fallbackVideo: HTMLVideoElement | null = null;
let fallbackStream: MediaStream | null = null;

function logFallback(event: string, detail?: Record<string, unknown>) {
  // console.debug (not .log) - invisible unless devtools' verbose level is
  // on, so this stays silent for normal use but is still checkable on the
  // real tablet in the field, which is where this bug actually reproduces.
  console.debug('[TABLET_WAKE_LOCK]', event, detail ?? {});
}

function ensureFallbackVideo(): HTMLVideoElement | null {
  if (fallbackVideo) return fallbackVideo;
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.fillRect(0, 0, 1, 1);
    const canvasWithCapture = canvas as HTMLCanvasElement & { captureStream?: (frameRate?: number) => MediaStream };
    if (typeof canvasWithCapture.captureStream !== 'function') {
      logFallback('unsupported', { reason: 'canvas.captureStream missing' });
      return null;
    }
    const stream = canvasWithCapture.captureStream(1);
    const video = document.createElement('video');
    video.muted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.setAttribute('aria-hidden', 'true');
    video.style.position = 'fixed';
    video.style.left = '0';
    video.style.top = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    // Not display:none / visibility:hidden - browsers throttle or pause
    // media in elements removed from the render tree that way. Kept at
    // near-zero opacity instead so it stays "on screen" as far as the
    // browser's media-playback bookkeeping is concerned.
    video.style.opacity = '0.01';
    video.style.pointerEvents = 'none';
    video.srcObject = stream;
    fallbackVideo = video;
    fallbackStream = stream;
    return video;
  } catch (caughtError) {
    logFallback('create_error', { message: String(caughtError) });
    return null;
  }
}

// Call once from a real user-gesture handler (tablet number selection) so
// the very first attempt this session doesn't happen unattended - mirrors
// unlockTabletAlertAudio's reasoning. Best-effort: a failure here never
// blocks the connect flow, and startTabletWakeLockFallback() below will
// simply retry later from the seat screen.
export function primeTabletWakeLockFallback() {
  try {
    const video = ensureFallbackVideo();
    if (!video) return;
    if (!video.isConnected) document.body.appendChild(video);
    video
      .play()
      .then(() => logFallback('primed'))
      .catch((playError: unknown) => logFallback('prime_failed', { message: String(playError) }));
  } catch (caughtError) {
    logFallback('prime_error', { message: String(caughtError) });
  }
}

export async function startTabletWakeLockFallback(): Promise<boolean> {
  const video = ensureFallbackVideo();
  if (!video) return false;
  try {
    if (!video.isConnected) document.body.appendChild(video);
    if (!video.paused) return true;
    await video.play();
    logFallback('started');
    return true;
  } catch (playError) {
    logFallback('start_failed', { message: String(playError) });
    return false;
  }
}

export function stopTabletWakeLockFallback(reason: string) {
  if (!fallbackVideo) return;
  try {
    fallbackVideo.pause();
  } catch {
    // noop - best-effort teardown only
  }
  fallbackStream?.getTracks().forEach((track) => track.stop());
  fallbackVideo.remove();
  fallbackVideo = null;
  fallbackStream = null;
  logFallback('stopped', { reason });
}

export function isTabletWakeLockFallbackActive() {
  return !!fallbackVideo && !fallbackVideo.paused;
}
