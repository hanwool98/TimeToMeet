import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { formatDeadline, formatWon, TicketQrDisplay } from '../components/EventTicket';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import {
  fetchMyConfirmedEventVenue,
  fetchMyEventTickets,
  getCachedTestEventPreviewToken,
  markPaymentInvitationReadByApplication,
  type ConfirmedEventVenue,
  type MyEventTicket,
} from '../services/supabaseApplications';
import { isParticipantListPublic, PARTICIPANT_LIST_LOCKED_NOTICE } from '../utils/participantListGate';

export default function TicketDetailPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [ticket, setTicket] = useState<MyEventTicket | null>(null);
  const [venue, setVenue] = useState<ConfirmedEventVenue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const tickets = await fetchMyEventTickets();
        if (!active) return;
        const nextTicket = tickets.find(
          (item) =>
            item.eventId === eventId &&
            (item.status === '참가 확정' || item.status === '참여 보류' || item.status === '결제 대기'),
        ) ?? null;
        setTicket(nextTicket);

        if (nextTicket?.status === '참가 확정' && !nextTicket.eventDeletedAt) {
          try {
            const latestVenue = await fetchMyConfirmedEventVenue(nextTicket.eventId);
            if (active) setVenue(latestVenue);
          } catch (venueError) {
            // The existing ticket RPC already returns the latest protected
            // venue text. Keep the ticket usable if the structured lookup is
            // temporarily unavailable, while retaining the same status gate.
            console.error('Confirmed event venue lookup failed', venueError);
          }
        } else {
          setVenue(null);
        }
      } catch {
        if (active) setTicket(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    // 이 페이지는 단 한 번만 조회하고 그대로 열어두는 경우가 많다(QR을
    // 띄워두고 입장 대기) - 그 사이 관리자가 행사를 삭제하면 원래는 이
    // 화면이 갱신될 방법이 전혀 없었다. 다른 화면들과 동일한 주기(30초
    // polling + 재연결 시그널)로 다시 조회해 "삭제됨" 전환도 놓치지 않는다.
    const intervalId = window.setInterval(() => void load(), 30_000);
    const handleReconnectSignal = () => void load();
    window.addEventListener('online', handleReconnectSignal);
    window.addEventListener('focus', handleReconnectSignal);
    document.addEventListener('visibilitychange', handleReconnectSignal);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleReconnectSignal);
      window.removeEventListener('focus', handleReconnectSignal);
      document.removeEventListener('visibilitychange', handleReconnectSignal);
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

  if (ticket.eventDeletedAt) {
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
          <section className="mt-6 rounded-[18px] border border-[#e5e5e5] bg-[#fafafa] p-6 text-center">
            <p className="inline-block rounded-[8px] bg-[#e5e5e5] px-2 py-1 text-[11px] font-black text-[#666]">삭제된 행사</p>
            <h1 className="mt-3 text-[18px] font-black text-[#555]">{ticket.eventTitle}</h1>
            <p className="mt-3 text-[13px] font-bold leading-relaxed text-[#999]">
              해당 행사는 삭제되어 QR 입장 및 행사 진행을 이용할 수 없습니다.
              <br />
              티켓은 자동으로 곧 삭제됩니다.
            </p>
          </section>
        </div>
        <BottomTabs />
      </main>
    );
  }

  const venueDetail = venue?.venueDetail || ticket.location.trim();
  const publicLocation = venue?.location && venue.location !== venueDetail ? venue.location : '';
  const naverMapUrl = ticket.status === '참가 확정'
    ? createNaverMapSearchUrl(venueDetail, publicLocation)
    : null;

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
            <section className="rounded-[24px] bg-white p-6 shadow-calendar">
              <TicketQrDisplay ticket={ticket} />
            </section>

            <section className="rounded-[16px] bg-meet-blueSoft p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="shrink-0 text-[15px] font-black text-[#555]">행사 장소</h2>
                {naverMapUrl ? (
                  <a
                    aria-label="네이버지도에서 행사 장소 보기"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-[12px] font-black text-[#03823f] shadow-sm active:scale-[0.98]"
                    href={naverMapUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <img alt="" aria-hidden="true" className="h-[18px] w-[18px]" src="/assets/naver-map-mark.svg" />
                    지도에서 보기
                  </a>
                ) : null}
              </div>
              {venueDetail ? <p className="mt-2 break-words text-[18px] font-black text-black">{venueDetail}</p> : null}
              {publicLocation ? <p className="mt-1 break-words text-[13px] font-bold text-[#777]">{publicLocation}</p> : null}
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

        {/* 결제대기 상태인 동안에는 결제 안내를 몇 번을 닫고 다시 들어와도
            항상 다시 확인할 수 있어야 한다 - 그래서 "닫으면 사라지는 모달"이
            아니라 티켓 상세 화면 자체에 상시 노출한다. 실제 입금자명 입력과
            "확인했습니다" 제출은 기존 결제 화면(PaymentPendingPage)의 몫으로
            남겨두고, 여기서는 금액/계좌 정보를 다시 보여주는 용도로만 쓴다. */}
        {ticket.status === '결제 대기' ? <PaymentInfoReminder ticket={ticket} /> : null}

        {isLastVisibleDayForTicket(ticket.eventDate) ? (
          <p className="rounded-[18px] bg-meet-pinkSoft p-4 text-center text-[13px] font-black text-meet-pink">
            이 티켓은 1일 뒤에 사라집니다.
          </p>
        ) : null}

        <TicketParticipantPreview eventId={ticket.eventId} />
      </div>
      <BottomTabs />
    </main>
  );
}

function PaymentInfoReminder({ ticket }: { ticket: MyEventTicket }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const hasAccountInfo = Boolean(ticket.bankName && ticket.bankAccountNumber && ticket.bankAccountHolder);

  const openPayment = async () => {
    try {
      await markPaymentInvitationReadByApplication(ticket.applicationId);
    } catch {
      // 안 읽음 배지 처리용 호출이라 실패해도 결제 화면 이동 자체는 막지 않는다.
    }
    navigate(`/my-events/payment/${ticket.applicationId}`);
  };

  const copyAccountNumber = () => {
    if (!ticket.bankAccountNumber) return;
    void navigator.clipboard.writeText(ticket.bankAccountNumber).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };

  return (
    <section className="space-y-4 rounded-[20px] bg-meet-blueSoft p-5">
      <p className="w-fit rounded-full bg-white px-3 py-1.5 text-[13px] font-black text-meet-blue">결제 대기 중</p>

      <div>
        <p className="text-[13px] font-black text-[#777]">결제 금액</p>
        <p className="mt-1.5 text-[24px] font-black text-black">{formatWon(ticket.paymentAmount)}</p>
      </div>

      {hasAccountInfo ? (
        <div className="space-y-2.5">
          <p className="text-[13px] font-black text-[#777]">입금 계좌</p>
          <div className="divide-y divide-[#f0f3f6] rounded-[14px] bg-white px-4">
            <div className="py-3">
              <p className="text-[16px] font-black text-black">
                {ticket.bankName} {ticket.bankAccountNumber}
              </p>
              <button
                className="mt-2.5 rounded-[10px] bg-meet-blue px-3 py-2 text-[12px] font-black text-white"
                onClick={copyAccountNumber}
                type="button"
              >
                {copied ? '복사됨 ✓' : '계좌번호 복사'}
              </button>
            </div>
            <p className="py-3 text-[14px] font-extrabold text-[#555]">예금주: {ticket.bankAccountHolder}</p>
            {/* PaymentPendingPage의 "확인할 입금자명" 규칙과 동일하게
                ticket.applicantName을 그대로 쓴다 - 별도 로직 없음. */}
            <p className="py-3 text-[14px] font-extrabold text-[#555]">입금자명: {ticket.applicantName}</p>
            {ticket.paymentDeadline ? (
              <p className="py-3 text-[14px] font-extrabold text-[#555]">입금기한: {formatDeadline(ticket.paymentDeadline)}까지</p>
            ) : null}
          </div>
          <p className="text-[12.5px] font-bold leading-relaxed text-[#666]">
            {ticket.applicantName} 본인 명의로 입금해주세요. 입금자명이 다르면 확인이 늦어질 수 있어요.
          </p>
        </div>
      ) : (
        <p className="text-[13px] font-bold leading-relaxed text-[#777]">
          결제 계좌 정보를 불러오지 못했어요. 아래 버튼으로 결제 안내를 다시 확인해주세요.
        </p>
      )}

      <PrimaryButton onClick={() => void openPayment()}>결제 안내 자세히 보기</PrimaryButton>
    </section>
  );
}

function createNaverMapSearchUrl(venueDetail: string, publicLocation: string) {
  const query = [venueDetail.trim(), publicLocation.trim()].filter(Boolean).join(' ');
  return query ? `https://map.naver.com/p/search/${encodeURIComponent(query)}` : null;
}

// Tickets stop appearing in "내 행사" 3 days after their event (kept in sync
// with get_my_event_tickets' own cutoff) - this fires on the last day a
// ticket is still visible, i.e. exactly 3 days after the event date.
function isLastVisibleDayForTicket(eventDateValue: string) {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()).getTime();
  const eventDate = new Date(`${eventDateValue}T00:00:00`).getTime();
  const daysSinceEvent = Math.round((today - eventDate) / 86_400_000);
  return daysSinceEvent === 3;
}

function TicketParticipantPreview({ eventId }: { eventId: string }) {
  const previewToken = getCachedTestEventPreviewToken(eventId);
  const { events, participants } = useOperationalData({ eventId, previewToken });
  const event = events.find((item) => item.id === eventId);
  const maleCapacity = Math.max(1, event?.maleCapacity ?? Math.ceil((event?.targetParticipants ?? 0) / 2));
  const femaleCapacity = Math.max(1, event?.femaleCapacity ?? Math.floor((event?.targetParticipants ?? 0) / 2));

  return (
    <section>
      <h2 className="px-1 text-[15px] font-black text-[#555]">참가자리스트</h2>
      <div className="mt-3 rounded-[16px] bg-meet-blueSoft p-1.5">
        {isParticipantListPublic(event?.date, event?.startTime) ? (
          <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
            <ParticipantList capacity={maleCapacity} participants={participants.filter((participant) => participant.gender === 'male')} title="남" />
            <ParticipantList capacity={femaleCapacity} participants={participants.filter((participant) => participant.gender === 'female')} title="여" />
          </div>
        ) : (
          <p className="px-5 py-12 text-center text-[13px] font-black leading-relaxed text-[#8a94a0]">
            {PARTICIPANT_LIST_LOCKED_NOTICE}
          </p>
        )}
      </div>
    </section>
  );
}
