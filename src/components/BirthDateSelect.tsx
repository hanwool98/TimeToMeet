interface BirthDateSelectProps {
  value: string;
  onChange: (value: string) => void;
  className: string;
  selectClassName?: string;
}

const currentYear = new Date().getFullYear();
const minYear = currentYear - 100;
const years = Array.from({ length: currentYear - minYear + 1 }, (_, index) => currentYear - index);
const months = Array.from({ length: 12 }, (_, index) => index + 1);

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export default function BirthDateSelect({ className, onChange, selectClassName, value }: BirthDateSelectProps) {
  const [yearPart, monthPart, dayPart] = value ? value.split('-') : ['', '', ''];
  const year = Number(yearPart) || undefined;
  const month = Number(monthPart) || undefined;
  const day = Number(dayPart) || undefined;
  const dayOptions = Array.from({ length: year && month ? daysInMonth(year, month) : 31 }, (_, index) => index + 1);
  const defaultSelectClass = selectClassName ?? 'w-full appearance-none bg-transparent text-center outline-none';

  const emit = (nextYear: number, nextMonth: number, nextDay: number) => {
    const clampedDay = Math.min(nextDay, daysInMonth(nextYear, nextMonth));
    onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`);
  };

  return (
    <div className={className}>
      <select
        aria-label="출생 연도"
        className={defaultSelectClass}
        onChange={(event) => emit(Number(event.target.value), month || 1, day || 1)}
        value={year ?? ''}
      >
        <option disabled value="">
          년도
        </option>
        {years.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="shrink-0 text-[13px] font-black text-[#777]">년</span>
      <select
        aria-label="출생 월"
        className={defaultSelectClass}
        onChange={(event) => emit(year || currentYear - 25, Number(event.target.value), day || 1)}
        value={month ?? ''}
      >
        <option disabled value="">
          월
        </option>
        {months.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="shrink-0 text-[13px] font-black text-[#777]">월</span>
      <select
        aria-label="출생 일"
        className={defaultSelectClass}
        onChange={(event) => emit(year || currentYear - 25, month || 1, Number(event.target.value))}
        value={day ?? ''}
      >
        <option disabled value="">
          일
        </option>
        {dayOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="shrink-0 text-[13px] font-black text-[#777]">일</span>
    </div>
  );
}
