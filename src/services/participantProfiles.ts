import { supabase } from '../lib/supabase';
import { getAppSession } from './appAuth';

export interface MyPageSummary {
  accountType: 'member' | 'guest' | null;
  avatarIndex: number;
  guestDisplayId?: string;
  hasProfile: boolean;
  nickname: string;
  phoneMasked: string;
  profilePhotoUrl?: string;
}

export interface MyParticipantProfile {
  accountType: 'member' | 'guest';
  birthDate: string;
  canReuse: boolean;
  gender: string;
  hasEmploymentProof: boolean;
  hasIdPhoto: boolean;
  hasVoiceIntro: boolean;
  height: string;
  id: string;
  job: string;
  name: string;
  nickname: string;
  phoneMasked: string;
  profilePhotoCount: number;
  relationshipStatus: string;
  representativePhotoIndex: number;
  residence: string;
  source: 'default_profile' | 'application_profile';
  updatedAt: string;
}

interface MyPageSummaryRow {
  account_type: 'member' | 'guest' | null;
  avatar_index: number | null;
  guest_display_id?: string | null;
  has_profile: boolean | null;
  nickname: string | null;
  phone_masked: string | null;
}

interface MySessionPhoneResponse {
  accountType?: 'member' | 'guest' | null;
  guestDisplayId?: string | null;
  ok?: boolean;
  phoneMasked?: string | null;
}

interface MyParticipantProfileRow {
  account_type: 'member' | 'guest';
  birth_date: string;
  can_reuse: boolean;
  gender: string;
  has_employment_proof: boolean;
  has_id_photo: boolean;
  has_voice_intro: boolean;
  height: string;
  id: string;
  job: string;
  name: string;
  nickname: string;
  phone_masked: string;
  profile_photo_count: number;
  relationship_status: string;
  representative_photo_index: number;
  residence: string;
  source: 'default_profile' | 'application_profile';
  updated_at: string;
}

export async function fetchMyPageSummary(): Promise<MyPageSummary | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return null;

  const { data, error } = await supabase.rpc('get_my_page_summary', {
    session_token: session.token,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as MyPageSummaryRow | undefined;
  if (!row?.account_type) return null;

  const profilePhotoUrl = Boolean(row.has_profile) ? await fetchMyProfilePhotoUrl(session.token) : undefined;
  const phoneFallback =
    row.account_type === 'guest' && (!row.phone_masked || !row.guest_display_id)
      ? await fetchMySessionPhone(session.token)
      : null;

  return {
    accountType: row.account_type,
    avatarIndex: Number(row.avatar_index ?? 0),
    guestDisplayId: row.guest_display_id || phoneFallback?.guestDisplayId || undefined,
    hasProfile: Boolean(row.has_profile),
    nickname: row.nickname || (row.account_type === 'member' ? '회원' : '비회원'),
    phoneMasked: row.phone_masked || phoneFallback?.phoneMasked || '',
    profilePhotoUrl,
  };
}

export async function fetchMySessionPhone(sessionToken?: string): Promise<Pick<MyPageSummary, 'accountType' | 'guestDisplayId' | 'phoneMasked'> | null> {
  if (!supabase || !sessionToken) return null;

  const { data, error } = await supabase.functions.invoke('my-session-phone', {
    body: { sessionToken },
  });

  const response = data as MySessionPhoneResponse | null;
  if (error || response?.ok !== true) return null;

  return {
    accountType: response.accountType ?? null,
    guestDisplayId: response.guestDisplayId || undefined,
    phoneMasked: response.phoneMasked || '',
  };
}

async function fetchMyProfilePhotoUrl(sessionToken: string) {
  if (!supabase) return undefined;

  const { data, error } = await supabase.functions.invoke('my-profile-photo', {
    body: { sessionToken },
  });

  if (error || data?.ok !== true || typeof data.signedUrl !== 'string') return undefined;
  return data.signedUrl;
}

export async function fetchMyParticipantProfile(): Promise<MyParticipantProfile | null> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) return null;

  const { data, error } = await supabase.rpc('get_my_participant_profile', {
    session_token: session.token,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as MyParticipantProfileRow | undefined;
  if (!row?.id) return null;

  return {
    accountType: row.account_type,
    birthDate: row.birth_date,
    canReuse: Boolean(row.can_reuse),
    gender: row.gender,
    hasEmploymentProof: Boolean(row.has_employment_proof),
    hasIdPhoto: Boolean(row.has_id_photo),
    hasVoiceIntro: Boolean(row.has_voice_intro),
    height: row.height,
    id: row.id,
    job: row.job,
    name: row.name,
    nickname: row.nickname,
    phoneMasked: row.phone_masked,
    profilePhotoCount: Number(row.profile_photo_count ?? 0),
    relationshipStatus: row.relationship_status,
    representativePhotoIndex: Number(row.representative_photo_index ?? 0),
    residence: row.residence,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

export async function updateMyParticipantProfileNickname(nickname: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const session = getAppSession();
  if (!session?.token) throw new Error('회원 로그인이 필요합니다.');

  const { data, error } = await supabase.rpc('update_my_participant_profile_nickname', {
    nickname_value: nickname,
    session_token: session.token,
  });

  if (error) throw error;
  return Boolean(data);
}
