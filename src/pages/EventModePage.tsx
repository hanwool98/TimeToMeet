import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import PrimaryButton from '../components/PrimaryButton';
import { fetchMyEventTickets, type MyEventTicket } from '../services/supabaseApplications';

export default function EventModePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [ticket, setTicket] = useState<MyEventTicket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const tickets = await fetchMyEventTickets();
        setTicket(tickets.find((item) => item.eventId === eventId && item.status === '참가 확정' && Boolean(item.checkedInAt)) ?? null);
      } catch {
        setTicket(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [eventId]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto grid min-h-[calc(100dvh-10rem)] place-items-center">
        <section className="w-full rounded-[30px] bg-white p-6 text-center shadow-calendar">
          <p className="text-[14px] font-black text-meet-blue">{ticket ? '행사 입장 완료' : '입장 확인 필요'}</p>
          <h1 className="mt-3 text-[27px] font-black leading-tight">{loading ? '확인 중' : ticket ? '행사 진행 화면' : '아직 입장할 수 없어요'}</h1>
          <p className="mt-4 text-[15px] font-extrabold leading-relaxed text-[#777]">
            {ticket ? `${ticket.eventTitle} 진행 화면입니다.` : '행사 당일 운영자의 QR 인증 후 입장할 수 있어요.'}
          </p>
          <PrimaryButton className="mt-6" onClick={() => navigate('/my-events')}>
            내 행사로 돌아가기
          </PrimaryButton>
        </section>
      </div>
      <BottomTabs />
    </main>
  );
}
