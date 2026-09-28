// 후기 별점 공용 컴포넌트 - 0.5점 단위(0.5~5.0)를 표현하기 위해 각 별을
// "빈 별(배경) + 채워진 별(전경, 폭으로 0/50/100% 클립)" 두 겹으로 그린다.
// ReviewFormPage(참가자 작성/읽기전용 표시), AdminReviewsPage(관리자 수정),
// HomeReviewsSection(홈/전체 후기 읽기전용 표시) 전부 이 컴포넌트를
// 재사용해 별점 렌더링 로직을 한 곳에만 둔다.
//
// className/starClassName을 호출부마다 그대로 넘겨받아 각 화면의 기존
// 레이아웃(간격, 글자 크기, 색상)을 그대로 재현한다 - 새 디자인을 만들지
// 않는다.
const STAR_VALUES = [1, 2, 3, 4, 5] as const;

function fillPercentFor(rating: number, starIndex: number) {
  return Math.max(0, Math.min(100, (rating - (starIndex - 1)) * 100));
}

export function StarRatingDisplay({
  rating,
  className = '',
  starClassName = '',
  emptyColorClassName = 'text-[#d9dde2]',
  fillColorClassName = 'text-meet-pink',
}: {
  rating: number;
  className?: string;
  starClassName?: string;
  emptyColorClassName?: string;
  fillColorClassName?: string;
}) {
  return (
    <span aria-label={`별점 ${rating}점`} className={`inline-flex shrink-0 items-center leading-none ${className}`}>
      {STAR_VALUES.map((star) => (
        <span className={`relative inline-block ${starClassName}`} key={star}>
          <span aria-hidden="true" className={emptyColorClassName}>
            ★
          </span>
          <span
            aria-hidden="true"
            className={`absolute inset-0 overflow-hidden ${fillColorClassName}`}
            style={{ width: `${fillPercentFor(rating, star)}%` }}
          >
            ★
          </span>
        </span>
      ))}
    </span>
  );
}

export function StarRatingPicker({
  value,
  onChange,
  disabled,
  className = '',
  starClassName = '',
  emptyColorClassName = 'text-[#d9dde2]',
  fillColorClassName = 'text-meet-pink',
}: {
  value: number | null;
  onChange: (rating: number) => void;
  disabled?: boolean;
  className?: string;
  starClassName?: string;
  emptyColorClassName?: string;
  fillColorClassName?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center leading-none ${className}`}>
      {STAR_VALUES.map((star) => {
        const fillPercent = value != null ? fillPercentFor(value, star) : 0;
        return (
          <span className={`relative inline-block ${starClassName}`} key={star}>
            <span aria-hidden="true" className={emptyColorClassName}>
              ★
            </span>
            <span
              aria-hidden="true"
              className={`absolute inset-0 overflow-hidden ${fillColorClassName}`}
              style={{ width: `${fillPercent}%` }}
            >
              ★
            </span>
            {/* 별 하나를 좌/우 절반으로 나눠 각각 x.5 / x점을 선택하게 한다. */}
            <button
              aria-label={`${star - 0.5}점`}
              aria-pressed={value === star - 0.5}
              className="absolute inset-y-0 left-0 w-1/2 disabled:cursor-not-allowed"
              disabled={disabled}
              onClick={() => onChange(star - 0.5)}
              type="button"
            />
            <button
              aria-label={`${star}점`}
              aria-pressed={value === star}
              className="absolute inset-y-0 right-0 w-1/2 disabled:cursor-not-allowed"
              disabled={disabled}
              onClick={() => onChange(star)}
              type="button"
            />
          </span>
        );
      })}
    </span>
  );
}
