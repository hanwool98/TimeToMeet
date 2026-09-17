export interface EventData {
  applicationDeadline?: string;
  id: string;
  title: string;
  shortName: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  nicknameInstruction?: string;
  venueBooked: boolean;
  venueDetail?: string;
  malePrice: number;
  maleCapacity?: number;
  femalePrice: number;
  femaleCapacity?: number;
  discountNote?: string;
  earlyBirdDeadline?: string;
  earlyBirdDiscountMale?: number;
  earlyBirdDiscountFemale?: number;
  currentParticipants: number;
  targetParticipants: number;
  // 서버(get_public_event_summaries 등)가 항상 실제(가려지지 않은) 인원
  // 기준으로 계산해 내려주는 모집 가능 여부. currentParticipants는 행사
  // 시작 3일 전까지 0으로 가려지므로, "모집중/마감" 판단은 반드시 이
  // 필드로 하고 currentParticipants < targetParticipants로 다시 계산하지
  // 않는다(가려진 0으로 계산하면 항상 모집중으로 잘못 나온다). optional인
  // 이유는 이 타입이 admin의 행사 생성/수정 payload로도 재사용되는데,
  // 그 방향(쓰기)에는 서버가 계산하는 이 필드가 없기 때문이다.
  isRecruiting?: boolean;
  maleApplications?: number;
  femaleApplications?: number;
  maleConfirmed?: number;
  femaleConfirmed?: number;
  isTestEvent?: boolean;
  endedAt?: string;
  isLocked?: boolean;
}
