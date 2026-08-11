import type { EventData } from '../types/event';

interface CalendarProps {
  currentMonth: Date;
  selectedDate: Date;
  today: Date;
  events: EventData[];
  onMonthChange: (nextMonth: Date) => void;
  onSelectDate: (date: Date) => void;
}

const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDate(a: Date, b: Date) {
  return toDateKey(a) === toDateKey(b);
}

function getMonthCells(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  for (let i = 0; i < firstDay.getDay(); i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

export default function Calendar({
  currentMonth,
  selectedDate,
  today,
  events,
  onMonthChange,
  onSelectDate,
}: CalendarProps) {
  const monthCells = getMonthCells(currentMonth);
  const eventByDate = new Map(events.map((event) => [event.date, event]));

  const moveMonth = (direction: -1 | 1) => {
    onMonthChange(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1));
  };

  return (
    <section className="w-full rounded-[30px] border border-[#f0f3f6] bg-white px-2.5 pb-5 pt-5 shadow-calendar min-[380px]:px-4 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-2">
        <button
          aria-label="이전 달 보기"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f7f7f7] text-3xl font-bold text-black transition hover:bg-slate-100 min-[380px]:h-11 min-[380px]:w-11"
          onClick={() => moveMonth(-1)}
          type="button"
        >
          ‹
        </button>
        <h2 className="min-w-0 text-center text-[21px] font-black tracking-normal text-black min-[380px]:text-[23px]">
          {currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월
        </h2>
        <button
          aria-label="다음 달 보기"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f7f7f7] text-3xl font-bold text-black transition hover:bg-slate-100 min-[380px]:h-11 min-[380px]:w-11"
          onClick={() => moveMonth(1)}
          type="button"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1.5 text-center min-[380px]:gap-y-2">
        {weekDays.map((day, index) => (
          <div
            className={[
              'text-[15px] font-extrabold',
              index === 0 ? 'text-meet-pink' : '',
              index === 6 ? 'text-meet-blue' : '',
              index !== 0 && index !== 6 ? 'text-[#b8b8b8]' : '',
            ].join(' ')}
            key={day}
          >
            {day}
          </div>
        ))}

        {monthCells.map((date, index) => {
          if (!date) {
            return <div className="h-[68px] min-[380px]:h-[74px]" key={`empty-${index}`} />;
          }

          const dateKey = toDateKey(date);
          const event = eventByDate.get(dateKey);
          const selected = isSameDate(date, selectedDate);
          const current = isSameDate(date, today);
          const isSunday = date.getDay() === 0;
          const isSaturday = date.getDay() === 6;

          return (
            <button
              aria-label={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 선택`}
              className={[
                'mx-auto flex w-full max-w-[46px] flex-col items-center justify-start px-0.5 pt-2 transition min-[380px]:max-w-[50px]',
                selected
                  ? 'h-[68px] rounded-[18px] bg-meet-blue text-white min-[380px]:h-[74px] min-[380px]:rounded-[20px]'
                  : 'h-[68px] rounded-[18px] bg-transparent hover:bg-slate-50 min-[380px]:h-[74px] min-[380px]:rounded-[20px]',
              ].join(' ')}
              key={dateKey}
              onClick={() => onSelectDate(date)}
              type="button"
            >
              <span
                className={[
                  'grid h-7 min-w-7 place-items-center rounded-full text-[18px] font-black leading-none min-[380px]:h-8 min-[380px]:min-w-8 min-[380px]:text-[20px]',
                  current && !selected ? 'bg-black text-white' : '',
                  selected ? 'text-white' : '',
                  !selected && !current && isSunday ? 'text-meet-pink' : '',
                  !selected && !current && isSaturday ? 'text-meet-blue' : '',
                  !selected && !current && !isSunday && !isSaturday ? 'text-black' : '',
                ].join(' ')}
              >
                {date.getDate()}
              </span>
              {event ? (
                <span
                  className={[
                    'mt-1 flex min-h-[28px] w-full flex-col items-center justify-center rounded-[11px] px-0.5 text-center text-[7px] font-extrabold leading-[1.08] min-[380px]:min-h-[31px] min-[380px]:rounded-[12px] min-[380px]:text-[8px]',
                    selected ? 'bg-white/20 text-white' : 'bg-meet-pinkSoft text-meet-pink',
                  ].join(' ')}
                >
                  <span>{event.shortName}</span>
                  <span>({event.currentParticipants}/{event.targetParticipants})</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
