import { supabase } from '../lib/supabase';

const appSessionKey = 'time2meet.appSession';

export type AppRole = 'member' | 'guest' | 'admin';

interface AppSession {
  expiresAt: string;
  role: AppRole;
  token: string;
  userId?: string;
}

interface SessionResponse {
  expires_at: string;
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

function writeSession(key: string, response: SessionResponse) {
  const session: AppSession = {
    expiresAt: response.expires_at,
    role: response.role,
    token: response.session_token,
    userId: response.user_id,
  };
  window.localStorage.setItem(key, JSON.stringify(session));
  return session;
}

function firstSessionResponse(data: unknown) {
  if (Array.isArray(data)) return data[0] as SessionResponse | undefined;
  return data as SessionResponse | undefined;
}

function clearSession(key: string) {
  window.localStorage.removeItem(key);
  window.sessionStorage.removeItem(key);
}

export function getAppSession() {
  return readSession(appSessionKey);
}

export function clearAppSession() {
  clearSession(appSessionKey);
}

export async function fetchMyTabProfileAvatar() {
  if (!supabase) return null;
  const session = getAppSession();
  if (!session?.token) return null;

  const { data, error } = await supabase.rpc('get_my_tab_profile_avatar', {
    session_token: session.token,
  });

  if (error) return null;
  const response = Array.isArray(data) ? data[0] : data;
  if (!response?.has_profile) return { hasProfile: false, avatarIndex: 0 };

  return {
    hasProfile: true,
    avatarIndex: Number(response.avatar_index ?? 0),
  };
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
  return writeSession(appSessionKey, response);
}

export async function loginGuestSession(phoneNormalized: string, pin: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { data, error } = await supabase.rpc('login_guest_session', {
    phone_value: phoneNormalized,
    pin_value: pin,
  });

  const response = firstSessionResponse(data);
  if (error || !response?.session_token) throw error ?? new Error('비회원 로그인에 실패했습니다.');
  return writeSession(appSessionKey, response);
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
