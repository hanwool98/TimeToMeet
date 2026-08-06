import { useNavigate } from 'react-router-dom';

const adminActions = [
  '행사 관리',
  '참가신청 관리',
  '행사모드',
  '회원·신고 관리',
  '콘텐츠 관리',
];

export default function AdminPage() {
  const navigate = useNavigate();

  const showPreparing = () => {
    window.alert('준비중!');
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-3 pt-2">
        <header className="mb-1 flex items-center gap-1">
          <img alt="time2meet" className="h-auto w-[150px] object-contain" src="/assets/time2meet-logo.png" />
          <span className="translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <section className="rounded-[30px] border border-[#f0f3f6] bg-white px-5 py-6 shadow-calendar">
          <div className="rounded-[28px] bg-meet-blueSoft p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <div className="rounded-[24px] border border-[#f0f3f6] bg-white px-5 py-6 shadow-calendar">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-[22px] font-black leading-none">다가오는 행사</h1>
                <p className="text-[18px] font-black italic leading-none text-meet-blue">D-9</p>
              </div>
              <p className="mt-6 text-[16px] font-extrabold leading-none">타임투밋 로테이션 소개팅 08.16</p>
              <div className="mt-6 grid grid-cols-2 gap-4 text-[15px] font-black leading-none">
                <p>남성&nbsp; 6/10</p>
                <p>여성&nbsp; 5/10</p>
              </div>
              <p className="mt-6 break-keep text-[15px] font-extrabold leading-snug text-[#555]">
                심사 대기 3 · 대기자 리스트 2 · 결제 대기 2
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3.5">
            {adminActions.map((label) => (
              <button
                className="h-[68px] w-full rounded-[22px] border border-[#f0f3f6] bg-white text-[19px] font-black text-black shadow-calendar transition active:scale-[0.99]"
                key={label}
                onClick={showPreparing}
                type="button"
              >
                {label}
              </button>
            ))}
            <button
              className="h-[68px] w-full rounded-[22px] bg-meet-blue text-[19px] font-black text-white shadow-calendar transition active:scale-[0.99]"
              onClick={() => navigate('/')}
              type="button"
            >
              관리자페이지 나가기
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
