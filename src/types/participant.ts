export interface ParticipantData {
  id: string;
  gender: 'male' | 'female';
  nickname: string;
  tags: string[];
  avatarIndex: number;
  audioIntroUrl?: string;
}
