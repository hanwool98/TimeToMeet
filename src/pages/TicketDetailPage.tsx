import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { TicketQrDisplay } from '../components/EventTicket';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import { fetchMyEventTickets, type MyEventTicket } from '../services/supabaseApplications';

export default function TicketDetailPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [ticket, setTicket] = useState<MyEventTicket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const tickets = await fetchMyEventTickets();
        if (!active) return;
        setTicket(
          tickets.find(
            (item) =>
              item.eventId === eventId &&
              (item.status === '참가 확정' || item.status === '참여 보류' || item.status === '결제 대기'),
          ) ?? null,
        );
      } catch {
        if (active) setTicket(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (!loading && !ticket) navigate('/my-events', { replace: true });
  }, [loading, navigate, ticket]);

  if (loading || !ticket) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-10rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
        <BottomTabs />
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-10rem)] flex-col gap-6 pb-8">
        <button
          className="w-fit text-[14px] font-black text-[#777]"
          onClick={() => navigate('/my-events')}
          type="button"
        >
          ← 내 행사
        </button>

        {ticket.status === '참가 확정' ? (
          <>
            <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-6 shadow-calendar">
              <TicketQrDisplay ticket={ticket} />
            </section>

            <section className="rounded-[24px] bg-meet-blueSoft p-5">
              <h2 className="text-[15px] font-black text-[#555]">행사 장소</h2>
              <p className="mt-2 text-[18px] font-black text-black">{ticket.location}</p>
            </section>

            <div className="space-y-2">
              <PrimaryButton disabled={!ticket.checkedInAt} onClick={() => navigate(`/events/${ticket.eventId}/mode`)}>
                행사 입장
              </PrimaryButton>
              {!ticket.checkedInAt ? (
                <p className="text-center text-[13px] font-black text-[#999]">행사 당일 QR 인증 후 입장할 수 있어요</p>
              ) : null}
            </div>
          </>
        ) : null}

        <TicketParticipantPreview eventId={ticket.eventId} />
      </div>
      <BottomTabs />
    </main>
  );
}

function TicketParticipantPreview({ eventId }: { eventId: string }) {
  const { participants } = useOperationalData({ eventId });

  return (
    <section>
      <h2 className="px-1 text-[15px] font-black text-[#555]">참가자리스트</h2>
      <div className="mt-3 rounded-[26px] bg-meet-blueSoft p-1.5">
        <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
          <ParticipantList participants={participants.filter((participant) => participant.gender === 'male')} title="남" />
          <ParticipantList participants={participants.filter((participant) => participant.gender === 'female')} title="여" />
        </div>
      </div>
    </section>
  );
}
