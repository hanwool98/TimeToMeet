import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ParticipantData } from '../types/participant';

interface ParticipantListProps {
  title: string;
  participants: ParticipantData[];
  capacity: number;
  onProfileClick?: (participant: ParticipantData) => void;
}

export const avatarSheet = '/assets/mosaic-participants.png';
const gridColumns = 4;
const gridRows = 3;

export function getAvatarPosition(index: number) {
  const column = index % gridColumns;
  const row = Math.floor(index / gridColumns) % gridRows;
  const x = (column / (gridColumns - 1)) * 100;
  const y = (row / (gridRows - 1)) * 100;
  return `${x}% ${y}%`;
}

// A single shared <audio> element for the whole app so starting one
// participant's voice intro always stops any other that's currently playing.
let sharedAudio: HTMLAudioElement | null = null;
let playingParticipantId: string | null = null;
const playbackListeners = new Set<() => void>();

function emitPlaybackChange() {
  playbackListeners.forEach((listener) => listener());
}

function stopSharedAudio() {
  sharedAudio?.pause();
  playingParticipantId = null;
  emitPlaybackChange();
}

function toggleParticipantAudio(participantId: string, audioUrl: string) {
  if (playingParticipantId === participantId) {
    stopSharedAudio();
    return;
  }
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.addEventListener('ended', stopSharedAudio);
  }
  sharedAudio.src = audioUrl;
  playingParticipantId = participantId;
  emitPlaybackChange();
  sharedAudio.play().catch(() => {
    stopSharedAudio();
  });
}

function subscribePlayback(listener: () => void) {
  playbackListeners.add(listener);
  return () => playbackListeners.delete(listener);
}

function getPlayingParticipantId() {
  return playingParticipantId;
}

export default function ParticipantList({ title, participants, capacity, onProfileClick }: ParticipantListProps) {
  const recruitingRows = Array.from({ length: Math.max(0, capacity - participants.length) });
  const currentlyPlayingId = useSyncExternalStore(subscribePlayback, getPlayingParticipantId);

  return (
    <section className="min-w-0 flex-1 rounded-[24px] border border-[#f0f3f6] bg-white px-1.5 py-3 shadow-calendar">
      <h2 className="mx-auto mb-2 grid h-8 w-14 place-items-center rounded-full bg-meet-blueSoft text-center text-[18px] font-black text-black">
        {title}
      </h2>
      {/* Tailwind's JIT scanner can't see a runtime-computed class name, so
          the slot count (which now varies per event) has to be an inline
          style rather than a `grid-rows-[repeat(${capacity},48px)]` class. */}
      {/* minmax(48px, auto) keeps the usual compact row height but lets a
          row with a long job title (which now wraps instead of being
          ellipsis-truncated below) grow taller instead of clipping it. */}
      <div className="grid gap-1.5" style={{ gridTemplateRows: `repeat(${Math.max(participants.length, capacity)}, minmax(48px, auto))` }}>
        {participants.map((participant) => {
          const isPlaying = currentlyPlayingId === participant.id;
          return (
            <article
              className="grid min-h-12 min-w-0 grid-cols-[30px_minmax(0,1fr)_22px] items-center gap-1.5 rounded-[17px] bg-white px-1 py-1 shadow-[0_8px_18px_rgba(30,43,63,0.05)]"
              key={participant.id}
            >
              <button
                aria-label={`${participant.nickname} 프로필 보기`}
                className={[
                  'contents text-left',
                  onProfileClick ? 'cursor-pointer' : 'cursor-default',
                ].join(' ')}
                disabled={!onProfileClick}
                onClick={() => onProfileClick?.(participant)}
                type="button"
              >
                <span className="relative h-[30px] w-[30px] shrink-0 overflow-hidden rounded-full bg-[#e4e7eb] ring-1 ring-black/5">
                  {participant.photoUrl ? (
                    <MosaicAvatarPhoto crop={participant.representativeCrop} photoUrl={participant.photoUrl} sizePx={30} />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[#aeb4bb]">
                      <PlaceholderPersonIcon />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-black leading-[1.1] text-black min-[390px]:text-[11px]">
                    {participant.nickname}
                  </span>
                  <span className="mt-0.5 block break-keep text-[8px] font-extrabold leading-[1.25] text-[#8c8c8c] min-[390px]:text-[9px]">
                    {participant.tags.map((tag) => `#${tag}`).join(' ')}
                  </span>
                </span>
              </button>
              <button
                aria-label={participant.audioIntroUrl ? `${participant.nickname} 자기소개 ${isPlaying ? '정지' : '재생'}` : `${participant.nickname} 음성 없음`}
                className="grid h-7 w-[22px] place-items-center rounded-full bg-meet-pinkSoft text-meet-pink transition hover:bg-[#ffdce8] disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!participant.audioIntroUrl}
                onClick={() => {
                  if (participant.audioIntroUrl) toggleParticipantAudio(participant.id, participant.audioIntroUrl);
                }}
                type="button"
              >
                {isPlaying ? (
                  <span className="flex h-2.5 w-2.5 items-center justify-between">
                    <span className="h-full w-[3px] bg-meet-pink" />
                    <span className="h-full w-[3px] bg-meet-pink" />
                  </span>
                ) : (
                  <span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-meet-pink" />
                )}
              </button>
            </article>
          );
        })}
        {recruitingRows.map((_, index) => (
          <div
            className="grid h-12 place-items-center rounded-[17px] bg-white text-center text-[12px] font-black text-[#8a8a8a] shadow-[0_8px_18px_rgba(30,43,63,0.04)]"
            key={`recruiting-${index}`}
          >
            (모집중)
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Renders the real representative photo with a genuine pixel mosaic (not a
 * CSS blur). A CSS-only version of this (paint into a tiny overflow-hidden
 * box, then magnify that box with a transform: scale()) is unreliable —
 * browsers are free to collapse the whole transform chain into a single
 * direct sample from the full-resolution source image, which skips the
 * intended low-res rasterization step and can render as a plain, undistorted
 * photo. Drawing into an actual small <canvas> instead guarantees the pixels
 * are genuinely downsampled before the CSS upscales the element for display.
 */
function MosaicAvatarPhoto({
  crop,
  photoUrl,
  sizePx,
}: {
  crop: ParticipantData['representativeCrop'];
  photoUrl: string;
  sizePx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Mild enough that overall look, hairstyle, and face shape stay readable —
  // strong enough that individual facial features don't resolve.
  const cellPx = Math.max(10, Math.round(sizePx * 0.6));
  const rawScale = crop?.scale ?? 1;
  const rawOffsetX = crop?.offsetX ?? 0;
  const rawOffsetY = crop?.offsetY ?? 0;

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const { naturalHeight, naturalWidth } = image;
      if (!naturalWidth || !naturalHeight) return;

      // A crop captured at less than the image's own cover-fit minimum (older
      // data from before that minimum was enforced) would ask drawImage for a
      // source square bigger than the image actually is. Flooring the scale
      // here — mirroring the same aspect-based minimum ProfileFormPage enforces
      // when a photo is opened for editing — keeps the source rect in bounds.
      const aspect = naturalWidth / naturalHeight;
      const aspectMinScale = aspect >= 1 ? 1 : 1 / aspect;
      const scale = Math.max(rawScale, aspectMinScale);
      const maxOffsetFraction = Math.max(0, (scale - 1) / 2);
      const offsetX = Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, rawOffsetX));
      const offsetY = Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, rawOffsetY));

      // Mirrors the same crop-box math as representativeCropTransform, but resolves
      // it to a source rectangle for drawImage instead of a CSS translate/scale.
      const box = cellPx;
      const pxPerNaturalPx = (box * scale) / naturalHeight;
      const displayedWidth = box * scale * aspect;
      const displayedHeight = box * scale;
      const imageTopLeftX = box / 2 + offsetX * box - displayedWidth / 2;
      const imageTopLeftY = box / 2 + offsetY * box - displayedHeight / 2;
      const sourceSize = box / pxPerNaturalPx;
      const sourceX = Math.max(0, Math.min(-imageTopLeftX / pxPerNaturalPx, naturalWidth - sourceSize));
      const sourceY = Math.max(0, Math.min(-imageTopLeftY / pxPerNaturalPx, naturalHeight - sourceSize));

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cellPx, cellPx);
      ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, cellPx, cellPx);
    };
    image.src = photoUrl;
    return () => {
      cancelled = true;
    };
  }, [cellPx, photoUrl, rawOffsetX, rawOffsetY, rawScale]);

  return (
    <canvas
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      height={cellPx}
      ref={canvasRef}
      style={{ imageRendering: 'pixelated' }}
      width={cellPx}
    />
  );
}

function PlaceholderPersonIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      <path d="M4.5 20c1.4-4 4.1-6 7.5-6s6.1 2 7.5 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}
