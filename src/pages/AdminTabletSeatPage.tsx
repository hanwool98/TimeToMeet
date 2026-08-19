import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataLoadingState } from '../components/DataState';
import { fetchEventTableSeatGuide, type EventTableSeatGuide } from '../services/supabaseApplications';

const storageKey = 'time2meet.tabletConnection';
const pollIntervalMs = 5_000;

interface StoredTabletConnection {
  connectionToken: string;
  eventId: string;
  tableNumber: number;
}

function readStoredConnection(eventId: string, tableNumber: number): StoredTabletConnection | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabletConnection;
    if (parsed.eventId !== eventId || parsed.tableNumber !== tableNumber || !parsed.connectionToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStoredConnection() {
  window.localStorage.removeItem(storageKey);
}

// This tablet screen currently only ever shows the pre-event seat guide.
// Once round/timer states exist, swap the body below for a small switch on
// event/round state rather than growing this component in place.
export default function AdminTabletSeatPage() {
  const navigate = useNavigate();
  const { eventId, tableNumber: tableNumberParam } = useParams();
  const tableNumber = Number(tableNumberParam);
  const [seatGuide, setSeatGuide] = useState<EventTableSeatGuide | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId || !Number.isFinite(tableNumber)) return;
    let active = true;

    const goToConnect = () => {
      clearStoredConnection();
      navigate(`/admin/events/${eventId}/tablet-connect`, { replace: true });
    };

    const poll = async () => {
      const stored = readStoredConnection(eventId, tableNumber);
      if (!stored) {
        goToConnect();
        return;
      }
      try {
        const result = await fetchEventTableSeatGuide(eventId, tableNumber, stored.connectionToken);
        if (!active) return;
        if (!result.ok) {
          goToConnect();
          return;
        }
        setSeatGuide(result);
        setLoading(false);
      } catch {
        // Network hiccup - keep showing the last known state rather than bouncing the tablet.
        if (active) setLoading(false);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [eventId, navigate, tableNumber]);

  if (loading) return <DataLoadingState />;

  return (
    <main className="fixed inset-0 flex overflow-hidden">
      <span className="pointer-events-none absolute left-1/2 top-6 z-10 -translate-x-1/2 text-[13px] font-black tracking-[0.35em] text-[#8a94a6]">
        <span className="mr-3">—</span>
        SEAT GUIDE
        <span className="ml-3">—</span>
      </span>

      <SeatSide gradient="linear-gradient(135deg,#cfe0f5,#eef4fc)" nickname={seatGuide?.maleNickname} textColor="#1f3a6b" />
      <div className="relative w-px shrink-0 bg-black/10">
        <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center text-[15px] font-black text-[#999]">&amp;</span>
      </div>
      <SeatSide gradient="linear-gradient(225deg,#f7d7e2,#fbeaf0)" nickname={seatGuide?.femaleNickname} textColor="#7a2145" />
    </main>
  );
}

function SeatSide({ gradient, nickname, textColor }: { gradient: string; nickname?: string; textColor: string }) {
  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center px-6" style={{ backgroundImage: gradient }}>
      {nickname ? (
        <p className="text-fluid-safe max-w-full break-keep text-center text-[clamp(40px,9vw,120px)] font-black leading-none" style={{ color: textColor }}>
          {nickname}
        </p>
      ) : (
        <p className="text-[clamp(16px,2.4vw,22px)] font-black" style={{ color: `${textColor}99` }}>
          자리 배정 대기 중
        </p>
      )}
    </div>
  );
}
