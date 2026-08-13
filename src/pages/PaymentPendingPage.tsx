import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import EventTicket, { formatDeadline, formatKoreanDate, formatWon } from '../components/EventTicket';
import PrimaryButton from '../components/PrimaryButton';
import {
  fetchMyEventTickets,
  requestBankTransferConfirmation,
  subscribeToMyApplicationChanges,
  type MyEventTicket,
} from '../services/supabaseApplications';

export default function PaymentPendingPage() {
  const navigate = useNavigate();
  const { invitationId } = useParams();
  const [tickets, setTickets] = useState<MyEventTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ticket = useMemo(() => tickets.find((item) => item.applicationId === invitationId), [invitationId, tickets]);
  const [depositorName, setDepositorName] = useState('');
  const isExpired = ticket?.paymentDeadline ? new Date(ticket.paymentDeadline).getTime() < Date.now() : false;

  const loadTickets = useCallback(async () => {
    setError('');
    try {
      const nextTickets = await fetchMyEventTickets();
      setTickets(nextTickets);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '결제 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
    const unsubscribe = subscribeToMyApplicationChanges(() => {
      void loadTickets();
    });
    return unsubscribe;
  }, [loadTickets]);

  useEffect(() => {
    if (ticket && !depositorName) setDepositorName(ticket.depositorName || ticket.applicantName);
  }, [depositorName, ticket]);

  const submitDepositRequest = async () => {
    if (!ticket || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await requestBankTransferConfirmation(ticket.applicationId, depositorName.trim() || ticket.applicantName);
      await loadTickets();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '입금 확인 요청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-white px-4 text-[16px] font-black text-[#999]">
        불러오는 중
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 with-bottom-tabs pb-8 pt-6 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto">
        <header className="relative grid h-12 place-items-center border-b border-[#f1f1f1]">
          <button aria-label="뒤로가기" className="absolute left-0 text-[32px] font-black leading-none" onClick={() => navigate('/my-events')} type="button">
            ‹
          </button>
          <h1 className="text-[21px] font-black">결제하기</h1>
        </header>

        {ticket ? (
          ticket.status === '참가 확정' ? (
            <section className="mt-6 space-y-5">
              <p className="w-fit rounded-full bg-meet-blueSoft px-4 py-2 text-[14px] font-black text-meet-blue">참가 확정</p>
              <h2 className="text-[28px] font-black leading-tight">참가가 확정되었어요</h2>
              <EventTicket ticket={ticket} />
              <PrimaryButton onClick={() => navigate('/my-events')}>내 행사로 돌아가기</PrimaryButton>
            </section>
          ) : (
            <section className="mt-6 space-y-6">
              <p className="w-fit rounded-full bg-meet-pinkSoft px-4 py-2 text-[14px] font-black text-meet-pink">{ticket.status}</p>
              <div>
                <h2 className="text-fluid-safe text-[29px] font-black leading-tight">참가자로 선정되었어요</h2>
                <p className="mt-3 text-[15px] font-extrabold leading-relaxed text-[#777]">아래 기한까지 입금하면 참가가 확정됩니다.</p>
              </div>

              {ticket.paymentDeadline ? (
                <section className="rounded-[16px] border border-meet-blue/20 bg-meet-blueSoft p-4">
                  <p className="text-[14px] font-black text-[#555]">결제 기한</p>
                  <p className="mt-3 text-fluid-safe text-[22px] font-black text-[#14213d]">{formatDeadline(ticket.paymentDeadline)}</p>
                </section>
              ) : null}

              <MiniTicket ticket={ticket} />

              <section className="rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
                <p className="text-[14px] font-black text-[#777]">결제 금액</p>
                <p className="mt-3 text-[31px] font-black">{formatWon(ticket.paymentAmount)}</p>
              </section>

              <section className="space-y-3">
                <h3 className="text-[19px] font-black">결제 수단</h3>
                <DisabledMethod label="카카오페이" />
                <DisabledMethod label="신용·체크카드" />
                <div className="flex h-14 items-center gap-3 rounded-[12px] border border-meet-blue bg-white px-4">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-meet-blue text-[12px] font-black text-white">✓</span>
                  <span className="text-[15px] font-black">계좌이체</span>
                </div>
              </section>

              <section className="space-y-4 rounded-[20px] bg-meet-blueSoft p-4">
                <p className="rounded-[16px] bg-white/85 p-3 text-[14px] font-black leading-relaxed text-[#4d5d6d]">
                  빠른 입금 확인을 위해 신청자 본인 명의의 계좌에서 송금해주세요.
                </p>
                <p className="text-[15px] font-black text-black">확인할 입금자명: {ticket.applicantName}</p>
                <AccountRow label="은행명" value={ticket.bankName} />
                <AccountRow label="계좌번호" value={ticket.bankAccountNumber} copyable />
                <AccountRow label="예금주" value={ticket.bankAccountHolder} />
                <label className="block">
                  <span className="text-[14px] font-black text-[#777]">실제 입금자명</span>
                  <input
                    className="mt-2 h-14 w-full rounded-[16px] bg-white px-4 text-[17px] font-black outline-none"
                    onChange={(event) => setDepositorName(event.target.value)}
                    value={depositorName}
                  />
                </label>
              </section>

              {ticket.depositFailureReason ? (
                <p className="rounded-[18px] bg-meet-pinkSoft p-4 text-[14px] font-black leading-relaxed text-meet-pink">
                  입금 내역을 확인하지 못했어요. {ticket.depositFailureReason}
                </p>
              ) : null}

              <label className="flex items-center gap-3 text-[15px] font-black text-[#555]">
                <input className="h-5 w-5" type="checkbox" defaultChecked />
                환불 규정을 확인했습니다
              </label>
              <p className="text-center text-[13px] font-extrabold leading-relaxed text-[#999]">운영자가 입금 내역을 확인한 후 참가가 최종 확정됩니다.</p>
              <PrimaryButton
                disabled={isExpired || submitting || ticket.status === '입금 확인 중'}
                onClick={submitDepositRequest}
              >
                {ticket.status === '입금 확인 중' ? '입금 확인 중' : submitting ? '요청 중' : '입금 완료했어요'}
              </PrimaryButton>
              {isExpired ? <p className="text-center text-[13px] font-black text-meet-pink">결제 기한이 지나 입금 확인을 요청할 수 없습니다.</p> : null}
            </section>
          )
        ) : (
          <section className="grid min-h-[calc(100dvh-12rem)] place-items-center">
            <p className="text-center text-[17px] font-extrabold text-[#999]">확인할 결제 내역이 없습니다</p>
          </section>
        )}

        {error ? <p className="mt-5 rounded-[18px] bg-meet-pinkSoft p-4 text-[14px] font-black text-meet-pink">{error}</p> : null}
      </div>
      <BottomTabs />
    </main>
  );
}

function MiniTicket({ ticket }: { ticket: MyEventTicket }) {
  return (
    <section className="grid grid-cols-[minmax(0,3fr)_minmax(84px,1fr)] overflow-hidden rounded-[16px] border border-[#edf1f5] bg-white shadow-sm">
      <div className="min-w-0 p-4">
        <h3 className="truncate text-[21px] font-black">{ticket.eventTitle}</h3>
        <p className="mt-3 text-[14px] font-extrabold text-[#666]">📅 {formatKoreanDate(ticket.eventDate)}</p>
        <p className="mt-2 text-[14px] font-extrabold text-[#666]">🕒 오후 {ticket.startTime} - {ticket.endTime}</p>
        <p className="mt-2 text-[14px] font-extrabold text-[#666]">⌖ {ticket.location}</p>
      </div>
      <div className="grid place-items-center border-l border-dashed border-[#d9e8f5] bg-meet-blueSoft text-meet-blue">
        <span className="text-[36px]" aria-hidden="true">✈</span>
      </div>
    </section>
  );
}

function DisabledMethod({ label }: { label: string }) {
  return (
    <div className="flex h-14 items-center gap-3 rounded-[12px] border border-[#edf1f5] bg-[#f8f8f8] px-4 opacity-55">
      <span className="h-5 w-5 rounded-full border-2 border-[#c8c8c8]" />
      <span className="text-[15px] font-black text-[#777]">{label}</span>
    </div>
  );
}

function AccountRow({ copyable = false, label, value }: { copyable?: boolean; label: string; value: string }) {
  return (
    <div className="rounded-[16px] bg-white px-4 py-3">
      <p className="text-[13px] font-black text-[#888]">{label}</p>
      <div className="mt-1 flex min-w-0 items-center gap-3">
        <p className="min-w-0 flex-1 break-all text-[17px] font-black text-black">{value}</p>
        {copyable ? (
          <button
            className="shrink-0 rounded-[10px] bg-meet-blue px-3 py-2 text-[12px] font-black text-white"
            onClick={() => void navigator.clipboard.writeText(value)}
            type="button"
          >
            복사
          </button>
        ) : null}
      </div>
    </div>
  );
}
