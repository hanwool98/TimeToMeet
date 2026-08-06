import LogoMark from '../components/LogoMark';

export default function ApplicationCompletePage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-5 py-12 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-[430px] flex-col justify-center">
        <section className="rounded-[30px] border border-[#f0f3f6] bg-white p-7 text-center shadow-calendar">
          <div className="mx-auto mb-8 grid h-[82px] w-[82px] place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <h1 className="break-keep text-[27px] font-black leading-tight">심사 신청이 완료되었습니다</h1>
          <p className="mt-8 break-keep text-[17px] font-extrabold leading-relaxed text-[#555]">
            심사 결과는 12시간 이내에 앱과 메시지로 안내해드려요.
            <br />
            참가자로 선정된 경우 안내 후 24시간 이내에
            <br />
            결제를 완료해야 참가가 최종 확정됩니다.
          </p>
        </section>
      </div>
    </main>
  );
}
