// Simple HTMLAudioElement-based alert chimes for the tablet-only event-mode
// screen (mirrors the module-scope singleton pattern already used for voice
// previews in ParticipantList.tsx). Deliberately NOT Web Audio API: event
// tablets may run very old Android WebView, where AudioContext support and
// autoplay behavior are far less consistent than plain <audio>/.play(),
// which has been supported since the earliest Android WebView versions.
const SOUND_PATHS = {
  finish: '/sounds/timer-finish.mp3',
  warning: '/sounds/timer-warning.mp3',
} as const;

export type TabletAlertSoundType = keyof typeof SOUND_PATHS;

const audioElements: Partial<Record<TabletAlertSoundType, HTMLAudioElement>> = {};

function getAudio(type: TabletAlertSoundType): HTMLAudioElement {
  let audio = audioElements[type];
  if (!audio) {
    audio = new Audio(SOUND_PATHS[type]);
    audio.preload = 'auto';
    audioElements[type] = audio;
  }
  return audio;
}

// Call once from a real user-gesture handler (tablet number selection /
// connect tap) so the very first `.play()` this session doesn't happen
// unattended during a timer tick, where autoplay-restricted browsers would
// silently reject it. Plays each clip near-silently and immediately stops
// it - the standard "unlock" trick - wrapped defensively so a failure here
// never breaks the connect flow; later real alerts just fall back to
// playTabletAlertSound's own best-effort handling.
export function unlockTabletAlertAudio() {
  (Object.keys(SOUND_PATHS) as TabletAlertSoundType[]).forEach((type) => {
    try {
      const audio = getAudio(type);
      const previousVolume = audio.volume;
      audio.volume = 0;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = previousVolume;
        })
        .catch(() => {
          audio.volume = previousVolume;
        });
    } catch (unlockError) {
      console.warn('[tablet-alert] audio unlock failed', unlockError);
    }
  });
}

// Never throws and never leaves an unhandled rejection - a failed alert
// sound must not interrupt the event (the caller still shows a visual
// toast regardless of this call's outcome).
export function playTabletAlertSound(type: TabletAlertSoundType) {
  try {
    const audio = getAudio(type);
    audio.currentTime = 0;
    audio.play().catch((playError: unknown) => {
      console.warn(`[tablet-alert] ${type} sound playback failed`, playError);
    });
  } catch (syncError) {
    console.warn(`[tablet-alert] ${type} sound could not be started`, syncError);
  }
}
