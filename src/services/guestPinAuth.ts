import { createGuestSession, getAppSession, loginGuestSession } from './appAuth';
import { logFunnelEvent } from './supabaseApplications';

export function normalizeKoreanPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(digits)) {
    return null;
  }

  return digits;
}

export function formatKoreanPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function validateGuestPin(pin: string, phoneNormalized: string) {
  if (!/^\d{6}$/.test(pin)) return 'PIN은 숫자 6자리로 입력해주세요.';
  if (/^(\d)\1{5}$/.test(pin)) return '추측하기 쉬운 PIN은 사용할 수 없습니다.';
  if (phoneNormalized.endsWith(pin)) return '휴대폰 번호와 비슷한 PIN은 사용할 수 없습니다.';
  if (isSequentialPin(pin)) return '연속된 숫자 PIN은 사용할 수 없습니다.';
  return '';
}

export async function createGuestAccount(phoneNormalized: string, pin: string) {
  await createGuestSession(phoneNormalized, pin);
  // 신청 퍼널 3단계 완료(비회원 로그인 성공) 계측 - 신규 가입/재로그인
  // 두 경로 모두 여기서 공통으로 기록한다.
  void logFunnelEvent('login_success');
}

export async function loginGuestAccount(phoneNormalized: string, pin: string) {
  await loginGuestSession(phoneNormalized, pin);
  void logFunnelEvent('login_success');
}

function isSequentialPin(pin: string) {
  const ascending = '0123456789';
  const descending = '9876543210';
  return ascending.includes(pin) || descending.includes(pin);
}

/**
 * 신규 비회원의 초기 PIN 값(생년월일 6자리, YYMMDD). birthDate는
 * BirthDateSelect가 넘겨주는 'YYYY-MM-DD' 형식이 전제다. 항상 정확히
 * 숫자 6자리가 나오므로(실제 날짜라면) create_guest_session의 PIN 형식
 * 검증(^[0-9]{6}$)은 항상 통과한다 - validateGuestPin의 "추측하기 쉬운
 * PIN" 류 검사는 사용자가 직접 고르는 PIN에만 적용하는 것이라 여기서는
 * 쓰지 않는다(생년월일은 사용자가 바꿀 수 있는 값이 아니므로).
 */
export function birthDateToInitialPin(birthDate: string) {
  return birthDate.replace(/-/g, '').slice(2);
}

/**
 * phone_normalized가 이미 다른 비회원 계정에 쓰이고 있어서(생년월일을
 * PIN으로 자동 로그인 시도조차 하지 않고) 더 진행할 수 없을 때 던진다.
 * 그 계정의 실제 PIN이 생년월일이 아닐 수 있고, 짐작 로그인을 시도하면
 * 실제 계정 주인 모르게 로그인 시도 제한 횟수만 소모시키게 되므로, 항상
 * 기존 비회원 로그인 화면으로 안내한다.
 */
export class ExistingGuestAccountError extends Error {}

/**
 * 신규 참가자가 프로필 작성 화면에서 별도의 "비회원 계정 만들기" 화면을
 * 거치지 않고도 신청을 이어갈 수 있도록, 전화번호+생년월일로 비회원
 * 계정/세션을 자동 준비한다.
 *
 * 이미 로그인되어 있으면(회원이든 기존 비회원 세션이든) 아무것도 하지
 * 않는다 - 기존 세션을 그대로 쓴다. 이 전화번호로 이미 비회원 계정이
 * 존재하면 ExistingGuestAccountError를 던진다(계정을 덮어쓰거나 생년월일
 * 추측 로그인을 시도하지 않음 - 호출부가 로그인 화면으로 안내해야 한다).
 */
export async function ensureGuestSessionFromProfileForm(phoneNormalized: string, birthDate: string) {
  if (getAppSession()?.token) return;

  try {
    await createGuestAccount(phoneNormalized, birthDateToInitialPin(birthDate));
  } catch (error) {
    if (error instanceof Error && error.message === '이미 가입된 번호입니다') {
      throw new ExistingGuestAccountError('이미 가입된 번호입니다');
    }
    throw error;
  }
}
