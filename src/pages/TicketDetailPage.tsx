import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { TicketQrDisplay } from '../components/EventTicket';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import {
  fetchMyConfirmedEventVenue,
  fetchMyEventTickets,
  getCachedTestEventPreviewToken,
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
      setVenue(null);
      try {
        const tickets = await fetchMyEventTickets();
        if (!active) return;
        const nextTicket = tickets.find(
          (item) =>
            item.eventId === eventId &&
            (item.status === '참가 확정' || item.status === '참여 보류' || item.status === '결제 대기'),
        ) ?? null;
        setTicket(nextTicket);

        if (nextTicket?.status === '참가 확정') {
          try {
            const latestVenue = await fetchMyConfirmedEventVenue(nextTicket.eventId);
            if (active) setVenue(latestVenue);
          } catch (venueError) {
            // The existing ticket RPC already returns the latest protected
            // venue text. Keep the ticket usable if the structured lookup is
            // temporarily unavailable, while retaining the same status gate.
            console.error('Confirmed event venue lookup failed', venueError);
          }
        }
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
            <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-6 shadow-calendar">
              <TicketQrDisplay ticket={ticket} />
            </section>

            <section className="rounded-[24px] bg-meet-blueSoft p-5">
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
      <div className="mt-3 rounded-[26px] bg-meet-blueSoft p-1.5">
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
