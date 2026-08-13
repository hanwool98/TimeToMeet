import { useNavigate } from 'react-router-dom';
import PrimaryButton from '../components/PrimaryButton';

export default function ApplicationCompletePage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 py-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-6rem)] flex-col justify-center">
        <section className="rounded-[30px] border border-[#f0f3f6] bg-white p-7 text-center shadow-calendar">
          <h1 className="text-fluid-safe text-[27px] font-black leading-tight">심사 신청이 완료되었습니다</h1>
          <p className="mt-8 text-fluid-safe text-[17px] font-extrabold leading-relaxed text-[#555]">
            심사 결과는 12시간 이내에 앱과 메시지로 안내해드려요.
            <br />
            참가자로 선정된 경우 안내 후 24시간 이내에
            <br />
            결제를 완료해야 참가가 최종 확정됩니다.
          </p>
          <PrimaryButton className="mt-8" onClick={() => navigate('/')}>
            메인화면으로 돌아가기
          </PrimaryButton>
        </section>
      </div>
    </main>
  );
}
