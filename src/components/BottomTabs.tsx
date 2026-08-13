import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { avatarSheet, getAvatarPosition } from './ParticipantList';
import { fetchMyTabProfileAvatar, getAppSession } from '../services/appAuth';

const tabs = [
  { icon: 'calendar', label: '캘린더', path: '/' },
  { icon: 'event', label: '행사 소개', path: '/event-info' },
  { icon: 'mail', label: '내 행사 및 프로필', path: '/my-events' },
  { icon: 'person', label: '마이페이지', path: '/mypage' },
];

function TabIcon({
  avatarIndex,
  hasProfile,
  isLoggedIn,
  name,
}: {
  avatarIndex?: number;
  hasProfile?: boolean;
  isLoggedIn?: boolean;
  name: string;
}) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2.4,
  };

  if (name === 'calendar') {
    return (
      <svg aria-hidden="true" className="h-9 w-9 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" viewBox="0 0 24 24">
        <rect height="16" rx="3" width="16" x="4" y="5" {...common} />
        <path d="M8 3v4M16 3v4M4 10h16" {...common} />
      </svg>
    );
  }

  if (name === 'event') {
    return (
      <svg aria-hidden="true" className="h-9 w-9 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" viewBox="0 0 24 24">
        <path d="M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8-4.2-4.1 5.8-.8L12 3z" {...common} />
      </svg>
    );
  }

  if (name === 'mail') {
    return (
      <svg aria-hidden="true" className="h-9 w-9 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" viewBox="0 0 24 24">
        <rect height="14" rx="3" width="18" x="3" y="5" {...common} />
        <path d="M4 7l8 6 8-6" {...common} />
      </svg>
    );
  }

  if (name === 'person' && isLoggedIn) {
    if (hasProfile) {
      return (
        <span
          aria-hidden="true"
          className="h-10 w-10 rounded-full bg-cover bg-center bg-no-repeat shadow-[0_2px_7px_rgba(0,0,0,0.25)] ring-2 ring-white/85 blur-[1px] saturate-[0.9]"
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
    <svg aria-hidden="true" className="h-9 w-9 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" {...common} />
      <path d="M4.5 20c1.4-4 4.1-6 7.5-6s6.1 2 7.5 6" {...common} />
    </svg>
  );
}

function DefaultProfileIcon() {
  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 place-items-center rounded-full bg-[#d9d9d9] text-white shadow-[0_2px_7px_rgba(0,0,0,0.18)] ring-2 ring-white/80"
    >
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
        <path d="M5.8 19c1.1-3.2 3.3-4.8 6.2-4.8s5.1 1.6 6.2 4.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      </svg>
    </span>
  );
}

export default function BottomTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const [profileAvatar, setProfileAvatar] = useState<{ avatarIndex: number; hasProfile: boolean } | null>(null);
  const isLoggedIn = Boolean(getAppSession());

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
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-black bg-meet-tab pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-4">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;

          return (
          <button
            aria-label={`${tab.label} 메뉴`}
            className={[
              'flex h-[72px] min-w-0 items-center justify-center border-r border-white/80 text-white/95 last:border-r-0',
              active ? 'bg-white/45' : '',
            ].join(' ')}
            key={tab.path}
            onClick={() => navigate(tab.path)}
            type="button"
          >
            <TabIcon
              avatarIndex={profileAvatar?.avatarIndex}
              hasProfile={profileAvatar?.hasProfile}
              isLoggedIn={isLoggedIn}
              name={tab.icon}
            />
          </button>
          );
        })}
      </div>
    </nav>
  );
}
