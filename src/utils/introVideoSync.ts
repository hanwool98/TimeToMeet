import type { EventProgress } from '../services/supabaseApplications';

// The server only stores a (position, updated_at, status) snapshot rather
// than ticking every second, so both the operator and every tablet derive
// "where the video should be right now" the same way: extrapolate forward
// from the snapshot while playing, or hold still while paused.
export function computeLiveVideoPosition(progress: Pick<EventProgress, 'introVideoPositionSeconds' | 'introVideoStatus' | 'introVideoUpdatedAt'>, nowMs = Date.now()) {
  if (progress.introVideoStatus !== 'playing' || !progress.introVideoUpdatedAt) {
    return progress.introVideoPositionSeconds;
  }
  const elapsedSeconds = (nowMs - new Date(progress.introVideoUpdatedAt).getTime()) / 1000;
  return Math.max(0, progress.introVideoPositionSeconds + elapsedSeconds);
}

// Re-seeking a <video> every poll tick would be janky - only correct drift
// once it's noticeable, and let native playback carry it the rest of the time.
export const VIDEO_DRIFT_RESYNC_THRESHOLD_SECONDS = 1.5;
