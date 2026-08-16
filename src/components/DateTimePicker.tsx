import { useEffect, useState } from 'react';
import { MonthCalendarGrid, formatDateKeyKorean, parseDateKey } from './DatePicker';
import TimeSelect from './TimeSelect';

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  placeholder?: string;
  triggerClassName: string;
}

function splitValue(value: string) {
  const [datePart, timePart] = value.split('T');
  return { datePart: datePart ?? '', timePart: timePart ?? '' };
}

function formatValueKorean(value: string) {
  const { datePart, timePart } = splitValue(value);
  if (!datePart) return '';
  const dateLabel = formatDateKeyKorean(datePart);
  return timePart ? `${dateLabel} ${timePart}` : dateLabel;
}

export default function DateTimePicker({ min, onChange, placeholder = '날짜/시간 선택', triggerClassName, value }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const initial = splitValue(value);
  const [pendingDate, setPendingDate] = useState(initial.datePart);
  const [pendingTime, setPendingTime] = useState(initial.timePart || '00:00');
  const [viewMonth, setViewMonth] = useState(() => {
    const base = parseDateKey(initial.datePart) ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const minDate = min ? splitValue(min).datePart : undefined;

  useEffect(() => {
    if (!open) return;
    const current = splitValue(value);
    const base = parseDateKey(current.datePart) ?? new Date();
    setPendingDate(current.datePart);
    setPendingTime(current.timePart || '00:00');
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    // Only reset when the picker opens, not on every value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = () => {
    if (!pendingDate) return;
    onChange(`${pendingDate}T${pendingTime}`);
    setOpen(false);
  };

  return (
    <>
      <button className={triggerClassName} onClick={() => setOpen(true)} type="button">
        {value ? formatValueKorean(value) : placeholder}
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
              <h2 className="text-[18px] font-black text-black">날짜/시간 선택</h2>
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
              min={minDate}
              onSelectDate={setPendingDate}
              onViewMonthChange={setViewMonth}
              selectedDateKey={pendingDate}
              viewMonth={viewMonth}
            />

            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="text-[14px] font-extrabold text-[#777]">시간</span>
              <TimeSelect
                className="flex h-11 items-center gap-1.5 rounded-[14px] bg-[#f7f7f7] px-3"
                onChange={setPendingTime}
                selectClassName="appearance-none bg-transparent text-center text-[15px] font-bold text-black outline-none"
                value={pendingTime}
              />
            </div>

            <button
              className="mt-5 h-12 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white disabled:opacity-40"
              disabled={!pendingDate}
              onClick={confirm}
              type="button"
            >
              확인
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
