import type { ParticipantData } from '../types/participant';

interface ParticipantListProps {
  title: string;
  participants: ParticipantData[];
  onAvatarClick: (participant: ParticipantData) => void;
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

export default function ParticipantList({ title, participants, onAvatarClick }: ParticipantListProps) {
  const recruitingRows = Array.from({ length: Math.max(0, 10 - participants.length) });

  return (
    <section className="min-w-0 flex-1 rounded-[24px] border border-[#f0f3f6] bg-white px-1.5 py-3 shadow-calendar">
      <h2 className="mx-auto mb-3 grid h-9 w-14 place-items-center rounded-full bg-meet-blueSoft text-center text-[18px] font-black text-black">
        {title}
      </h2>
      <div className="space-y-2">
        {participants.map((participant) => (
          <article
            className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)_24px] items-center gap-1.5 rounded-[17px] bg-white px-1 py-1.5 shadow-[0_8px_18px_rgba(30,43,63,0.05)]"
            key={participant.id}
          >
            <button
              aria-label={`${participant.nickname} 대표 사진`}
              className="h-8 w-8 rounded-full bg-cover bg-center bg-no-repeat ring-1 ring-black/5 blur-[1.6px] saturate-[0.9] transition hover:scale-105"
              onClick={() => onAvatarClick(participant)}
              type="button"
              style={{
                backgroundImage: `url(${avatarSheet})`,
                backgroundPosition: getAvatarPosition(participant.avatarIndex),
                backgroundSize: '440% 330%',
              }}
            />
            <div className="min-w-0">
              <p className="break-keep text-[11px] font-black leading-[1.18] text-black">
                {participant.nickname}
              </p>
              <p className="mt-0.5 break-keep text-[9px] font-extrabold leading-[1.18] text-[#8c8c8c]">
                {participant.tags.map((tag) => `#${tag}`).join(' ')}
              </p>
            </div>
            <button
              aria-label={`${participant.nickname} 자기소개 재생`}
              className="grid h-7 w-6 place-items-center rounded-full bg-meet-pinkSoft text-meet-pink transition hover:bg-[#ffdce8]"
              type="button"
            >
              <span className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-meet-pink" />
            </button>
          </article>
        ))}
        {recruitingRows.map((_, index) => (
          <div
            className="rounded-[17px] bg-white py-2 text-center text-[12px] font-black text-[#8a8a8a] shadow-[0_8px_18px_rgba(30,43,63,0.04)]"
            key={`recruiting-${index}`}
          >
            (모집중)
          </div>
        ))}
      </div>
    </section>
  );
}
