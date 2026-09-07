import { useEffect, useRef } from 'react';

const requiredTapCount = 5;
const tapWindowMs = 3_000;

type MaintenancePageProps = {
  onBypass: () => void;
};

export default function MaintenancePage({ onBypass }: MaintenancePageProps) {
  const tapCountRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const handleLogoTap = () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);

    tapCountRef.current += 1;
    if (tapCountRef.current >= requiredTapCount) {
      tapCountRef.current = 0;
      resetTimerRef.current = null;
      onBypass();
      return;
    }

    resetTimerRef.current = window.setTimeout(() => {
      tapCountRef.current = 0;
      resetTimerRef.current = null;
    }, tapWindowMs);
  };

  const handleExit = () => {
    window.close();

    window.setTimeout(() => {
      if (!window.closed) window.location.replace('about:blank');
    }, 150);
  };

  return (
    <main className="app-page min-h-[100dvh] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] text-[#17223c]">
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-[430px] flex-col items-center">
        <button
          aria-label="time2meet 로고"
          className="-m-3 mb-8 block w-[174px] touch-manipulation p-3"
          onClick={handleLogoTap}
          type="button"
        >
          <img alt="time2meet" className="h-auto w-full object-contain" draggable={false} src="/assets/time2meet-logo.png" />
        </button>

        <div className="mb-5 flex justify-center">
          <img
            alt="확성기 안내 이미지"
            className="h-[142px] w-[142px] object-contain"
            src="/assets/maintenance-megaphone.png"
          />
        </div>

        <h1 className="text-center text-[clamp(30px,9vw,40px)] font-black leading-[1.18] tracking-[0]">
          앱이 잠시 쉬어가고 있어요
        </h1>
        <p className="mt-3 text-center text-[17px] font-medium leading-7 text-[#71809f]">
          더 좋은 경험을 위해 현재 앱 패치를 진행하고 있습니다.
          <br />
          잠시만 기다려주세요!
        </p>

        <section className="mt-7 w-full rounded-[24px] border border-[#dceaff] bg-[#f7faff] px-5 py-6 shadow-[0_10px_30px_rgba(79,140,225,0.08)]">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#edf5ff] text-[#428ff1]">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path d="M7 18.2 3.5 20l1-3.8A8 8 0 1 1 7 18.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
                <circle cx="8" cy="11" fill="currentColor" r="1" />
                <circle cx="12" cy="11" fill="currentColor" r="1" />
                <circle cx="16" cy="11" fill="currentColor" r="1" />
              </svg>
            </span>
            <p className="min-w-0 text-[15px] font-medium leading-7 text-[#60708f]">
              1차 체험단에서 보내주신 소중한 피드백을 반영하고,
              <br className="hidden min-[390px]:block" />
              보다 안정적인 이용 환경을 만들기 위해 현재 앱 패치를 진행하고 있습니다.
            </p>
          </div>

          <div className="mt-5 flex items-start gap-4">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#edf5ff] text-[#428ff1]">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24">
                <rect height="17" rx="3" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="4" />
                <path d="M8 2v4M16 2v4M3 9h18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
              </svg>
            </span>
            <p className="min-w-0 text-[15px] font-medium leading-7 text-[#60708f]">
              이로 인해 9월 13일 행사 참가 신청은 이번에 한해 네이버폼을 통해 진행될 예정입니다.
            </p>
          </div>

          <div className="my-5 h-px bg-[#dce8f8]" />

          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#edf5ff] text-[#428ff1]">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-[#71809f]">예상 패치 종료 시간</p>
              <p className="mt-1 break-keep text-[20px] font-extrabold leading-8 text-[#17223c]">2026년 9월 8일 (화) 12:00</p>
            </div>
          </div>

          <p className="mt-6 text-center text-[14px] font-medium leading-6 text-[#7d8ca8]">
            앱 패치가 완료되는 대로 다시 공지드리겠습니다.
            <br />
            조금만 기다려주세요!
          </p>
        </section>

        <div className="mt-6 text-center text-[#8796b2]">
          <p aria-hidden="true" className="text-xl text-[#f6a7bf]">♥</p>
          <p className="mt-2 text-[14px] font-medium leading-6">
            늘 더 좋은 만남을 위해,
            <br />
            타임투밋은 계속 노력합니다.
          </p>
        </div>

        <button
          className="mt-7 w-full rounded-[18px] bg-[#3f8ff1] py-4 text-[18px] font-bold text-white shadow-[0_10px_24px_rgba(63,143,241,0.2)]"
          onClick={handleExit}
          type="button"
        >
          앱 종료
        </button>
      </div>
    </main>
  );
}
