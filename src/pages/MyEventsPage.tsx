import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import EventTicket from '../components/EventTicket';
import PrimaryButton from '../components/PrimaryButton';
import { getAppSession } from '../services/appAuth';
import {
  cancelMyHeldApplication,
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
  const [reasonModalTicket, setReasonModalTicket] = useState<MyEventTicket | null>(null);
  const [canceling, setCanceling] = useState(false);
  const shownReasonTicketIdsRef = useRef<Set<string>>(new Set());

  const loadTickets = useCallback(async () => {
    if (!getAppSession()) return;
    setError('');
    try {
      const nextTickets = await fetchMyEventTickets();
      setTickets(nextTickets);
      const pendingReasonTicket = nextTickets.find(
        (ticket) =>
          (ticket.status === '참여 보류' || ticket.status === '반려') &&
          !shownReasonTicketIdsRef.current.has(ticket.applicationId),
      );
      if (pendingReasonTicket) {
        shownReasonTicketIdsRef.current.add(pendingReasonTicket.applicationId);
        setReasonModalTicket((current) => current ?? pendingReasonTicket);
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : '내 행사 정보를 불러오지 못했습니다.';
      if (message.includes('get_my_event_tickets')) {
        setTickets([]);
        setError('');
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCancelHeldApplication = async (ticket: MyEventTicket) => {
    const ok = window.confirm('참가 신청을 취소할까요? 취소 후에는 되돌릴 수 없습니다.');
    if (!ok) return;
    setCanceling(true);
    try {
      await cancelMyHeldApplication(ticket.applicationId);
      setReasonModalTicket(null);
      await loadTickets();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '신청취소에 실패했습니다.');
    } finally {
      setCanceling(false);
    }
  };

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
              {tickets.map((ticket) => {
                const openTicketDetail =
                  ticket.status === '결제 대기' || ticket.status === '참가 확정' || ticket.status === '참여 보류'
                    ? () => navigate(`/my-events/ticket/${ticket.eventId}`)
                    : undefined;

                return (
                  <section className="space-y-4" key={ticket.applicationId}>
                    <div
                      className={openTicketDetail ? 'cursor-pointer' : undefined}
                      onClick={openTicketDetail}
                      onKeyDown={(event) => {
                        if (openTicketDetail && (event.key === 'Enter' || event.key === ' ')) openTicketDetail();
                      }}
                      role={openTicketDetail ? 'button' : undefined}
                      tabIndex={openTicketDetail ? 0 : undefined}
                    >
                      <EventTicket
                        onPay={ticket.status === '결제 대기' ? () => void openPayment(ticket) : undefined}
                        ticket={ticket}
                      />
                    </div>
                    {ticket.status === '결제중' || ticket.status === '입금 확인 중' ? (
                      <p className="rounded-[18px] bg-meet-blueSoft p-4 text-[14px] font-black leading-relaxed text-[#555]">
                        입금 확인 후 참가가 최종 확정됩니다.
                      </p>
                    ) : null}
                    {ticket.depositFailureReason ? (
                      <p className="rounded-[18px] bg-meet-pinkSoft p-4 text-[14px] font-black leading-relaxed text-meet-pink">
                        입금 확인이 보류됐어요. {ticket.depositFailureReason}
                      </p>
                    ) : null}
                    {ticket.status === '참여 보류' ? (
                      <button
                        className="w-full rounded-[18px] bg-meet-blueSoft p-4 text-left text-[14px] font-black leading-relaxed text-[#555]"
                        onClick={() => setReasonModalTicket(ticket)}
                        type="button"
                      >
                        현재 참가가 보류되었습니다. 자세히 보기 →
                      </button>
                    ) : null}
                    {ticket.status === '반려' ? (
                      <button
                        className="w-full rounded-[18px] bg-meet-pinkSoft p-4 text-left text-[14px] font-black leading-relaxed text-meet-pink"
                        onClick={() => setReasonModalTicket(ticket)}
                        type="button"
                      >
                        이번 행사 참가 신청이 승인되지 않았습니다. 자세히 보기 →
                      </button>
                    ) : null}
                  </section>
                );
              })}
            </div>
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
      {reasonModalTicket ? (
        <ReasonModal
          canceling={canceling}
          onCancelApplication={() => void handleCancelHeldApplication(reasonModalTicket)}
          onClose={() => setReasonModalTicket(null)}
          ticket={reasonModalTicket}
        />
      ) : null}
    </main>
  );
}

function ReasonModal({
  canceling,
  onCancelApplication,
  onClose,
  ticket,
}: {
  canceling: boolean;
  onCancelApplication: () => void;
  onClose: () => void;
  ticket: MyEventTicket;
}) {
  const isHold = ticket.status === '참여 보류';
  const title = isHold ? '참가 보류 안내' : '참가 신청 결과 안내';
  const leadLine = isHold ? '현재 참가가 보류되었습니다.' : '이번 행사 참가 신청이 승인되지 않았습니다.';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5" onClick={onClose} role="dialog">
      <section
        className="flex max-h-[85dvh] w-full max-w-[340px] flex-col overflow-hidden rounded-[28px] bg-white shadow-calendar"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-h-0 overflow-y-auto p-6 text-center">
          <h2 className="text-[20px] font-black">{title}</h2>
          <p className="mt-2 text-[15px] font-extrabold text-[#777]">{ticket.eventTitle}</p>
          <p className="mt-5 text-[17px] font-black leading-relaxed text-black">{leadLine}</p>
          {ticket.reviewReason ? (
            <p className="mt-3 whitespace-pre-wrap rounded-[16px] bg-[#f5f5f5] p-4 text-left text-[14px] font-extrabold leading-relaxed text-[#555]">
              {ticket.reviewReason}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 px-6 pb-6 pt-2 text-center">
          <button className="h-12 w-full rounded-[16px] bg-[#eee] text-[15px] font-black text-black" onClick={onClose} type="button">
            닫기
          </button>
          {isHold ? (
            <button
              className="mt-3 text-[12px] font-bold text-[#aaa] underline decoration-[#ccc] underline-offset-2 disabled:opacity-50"
              disabled={canceling}
              onClick={onCancelApplication}
              type="button"
            >
              {canceling ? '취소 처리 중…' : '신청취소하기'}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
