import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HomeCarousel from './HomeCarousel';
import { fetchEventCoverUrls } from '../services/supabaseApplications';
import type { EventData } from '../types/event';

// 관리자가 행사별 대표 이미지를 등록하지 않은 경우에 쓰는 공용 목업.
// 실제 로테이션 소개팅 현장 사진(대화 장면)을 기본값으로 쓰고, 좁은
// 썸네일에서는 object-position으로 대화하는 두 사람 위주로 잡아준다.
const eventCoverPlaceholder = '/assets/home/event-cover-placeholder.jpg';

// 레퍼런스 시안의 다가오는 행사 카드: 세로가 아니라 가로형 - 사진 왼쪽
// 썸네일, 가운데 제목/날짜/시간/지역, 신청 버튼은 오른쪽 아래.
export default function HomeUpcomingEventsSection({ events }: { events: EventData[] }) {
  const navigate = useNavigate();
  const [covers, setCovers] = useState<Record<string, string>>({});

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((event) => getDaysUntilEvent(event.date) >= 0)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [events],
  );

  const upcomingIdsKey = upcomingEvents.map((event) => event.id).join(',');
  useEffect(() => {
    if (!upcomingIdsKey) return;
    let active = true;
    void fetchEventCoverUrls(upcomingIdsKey.split(',')).then((next) => {
      if (active) setCovers(next);
    });
    return () => {
      active = false;
    };
  }, [upcomingIdsKey]);

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-black text-black">다가오는 행사 🌸</h2>
        <button className="text-[12px] font-bold text-[#9a9a9a]" onClick={() => navigate('/calendar')} type="button">
          전체보기 ›
        </button>
      </div>
      {upcomingEvents.length === 0 ? (
        <div className="grid h-[120px] w-full place-items-center rounded-[18px] bg-meet-blueSoft">
          <p className="text-[13px] font-bold text-[#8a8a8a]">예정된 행사가 없습니다</p>
        </div>
      ) : (
        <HomeCarousel
          ariaLabel="다가오는 행사"
          getKey={(event) => event.id}
          items={upcomingEvents}
          trackClassName="-mr-5 pr-5"
          renderItem={(event) => (
            <button
              className="flex w-full items-stretch gap-3.5 rounded-[18px] border border-[#eef0f2] bg-white p-3.5 text-left shadow-[0_8px_22px_rgba(30,43,63,0.07)] transition active:scale-[0.99]"
              onClick={() => navigate(`/events/${event.id}`)}
              type="button"
            >
              <div className="relative w-[108px] shrink-0 self-stretch overflow-hidden rounded-[13px]">
                <img
                  alt=""
                  aria-hidden="true"
                  className={`absolute inset-0 h-full min-h-[108px] w-full object-cover ${
                    covers[event.id] ? 'object-center' : 'object-[center_30%]'
                  }`}
                  src={covers[event.id] ?? eventCoverPlaceholder}
                />
                <span className="absolute left-1.5 top-1.5 rounded-full bg-meet-pink px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
                  {formatDDay(getDaysUntilEvent(event.date))}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col py-0.5">
                <h3 className="truncate text-[14.5px] font-black text-black">{event.title}</h3>
                <p className="mt-1.5 text-[11px] font-bold leading-[1.7] text-[#8a8a8a]">
                  📅 {formatKoreanDate(event.date)}
                  <br />🕐 {formatTimeRange(event.startTime, event.endTime)}
                  <br />📍 {event.location}
                </p>
                <span className="mt-auto ml-auto rounded-[12px] bg-meet-blueSoft px-3.5 py-2 text-[11.5px] font-black text-meet-blue">
                  소개팅 신청하기 ›
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
