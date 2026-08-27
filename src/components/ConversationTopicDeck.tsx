import { useEffect, useId, useRef, useState } from 'react';
import { fetchConversationTopicsForTablet, type TabletConversationTopic } from '../services/supabaseApplications';

const topicsRefreshIntervalMs = 90_000;
const flipTransitionMs = 520;
const rotateDelayMs = 60;
const rotateDurationMs = 460;

// 종이 두께 겹 수/간격 - deck-final.html 확정본과 동일.
const deckPlyCount = 13;
const deckPlyStepPx = 1.4;

// 특정 태블릿에서 "숨쉬기" 대기 애니메이션이 버벅이면, 그 기기 브라우저
// 콘솔에서 localStorage.setItem('time2meet.deckStaticMode','1') 한 번
// 실행해두면 이후 계속 꺼진 채로 유지된다(코드 재배포 없이 기기별로 끌
// 수 있는 탈출구).
function isDeckStaticModeEnabled() {
  try {
    return window.localStorage.getItem('time2meet.deckStaticMode') === '1';
  } catch {
    return false;
  }
}

function shuffle<T>(items: T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

// offsetTop/offsetLeft/offsetParent are pure layout-box values that ignore
// any `transform` on an element or its ancestors - summing them for two
// elements that share an ancestor gives the correct on-screen delta between
// those elements no matter how that ancestor is being visually rotated
// (the tablet's landscape-rotate-via-CSS fallback for physically-portrait
// devices included), unlike getBoundingClientRect() which reports the
// already-rotated box.
function cumulativeOffset(el: HTMLElement | null) {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = el;
  let guard = 0;
  while (node && guard < 50) {
    top += node.offsetTop;
    left += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
    guard += 1;
  }
  return { left, top };
}

const supports3D = typeof document !== 'undefined' && 'webkitPerspective' in document.body.style;

interface FlipState {
  finalHeight: number;
  finalLeft: number;
  finalTop: number;
  finalWidth: number;
  initialDx: number;
  initialDy: number;
  initialScaleX: number;
  initialScaleY: number;
  phase: 'closing' | 'opening' | 'open';
  topic: TabletConversationTopic;
}

// Topics are fetched once (and refreshed on a slow interval so admin edits
// eventually show up) rather than round-tripping to the server on every
// card draw - the shuffle-bag draw order and the fly-to-center reveal all
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
  const [flip, setFlip] = useState<FlipState | null>(null);
  const deckRef = useRef<TabletConversationTopic[]>([]);
  const lastTopicIdRef = useRef<string | null>(null);
  const stackCardRef = useRef<HTMLDivElement | null>(null);
  const overlayAnchorRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const [staticMode] = useState(isDeckStaticModeEnabled);
  const patternIdBase = useId();
  const nextPatternId = `${patternIdBase}-next`;
  const topPatternId = `${patternIdBase}-top`;

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

  // Admin may have edited the topic pool - the in-flight shuffle bag could
  // reference topics that no longer exist (or miss brand-new ones), so
  // start a fresh bag rather than trying to patch it in place.
  useEffect(() => {
    deckRef.current = [];
  }, [topics]);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) window.clearTimeout(closeTimeoutRef.current);
    },
    [],
  );

  // Full-cycle shuffle bag: every topic is drawn exactly once before any
  // repeat, refilled (and reshuffled) once the bag empties.
  const drawNextTopic = (): TabletConversationTopic | null => {
    if (topics.length === 0) return null;
    if (deckRef.current.length === 0) {
      const bag = shuffle(topics);
      if (bag.length > 1 && bag[0].id === lastTopicIdRef.current) {
        const temp = bag[0];
        bag[0] = bag[1];
        bag[1] = temp;
      }
      deckRef.current = bag;
    }
    const pick = deckRef.current.shift();
    if (!pick) return null;
    lastTopicIdRef.current = pick.id;
    return pick;
  };

  const openDeck = () => {
    if (flip) return;
    const topic = drawNextTopic();
    const source = stackCardRef.current;
    const anchor = overlayAnchorRef.current;
    if (!topic || !source || !anchor) return;

    const anchorWidth = anchor.offsetWidth;
    const anchorHeight = anchor.offsetHeight;
    const finalHeight = Math.max(300, Math.min(560, anchorHeight * 0.62));
    const finalWidth = finalHeight * (320 / 440);
    const finalLeft = (anchorWidth - finalWidth) / 2;
    const finalTop = (anchorHeight - finalHeight) / 2;

    const sourceOffset = cumulativeOffset(source);
    const anchorOffset = cumulativeOffset(anchor);
    const fromLeft = sourceOffset.left - anchorOffset.left;
    const fromTop = sourceOffset.top - anchorOffset.top;

    setFlip({
      finalHeight,
      finalLeft,
      finalTop,
      finalWidth,
      initialDx: fromLeft - finalLeft,
      initialDy: fromTop - finalTop,
      initialScaleX: source.offsetWidth / finalWidth,
      initialScaleY: source.offsetHeight / finalHeight,
      phase: 'opening',
      topic,
    });

    // Two rAFs: the first commits the "still at the stack" starting
    // transform, the second (next paint) flips to the centered end state
    // so the browser actually animates the transition instead of jumping.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setFlip((current) => (current ? { ...current, phase: 'open' } : current));
      });
    });
  };

  const closeDeck = () => {
    setFlip((current) => (current ? { ...current, phase: 'closing' } : current));
    closeTimeoutRef.current = window.setTimeout(() => setFlip(null), flipTransitionMs);
  };

  const isFlying = Boolean(flip);

  return (
    <div className="flex w-full flex-col items-center">
      <div className="mb-1 flex flex-col items-center">
        <p className="text-center leading-snug" style={{ color: '#c07f87', fontSize: 'clamp(12px,1.35vh,15px)', fontWeight: 600 }}>
          대화가 막혔다면
          <br />
          새로운 대화주제를 뽑아보세요!
        </p>
        <ArrowGlyph />
      </div>

      <div className="relative grid w-full place-items-center" style={{ height: 'clamp(230px, 30vh, 340px)' }}>
        <div
          className={`topic-deck${staticMode ? ' topic-deck--static' : ''}`}
          onClick={openDeck}
          role="button"
        >
          <span className="topic-deck-ground" />

          {Array.from({ length: deckPlyCount }, (_, index) => (
            <span
              className="topic-deck-ply"
              key={index}
              style={{ opacity: 0.74 + index * 0.02, transform: `translateY(${-(index * deckPlyStepPx)}px)`, zIndex: index + 1 }}
            />
          ))}

          <span className="topic-deck-card topic-deck-next">
            <DeckPatternSvg patternId={nextPatternId} />
            <span className="topic-deck-border-outer" />
            <span className="topic-deck-border-inner" />
            <DeckCorners />
            <DeckWordmark />
          </span>

          <div className="topic-deck-card topic-deck-top" ref={stackCardRef} style={{ visibility: isFlying ? 'hidden' : 'visible' }}>
            <DeckPatternSvg patternId={topPatternId} />
            <span className="topic-deck-glare" />
            <span className="topic-deck-border-outer" />
            <span className="topic-deck-border-inner" />
            <DeckCorners />
            <DeckWordmark />
          </div>
        </div>
      </div>

      {/* position:absolute here escapes this narrow column entirely and
          resolves against the nearest positioned ancestor (the tablet's
          fixed-inset-0 <main>), so the flying card centers on the whole
          screen rather than this 32%-wide slice of it. */}
      <div className="absolute inset-0" ref={overlayAnchorRef} style={{ pointerEvents: isFlying ? 'auto' : 'none', zIndex: 40 }}>
        <div
          onClick={closeDeck}
          style={{
            background: 'rgba(253,244,246,0.62)',
            inset: 0,
            opacity: flip && flip.phase !== 'opening' ? 1 : 0,
            position: 'absolute',
            transition: `opacity ${flipTransitionMs}ms ease`,
          }}
        />
        {flip ? (
          <div
            onClick={closeDeck}
            style={{
              height: flip.finalHeight,
              left: flip.finalLeft,
              perspective: 1600,
              position: 'absolute',
              top: flip.finalTop,
              transform:
                flip.phase === 'open'
                  ? 'translate(0px, 0px) scale(1, 1)'
                  : `translate(${flip.initialDx}px, ${flip.initialDy}px) scale(${flip.initialScaleX}, ${flip.initialScaleY})`,
              transformOrigin: 'top left',
              transition: `transform ${flipTransitionMs}ms cubic-bezier(0.22,1,0.36,1)`,
              width: flip.finalWidth,
              WebkitPerspective: 1600,
            }}
          >
            <div
              style={{
                height: '100%',
                position: 'relative',
                transform: supports3D ? (flip.phase === 'open' ? 'rotateY(180deg)' : 'rotateY(0deg)') : undefined,
                transformStyle: supports3D ? 'preserve-3d' : undefined,
                transition: supports3D
                  ? `transform ${rotateDurationMs}ms cubic-bezier(0.4,0.15,0.2,1) ${rotateDelayMs}ms`
                  : undefined,
                width: '100%',
                WebkitTransformStyle: supports3D ? 'preserve-3d' : undefined,
              }}
            >
              <div
                style={{
                  backfaceVisibility: 'hidden',
                  height: '100%',
                  opacity: supports3D ? 1 : flip.phase === 'open' ? 0 : 1,
                  position: 'absolute',
                  transition: supports3D ? undefined : 'opacity 260ms ease',
                  width: '100%',
                  WebkitBackfaceVisibility: 'hidden',
                }}
              >
                <UnrevealedFace />
              </div>
              <div
                style={{
                  backfaceVisibility: 'hidden',
                  height: '100%',
                  opacity: supports3D ? 1 : flip.phase === 'open' ? 1 : 0,
                  position: 'absolute',
                  transform: supports3D ? 'rotateY(180deg)' : undefined,
                  transition: supports3D ? undefined : 'opacity 260ms ease',
                  width: '100%',
                  WebkitBackfaceVisibility: 'hidden',
                }}
              >
                <QuestionFace topic={flip.topic} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UnrevealedFace() {
  return (
    <div
      className="grid h-full w-full place-items-center rounded-[20px] border"
      style={{
        background: 'linear-gradient(160deg, #fffdfb 0%, #f7e0d8 100%)',
        borderColor: 'rgba(255,255,255,0.9)',
        boxShadow: '0 10px 26px rgba(196,122,104,0.22)',
      }}
    >
      <CardsGlyph />
    </div>
  );
}

function QuestionFace({ topic }: { topic: TabletConversationTopic }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center rounded-[20px] border px-[9%] py-[8%] text-center"
      style={{
        background: 'linear-gradient(165deg, #fff9f5 0%, #fdf0f0 100%)',
        borderColor: 'rgba(255,255,255,0.9)',
        boxShadow: '0 14px 34px rgba(181,100,109,0.24)',
      }}
    >
      <p style={{ color: '#d7a3aa', fontSize: 'clamp(10px,1.1vh,12px)', fontWeight: 700, letterSpacing: '0.22em' }}>대화 주제</p>
      <p
        className="mt-3 break-keep"
        style={{ color: '#b5646d', fontSize: 'clamp(17px,2.6vh,25px)', fontWeight: 600, lineHeight: 1.65 }}
      >
        {topic.content}
      </p>
      <p className="mt-4" style={{ color: '#cba79d', fontSize: 'clamp(10px,1.15vh,13px)', fontWeight: 600 }}>
        카드를 누르면 돌아갑니다
      </p>
    </div>
  );
}

// 문장(紋章)풍 격자 무늬 - 카드 뒷면 패턴. 이미지 파일 없이 인라인 SVG
// pattern으로 그린다. next/top 카드가 각각 고유한 patternId를 써야
// (동일 id가 DOM에 중복되면 브라우저가 앞의 것만 렌더링할 수 있음).
function DeckPatternSvg({ patternId }: { patternId: string }) {
  return (
    <svg className="topic-deck-card-pattern" preserveAspectRatio="xMidYMid slice" viewBox="0 0 88 116">
      <defs>
        <pattern height="26" id={patternId} patternUnits="userSpaceOnUse" width="26">
          <g fill="none" stroke="#d68a9a" strokeWidth={0.85}>
            <path d="M13 2 L13 24 M2 13 L24 13" />
            <path d="M13 6 L17 13 L13 20 L9 13 Z" fill="#e9b7c2" stroke="none" />
            <circle cx={13} cy={13} fill="#c9a25f" r={1.6} stroke="none" />
          </g>
        </pattern>
      </defs>
      <rect fill={`url(#${patternId})`} height={116} opacity={0.27} width={88} />
    </svg>
  );
}

// 카드 네 모서리의 트럼프 카드풍 장식 - 4방향 재사용, CSS transform으로
// 대칭시킨다(topic-deck-corner--tr/bl/br).
function DeckCorners() {
  return (
    <>
      <span className="topic-deck-corner topic-deck-corner--tl">
        <DeckCornerGlyph />
      </span>
      <span className="topic-deck-corner topic-deck-corner--tr">
        <DeckCornerGlyph />
      </span>
      <span className="topic-deck-corner topic-deck-corner--bl">
        <DeckCornerGlyph />
      </span>
      <span className="topic-deck-corner topic-deck-corner--br">
        <DeckCornerGlyph />
      </span>
    </>
  );
}

function DeckCornerGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12">
      <path d="M1 1 L1 8 C1 4 4 1 8 1 L1 1 Z" fill="#c08a4a" opacity={0.55} />
      <circle cx={1.6} cy={1.6} fill="#c08a4a" opacity={0.7} r={1.1} />
    </svg>
  );
}

function DeckWordmark() {
  return (
    <span className="topic-deck-wordmark">
      <span className="topic-deck-wordmark-w1">time</span>
      <span className="topic-deck-wordmark-w2">2</span>
      <span className="topic-deck-wordmark-w3">meet</span>
    </span>
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
    <svg aria-hidden="true" className="mt-1 h-8 w-10" fill="none" style={{ color: '#c07f87' }} viewBox="0 0 40 32">
      <path d="M4 4c2 10 8 18 18 22" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M15 24 22 26.5 20 19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
