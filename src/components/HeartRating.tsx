// Read-only 0~5 score (0.5 steps) rendered as 5 pink hearts - empty / half /
// full. Score display only; there's no editing affordance here since this
// is for operators reviewing what a participant already submitted.
export default function HeartRating({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`호감도 ${score}점`}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, score - index));
        return <Heart key={index} fill={fill} />;
      })}
    </span>
  );
}

function Heart({ fill }: { fill: number }) {
  const gradientId = `heart-fill-${Math.round(fill * 100)}`;
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
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
