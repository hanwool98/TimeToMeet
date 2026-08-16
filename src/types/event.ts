export interface EventData {
  applicationDeadline?: string;
  id: string;
  title: string;
  shortName: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  venueBooked: boolean;
  venueDetail?: string;
  malePrice: number;
  maleCapacity?: number;
  femalePrice: number;
  femaleCapacity?: number;
  currentParticipants: number;
  targetParticipants: number;
  maleApplications?: number;
  femaleApplications?: number;
  maleConfirmed?: number;
  femaleConfirmed?: number;
}
