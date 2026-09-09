import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import Calendar from '../components/Calendar';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import EventCard from '../components/EventCard';
import useOperationalData from '../hooks/useOperationalData';

const KOREA_TIME_ZONE = 'Asia/Seoul';

function getKoreaToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone: KOREA_TIME_ZONE, year: 'numeric' });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1');
  return new Date(year, month - 1, day);
}

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

// 홈 UI 개편(1차) 이전에는 "/" 화면이 로고 + 캘린더 + 선택한 날짜의 행사
// 카드였다. 이 화면은 그 기능을 그대로 옮겨온 것으로, 캘린더로 날짜를
// 골라 그 날짜의 행사에 신청하는 기존 흐름을 하나도 바꾸지 않았다.
export default function CalendarPage() {
  const navigate = useNavigate();
  const eventCardRef = useRef<HTMLDivElement>(null);
  const [today] = useState(getKoreaToday);
  const [currentMonth, setCurrentMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => today);
  const { error, events, loading, reload } = useOperationalData();

  const selectedEvent = useMemo(
    () => events.find((event) => event.date === toDateKey(selectedDate)),
    [events, selectedDate],
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

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mobile-container mx-auto flex min-h-screen flex-col px-3 with-bottom-tabs pt-4">
        <h1 className="mb-3 text-[24px] font-black">캘린더</h1>
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
