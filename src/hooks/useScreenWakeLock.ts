import { useEffect } from 'react';

// A wake lock is released automatically by the browser whenever the tab is
// backgrounded (screen off, app-switch, tab hidden) - `visibilitychange` is
// the standard way to notice coming back to the foreground and re-acquire
// it, since there's no event for "the lock was silently dropped".
export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    const navigatorWithWakeLock = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!navigatorWithWakeLock.wakeLock) return undefined;

    let active = true;
    let sentinel: { release: () => Promise<void> } | null = null;

    const acquire = async () => {
      try {
        const lock = await navigatorWithWakeLock.wakeLock!.request('screen');
        if (!active) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Best-effort only - unsupported/denied/older Android should behave
        // exactly as if this hook didn't exist.
      }
    };

    void acquire();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) void sentinel.release();
    };
  }, [enabled]);
}
