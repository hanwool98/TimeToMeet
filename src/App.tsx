import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from './components/BottomTabs';
import Calendar from './components/Calendar';
import EventCard from './components/EventCard';
import useSharedAdminData from './hooks/useSharedAdminData';
import { getEventsWithParticipantCounts } from './utils/adminApplications';

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
  const [logoTapCount, setLogoTapCount] = useState(0);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  useSharedAdminData();
  const events = getEventsWithParticipantCounts();

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

  const handleLogoSecretTap = () => {
    setLogoTapCount((count) => {
      const nextCount = count + 1;
      if (nextCount >= 5) {
        setShowAdminPrompt(true);
        return 0;
      }
      return nextCount;
    });
  };

  const handleAdminSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (adminPassword === '19980618') {
      setShowAdminPrompt(false);
      setAdminPassword('');
      navigate('/admin');
      return;
    }
    window.alert('비밀번호가 올바르지 않습니다.');
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-3 pb-[108px] pt-2">
        <div className="relative mb-1 w-[150px]">
          <img alt="time2meet" className="h-auto w-full object-contain" src="/assets/time2meet-logo.png" />
          <button
            aria-label="관리자 비밀번호 입력 열기"
            className="absolute left-[43%] top-0 h-full w-[16%]"
            onClick={handleLogoSecretTap}
            type="button"
          />
        </div>
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
      {showAdminPrompt ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 px-6">
          <form
            className="w-full max-w-[330px] rounded-[26px] bg-white p-6 shadow-calendar"
            onSubmit={handleAdminSubmit}
          >
            <label className="block">
              <span className="text-[17px] font-black">관리자 비밀번호</span>
              <input
                autoFocus
                className="mt-4 h-12 w-full rounded-[16px] bg-meet-blueSoft px-4 text-[18px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
                onChange={(event) => setAdminPassword(event.target.value)}
                type="password"
                value={adminPassword}
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="h-12 rounded-[16px] bg-[#e8e8e8] text-[15px] font-black text-black"
                onClick={() => {
                  setShowAdminPrompt(false);
                  setAdminPassword('');
                }}
                type="button"
              >
                취소
              </button>
              <button className="h-12 rounded-[16px] bg-meet-blue text-[15px] font-black text-white" type="submit">
                확인
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <BottomTabs />
    </main>
  );
}
