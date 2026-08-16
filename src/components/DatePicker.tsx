import { useEffect, useState } from 'react';

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  triggerClassName: string;
}

const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatDateKeyKorean(value: string) {
  const date = parseDateKey(value);
  if (!date) return '';
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${dayNames[date.getDay()]})`;
}

function getMonthCells(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  for (let i = 0; i < firstDay.getDay(); i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

interface MonthCalendarGridProps {
  selectedDateKey: string;
  min?: string;
  max?: string;
  onSelectDate: (dateKey: string) => void;
  viewMonth: Date;
  onViewMonthChange: (nextMonth: Date) => void;
}

export function MonthCalendarGrid({ max, min, onSelectDate, onViewMonthChange, selectedDateKey, viewMonth }: MonthCalendarGridProps) {
  const [showMonthJump, setShowMonthJump] = useState(false);
  const minDate = parseDateKey(min ?? '');
  const maxDate = parseDateKey(max ?? '');

  const isOutOfRange = (date: Date) => {
    if (minDate && date.getTime() < minDate.getTime()) return true;
    if (maxDate && date.getTime() > maxDate.getTime()) return true;
    return false;
  };

  const moveMonth = (direction: -1 | 1) => {
    onViewMonthChange(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + direction, 1));
  };

  const monthCells = getMonthCells(viewMonth);
  const today = new Date();
  const yearRangeStart = viewMonth.getFullYear() - 6;

  if (showMonthJump) {
    return (
      <div className="mt-4">
        <div className="mb-3 flex items-center justify-center gap-4">
          <button
            aria-label="이전 연도대"
            className="grid h-9 w-9 place-items-center rounded-full bg-[#f7f7f7] text-[18px] font-bold text-black"
            onClick={() => onViewMonthChange(new Date(viewMonth.getFullYear() - 12, viewMonth.getMonth(), 1))}
            type="button"
          >
            ‹
          </button>
          <span className="text-[16px] font-black text-black">
            {yearRangeStart} - {yearRangeStart + 11}
          </span>
          <button
            aria-label="다음 연도대"
            className="grid h-9 w-9 place-items-center rounded-full bg-[#f7f7f7] text-[18px] font-bold text-black"
            onClick={() => onViewMonthChange(new Date(viewMonth.getFullYear() + 12, viewMonth.getMonth(), 1))}
            type="button"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, index) => yearRangeStart + index).map((year) => (
            <button
              className={[
                'h-11 rounded-[14px] text-[14px] font-bold',
                year === viewMonth.getFullYear() ? 'bg-meet-blue text-white' : 'bg-[#f7f7f7] text-black',
              ].join(' ')}
              key={year}
              onClick={() => onViewMonthChange(new Date(year, viewMonth.getMonth(), 1))}
              type="button"
            >
              {year}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {monthNames.map((label, index) => (
            <button
              className={[
                'h-11 rounded-[14px] text-[14px] font-bold',
                index === viewMonth.getMonth() ? 'bg-meet-blue text-white' : 'bg-[#f7f7f7] text-black',
              ].join(' ')}
              key={label}
              onClick={() => {
                onViewMonthChange(new Date(viewMonth.getFullYear(), index, 1));
                setShowMonthJump(false);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <button
          aria-label="이전 달"
          className="grid h-9 w-9 place-items-center rounded-full bg-[#f7f7f7] text-[20px] font-bold text-black"
          onClick={() => moveMonth(-1)}
          type="button"
        >
          ‹
        </button>
        <button className="text-[17px] font-black text-black" onClick={() => setShowMonthJump(true)} type="button">
          {viewMonth.getFullYear()}년 {viewMonth.getMonth() + 1}월
        </button>
        <button
          aria-label="다음 달"
          className="grid h-9 w-9 place-items-center rounded-full bg-[#f7f7f7] text-[20px] font-bold text-black"
          onClick={() => moveMonth(1)}
          type="button"
        >
          ›
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-y-1 text-center">
        {weekDays.map((day, index) => (
          <div
            className={['text-[12px] font-extrabold', index === 0 ? 'text-meet-pink' : index === 6 ? 'text-meet-blue' : 'text-[#b8b8b8]'].join(' ')}
            key={day}
          >
            {day}
          </div>
        ))}
        {monthCells.map((date, index) => {
          if (!date) return <div className="h-11" key={`empty-${index}`} />;
          const dateKey = toDateKey(date);
          const disabled = isOutOfRange(date);
          const isSelected = selectedDateKey === dateKey;
          const isToday = toDateKey(today) === dateKey;
          return (
            <button
              className={[
                'mx-auto grid h-11 w-9 place-items-center rounded-full text-[14px] font-bold transition',
                isSelected ? 'bg-meet-blue text-white' : isToday ? 'bg-[#f0f3f6] text-black' : 'text-black',
                disabled ? 'cursor-not-allowed opacity-25' : 'active:scale-[0.92]',
              ].join(' ')}
              disabled={disabled}
              key={dateKey}
              onClick={() => onSelectDate(dateKey)}
              type="button"
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function DatePicker({ max, min, onChange, placeholder = '날짜 선택', triggerClassName, value }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseDateKey(value);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = selectedDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return;
    const base = selectedDate ?? new Date();
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    // Only reset the view when the picker opens, not on every value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button className={triggerClassName} onClick={() => setOpen(true)} type="button">
        {value ? formatDateKeyKorean(value) : placeholder}
      </button>

      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-5"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <section className="w-full max-w-[360px] rounded-[28px] bg-white p-5 shadow-calendar" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-black text-black">날짜 선택</h2>
              <button
                aria-label="닫기"
                className="grid h-9 w-9 place-items-center rounded-full bg-[#f2f2f2] text-[18px] font-black text-black"
                onClick={() => setOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <MonthCalendarGrid
              max={max}
              min={min}
              onSelectDate={(dateKey) => {
                onChange(dateKey);
                setOpen(false);
              }}
              onViewMonthChange={setViewMonth}
              selectedDateKey={value}
              viewMonth={viewMonth}
            />
          </section>
        </div>
      ) : null}
    </>
  );
}
