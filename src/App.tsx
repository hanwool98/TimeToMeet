import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from './components/BottomTabs';
import Calendar from './components/Calendar';
import EventCard from './components/EventCard';
import { events } from './data/events';

const initialSelectedDate = new Date(2026, 7, 16);
const today = new Date(2026, 7, 3);

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatKoreanDate(date: Date) {
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일(${dayNames[date.getDay()]})`;
}

export default function App() {
  const navigate = useNavigate();
  const eventCardRef = useRef<HTMLDivElement>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 7, 1));
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);

  const selectedEvent = useMemo(
    () => events.find((event) => event.date === toDateKey(selectedDate)),
    [selectedDate],
  );

  const handleApply = () => {
    if (!selectedEvent) return;
    navigate(`/events/${selectedEvent.id}`);
  };

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    window.setTimeout(() => {
      eventCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-5 pb-[108px] pt-11">
        <h1 className="mb-7 text-[40px] font-black leading-none tracking-normal">타임투밋</h1>
        <Calendar
          currentMonth={currentMonth}
          events={events}
          onMonthChange={setCurrentMonth}
          onSelectDate={handleSelectDate}
          selectedDate={selectedDate}
          today={today}
        />
        <div className="mt-8 scroll-mt-8" ref={eventCardRef}>
          <EventCard
            event={selectedEvent}
            onApply={handleApply}
            selectedDateLabel={formatKoreanDate(selectedDate)}
          />
        </div>
      </div>
      <BottomTabs />
    </main>
  );
}
