import BottomTabs from '../components/BottomTabs';

export default function MyEventsPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-10rem)] items-center justify-center">
        <p className="text-center text-[17px] font-extrabold text-[#999]">로그인 후에 이용가능합니다.</p>
      </div>
      <BottomTabs />
    </main>
  );
}
