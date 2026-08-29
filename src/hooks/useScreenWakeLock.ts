import { useEffect } from 'react';
import { isTabletWakeLockFallbackActive, startTabletWakeLockFallback, stopTabletWakeLockFallback } from '../utils/tabletWakeLockFallback';

interface WakeLockSentinelLike {
  addEventListener?: (type: 'release', listener: () => void) => void;
  release: () => Promise<void>;
}
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

function logWakeLock(event: string, detail?: Record<string, unknown>) {
  // console.debug (not .log) - invisible unless devtools' verbose level is
  // on. The real bug reproduces on a deployed tablet, not a local dev
  // server, so this can't be gated behind import.meta.env.DEV like a normal
  // debug log; console.debug's default-hidden behavior gives the same
  // "silent in production" outcome without losing the ability to check it
  // on the actual device.
  console.debug('[TABLET_WAKE_LOCK]', event, detail ?? {});
}

interface UseScreenWakeLockOptions {
  // Old Android/WebView builds without the Wake Lock API (Chrome 84+) get a
  // muted invisible-video fallback instead of silently doing nothing - see
  // tabletWakeLockFallback.ts. Only opted into by the tablet event-mode
  // screen; participant phones are modern enough in practice that running
  // the extra fallback machinery there isn't worth it.
  allowVideoFallback?: boolean;
}

// A wake lock is released automatically by the browser whenever the tab is
// backgrounded (screen off, app-switch, tab hidden) - `visibilitychange` is
// the standard way to notice coming back to the foreground and re-acquire
// it, since there's no event for "the lock was silently dropped".
export function useScreenWakeLock(enabled: boolean, options: UseScreenWakeLockOptions = {}) {
  const { allowVideoFallback = false } = options;

  useEffect(() => {
    if (!enabled) return undefined;
    const navigatorWithWakeLock = navigator as NavigatorWithWakeLock;
    const supportsNativeWakeLock = !!navigatorWithWakeLock.wakeLock;
    logWakeLock('init', { allowVideoFallback, supportsNativeWakeLock });

    let active = true;
    let sentinel: WakeLockSentinelLike | null = null;
    let usingFallback = false;

    const acquire = async () => {
      if (supportsNativeWakeLock) {
        try {
          const lock = await navigatorWithWakeLock.wakeLock!.request('screen');
          if (!active) {
            void lock.release();
            return;
          }
          sentinel = lock;
          usingFallback = false;
          logWakeLock('acquired', { via: 'native' });
          lock.addEventListener?.('release', () => {
            // Fires both for our own explicit release() calls below and for
            // a release the browser/OS forces on its own - logging every
            // time (not just the unexpected case) is what lets a real
            // device trace show which one actually happened.
            logWakeLock('native_sentinel_released_event');
            if (sentinel === lock) sentinel = null;
          });
          return;
        } catch (requestError) {
          logWakeLock('native_request_failed', { message: String(requestError) });
        }
      }

      if (!allowVideoFallback) return;
      const started = await startTabletWakeLockFallback();
      if (!active) {
        stopTabletWakeLockFallback('effect_inactive_after_start');
        return;
      }
      usingFallback = started;
      if (started) logWakeLock('acquired', { via: 'fallback_video' });
    };

    void acquire();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const stillHeld = sentinel !== null || (usingFallback && isTabletWakeLockFallbackActive());
      if (stillHeld) return;
      logWakeLock('reacquiring_after_visible');
      void acquire();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) {
        void sentinel.release();
        logWakeLock('released', { reason: 'effect_cleanup', via: 'native' });
      }
      if (usingFallback) {
        stopTabletWakeLockFallback('effect_cleanup');
      }
    };
  }, [enabled, allowVideoFallback]);
}
