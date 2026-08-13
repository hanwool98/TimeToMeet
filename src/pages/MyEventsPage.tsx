import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import EventTicket, { QrModal, formatDeadline } from '../components/EventTicket';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import { getAppSession } from '../services/appAuth';
import {
  fetchMyEventTickets,
  markPaymentInvitationReadByApplication,
  subscribeToMyApplicationChanges,
  type MyEventTicket,
} from '../services/supabaseApplications';

export default function MyEventsPage() {
  const navigate = useNavigate();
  const isLoggedIn = Boolean(getAppSession());
  const [tickets, setTickets] = useState<MyEventTicket[]>([]);
  const [loading, setLoading] = useState(isLoggedIn);
  const [error, setError] = useState('');
  const [qrTicket, setQrTicket] = useState<MyEventTicket | null>(null);
  const { participants } = useOperationalData({ eventId: tickets[0]?.eventId });

  const loadTickets = useCallback(async () => {
    if (!getAppSession()) return;
    setError('');
    try {
      const nextTickets = await fetchMyEventTickets();
      setTickets(nextTickets);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '내 행사 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    void loadTickets();
    const unsubscribe = subscribeToMyApplicationChanges(() => {
      void loadTickets();
    });
    const onRefresh = () => void loadTickets();
    window.addEventListener('focus', onRefresh);
    window.addEventListener('online', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('online', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
    };
  }, [isLoggedIn, loadTickets]);

  const openPayment = async (ticket: MyEventTicket) => {
    try {
      await markPaymentInvitationReadByApplication(ticket.applicationId);
    } catch {
      // Invitation read state is helpful for the badge, but the ticket itself remains the source of truth.
    }
    navigate(`/my-events/payment/${ticket.applicationId}`);
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-10rem)] flex-col gap-5">
        {isLoggedIn ? (
          <section className="w-full pt-6">
            <h1 className="text-[24px] font-black">내 행사</h1>
            {loading ? <p className="mt-8 text-center text-[16px] font-black text-[#999]">불러오는 중</p> : null}
            {error ? <p className="mt-8 rounded-[18px] bg-meet-pinkSoft p-4 text-center text-[15px] font-black text-meet-pink">{error}</p> : null}
            {!loading && !error && tickets.length === 0 ? (
              <div className="flex min-h-[calc(100dvh-14rem)] flex-col items-center justify-center">
                <p className="text-center text-[17px] font-extrabold text-[#999]">참가 예정인 행사가 없습니다</p>
              </div>
            ) : null}
            <div className="mt-5 space-y-6">
              {tickets.map((ticket) => (
                <section className="space-y-4" key={ticket.applicationId}>
                  <EventTicket
                    onPay={ticket.status === '결제 대기' ? () => void openPayment(ticket) : undefined}
                    onQrOpen={ticket.status === '참가 확정' ? () => setQrTicket(ticket) : undefined}
                    ticket={ticket}
                  />
                  {ticket.status === '입금 확인 중' ? (
                    <p className="rounded-[18px] bg-meet-blueSoft p-4 text-[14px] font-black leading-relaxed text-[#555]">
                      입금 확인을 요청했어요. 운영자가 통장 내역을 확인하면 참가 확정 티켓으로 바뀝니다.
                    </p>
                  ) : null}
                  {ticket.depositFailureReason ? (
                    <p className="rounded-[18px] bg-meet-pinkSoft p-4 text-[14px] font-black leading-relaxed text-meet-pink">
                      입금 확인이 보류됐어요. {ticket.depositFailureReason}
                    </p>
                  ) : null}
                  {ticket.status === '참가 확정' ? (
                    <div className="space-y-2">
                      <PrimaryButton disabled={!ticket.checkedInAt} onClick={() => navigate(`/events/${ticket.eventId}/mode`)}>
                        행사 입장
                      </PrimaryButton>
                      {!ticket.checkedInAt ? (
                        <p className="text-center text-[13px] font-black text-[#999]">행사 당일 QR 인증 후 입장할 수 있어요</p>
                      ) : null}
                    </div>
                  ) : ticket.paymentDeadline ? (
                    <p className="text-[13px] font-black text-[#777]">결제 기한 {formatDeadline(ticket.paymentDeadline)}</p>
                  ) : null}
                </section>
              ))}
            </div>

            {tickets.length > 0 && participants.length > 0 ? (
              <section className="mt-8 rounded-[26px] bg-meet-blueSoft p-1.5">
                <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
                  <ParticipantList participants={participants.filter((participant) => participant.gender === 'male')} title="남" />
                  <ParticipantList participants={participants.filter((participant) => participant.gender === 'female')} title="여" />
                </div>
              </section>
            ) : null}
          </section>
        ) : (
          <div className="flex min-h-[calc(100dvh-10rem)] flex-col items-center justify-center gap-5">
            <p className="text-center text-[17px] font-extrabold text-[#999]">로그인 후에 이용가능합니다.</p>
            <PrimaryButton className="max-w-[260px]" onClick={() => navigate('/login?returnTo=/my-events')}>
              로그인
            </PrimaryButton>
          </div>
        )}
      </div>
      <BottomTabs />
      {qrTicket ? <QrModal onClose={() => setQrTicket(null)} ticket={qrTicket} /> : null}
    </main>
  );
}
