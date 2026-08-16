export interface ParticipantData {
  id: string;
  gender: 'male' | 'female';
  nickname: string;
  tags: string[];
  avatarIndex: number;
  photoUrl?: string;
  representativeCrop?: { scale: number; offsetX: number; offsetY: number };
  audioIntroUrl?: string;
  profile?: ParticipantProfile;
}

export interface ParticipantProfile {
  name: string;
  birthDate: string;
  genderLabel: string;
  residence: string;
  phone: string;
  relationshipStatus: string;
  idPhotoStatus: string;
  nickname: string;
  profilePhotos: string;
  voiceIntro: string;
  height: string;
  job: string;
  employmentProof: string;
  accessRoute: string;
  shootingConsent: string;
  interviewConsent: string;
  refundAgreement: string;
  inquiry: string;
  reviewNotice: string;
}
