import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

// Menu hub between the admin home and each content-type's own management
// screen. Only "대화주제 관리" exists today, but more content types (FAQ,
// notices, banners, ...) are expected later, so this stays a menu rather
// than jumping straight to the topics screen.
export default function AdminContentPage() {
  const navigate = useNavigate();

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-8 pt-4 min-[390px]:px-5">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[22px] font-black">콘텐츠 관리</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin')} type="button">
            ← 관리자 홈
          </button>
        </div>

        <div className="mt-5 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
          <MenuCard
            icon={<TopicsIcon />}
            label="대화주제 관리"
            onClick={() => navigate('/admin/content/conversation-topics')}
          />
        </div>
      </div>
    </main>
  );
}

function MenuCard({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-[76px] w-full max-w-full min-w-0 items-center gap-2 rounded-[18px] border border-[#eef3f7] bg-white px-2.5 py-3 text-left shadow-calendar transition active:scale-[0.98]"
      onClick={onClick}
      type="button"
    >
      <span className="shrink-0 text-meet-pink">{icon}</span>
      <span className="min-w-0 flex-1 whitespace-nowrap text-[12px] font-black text-black min-[360px]:text-[14px] min-[380px]:text-[16px]">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a7adb5]" />
    </button>
  );
}

function TopicsIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 32 32">
      <rect height="20" rx="3" width="14" x="9" y="6" />
      <path d="M13 12h6M13 17h4" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}
