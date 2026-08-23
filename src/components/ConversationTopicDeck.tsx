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
    <div className="flex w-full flex-col items-center" style={{ touchAction: 'none' }}>
      {!currentTopic ? (
        <div className="mb-1 flex flex-col items-center">
          <p
            className="text-center leading-snug"
            style={{ color: '#c1897c', fontSize: 'clamp(12px,1.35vh,15px)', fontWeight: 600 }}
          >
            대화가 막혔다면
            <br />
            새로운 대화주제를 뽑아보세요!
          </p>
          <ArrowGlyph />
        </div>
      ) : null}

      <div
        className="relative grid w-full place-items-center"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        style={{ height: 'clamp(230px, 30vh, 340px)' }}
      >
        <div className="relative" style={{ height: 'clamp(180px, 23vh, 260px)', width: 'clamp(128px, 16vh, 185px)' }}>
          <DeckCard rotate={7} translate="42% 6%" tone="back" />
          <DeckCard rotate={-5} translate="-38% -4%" tone="middle" />
          <div className="absolute inset-0" key={revealKey} style={{ animation: 'topic-card-in 280ms cubic-bezier(0.22,1,0.36,1)' }}>
            <DeckCard rotate={0} tone="front">
              {currentTopic ? (
                <div className="flex h-full w-full flex-col items-center justify-center px-[10%] text-center">
                  <p
                    className="text-fluid-safe break-keep leading-snug"
                    style={{ color: '#8a5145', fontSize: 'clamp(13px,1.7vh,17px)', fontWeight: 600 }}
                  >
                    {currentTopic.content}
                  </p>
                  <span className="mt-3 h-[3px] w-6 rounded-full" style={{ background: '#f5709a' }} />
                  <p className="mt-2" style={{ color: '#cba79d', fontSize: 'clamp(9px,1vh,11px)', fontWeight: 600 }}>
                    눌러서 다음 주제 보기
                  </p>
                </div>
              ) : (
                <CardsGlyph />
              )}
            </DeckCard>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes topic-card-in {
          from { opacity: 0; transform: translateX(10px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function DeckCard({
  children,
  rotate,
  tone,
  translate = '0 0',
}: {
  children?: React.ReactNode;
  rotate: number;
  tone: 'back' | 'front' | 'middle';
  translate?: string;
}) {
  const [tx, ty] = translate.split(' ');
  const background =
    tone === 'front'
      ? 'linear-gradient(160deg, #ffffff 0%, #fff3ee 100%)'
      : tone === 'middle'
        ? 'linear-gradient(160deg, #ffe7dd 0%, #ffd6c6 100%)'
        : 'linear-gradient(160deg, #ffdccf 0%, #ffc7b3 100%)';
  const shadow =
    tone === 'front'
      ? '0 4px 10px rgba(196,122,104,0.12), 0 16px 32px rgba(196,122,104,0.24)'
      : '0 8px 18px rgba(196,122,104,0.14)';

  return (
    <div
      className="absolute inset-0 grid place-items-center rounded-[20px] border"
      style={{
        background,
        borderColor: 'rgba(255,255,255,0.9)',
        boxShadow: shadow,
        transform: `translate(${tx}, ${ty}) rotate(${rotate}deg)`,
        zIndex: tone === 'front' ? 3 : tone === 'middle' ? 2 : 1,
      }}
    >
      {children}
    </div>
  );
}

function CardsGlyph() {
  return (
    <svg aria-hidden="true" className="h-[22%] w-[22%]" fill="none" style={{ color: '#e3a89a' }} viewBox="0 0 24 24">
      <rect height="16" rx="2.5" stroke="currentColor" strokeWidth="1.4" width="12" x="6" y="4" />
      <path d="M9 9h6M9 13h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg aria-hidden="true" className="mt-1 h-8 w-10" fill="none" style={{ color: '#e0a99d' }} viewBox="0 0 40 32">
      <path d="M4 4c2 10 8 18 18 22" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M15 24 22 26.5 20 19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
