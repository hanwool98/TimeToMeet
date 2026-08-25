// 행사 전용 프로필 카드의 "나를 표현하는 키워드" - 상대를 평가하는
// rating hashtag(constants/ratingHashtags.ts)와는 완전히 다른 개념으로,
// 본인이 스스로를 소개하기 위해 고르는 태그다. key는 DB에 저장되는
// 안정적인 식별자(문구가 바뀌어도 공통 키워드 판정이 깨지지 않도록) -
// label은 화면에 보여줄 문구.
export interface ProfileKeywordOption {
  key: string;
  label: string;
}

export const PROFILE_KEYWORD_OPTIONS: ProfileKeywordOption[] = [
  // 성격 / 분위기
  { key: 'lively', label: '#활발함' },
  { key: 'calm', label: '#차분함' },
  { key: 'humorous', label: '#유머러스함' },
  { key: 'friendly', label: '#친근함' },
  { key: 'considerate', label: '#배려심있음' },
  { key: 'honest', label: '#솔직함' },
  { key: 'positive', label: '#긍정적임' },
  { key: 'quirky', label: '#엉뚱함' },
  { key: 'witty', label: '#센스있음' },
  { key: 'intellectual', label: '#지적인느낌' },
  // 생활 / 성향
  { key: 'workaholic', label: '#워커홀릭' },
  { key: 'self_disciplined', label: '#자기관리잘함' },
  { key: 'organized', label: '#계획적임' },
  { key: 'spontaneous', label: '#즉흥적임' },
  { key: 'frugal', label: '#알뜰함' },
  // 취미 / 관심사
  { key: 'likes_music', label: '#음악좋아함' },
  { key: 'likes_movies', label: '#영화좋아함' },
  { key: 'likes_exercise', label: '#운동좋아함' },
  { key: 'likes_travel', label: '#여행좋아함' },
  { key: 'likes_food', label: '#맛집좋아함' },
  { key: 'likes_cafe', label: '#카페좋아함' },
  { key: 'likes_games', label: '#게임좋아함' },
  { key: 'likes_books', label: '#책좋아함' },
  { key: 'likes_pets', label: '#반려동물좋아함' },
  { key: 'likes_driving', label: '#드라이브좋아함' },
];

export const PROFILE_KEYWORD_LABEL_BY_KEY = new Map(PROFILE_KEYWORD_OPTIONS.map((option) => [option.key, option.label]));

export const PROFILE_KEYWORD_CUSTOM_MAX_LENGTH = 15;

// 고정 키워드는 key로, 직접입력은 정규화된(#으로 시작하는) 문구로 저장되므로
// 화면에 보여줄 라벨은 이 함수 하나로 통일해서 구한다.
export function profileKeywordLabel(storedValue: string) {
  return PROFILE_KEYWORD_LABEL_BY_KEY.get(storedValue) ?? storedValue;
}
