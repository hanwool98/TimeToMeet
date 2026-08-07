export interface EventData {
  id: string;
  title: string;
  shortName: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  venueBooked: boolean;
  currentParticipants: number;
  targetParticipants: number;
}
