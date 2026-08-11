interface DataErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function DataLoadingState() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mobile-container mx-auto grid min-h-screen place-items-center px-5">
        <section className="w-full rounded-[28px] border border-[#f0f3f6] bg-white px-5 py-8 text-center shadow-calendar">
          <p className="text-[18px] font-black">데이터를 불러오는 중입니다</p>
        </section>
      </div>
    </main>
  );
}

export function DataErrorState({ message, onRetry }: DataErrorStateProps) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mobile-container mx-auto grid min-h-screen place-items-center px-5">
        <section className="w-full rounded-[28px] border border-[#f0f3f6] bg-white px-5 py-8 text-center shadow-calendar">
          <p className="text-[19px] font-black">운영 데이터를 불러올 수 없습니다</p>
          <p className="mx-auto mt-3 max-w-[300px] break-keep text-[14px] font-extrabold leading-relaxed text-[#777]">
            {message || 'Supabase 연결 또는 권한 설정을 확인해주세요.'}
          </p>
          {onRetry ? (
            <button
              className="mt-5 h-12 rounded-[16px] bg-meet-blue px-6 text-[15px] font-black text-white"
              onClick={onRetry}
              type="button"
            >
              다시 불러오기
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
