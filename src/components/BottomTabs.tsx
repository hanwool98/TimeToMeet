import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { avatarSheet, getAvatarPosition } from './ParticipantList';
import { fetchMyTabProfileAvatar, getAppSession } from '../services/appAuth';
import { usePaymentInvitations } from './PaymentInvitationProvider';

const tabs = [
  { icon: 'calendar', label: '캘린더', path: '/' },
  { icon: 'event', label: '행사 소개', path: '/event-info' },
  { icon: 'mail', label: '내 행사', path: '/my-events' },
  { icon: 'person', label: '마이페이지', path: '/mypage' },
];

function TabIcon({
  avatarIndex,
  active,
  hasProfile,
  isLoggedIn,
  name,
  photoUrl,
}: {
  avatarIndex?: number;
  active: boolean;
  hasProfile?: boolean;
  isLoggedIn?: boolean;
  name: string;
  photoUrl?: string;
}) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2.1,
  };
  const iconClassName = "h-8 w-8";

  if (name === 'calendar') {
    return (
      <svg aria-hidden="true" className={iconClassName} viewBox="0 0 24 24">
        <rect height="16" rx="3" width="16" x="4" y="5" {...common} />
        <path d="M8 3v4M16 3v4M4 10h16" {...common} />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" {...common} />
      </svg>
    );
  }

  if (name === 'event') {
    return (
      <svg aria-hidden="true" className={iconClassName} viewBox="0 0 24 24">
        <path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8-4.2-4.1 5.8-.8L12 3z" {...common} />
      </svg>
    );
  }

  if (name === 'mail') {
    return (
      <svg aria-hidden="true" className={iconClassName} viewBox="0 0 24 24">
        <path
          d="M5 6.5h14A1.5 1.5 0 0 1 20.5 8v2.1a2 2 0 0 0 0 3.8V16a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16v-2.1a2 2 0 0 0 0-3.8V8A1.5 1.5 0 0 1 5 6.5z"
          {...common}
        />
        <path d="M9 9.2v.01M9 12v.01M9 14.8v.01" {...common} />
      </svg>
    );
  }

  if (name === 'person' && isLoggedIn) {
    if (hasProfile && photoUrl) {
      return (
        <img
          alt=""
          className={[
            'h-8 w-8 rounded-full bg-cover bg-center bg-no-repeat ring-2',
            active ? 'ring-meet-blue/55' : 'ring-[#777]/30 saturate-[0.9]',
          ].join(' ')}
          src={photoUrl}
        />
      );
    }

    if (hasProfile) {
      return (
        <span
          aria-hidden="true"
          className={[
            'h-8 w-8 rounded-full bg-cover bg-center bg-no-repeat ring-2',
            active ? 'ring-meet-blue/55' : 'ring-[#777]/30 blur-[1px] saturate-[0.9]',
          ].join(' ')}
          style={{
            backgroundImage: `url(${avatarSheet})`,
            backgroundPosition: getAvatarPosition(avatarIndex ?? 0),
            backgroundSize: '440% 330%',
          }}
        />
      );
    }

    return <DefaultProfileIcon />;
  }

  return (
    <svg aria-hidden="true" className={iconClassName} viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" {...common} />
      <path d="M4.5 20c1.4-4 4.1-6 7.5-6s6.1 2 7.5 6" {...common} />
    </svg>
  );
}

function DefaultProfileIcon() {
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 place-items-center rounded-full bg-[#d9d9d9] text-white ring-2 ring-[#777]/20"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
        <path d="M5.8 19c1.1-3.2 3.3-4.8 6.2-4.8s5.1 1.6 6.2 4.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      </svg>
    </span>
  );
}

export default function BottomTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const [profileAvatar, setProfileAvatar] = useState<{ avatarIndex: number; hasProfile: boolean; photoUrl?: string } | null>(null);
  const isLoggedIn = Boolean(getAppSession());
  const { unreadCount } = usePaymentInvitations();

  useEffect(() => {
    let mounted = true;

    if (!isLoggedIn) {
      setProfileAvatar(null);
      return () => {
        mounted = false;
      };
    }

    void fetchMyTabProfileAvatar().then((avatar) => {
      if (!mounted) return;
      setProfileAvatar(avatar);
    });

    return () => {
      mounted = false;
    };
  }, [isLoggedIn, location.pathname]);

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-[#e8e8e8] bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_18px_rgba(0,0,0,0.06)] backdrop-blur"
    >
      <div className="grid h-[88px] grid-cols-4 px-3 pt-3">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;

          return (
          <button
            aria-label={`${tab.label} 메뉴`}
            className={[
              'flex min-w-0 flex-col items-center justify-start gap-1.5 rounded-[20px] px-1 py-1 transition active:scale-[0.98]',
              active ? 'text-meet-blue' : 'text-[#9a9a9a]',
            ].join(' ')}
            key={tab.path}
            onClick={() => navigate(tab.path)}
            type="button"
          >
            <span
              className={[
                'relative grid h-11 w-11 place-items-center rounded-[15px] transition',
                active ? 'bg-meet-blueSoft' : 'bg-transparent',
              ].join(' ')}
            >
              <TabIcon
                active={active}
                avatarIndex={profileAvatar?.avatarIndex}
                hasProfile={profileAvatar?.hasProfile}
                isLoggedIn={isLoggedIn}
                name={tab.icon}
                photoUrl={profileAvatar?.photoUrl}
              />
              {tab.path === '/my-events' && unreadCount > 0 ? (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-meet-pink" />
              ) : null}
            </span>
            <span className={['whitespace-nowrap text-[12px] leading-none', active ? 'font-black' : 'font-bold'].join(' ')}>
              {tab.label}
            </span>
          </button>
          );
        })}
      </div>
    </nav>
  );
}
