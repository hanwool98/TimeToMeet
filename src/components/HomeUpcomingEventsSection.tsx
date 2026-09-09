import { useNavigate } from 'react-router-dom';
import HomeCarousel, { HOME_MAIN_CARD_HEIGHT_CLASS } from './HomeCarousel';
import type { EventData } from '../types/event';

// 행사 대표 이미지를 담을 DB 컬럼/관리자 업로드가 아직 없어(이번 1차
// 작업 범위 밖) 전체 행사 공용 placeholder 그래픽을 쓴다. 실제 사진처럼
// 보이지 않도록 일부러 그라디언트+로고 그래픽으로만 구성했다.
const eventCoverPlaceholder = '/assets/home/event-cover-placeholder.svg';

export default function HomeUpcomingEventsSection({ events }: { events: EventData[] }) {
  const navigate = useNavigate();

  const upcomingEvents = events
    .filter((event) => getDaysUntilEvent(event.date) >= 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <section>
      <h2 className="mb-3 text-[19px] font-black text-black">다가오는 행사 💧</h2>
      {upcomingEvents.length === 0 ? (
        <div
          className={`grid w-full place-items-center rounded-[22px] bg-meet-blueSoft ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
        >
          <p className="text-[14px] font-bold text-[#8a8a8a]">예정된 행사가 없습니다</p>
        </div>
      ) : (
        <HomeCarousel
          ariaLabel="다가오는 행사"
          getKey={(event) => event.id}
          items={upcomingEvents}
          renderItem={(event) => (
            <button
              className={`flex w-full flex-col overflow-hidden rounded-[22px] bg-white text-left shadow-[0_10px_30px_rgba(30,43,63,0.08)] transition active:scale-[0.99] ${HOME_MAIN_CARD_HEIGHT_CLASS}`}
              onClick={() => navigate(`/events/${event.id}`)}
              type="button"
            >
              <div className="relative h-[54%] w-full shrink-0">
                <img alt="" aria-hidden="true" className="h-full w-full object-cover" src={eventCoverPlaceholder} />
                <span className="absolute left-3 top-3 rounded-full bg-meet-pink px-2.5 py-1 text-[12px] font-black text-white shadow-sm">
                  {formatDDay(getDaysUntilEvent(event.date))}
                </span>
              </div>
              <div className="flex flex-1 flex-col justify-between px-3.5 py-2.5">
                <div>
                  <h3 className="truncate text-[15px] font-black text-black">{event.title}</h3>
                  <p className="mt-1 truncate text-[12px] font-bold text-[#8a8a8a]">
                    {formatKoreanDate(event.date)} · {formatTimeRange(event.startTime, event.endTime)}
                  </p>
                  <p className="truncate text-[12px] font-bold text-[#8a8a8a]">{event.location}</p>
                </div>
                <span className="mt-1.5 inline-flex w-fit items-center gap-1 self-end rounded-full bg-meet-blueSoft px-3 py-1.5 text-[12px] font-black text-meet-blue">
                  소개팅 신청하기 <span aria-hidden="true">›</span>
                </span>
              </div>
            </button>
          )}
        />
      )}
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

function formatKoreanDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(year, month - 1, day);
  return `${year}년 ${month}월 ${day}일 (${dayNames[date.getDay()]})`;
}

function formatTimeRange(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const period = startHour < 12 ? '오전' : '오후';
  const to12Hour = (hour: number) => hour % 12 || 12;
  return `${period} ${to12Hour(startHour)}:${String(startMinute).padStart(2, '0')} - ${to12Hour(endHour)}:${String(endMinute).padStart(2, '0')}`;
}
