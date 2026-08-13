import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import { createGuestAccount, formatKoreanPhone, loginGuestAccount, normalizeKoreanPhone, validateGuestPin } from '../services/guestPinAuth';

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
      <path d="M18 12L7 23L18 34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
      <path d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
    </svg>
  );
}

export default function GuestPhoneAuthPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'login' ? 'login' : 'signup';
  const fromLoginTab = searchParams.get('entry') === 'tab';
  const returnTo = getSafeReturnTo(searchParams.get('returnTo'));
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const normalizedPhone = useMemo(() => normalizeKoreanPhone(phone), [phone]);

  const changeMode = (nextMode: 'signup' | 'login') => {
    setSearchParams({
      ...(nextMode === 'login' ? { mode: 'login' } : {}),
      ...(returnTo ? { returnTo } : {}),
      entry: 'tab',
    });
    setPin('');
    setPinConfirm('');
    setError('');
  };

  const submit = async () => {
    setError('');

    if (!normalizedPhone) {
      setError('한국 휴대폰 번호 형식으로 입력해주세요.');
      return;
    }

    const pinError = validateGuestPin(pin, normalizedPhone);
    if (pinError) {
      setError(pinError);
      return;
    }

    if (mode === 'signup' && pin !== pinConfirm) {
      setError('PIN 번호가 일치하지 않습니다.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await createGuestAccount(normalizedPhone, pin);
      } else {
        await loginGuestAccount(normalizedPhone, pin);
      }
      navigate(returnTo ?? '/profile/new', { replace: Boolean(returnTo) });
    } catch (caughtError) {
      const message = caughtError instanceof Error && caughtError.message === '잠시 후 다시 시도해주세요.'
        ? '로그인 시도가 제한되었습니다. 잠시 후 다시 시도해주세요.'
        : caughtError instanceof Error && caughtError.message === '이미 가입된 번호입니다'
          ? '이미 가입된 번호입니다'
        : mode === 'signup'
          ? '비회원 계정을 만들 수 없습니다. 입력값을 확인해주세요.'
          : '휴대폰 번호 또는 PIN 번호를 확인해주세요.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 py-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-6rem)] flex-col justify-center">
        <section className="relative rounded-[30px] border border-[#f0f3f6] bg-white px-7 pb-9 pt-28 shadow-calendar">
          <button
            aria-label="뒤로 가기"
            className="absolute left-5 top-5 grid h-11 w-11 place-items-center text-black transition hover:opacity-70"
            onClick={() => navigate(-1)}
            type="button"
          >
            <BackIcon />
          </button>

          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>

          <div className="mx-auto grid h-[58px] w-[170px] place-items-center">
            <img alt="time2meet" className="h-auto w-full object-contain" src="/assets/time2meet-logo.png" />
          </div>

          {fromLoginTab ? (
            <div className="mt-10 grid grid-cols-2 gap-2 rounded-[18px] bg-meet-blueSoft p-1.5">
              <button
                className={['h-11 rounded-[15px] text-[14px] font-black', mode === 'signup' ? 'bg-white text-black shadow-sm' : 'text-[#777]'].join(' ')}
                onClick={() => changeMode('signup')}
                type="button"
              >
                비회원 임시 계정 만들기
              </button>
              <button
                className={['h-11 rounded-[15px] text-[14px] font-black', mode === 'login' ? 'bg-white text-black shadow-sm' : 'text-[#777]'].join(' ')}
                onClick={() => changeMode('login')}
                type="button"
              >
                비회원 로그인
              </button>
            </div>
          ) : null}

          <div className="mt-7 space-y-5">
            <div>
              <h1 className="text-center text-[24px] font-black">{mode === 'signup' ? '비회원 임시 계정 만들기' : '비회원 로그인'}</h1>
              <p className="mt-4 text-fluid-safe text-center text-[13px] font-extrabold leading-relaxed text-[#777]">
                설정한 PIN 번호는 비회원 로그인과 신청 내역 확인에 사용됩니다. 별도의 본인인증을 진행하지 않으므로 PIN 번호를 분실하면 직접 재설정할 수 없습니다. 반드시 기억해 주세요.
              </p>
              <p className="mt-3 text-fluid-safe text-center text-[12px] font-extrabold leading-relaxed text-[#8a8a8a]">
                PIN 번호를 잊으셨나요? DM으로 문의해 주세요.
              </p>
            </div>

            <label className="block">
              <span className="text-[15px] font-black text-[#777]">휴대폰 번호</span>
              <input
                className="mt-2 h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[17px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
                inputMode="tel"
                onChange={(event) => setPhone(formatKoreanPhone(event.target.value))}
                placeholder="010-0000-0000"
                value={phone}
              />
            </label>

            <label className="block">
              <span className="text-[15px] font-black text-[#777]">6자리 PIN 번호</span>
              <input
                className="mt-2 h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[17px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="숫자 6자리"
                type="password"
                value={pin}
              />
            </label>

            {mode === 'signup' ? (
              <label className="block">
                <span className="text-[15px] font-black text-[#777]">PIN 번호 확인</span>
                <input
                  className="mt-2 h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[17px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="한 번 더 입력"
                  type="password"
                  value={pinConfirm}
                />
              </label>
            ) : null}

            {error ? <p className="text-fluid-safe rounded-[16px] bg-meet-pinkSoft px-4 py-3 text-[13px] font-black text-meet-pink">{error}</p> : null}

            <PrimaryButton disabled={submitting} onClick={submit}>
              {submitting ? '처리 중' : mode === 'signup' ? '비회원 임시 계정 만들고 계속하기' : '비회원 로그인하기'}
            </PrimaryButton>
          </div>
        </section>
      </div>
    </main>
  );
}

function getSafeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
