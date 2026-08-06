import BottomTabs from '../components/BottomTabs';

export default function MyEventsPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-5 pb-[108px] pt-12 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-[430px] items-center justify-center">
        <p className="text-center text-[17px] font-extrabold text-[#999]">로그인 후에 이용가능합니다.</p>
      </div>
      <BottomTabs />
    </main>
  );
}
