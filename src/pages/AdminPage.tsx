import { useNavigate } from 'react-router-dom';

export default function AdminPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-3 pt-2">
        <header className="mb-1 flex items-center gap-1">
          <img alt="time2meet" className="h-auto w-[150px] object-contain" src="/assets/time2meet-logo.png" />
          <span className="translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <section className="flex flex-1 flex-col rounded-[30px] border border-[#f0f3f6] bg-white p-6 shadow-calendar">
          <button
            className="h-12 w-[104px] rounded-[16px] bg-meet-blueSoft text-[15px] font-black text-black transition active:scale-[0.99]"
            onClick={() => navigate(-1)}
            type="button"
          >
            돌아가기
          </button>
        </section>
      </div>
    </main>
  );
}
