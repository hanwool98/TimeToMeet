import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from './components/BottomTabs';
import Calendar from './components/Calendar';
import { DataErrorState, DataLoadingState } from './components/DataState';
import EventCard from './components/EventCard';
import useOperationalData from './hooks/useOperationalData';
import { loginAdminSession } from './services/adminAuth';

const today = new Date();

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
  const [currentMonth, setCurrentMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => today);
  const [logoTapCount, setLogoTapCount] = useState(0);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);
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

  const resetAdminLogin = () => {
    setShowAdminPrompt(false);
    setAdminPassword('');
    setAdminSubmitting(false);
  };

  const handleAdminSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setAdminSubmitting(true);
    try {
      await loginAdminSession(adminPassword);
      resetAdminLogin();
      navigate('/admin');
      return;
    } catch {
      window.alert('관리자 코드가 올바르지 않습니다.');
    } finally {
      setAdminSubmitting(false);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mobile-container mx-auto flex min-h-screen flex-col px-3 with-bottom-tabs pt-2">
        <div className="relative mb-1 w-[150px]">
          <img alt="time2meet" className="h-auto w-full object-contain" src="/assets/time2meet-logo.png" />
          <button
            aria-label="관리자 로그인 열기"
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
              <span className="text-[17px] font-black">관리자 코드</span>
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
                onClick={resetAdminLogin}
                type="button"
              >
                취소
              </button>
              <button className="h-12 rounded-[16px] bg-meet-blue text-[15px] font-black text-white disabled:opacity-50" disabled={adminSubmitting} type="submit">
                {adminSubmitting ? '확인 중' : '확인'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <BottomTabs />
    </main>
  );
}
