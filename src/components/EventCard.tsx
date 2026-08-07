import PrimaryButton from './PrimaryButton';
import type { EventData } from '../types/event';

interface EventCardProps {
  selectedDateLabel: string;
  event?: EventData;
  onApply: () => void;
}

export default function EventCard({ selectedDateLabel, event, onApply }: EventCardProps) {
  const hasEvent = Boolean(event);
  const isEarlyBird = event ? getDaysUntilEvent(event.date) >= 8 : false;
  const isRecruiting = event ? event.currentParticipants < event.targetParticipants : false;

  return (
    <section className="rounded-[28px] bg-meet-blueSoft px-5 py-6">
      <div className="mb-2 flex items-center gap-3 text-[15px] font-extrabold text-[#8a8a8a]">
        <span>{hasEvent ? selectedDateLabel : '선택된 날짜'}</span>
        {event ? <span>{event.startTime}</span> : null}
        {event ? <span className="ml-auto">{event.location}</span> : null}
      </div>
      <h3 className="min-h-[36px] break-keep text-[25px] font-black leading-tight text-black">
        {hasEvent ? event!.title : '행사없음'}
      </h3>
      {event ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] font-black leading-none">
          {isRecruiting ? <span className="text-meet-pink">🔥 모집중</span> : null}
          {isEarlyBird ? <span className="text-meet-blue">🕊️ 얼리버드</span> : null}
        </div>
      ) : null}
      <PrimaryButton className="mt-6" disabled={!hasEvent} onClick={onApply}>
        이 날짜로 소개팅 신청하기
      </PrimaryButton>
    </section>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date(2026, 7, 7);
  const eventDate = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((eventDate.getTime() - today.getTime()) / 86_400_000);
}
