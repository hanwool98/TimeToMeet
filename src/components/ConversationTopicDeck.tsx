import { useEffect, useRef, useState } from 'react';
import { fetchConversationTopicsForTablet, type TabletConversationTopic } from '../services/supabaseApplications';

const topicsRefreshIntervalMs = 90_000;
const swipeLeftThresholdPx = 40;
const tapMovePx = 10;

// Topics are fetched once (and refreshed on a slow interval so admin edits
// eventually show up) rather than round-tripping to the server on every
// card draw - the random pick and "don't repeat the last one" logic all
// happen locally, per-tablet, so different tables can be on different
// questions without any cross-table sync.
export default function ConversationTopicDeck({
  connectionToken,
  eventId,
  tableNumber,
}: {
  connectionToken: string;
  eventId: string;
  tableNumber: number;
}) {
  const [topics, setTopics] = useState<TabletConversationTopic[]>([]);
  const [currentTopic, setCurrentTopic] = useState<TabletConversationTopic | null>(null);
  const [revealKey, setRevealKey] = useState(0);
  const lastTopicIdRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await fetchConversationTopicsForTablet(eventId, tableNumber, connectionToken);
        if (active && result.ok) setTopics(result.topics);
      } catch {
        // Keep showing whatever was last loaded on a transient failure.
      }
    };
    void load();
    const intervalId = window.setInterval(() => void load(), topicsRefreshIntervalMs);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [connectionToken, eventId, tableNumber]);

  const drawTopic = () => {
    if (topics.length === 0) return;
    const pool = topics.length > 1 ? topics.filter((topic) => topic.id !== lastTopicIdRef.current) : topics;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastTopicIdRef.current = pick.id;
    setCurrentTopic(pick);
    setRevealKey((key) => key + 1);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isTap = Math.abs(deltaX) < tapMovePx && Math.abs(deltaY) < tapMovePx;
    const isSwipeLeft = deltaX <= -swipeLeftThresholdPx && Math.abs(deltaX) > Math.abs(deltaY);
    if (isTap || isSwipeLeft) drawTopic();
  };

  return (
    <div className="flex w-full flex-col items-center gap-4" style={{ touchAction: 'none' }}>
      {!currentTopic ? (
        <p className="text-center text-[clamp(13px,1.3vw,17px)] font-bold leading-snug text-[#b3675f]">
          대화가 막혔다면
          <br />
          새로운 대화주제를 뽑아보세요!
        </p>
      ) : null}

      <div
        className="relative grid w-full place-items-center"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        style={{ height: 'clamp(220px, 24vw, 320px)' }}
      >
        {currentTopic ? (
          <div
            className="flex h-full w-full max-w-[280px] flex-col items-center justify-center rounded-[20px] border border-white/70 bg-white/90 p-5 text-center shadow-[0_18px_40px_rgba(200,110,110,0.18)]"
            key={revealKey}
            style={{ animation: 'topic-card-in 260ms ease-out' }}
          >
            <p className="text-fluid-safe break-keep text-[clamp(16px,1.9vw,24px)] font-black leading-snug text-[#8a3f3f]">
              {currentTopic.content}
            </p>
            <p className="mt-4 text-[clamp(11px,1vw,13px)] font-bold text-[#c99]">눌러서 다음 주제 보기</p>
          </div>
        ) : (
          <CardStack />
        )}
      </div>

      <style>{`
        @keyframes topic-card-in {
          from { opacity: 0; transform: scale(0.92) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

function CardStack() {
  return (
    <div className="relative h-full w-full max-w-[200px]">
      <div className="absolute left-1/2 top-1/2 h-[70%] w-[60%] -translate-x-[68%] -translate-y-1/2 rotate-[-11deg] rounded-[16px] border border-[#f3ab98] bg-gradient-to-br from-[#ffcfba] to-[#ffb69f] shadow-[0_10px_22px_rgba(200,110,110,0.2)]" />
      <div className="absolute left-1/2 top-1/2 h-[70%] w-[60%] -translate-x-[32%] -translate-y-1/2 rotate-[10deg] rounded-[16px] border border-[#f6bfaf] bg-gradient-to-br from-[#ffdcc9] to-[#ffc4b0] shadow-[0_10px_22px_rgba(200,110,110,0.18)]" />
      <div className="absolute left-1/2 top-1/2 grid h-[76%] w-[66%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[18px] border border-white bg-gradient-to-br from-white to-[#fff4f0] shadow-[0_16px_32px_rgba(200,110,110,0.25)]">
        <CardsGlyph />
      </div>
    </div>
  );
}

function CardsGlyph() {
  return (
    <svg aria-hidden="true" className="h-[26%] w-[26%] text-[#ef8f80]" fill="none" viewBox="0 0 24 24">
      <rect height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" width="12" x="6" y="4" />
      <path d="M9 9h6M9 13h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
