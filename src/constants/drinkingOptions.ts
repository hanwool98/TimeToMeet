// 프로필카드 "흡연 및 음주"의 음주 정보 - 자유 입력 한 줄 대신 빈도/주량을
// 각각 선택하게 해서 "주 1회 / 주량 2병"처럼 한눈에 비교 가능한 형태로
// 통일한다. 실제 화면 표시 문자열 합성은 서버(save_event_profile_card_for_session)
// 가 하므로, 여기 상수는 선택지 목록 정의용이다.
export const DRINKING_FREQUENCY_OPTIONS = ['안 마심', '월 1~2회', '주 1회', '주 2~3회', '주 4회 이상'] as const;

export const DRINKING_AMOUNT_OPTIONS = ['거의 안 마심', '0.5병', '1병', '1.5병', '2병', '2병 이상'] as const;
