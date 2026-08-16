import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { clearAppSession, getAppSession } from '../services/appAuth';
import { fetchMyPageSummary, fetchMySessionPhone, type MyPageSummary } from '../services/participantProfiles';

const menuItems = [
  { icon: 'profile', label: '참가 프로필', path: '/mypage/profile' },
  { icon: 'mail', label: '문의하기' },
  { icon: 'policy', label: '약관 및 정책' },
  { icon: 'logout', label: '로그아웃' },
];

export default function MyPage() {
  const navigate = useNavigate();
  const [sessionVersion, setSessionVersion] = useState(0);
  const [summary, setSummary] = useState<MyPageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const session = getAppSession();
  const loggedIn = Boolean(session);
  const visibleMenuItems = loggedIn ? menuItems : menuItems.filter((item) => item.label !== '로그아웃');
  const accountType = summary?.accountType ?? (session?.role === 'guest' || session?.role === 'member' ? session.role : null);
  const accountLabel =
    accountType === 'guest'
      ? formatGuestLabel(summary?.guestDisplayId || session?.phoneNormalized)
      : '회원';
  const phoneLabel =
    summary?.phoneMasked ||
    (accountType === 'guest' ? maskPhone(session?.phoneNormalized) : '') ||
    (accountType === 'guest' ? '전화번호 확인 중' : '전화번호 없음');

  useEffect(() => {
    const refreshSession = () => setSessionVersion((version) => version + 1);
    window.addEventListener('time2meet:app-session-changed', refreshSession);
    window.addEventListener('storage', refreshSession);
    return () => {
      window.removeEventListener('time2meet:app-session-changed', refreshSession);
      window.removeEventListener('storage', refreshSession);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    if (!loggedIn) {
      setSummary(null);
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    setLoading(true);
    void fetchMyPageSummary()
      .then((nextSummary) => {
        if (mounted) setSummary(nextSummary);
      })
      .catch(async () => {
        if (session?.role !== 'guest') {
          if (mounted) setSummary(null);
          return;
        }

        const fallback = await fetchMySessionPhone(session.token);
        if (mounted) {
          setSummary(
            fallback
              ? {
                  accountType: fallback.accountType,
                  avatarIndex: 0,
                  guestDisplayId: fallback.guestDisplayId,
                  hasProfile: false,
                  nickname: '비회원',
                  phoneMasked: fallback.phoneMasked,
                }
              : null,
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loggedIn, sessionVersion]);

  const logout = () => {
    clearAppSession();
    navigate('/', { replace: true });
  };

  const handleMenu = (item: (typeof menuItems)[number]) => {
    if (item.label === '로그아웃') {
      logout();
      return;
    }
    if (item.path) {
      navigate(item.path);
      return;
    }
    window.alert('준비중!');
  };

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 pt-10 text-black with-bottom-tabs min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <header className="mb-8">
          <div className="mb-8 h-[46px] w-[150px]">
            <img alt="time2meet" className="h-full w-full object-contain object-left" src="/assets/time2meet-logo.png" />
          </div>
          <h1 className="text-[34px] font-black leading-none">마이페이지</h1>
        </header>

        <section className="rounded-[24px] border border-[#eaf3fb] bg-white p-4 shadow-calendar min-[380px]:p-5">
          {loggedIn ? (
            <div className="grid min-w-0 grid-cols-[78px_minmax(0,1fr)] items-center gap-4">
              <ProfileAvatar hasProfile={Boolean(summary?.hasProfile)} photoUrl={summary?.profilePhotoUrl} />
              <div className="min-w-0">
                <h2 className="overflow-hidden text-ellipsis whitespace-nowrap text-[22px] font-black leading-tight">
                  {loading ? '불러오는 중' : summary?.nickname || '프로필 없음'}
                </h2>
                <p className="mt-1 text-[14px] font-extrabold text-[#777]">{loading && !accountType ? '확인 중' : accountLabel}</p>
                <p className="mt-1.5 text-[16px] font-bold text-[#6f7680]">{loading && !summary?.phoneMasked && !session?.phoneNormalized ? '' : phoneLabel}</p>
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-4">
              <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#d9d9d9] text-white ring-4 ring-white">
                <DefaultPersonIcon />
              </span>
              <div className="min-w-0">
                <h2 className="text-[22px] font-black">로그인이 필요합니다</h2>
                <button
                  className="mt-3 h-11 rounded-[15px] border border-meet-blue px-5 text-[15px] font-black text-meet-blue"
                  onClick={() => navigate('/login?returnTo=/mypage')}
                  type="button"
                >
                  로그인
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-7 overflow-hidden rounded-[24px] border border-[#f0f3f6] bg-white px-4 shadow-calendar min-[380px]:px-5">
          {visibleMenuItems.map((item) => (
            <button
              className="grid h-[62px] w-full grid-cols-[34px_minmax(0,1fr)_18px] items-center gap-3 border-b border-[#edf0f3] text-left last:border-b-0"
              key={item.label}
              onClick={() => handleMenu(item)}
              type="button"
            >
              <span className={item.label === '로그아웃' ? 'text-[#aeb4bb]' : 'text-meet-blue'}>
                <MenuIcon name={item.icon} />
              </span>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[16px] font-extrabold">
                {item.label}
              </span>
              <span className="text-[24px] font-light leading-none text-[#8d939a]">›</span>
            </button>
          ))}
        </section>

        {loggedIn ? (
          <button
            className="mx-auto mt-9 block text-[16px] font-bold text-[#9a9a9a]"
            onClick={() => window.alert('준비중!')}
            type="button"
          >
            회원 탈퇴
          </button>
        ) : null}
      </div>
      <BottomTabs />
    </main>
  );
}

function ProfileAvatar({ hasProfile, photoUrl }: { hasProfile: boolean; photoUrl?: string }) {
  if (!hasProfile || !photoUrl) {
    return (
      <span className="grid h-[78px] w-[78px] place-items-center rounded-full bg-[#d9d9d9] text-white ring-4 ring-white shadow-sm">
        <DefaultPersonIcon />
      </span>
    );
  }

  return (
    <img
      alt="내 대표사진"
      className="h-[78px] w-[78px] rounded-full object-cover ring-4 ring-white shadow-sm"
      src={photoUrl}
    />
  );
}

function MenuIcon({ name }: { name: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
  };

  if (name === 'mail') {
    return (
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
        <rect height="14" rx="2.5" width="18" x="3" y="5" {...common} />
        <path d="m4 7 8 6 8-6" {...common} />
      </svg>
    );
  }

  if (name === 'policy') {
    return (
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
        <path d="M12 3 20 6v5.6c0 4.2-2.8 7.5-8 9.4-5.2-1.9-8-5.2-8-9.4V6l8-3z" {...common} />
        <path d="m8.7 12 2.2 2.2 4.7-5" {...common} />
      </svg>
    );
  }

  if (name === 'logout') {
    return (
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
        <path d="M9 5H6.8A2.8 2.8 0 0 0 4 7.8v8.4A2.8 2.8 0 0 0 6.8 19H9" {...common} />
        <path d="M13 8l4 4-4 4M17 12H8" {...common} />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" {...common} />
      <path d="M4.5 20c1.4-4 4.1-6 7.5-6s6.1 2 7.5 6" {...common} />
    </svg>
  );
}

function DefaultPersonIcon() {
  return (
    <svg aria-hidden="true" className="h-10 w-10" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      <path d="M4.5 20c1.4-4 4.1-6 7.5-6s6.1 2 7.5 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

function formatGuestLabel(value?: string) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length >= 8) return `비회원 ${digits.slice(-8, -4)}-${digits.slice(-4)}`;
  return '비회원';
}

function maskPhone(value?: string) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length < 8) return '';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}
