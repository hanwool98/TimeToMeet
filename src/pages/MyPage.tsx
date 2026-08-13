import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import PrimaryButton from '../components/PrimaryButton';
import { clearAppSession } from '../services/appAuth';

export default function MyPage() {
  const navigate = useNavigate();

  const logout = () => {
    clearAppSession();
    navigate('/', { replace: true });
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-10rem)] items-center justify-center">
        <PrimaryButton className="max-w-[260px]" onClick={logout}>
          로그아웃
        </PrimaryButton>
      </div>
      <BottomTabs />
    </main>
  );
}
