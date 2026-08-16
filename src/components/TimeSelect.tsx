interface TimeSelectProps {
  value: string;
  onChange: (value: string) => void;
  className: string;
  selectClassName?: string;
}

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

export default function TimeSelect({ className, onChange, selectClassName, value }: TimeSelectProps) {
  const [hour, minute] = value ? value.split(':') : ['', ''];

  const emit = (nextHour: string, nextMinute: string) => {
    if (!nextHour || !nextMinute) return;
    onChange(`${nextHour}:${nextMinute}`);
  };

  return (
    <div className={className}>
      <select
        aria-label="시"
        className={selectClassName ?? 'w-full appearance-none bg-transparent text-center outline-none'}
        onChange={(event) => emit(event.target.value, minute || '00')}
        value={hour}
      >
        {hours.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="shrink-0 font-black text-[#777]">:</span>
      <select
        aria-label="분"
        className={selectClassName ?? 'w-full appearance-none bg-transparent text-center outline-none'}
        onChange={(event) => emit(hour || '00', event.target.value)}
        value={minute}
      >
        {minutes.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
