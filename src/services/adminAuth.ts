import { supabase } from '../lib/supabase';

const adminSessionKey = 'time2meet.adminSession';

interface AdminSession {
  expiresAt: string;
  role: 'admin';
  token: string;
}

interface AdminSessionResponse {
  expires_at: string;
  role: 'admin';
  session_token: string;
}

function readAdminSession(): AdminSession | null {
  const raw = window.sessionStorage.getItem(adminSessionKey);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as AdminSession;
    if (!session.token || session.role !== 'admin' || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearAdminSession();
      return null;
    }
    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

function writeAdminSession(response: AdminSessionResponse) {
  const session: AdminSession = {
    expiresAt: response.expires_at,
    role: response.role,
    token: response.session_token,
  };

  window.sessionStorage.setItem(adminSessionKey, JSON.stringify(session));
  return session;
}

export function getAdminSession() {
  return readAdminSession();
}

export function clearAdminSession() {
  window.sessionStorage.removeItem(adminSessionKey);
}

export async function loginAdminSession(code: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { data, error } = await supabase.functions.invoke('admin-login', {
    body: { code },
  });

  if (error || !data?.session_token) throw error ?? new Error('관리자 코드가 올바르지 않습니다.');
  return writeAdminSession(data as AdminSessionResponse);
}

export async function verifyAdminSession() {
  if (!supabase) return false;
  const session = getAdminSession();
  if (!session) return false;

  const { data, error } = await supabase.rpc('is_admin_session', {
    session_token: session.token,
  });

  if (error || data !== true) {
    clearAdminSession();
    return false;
  }

  return true;
}
