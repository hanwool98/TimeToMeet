import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import { supabase } from '../lib/supabase';
import { formatKoreanPhone, loginGuestAccount, normalizeKoreanPhone, validateGuestPin } from '../services/guestPinAuth';

const actionLabels = [
  '로그인',
  '카카오로 로그인하기',
  '아이디로 로그인하기',
  '회원가입',
  '아이디 찾기',
  '비밀번호 찾기',
  '비회원으로 계속하기',
];

function showPreparing() {
  window.alert('준비중!');
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestPin, setGuestPin] = useState('');
  const [guestError, setGuestError] = useState('');
  const [activeLoginTab, setActiveLoginTab] = useState<'member' | 'guest'>('member');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!supabase) {
      window.alert('Supabase 연결 설정이 필요합니다.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginId,
        password,
      });
      if (error) throw error;
      navigate(-1);
    } catch {
      window.alert('로그인 정보를 확인해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuestLogin = async () => {
    setGuestError('');
    const normalizedPhone = normalizeKoreanPhone(guestPhone);
    if (!normalizedPhone) {
      setGuestError('한국 휴대폰 번호 형식으로 입력해주세요.');
      return;
    }

    const pinError = validateGuestPin(guestPin, normalizedPhone);
    if (pinError) {
      setGuestError(pinError);
      return;
    }

    setSubmitting(true);
    try {
      await loginGuestAccount(normalizedPhone, guestPin);
      navigate('/profile/new');
    } catch (caughtError) {
      setGuestError(caughtError instanceof Error && caughtError.message === '잠시 후 다시 시도해주세요.'
        ? '로그인 시도가 제한되었습니다. 잠시 후 다시 시도해주세요.'
        : '휴대폰 번호 또는 PIN 번호를 확인해주세요.');
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
            <svg
              aria-hidden="true"
              className="h-9 w-9"
              fill="none"
              viewBox="0 0 48 48"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M18 12L7 23L18 34"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="6"
              />
              <path
                d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="6"
              />
            </svg>
          </button>
          <div
            aria-label="로고 영역"
            className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm"
            role="img"
          >
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>

          <div className="mx-auto grid h-[58px] w-[170px] place-items-center">
            <img alt="time2meet" className="h-auto w-full object-contain" src="/assets/time2meet-logo.png" />
          </div>

          <div className="mt-10 grid grid-cols-2 gap-2 rounded-[18px] bg-meet-blueSoft p-1.5">
            <button
              className={['h-11 rounded-[15px] text-[14px] font-black', activeLoginTab === 'member' ? 'bg-white text-black shadow-sm' : 'text-[#777]'].join(' ')}
              onClick={() => setActiveLoginTab('member')}
              type="button"
            >
              회원 로그인
            </button>
            <button
              className={['h-11 rounded-[15px] text-[14px] font-black', activeLoginTab === 'guest' ? 'bg-white text-black shadow-sm' : 'text-[#777]'].join(' ')}
              onClick={() => setActiveLoginTab('guest')}
              type="button"
            >
              비회원 로그인
            </button>
          </div>

          {activeLoginTab === 'member' ? (
            <form className="mt-8 space-y-7" onSubmit={(event) => event.preventDefault()}>
              <label className="block">
                <span className="text-[16px] font-extrabold text-[#8a8a8a]">아이디</span>
                <input
                  aria-label="아이디"
                  className="mt-1 h-10 w-full border-0 border-b-2 border-[#9d9d9d] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue"
                  onChange={(event) => setLoginId(event.target.value)}
                  type="text"
                  value={loginId}
                />
              </label>

              <label className="block">
                <span className="text-[16px] font-extrabold text-[#8a8a8a]">비밀번호</span>
                <input
                  aria-label="비밀번호"
                  className="mt-1 h-10 w-full border-0 border-b-2 border-[#9d9d9d] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>
            </form>
          ) : null}

          {activeLoginTab === 'guest' ? (
            <form className="mt-8 space-y-7" onSubmit={(event) => event.preventDefault()}>
              <label className="block">
                <span className="text-[16px] font-extrabold text-[#8a8a8a]">전화번호</span>
                <input
                  aria-label="전화번호"
                  className="mt-1 h-10 w-full border-0 border-b-2 border-[#9d9d9d] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue"
                  inputMode="tel"
                  onChange={(event) => setGuestPhone(formatKoreanPhone(event.target.value))}
                  placeholder="010-0000-0000"
                  value={guestPhone}
                />
              </label>

              <label className="block">
                <span className="text-[16px] font-extrabold text-[#8a8a8a]">PIN 번호</span>
                <input
                  aria-label="PIN 번호"
                  className="mt-1 h-10 w-full border-0 border-b-2 border-[#9d9d9d] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setGuestPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  type="password"
                  value={guestPin}
                />
              </label>
              {guestError ? <p className="text-fluid-safe text-[12px] font-black text-meet-pink">{guestError}</p> : null}
            </form>
          ) : null}

          <div className="mt-8 space-y-3">
            {activeLoginTab === 'guest' ? (
              <button
                className="h-14 w-full rounded-[18px] bg-meet-blue px-5 text-[16px] font-extrabold text-white shadow-sm transition active:scale-[0.99]"
                onClick={handleGuestLogin}
                type="button"
              >
                {submitting ? '로그인 중' : '비회원 로그인'}
              </button>
            ) : null}
            {activeLoginTab === 'member' ? (
              actionLabels.slice(0, 3).map((label, index) => (
                <button
                  className={[
                    'h-14 w-full rounded-[18px] px-5 text-[16px] font-extrabold shadow-sm transition active:scale-[0.99]',
                    index === 0 ? 'bg-meet-blue text-white hover:bg-[#5aa7e9]' : '',
                    index === 1 ? 'bg-[#FEE500] text-black hover:bg-[#f2dc00]' : '',
                    index === 2 ? 'bg-[#d9d9d9] text-black hover:bg-[#d0d0d0]' : '',
                  ].join(' ')}
                  key={label}
                  onClick={index === 0 ? handleLogin : showPreparing}
                  type="button"
                >
                  {index === 0 && submitting ? '로그인 중' : label}
                </button>
              ))
            ) : null}
          </div>

          {activeLoginTab === 'member' ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[15px] font-extrabold text-[#777]">
              {actionLabels.slice(3, 6).map((label, index) => (
                <span className="flex items-center gap-x-2" key={label}>
                  <button className="transition hover:text-black" onClick={showPreparing} type="button">
                    {label}
                  </button>
                  {index < 2 ? <span aria-hidden="true">/</span> : null}
                </span>
              ))}
            </div>
          ) : null}

          <button
            className="mx-auto mt-8 block border-b-2 border-black pb-1 text-[17px] font-black leading-none"
            onClick={() => navigate('/guest-phone')}
            type="button"
          >
            비회원으로 계속하기
          </button>
          <p className="mx-auto mt-7 max-w-[310px] text-fluid-safe text-center text-[17px] font-black leading-snug">
            타임투밋 회원이 되시면 프로필 저장/쿠폰 등 다양한 혜택을 받으실 수 있습니다!
          </p>
        </section>
      </div>
    </main>
  );
}
