import PrimaryButton from './PrimaryButton';
import type { EventData } from '../types/event';

interface EventCardProps {
  selectedDateLabel: string;
  event?: EventData;
  onApply: () => void;
}

export default function EventCard({ selectedDateLabel, event, onApply }: EventCardProps) {
  const hasEvent = Boolean(event);

  return (
    <section className="rounded-[28px] bg-meet-blueSoft px-5 py-6">
      <p className="mb-2 text-[15px] font-extrabold text-[#8a8a8a]">
        {hasEvent ? selectedDateLabel : '선택된 날짜'}
      </p>
      <h3 className="min-h-[36px] text-[25px] font-black leading-tight text-black">
        {hasEvent
          ? `${event!.title} (${event!.currentParticipants}/${event!.targetParticipants})`
          : '행사없음'}
      </h3>
      <PrimaryButton className="mt-6" disabled={!hasEvent} onClick={onApply}>
        이 날짜로 소개팅 신청하기
      </PrimaryButton>
    </section>
  );
}
