import { supabase } from '../lib/supabase';

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
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');
  const phone = toSupabasePhone(phoneNormalized);

  const { data, error } = await supabase.auth.signUp({
    phone,
    password: pin,
    options: {
      data: {
        account_type: 'guest',
      },
    },
  });

  if (error || !data.user) throw error ?? new Error('비회원 계정을 만들 수 없습니다.');

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ phone, password: pin });
    if (signInError) throw signInError;
  }

  const { data: currentUser } = await supabase.auth.getUser();
  await upsertGuestRows(currentUser.user?.id ?? data.user.id, phoneNormalized);
}

export async function loginGuestAccount(phoneNormalized: string, pin: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { data: allowed, error: allowedError } = await supabase.rpc('can_attempt_guest_login', {
    phone_value: phoneNormalized,
  });

  if (allowedError) throw allowedError;
  if (allowed === false) throw new Error('잠시 후 다시 시도해주세요.');

  const { data, error } = await supabase.auth.signInWithPassword({
    phone: toSupabasePhone(phoneNormalized),
    password: pin,
  });

  if (error || !data.user) {
    await supabase.rpc('record_guest_login_failure', { phone_value: phoneNormalized });
    throw error ?? new Error('비회원 로그인에 실패했습니다.');
  }

  await supabase.rpc('clear_guest_login_failures', { phone_value: phoneNormalized });
  await upsertGuestRows(data.user.id, phoneNormalized);
}

async function upsertGuestRows(userId: string, phoneNormalized: string) {
  if (!supabase) throw new Error('Supabase 연결 설정이 필요합니다.');

  const { error: accountError } = await supabase.from('user_accounts').upsert({
    account_type: 'guest',
    user_id: userId,
  });
  if (accountError) throw accountError;

  const { error: guestError } = await supabase.from('guest_accounts').upsert({
    phone_normalized: phoneNormalized,
    user_id: userId,
  });
  if (guestError) throw guestError;
}

function toSupabasePhone(phoneNormalized: string) {
  return `+82${phoneNormalized.slice(1)}`;
}

function isSequentialPin(pin: string) {
  const ascending = '0123456789';
  const descending = '9876543210';
  return ascending.includes(pin) || descending.includes(pin);
}
