export type ApplicationStatus =
  | '심사 대기'
  | '결제 대기'
  | '입금 확인 중'
  | '참가 확정'
  | '반려'
  | '참여 보류'
  | '환불 완료'
  | '자동 취소';

export interface StoredApplication {
  dbId?: string;
  accountType?: 'member' | 'guest';
  id: string;
  userId: string;
  gender: '남성' | '여성';
  age: number;
  eventDate: string;
  eventType: string;
  returning: '첫 참여' | '재참여';
  appliedAt: string;
  status: ApplicationStatus;
  isNew?: boolean;
  paymentDeadline?: string;
  paymentNoticeSentAt?: string;
  depositRequestedAt?: string;
  depositFailedAt?: string;
  depositFailureReason?: string;
  depositorName?: string;
  paymentCompletedAt?: string;
  checkedInAt?: string;
  reviewedAt?: string;
  userUuid?: string;
  profile?: import('../types/participant').ParticipantProfile;
}
