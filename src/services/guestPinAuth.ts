import { createGuestSession, loginGuestSession } from './appAuth';

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
}

export async function loginGuestAccount(phoneNormalized: string, pin: string) {
  await loginGuestSession(phoneNormalized, pin);
}

function isSequentialPin(pin: string) {
  const ascending = '0123456789';
  const descending = '9876543210';
  return ascending.includes(pin) || descending.includes(pin);
}
