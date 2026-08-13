import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import PrimaryButton from '../components/PrimaryButton';
import { getAppSession } from '../services/appAuth';

export default function MyEventsPage() {
  const navigate = useNavigate();
  const isLoggedIn = Boolean(getAppSession());

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-10rem)] flex-col items-center justify-center gap-5">
        {isLoggedIn ? (
          <p className="text-center text-[17px] font-extrabold text-[#999]">참가 예정인 행사가 없습니다</p>
        ) : (
          <>
            <p className="text-center text-[17px] font-extrabold text-[#999]">로그인 후에 이용가능합니다.</p>
            <PrimaryButton className="max-w-[260px]" onClick={() => navigate('/login?returnTo=/my-events')}>
              로그인
            </PrimaryButton>
          </>
        )}
      </div>
      <BottomTabs />
    </main>
  );
}
