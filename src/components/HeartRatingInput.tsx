// Interactive 0~5 score input in 0.5 steps - the 5 hearts ARE the input
// (no separate slider/star control). Each heart's tap target is a fixed
// 44px square regardless of the drawn heart's visual size, split at its
// horizontal midpoint: left half picks index-0.5, right half picks index.
export default function HeartRatingInput({ onChange, value }: { onChange: (score: number) => void; value: number | null }) {
  const handlePick = (index: number, clientX: number, currentTarget: HTMLButtonElement) => {
    const rect = currentTarget.getBoundingClientRect();
    const isLeftHalf = clientX - rect.left < rect.width / 2;
    onChange(isLeftHalf ? index - 0.5 : index);
  };

  return (
    <div className="flex items-center justify-center" role="radiogroup" aria-label="호감도 점수 선택">
      {[1, 2, 3, 4, 5].map((index) => {
        const fill = Math.max(0, Math.min(1, (value ?? 0) - (index - 1)));
        return (
          <button
            aria-label={`${index}번째 하트`}
            className="grid h-11 w-11 shrink-0 place-items-center"
            key={index}
            onClick={(event) => handlePick(index, event.clientX, event.currentTarget)}
            type="button"
          >
            <Heart fill={fill} />
          </button>
        );
      })}
    </div>
  );
}

function Heart({ fill }: { fill: number }) {
  const gradientId = `heart-input-fill-${Math.round(fill * 100)}`;
  return (
    <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24">
      <defs>
        <linearGradient id={gradientId}>
          <stop offset={`${fill * 100}%`} stopColor="#ef4d7a" />
          <stop offset={`${fill * 100}%`} stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z"
        fill={`url(#${gradientId})`}
        stroke="#ef4d7a"
        strokeWidth="1.3"
      />
    </svg>
  );
}
