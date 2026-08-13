import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Calendar from '../components/Calendar';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';

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

export default function AdminEventManagementPage() {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 7, 1));
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const { error, events, loading, reload } = useOperationalData();

  const selectedEvent = useMemo(
    () => events.find((event) => event.date === toDateKey(selectedDate)),
    [selectedDate],
  );
  const isEarlyBird = selectedEvent ? getDaysUntilEvent(selectedEvent.date) >= 8 : false;
  const isRecruiting = selectedEvent ? selectedEvent.currentParticipants < selectedEvent.targetParticipants : false;

  const handleEventAction = () => {
    if (selectedEvent) {
      navigate(`/admin/events/${selectedEvent.id}`);
      return;
    }
    navigate(`/admin/events/new?date=${toDateKey(selectedDate)}`);
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto flex min-h-screen w-full max-w-full min-w-0 flex-col px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <Calendar
          currentMonth={currentMonth}
          events={events}
          onMonthChange={setCurrentMonth}
          onSelectDate={setSelectedDate}
          selectedDate={selectedDate}
          today={today}
        />

        <section className="mt-8 w-full max-w-full min-w-0 rounded-[28px] bg-meet-blueSoft px-5 py-6">
          <div className="mb-2 flex max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-extrabold text-[#8a8a8a]">
            <span className="min-w-0 text-fluid-safe">{formatKoreanDate(selectedDate)}</span>
            {selectedEvent ? (
              <>
                <span>{selectedEvent.startTime}</span>
                <span className="ml-auto shrink-0">{selectedEvent.location}</span>
              </>
            ) : null}
          </div>
          <div className="flex min-h-[36px] items-start gap-3">
            <h1 className="min-w-0 flex-1 text-fluid-safe text-[25px] font-black leading-tight text-black">
              {selectedEvent ? selectedEvent.title : '행사없음'}
            </h1>
            {selectedEvent ? (
              <span
                aria-label={selectedEvent.venueBooked ? '대관 완료' : '대관 미완료'}
                className={[
                  'mt-1 h-3.5 w-3.5 shrink-0 rounded-full',
                  selectedEvent.venueBooked ? 'bg-green-500' : 'bg-red-500',
                ].join(' ')}
              />
            ) : null}
          </div>
          {selectedEvent ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[16px] font-black leading-none">
              {isRecruiting ? <span className="text-meet-pink">🔥 모집중</span> : null}
              {isEarlyBird ? <span className="text-meet-blue">🕊️ 얼리버드</span> : null}
            </div>
          ) : null}
          <PrimaryButton className="mt-6" onClick={handleEventAction}>
            {selectedEvent ? '참가자 확인 및 행사 수정' : '새 행사 만들기'}
          </PrimaryButton>
        </section>

        <button
          className="mx-auto mt-5 text-sm font-extrabold text-meet-blue"
          onClick={() => navigate('/admin')}
          type="button"
        >
          관리자페이지로 돌아가기
        </button>
      </div>
    </main>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date(2026, 7, 7);
  const eventDate = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((eventDate.getTime() - today.getTime()) / 86_400_000);
}
