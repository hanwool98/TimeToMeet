// Pure helper: "has it been too long since we last heard from the server?"
// Screens call this from the 1-second tick they already run for their
// countdown display, so no extra interval is needed. Measuring elapsed time
// since the last SUCCESS (not counting consecutive failures) means a single
// transient failed request never triggers the banner - only a sustained gap
// does, and it auto-clears the instant a fresh success updates lastSuccessAt.
export const CONNECTION_STALE_THRESHOLD_MS = 12_000;

export function isConnectionStale(
  lastSuccessAtMs: number | null,
  nowMs: number,
  thresholdMs = CONNECTION_STALE_THRESHOLD_MS,
) {
  if (lastSuccessAtMs === null) return false;
  return nowMs - lastSuccessAtMs > thresholdMs;
}
