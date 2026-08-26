import { FunctionsHttpError } from '@supabase/supabase-js';
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

  if (error || !data?.session_token) {
    // 백엔드는 이미 잠금(429)과 코드 오류(401)를 서로 다른 상태 코드로
    // 내려주지만, supabase-js는 실패 응답의 body를 버리고 이 SDK 자체의
    // 에러(FunctionsHttpError)만 넘기므로 여기서 status로 직접 구분한다.
    if (error instanceof FunctionsHttpError && error.context.status === 429) {
      throw new Error('로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.');
    }
    throw new Error('관리자 코드가 올바르지 않습니다.');
  }
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
