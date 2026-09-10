import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from './components/BottomTabs';
import { DataErrorState, DataLoadingState } from './components/DataState';
import HomeFieldSketchSection from './components/HomeFieldSketchSection';
import HomeReasonSection from './components/HomeReasonSection';
import HomeRecruitmentSection from './components/HomeRecruitmentSection';
import HomeReviewsSection from './components/HomeReviewsSection';
import HomeUpcomingEventsSection from './components/HomeUpcomingEventsSection';
import useOperationalData from './hooks/useOperationalData';
import { loginAdminSession } from './services/adminAuth';

// 홈(메인 대시보드) - 캘린더로 날짜를 골라 신청하던 기존 화면은
// src/pages/CalendarPage.tsx로 그대로 옮기고, "/"는 이제 다가오는 행사 /
// 사랑받는 이유 / 모집방식 / 현장 스케치 / 참가자 후기 순서의 대시보드다.
// 로고 5회 탭으로 여는 숨김 관리자 로그인은 기존 그대로 유지한다.
export default function App() {
  const navigate = useNavigate();
  const [logoTapCount, setLogoTapCount] = useState(0);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const { error, events, loading, reload } = useOperationalData();

  const handleLogoSecretTap = () => {
    setLogoTapCount((count) => {
      const nextCount = count + 1;
      if (nextCount >= 5) {
        setShowAdminPrompt(true);
        return 0;
      }
      return nextCount;
    });
  };

  const resetAdminLogin = () => {
    setShowAdminPrompt(false);
    setAdminPassword('');
    setAdminSubmitting(false);
  };

  const handleAdminSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setAdminSubmitting(true);
    try {
      await loginAdminSession(adminPassword);
      resetAdminLogin();
      navigate('/admin');
      return;
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '관리자 코드가 올바르지 않습니다.');
    } finally {
      setAdminSubmitting(false);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mobile-container mx-auto flex min-h-screen flex-col px-5 with-bottom-tabs pt-2.5">
        <header className="mb-3 flex items-center">
          <div className="relative w-[132px]">
            <img alt="time2meet" className="h-auto w-full object-contain" src="/assets/time2meet-logo-transparent.png" />
            <button
              aria-label="관리자 로그인 열기"
              className="absolute left-[43%] top-0 h-full w-[16%]"
              onClick={handleLogoSecretTap}
              type="button"
            />
          </div>
        </header>
        <div className="flex flex-col gap-5">
          <HomeUpcomingEventsSection events={events} />
          <HomeReasonSection />
          <HomeRecruitmentSection />
          <HomeFieldSketchSection />
          <HomeReviewsSection />
        </div>
      </div>
      {showAdminPrompt ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 px-6">
          <form
            className="w-full max-w-[330px] rounded-[26px] bg-white p-6 shadow-calendar"
            onSubmit={handleAdminSubmit}
          >
            <label className="block">
              <span className="text-[17px] font-black">관리자 코드</span>
              <input
                autoFocus
                className="mt-4 h-12 w-full rounded-[16px] bg-meet-blueSoft px-4 text-[18px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
                onChange={(event) => setAdminPassword(event.target.value)}
                type="password"
                value={adminPassword}
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="h-12 rounded-[16px] bg-[#e8e8e8] text-[15px] font-black text-black"
                onClick={resetAdminLogin}
                type="button"
              >
                취소
              </button>
              <button className="h-12 rounded-[16px] bg-meet-blue text-[15px] font-black text-white disabled:opacity-50" disabled={adminSubmitting} type="submit">
                {adminSubmitting ? '확인 중' : '확인'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <BottomTabs />
    </main>
  );
}
