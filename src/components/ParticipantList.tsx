import type { ParticipantData } from '../types/participant';

interface ParticipantListProps {
  title: string;
  participants: ParticipantData[];
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

export default function ParticipantList({ title, participants, onProfileClick }: ParticipantListProps) {
  const recruitingRows = Array.from({ length: Math.max(0, 10 - participants.length) });

  return (
    <section className="min-w-0 flex-1 rounded-[24px] border border-[#f0f3f6] bg-white px-1.5 py-3 shadow-calendar">
      <h2 className="mx-auto mb-2 grid h-8 w-14 place-items-center rounded-full bg-meet-blueSoft text-center text-[18px] font-black text-black">
        {title}
      </h2>
      <div className="grid grid-rows-[repeat(10,48px)] gap-1.5">
        {participants.map((participant) => (
          <article
            className="grid h-12 min-w-0 grid-cols-[30px_minmax(0,1fr)_22px] items-center gap-1.5 rounded-[17px] bg-white px-1 py-1 shadow-[0_8px_18px_rgba(30,43,63,0.05)]"
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
              <span
                aria-hidden="true"
                className="h-[30px] w-[30px] shrink-0 rounded-full bg-cover bg-center bg-no-repeat ring-1 ring-black/5 blur-[1.6px] saturate-[0.9]"
                style={{
                  backgroundImage: `url(${avatarSheet})`,
                  backgroundPosition: getAvatarPosition(participant.avatarIndex),
                  backgroundSize: '440% 330%',
                }}
              />
              <span className="min-w-0">
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-black leading-[1.1] text-black min-[390px]:text-[11px]">
                  {participant.nickname}
                </span>
                <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[8px] font-extrabold leading-[1.1] text-[#8c8c8c] min-[390px]:text-[9px]">
                  {participant.tags.map((tag) => `#${tag}`).join(' ')}
                </span>
              </span>
            </button>
            <button
              aria-label={`${participant.nickname} 자기소개 재생`}
              className="grid h-7 w-[22px] place-items-center rounded-full bg-meet-pinkSoft text-meet-pink transition hover:bg-[#ffdce8]"
              type="button"
            >
              <span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-meet-pink" />
            </button>
          </article>
        ))}
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
