// Shared helper for event-mode polling/Realtime fetchers: several screens
// (참가자 Event Mode, 태블릿 진행 화면, 운영자 Live 화면, 체크인 화면) call the
// same fetch function from both a setInterval poll AND a Realtime callback,
// with no coordination - a slow response landing after a newer one started
// could stomp fresher state (out-of-order race), and a poll tick firing
// while a Realtime-triggered call is still in flight duplicates work for no
// reason. `createRequestGuard` gives every such fetcher two small guarantees
// with no new server calls or intervals: skip starting a new call while one
// is already in flight, and only apply a result if no newer call has
// started since (latest-request-wins).
export function createRequestGuard() {
  let latestId = 0;
  let inFlight = false;

  return {
    isInFlight: () => inFlight,
    async run<T>(
      task: () => Promise<T>,
      apply: (result: T) => void,
      options?: { skipIfInFlight?: boolean },
    ): Promise<void> {
      if (options?.skipIfInFlight && inFlight) return;
      const id = ++latestId;
      inFlight = true;
      try {
        const result = await task();
        if (id === latestId) apply(result);
      } finally {
        if (id === latestId) inFlight = false;
      }
    },
  };
}

// Collapses a burst of rapid calls (e.g. several Realtime row-change events
// firing within milliseconds of each other) into a single trailing call.
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, waitMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Args) => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = undefined;
  };
  return debounced;
}
