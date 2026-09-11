import PrimaryButton from './PrimaryButton';
import type { EventData } from '../types/event';

// 홈 "다가오는 행사" 카드와 같은 기본 목업(현장 사진) - 관리자가 대표
// 이미지를 등록하지 않은 행사에 쓴다. 좁은 카드에서도 대화하는 두 사람
// 위주로 보이도록 레터박스(2.5:1)로 자르고 object-position을 내려 잡는다.
const eventCoverPlaceholder = '/assets/home/event-cover-placeholder.jpg';

interface EventCardProps {
  selectedDateLabel: string;
  event?: EventData;
  coverUrl?: string;
  onApply: () => void;
  blockedMessage?: string;
}

export default function EventCard({ selectedDateLabel, event, coverUrl, onApply, blockedMessage }: EventCardProps) {
  const hasEvent = Boolean(event);
  const isEarlyBird = event ? getDaysUntilEvent(event.date) >= 8 : false;
  const isRecruiting = event ? event.currentParticipants < event.targetParticipants : false;
  const isBlocked = Boolean(blockedMessage);

  return (
    <section className="w-full overflow-hidden rounded-[24px] bg-meet-blueSoft">
      {event ? (
        <div className="relative w-full" style={{ aspectRatio: '2.5 / 1' }}>
          <img
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 h-full w-full object-cover ${coverUrl ? 'object-center' : 'object-[center_32%]'}`}
            src={coverUrl ?? eventCoverPlaceholder}
          />
          <span className="absolute left-3 top-3 rounded-full bg-meet-pink px-2.5 py-1 text-[11px] font-black text-white shadow-sm">
            {formatDDay(getDaysUntilEvent(event.date))}
          </span>
        </div>
      ) : null}
      <div className="px-4 pb-6 pt-4 min-[380px]:px-5">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-extrabold text-[#8a8a8a] min-[380px]:text-[15px]">
          <span className="min-w-0 text-fluid-safe">{hasEvent ? selectedDateLabel : '선택된 날짜'}</span>
          {event ? <span>{event.startTime}</span> : null}
          {event ? <span className="ml-auto shrink-0">{event.location}</span> : null}
        </div>
        <h3 className="min-h-[36px] text-fluid-safe text-[22px] font-black leading-tight text-black min-[380px]:text-[25px]">
          {hasEvent ? event!.title : '행사없음'}
        </h3>
        {event ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] font-black leading-none">
            {isRecruiting ? <span className="text-meet-pink">🔥 모집중</span> : null}
            {isEarlyBird ? <span className="text-meet-blue">🕊️ 얼리버드</span> : null}
          </div>
        ) : null}
        <PrimaryButton className="mt-6" disabled={!hasEvent || isBlocked} onClick={onApply}>
          이 날짜로 소개팅 신청하기
        </PrimaryButton>
        {isBlocked ? <p className="mt-2 text-center text-[13px] font-black text-meet-pink">{blockedMessage}</p> : null}
      </div>
    </section>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((eventDate.getTime() - today.getTime()) / 86_400_000);
}

function formatDDay(days: number) {
  return days <= 0 ? 'D-DAY' : `D-${days}`;
}
