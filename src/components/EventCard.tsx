import PrimaryButton from './PrimaryButton';
import type { EventData } from '../types/event';

interface EventCardProps {
  selectedDateLabel: string;
  event?: EventData;
  onApply: () => void;
  blockedMessage?: string;
}

export default function EventCard({ selectedDateLabel, event, onApply, blockedMessage }: EventCardProps) {
  const hasEvent = Boolean(event);
  const isEarlyBird = event ? getDaysUntilEvent(event.date) >= 8 : false;
  const isRecruiting = event ? event.currentParticipants < event.targetParticipants : false;
  const isBlocked = Boolean(blockedMessage);

  return (
    <section className="w-full rounded-[28px] bg-meet-blueSoft px-4 py-6 min-[380px]:px-5">
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
    </section>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((eventDate.getTime() - today.getTime()) / 86_400_000);
}
