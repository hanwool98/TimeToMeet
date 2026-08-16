import { supabase } from '../lib/supabase';
import { fetchMyPageSummary } from './participantProfiles';

const appSessionKey = 'time2meet.appSession';

export type AppRole = 'member' | 'guest' | 'admin';

interface AppSession {
  expiresAt: string;
  phoneNormalized?: string;
  role: AppRole;
  token: string;
  userId?: string;
}

interface SessionResponse {
  expires_at: string;
  phone_normalized?: string;
  role: AppRole;
  session_token: string;
  user_id?: string;
}

function readSession(key: string): AppSession | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AppSession;
    if (!session.token || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession(key);
      return null;
    }
    return session;
  } catch {
    clearSession(key);
    return null;
  }
}

function writeSession(key: string, response: SessionResponse, fallbackPhoneNormalized?: string) {
  const session: AppSession = {
    expiresAt: response.expires_at,
    phoneNormalized: response.phone_normalized || fallbackPhoneNormalized,
    role: response.role,
    token: response.session_token,
    userId: response.user_id,
  };
  window.localStorage.setItem(key, JSON.stringify(session));
  window.dispatchEvent(new Event('time2meet:app-session-changed'));
  return session;
}

function firstSessionResponse(data: unknown) {
  if (Array.isArray(data)) return data[0] as SessionResponse | undefined;
  return data as SessionResponse | undefined;
}

function clearSession(key: string) {
  window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
  window.dispatchEvent(new Event('time2meet:app-session-changed'));
}

export function getAppSession() {
  return readSession(appSessionKey);
}

export function clearAppSession() {
  clearSession(appSessionKey);
}

export async function verifyAppSession() {
  if (!supabase) return false;
  const session = getAppSession();
  if (!session) return false;

  const { data, error } = await supabase.rpc('is_app_session_valid', {
    session_token: session.token,
  });

  if (error || data !== true) {
    clearAppSession();
    return false;
  }

  return true;
}

export async function fetchMyTabProfileAvatar() {
  try {
    const summary = await fetchMyPageSummary();
    if (!summary?.hasProfile) return { hasProfile: false, avatarIndex: 0 };
    return {
      avatarIndex: summary.avatarIndex,
      hasProfile: true,
      photoUrl: summary.profilePhotoUrl,
    };
  } catch {
    return null;
  }
}

export async function createGuestSession(phoneNormalized: string, pin: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { data, error } = await supabase.rpc('create_guest_session', {
    phone_value: phoneNormalized,
    pin_value: pin,
  });

  const response = firstSessionResponse(data);
  if (error) {
    if (error.message === 'Guest account already exists.') {
      throw new Error('이미 가입된 번호입니다');
    }
    throw error;
  }
  if (!response?.session_token) throw new Error('비회원 계정을 만들 수 없습니다.');
  return writeSession(appSessionKey, response, phoneNormalized);
}

export async function loginGuestSession(phoneNormalized: string, pin: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { data, error } = await supabase.rpc('login_guest_session', {
    phone_value: phoneNormalized,
    pin_value: pin,
  });

  const response = firstSessionResponse(data);
  if (error || !response?.session_token) throw error ?? new Error('비회원 로그인에 실패했습니다.');
  return writeSession(appSessionKey, response, phoneNormalized);
}

export async function loginMemberSession(loginId: string, password: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { data, error } = await supabase.rpc('login_member_session', {
    login_id_value: loginId,
    password_value: password,
  });

  const response = firstSessionResponse(data);
  if (error || !response?.session_token) throw error ?? new Error('회원 로그인에 실패했습니다.');
  return writeSession(appSessionKey, response);
}
