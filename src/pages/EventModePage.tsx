import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import { toPng } from 'html-to-image';
import { useNavigate, useParams } from 'react-router-dom';
import ConnectionStatusBanner from '../components/ConnectionStatusBanner';
import HeartRatingInput from '../components/HeartRatingInput';
import ParticipantPhoto from '../components/ParticipantPhoto';
import PhotoSourceInputs, { type PhotoSourceInputsHandle } from '../components/PhotoSourceInputs';
import PrimaryButton from '../components/PrimaryButton';
import ProfileKeywordPicker from '../components/ProfileKeywordPicker';
import { DRINKING_AMOUNT_OPTIONS, DRINKING_FREQUENCY_OPTIONS } from '../constants/drinkingOptions';
import {
  PROFILE_KEYWORD_OPTIONS,
  profileKeywordLabel,
  resolveProfileKeywordLabel,
  type ProfileKeywordOption,
} from '../constants/profileKeywords';
import { useScreenWakeLock } from '../hooks/useScreenWakeLock';
import {
  createParticipantPauseRequest,
  createParticipantReport,
  fetchActiveProfileKeywords,
  fetchBonusKeywordMission,
  fetchFinalSelectionCandidatePhotos,
  fetchFinalSelectionCandidates,
  fetchMyBonusRating,
  fetchMyEventProfileCard,
  fetchMyEventReview,
  fetchMyEventTickets,
  fetchMyRoundRating,
  fetchParticipantPartnerPhoto,
  fetchParticipantRoundProgress,
  saveEventProfileCard,
  saveEventReview,
  submitBonusKeywordGuess,
  submitFinalSelection,
  submitMyBonusRating,
  submitRoundRating,
  uploadEventProfileCardPhoto,
  type BonusKeywordMissionState,
  type FinalSelectionCandidate,
  type FinalSelectionCandidateProfile,
  type FinalSelectionData,
  type MyEventProfileCard,
  type MyEventTicket,
  type ParticipantPhotoInfo,
  type ParticipantRoundProgress,
  type PartnerEventProfileCard,
} from '../services/supabaseApplications';
import { representativeCropTransform, type RepresentativeCrop } from '../utils/representativeCrop';
import { isConnectionStale } from '../utils/connectionStatus';
import { playKeywordGuessSound } from '../utils/keywordGuessAudio';
import { createRequestGuard } from '../utils/requestGuard';
import { computeLiveElapsedSeconds, formatCountdown, phaseDurationSeconds } from '../utils/roundTimerSync';

const progressPollIntervalMs = 4_000;

// "나를 표현하는 키워드"는 최소 3개는 있어야 추가라운드 "나를 맞혀봐"
// 미션이 아이스브레이킹으로 의미가 있다 - 최대 개수 제한은 없다(서버도
// save_event_profile_card_for_session에서 동일하게 강제).
const profileKeywordMinCount = 3;
// 추가라운드 시작 후 이 시간(초)이 지나야 태블릿 미션카드/참가자 폰
// 키워드 미션이 등장한다 - 서버 타이머 스냅샷 기준 경과 시간으로 계산해
// 새로고침해도 항상 같은 시점에 나타난다(로컬 setTimeout 아님).
const bonusMissionRevealDelaySeconds = 5;

// 프로필 키워드 목록(관리자 콘텐츠 관리에서 관리)은 화면(프로필카드 작성,
// 대화 중, 최종선택)을 열 때마다 매번 새로 받아온다 - 과거엔 브라우저 탭당
// 한 번만 받아와 계속 재사용하는 캐시가 있었는데, 그러면 참가자가 탭을
// 새로고침하지 않는 이상 관리자가 그 사이 키워드를 수정해도 절대 반영되지
// 않는 문제가 있었다. 이 목록은 자주 바뀌지도 않고 응답도 가벼워서, 매번
// 새로 받아오는 비용보다 최신 상태를 보장하는 쪽이 더 중요하다. 실패하면
// 코드 상수로 폴백해 화면이 비어보이지 않는다.
function loadProfileKeywordOptions() {
  return fetchActiveProfileKeywords().catch(() => PROFILE_KEYWORD_OPTIONS);
}

// 저장된 키 값은 숫자만(예: "177") 들어있는 경우가 대부분이지만, 과거에
// 직접 "177cm"처럼 단위를 붙여 입력한 값도 섞여 있을 수 있다 - 이미 단위가
// 붙어있으면 중복으로 더 붙이지 않는다.
function formatHeightLabel(height: string | null | undefined) {
  const trimmed = height?.trim();
  if (!trimmed) return null;
  return /cm$/i.test(trimmed) ? trimmed : `${trimmed}cm`;
}

// html-to-image(toPng)는 캡처 시점에 아직 로드/디코딩이 끝나지 않은 <img>는
// 빈 채로 캡처해버린다 - 사진을 방금 고른 직후처럼 브라우저가 여전히
// 디코딩 중인 상태에서 캡처가 시작되면 화면엔 보여도 저장된 PNG에서는
// 빠질 수 있다. decode()가 없거나(구형 브라우저) 실패해도(일부 Safari
// 버전의 알려진 동작) img.complete가 이미 true라면 화면에 실제로 그려진
// 상태이므로 캡처를 막지 않고 그냥 진행한다.
async function waitForImagesToLoad(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          const done = () => {
            img.removeEventListener('load', done);
            img.removeEventListener('error', done);
            resolve();
          };
          img.addEventListener('load', done);
          img.addEventListener('error', done);
        });
      }
      if (typeof img.decode === 'function') {
        try {
          await img.decode();
        } catch {
          // 무시 - 위에서 이미 load/complete를 확인했으므로 화면에는 정상
          // 표시된 상태다.
        }
      }
    }),
  );
}

// 캡처 직전에만, cardCaptureRef 안의 모든 <img>의 src를 fetch()->blob()->
// object URL로 바꿔치기한다. html-to-image(toPng)는 네이티브 canvas
// drawImage와 달리 각 <img>를 자체적으로 다시 fetch해서 base64로
// 임베딩하는데, 이 내부 fetch는 화면 표시용 <img>의 crossOrigin 속성/
// onError 폴백과 완전히 무관하게 동작한다 - Supabase Storage 서명 URL을
// 그 fetch가 못 읽으면(CORS/토큰 처리 등 정확한 원인과 무관하게) 화면엔
// 정상적으로 보이는 사진이 캡처된 PNG에서만 조용히 빈 채로 나온다. 같은
// 오리진의 blob object URL로 바꾸면 그 내부 fetch가 애초에 크로스오리진
// 요청을 할 필요가 없어져 근본 원인과 무관하게 우회된다. 캡처가 끝나면
// 원래 src로 되돌리고 만든 object URL은 반드시 revoke한다.
async function withCaptureSafeImages<T>(container: HTMLElement, run: () => Promise<T>): Promise<T> {
  const images = Array.from(container.querySelectorAll('img'));
  const originalSrcs = images.map((img) => img.src);
  // ParticipantPhoto는 이 캡처 기능 자체를 위해 사진 <img>에 항상
  // crossOrigin="anonymous"를 붙여둔다. 그런데 Safari/WebKit은
  // crossOrigin="anonymous"가 붙은 <img>에 blob: URL을 넣으면 로드가
  // 조용히 실패하는 버그가 있다 - 안드로이드 Chrome은 문제없이 그려지는데
  // 아이폰에서만 사진이 빈 칸으로 캡처되는 원인이 이거였다. blob: URL은
  // 원래 페이지와 같은 출처라 애초에 CORS 모드가 필요 없으므로, 바꿔치기
  // 하는 동안만 crossOrigin을 지웠다가 끝나면 원래 값으로 되돌린다.
  const originalCrossOrigins = images.map((img) => img.crossOrigin);
  const createdObjectUrls: string[] = [];

  await Promise.all(
    images.map(async (img, index) => {
      const originalSrc = originalSrcs[index];
      if (!originalSrc || originalSrc.startsWith('blob:') || originalSrc.startsWith('data:')) return;
      try {
        const response = await fetch(originalSrc, { cache: 'no-store' });
        // 서명 URL이 만료되면(카드 작성에 시간이 걸려 발급 당시의 짧은
        // 만료시간을 넘긴 경우 등) Storage가 200이 아닌 응답(에러 본문)을
        // 준다 - 이걸 그대로 blob으로 바꿔 <img>에 넣으면 깨진 이미지가
        // 캡처되거나 decode()가 실패해 카드 사진만 빈 채로 저장되는데,
        // 상태 자체를 확인하지 않으면 이 실패가 조용히 묻혀버린다.
        if (!response.ok) throw new Error(`signed url fetch failed: ${response.status}`);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        createdObjectUrls.push(objectUrl);
        img.crossOrigin = null;
        img.src = objectUrl;
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => undefined);
        }
      } catch (swapError) {
        // 실패하면 원래 src(서명 URL)를 그대로 둔다 - 최소한 이전과 같은
        // 동작(성공할 수도, 빈 채로 캡처될 수도)으로 되돌아갈 뿐 더
        // 나빠지지는 않는다.
        console.debug('[PROFILE_CARD_EXPORT] image_swap_failed', { message: String(swapError), src: originalSrc });
      }
    }),
  );

  try {
    return await run();
  } finally {
    images.forEach((img, index) => {
      img.src = originalSrcs[index];
      img.crossOrigin = originalCrossOrigins[index];
    });
    createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

// blob 바꿔치기(withCaptureSafeImages) 이후에도 iOS Safari에서는 여전히
// html-to-image가 SVG <foreignObject> 안의 <img>를 래스터화하는 과정
// 자체가 간헐적으로 비어버리는 사례가 보고된다(라이브러리가 이미지를
// 다시 그리는 방식과 WebKit의 SVG 이미지 디코딩 타이밍이 어긋나는
// 문제로 추정 - Chrome/Android에서는 재현되지 않음). 캡처 라이브러리에
// 사진의 렌더링 자체를 맡기지 않고, 지금 화면에 실제로 보이는 모습(크롭
// 위치/확대까지 전부 반영된 최종 결과)을 네이티브 canvas
// drawImage(브라우저가 이미 계산해준 getBoundingClientRect 좌표 그대로
// 사용 - crop 수식을 다시 구현할 필요가 없다)로 한 번 평평하게 "구워서"
// data: URL 오버레이로 덮어씌운 뒤 캡처한다. data: URL은 외부 요청이
// 전혀 없는 완전한 인라인 데이터라 SVG 안에서도 항상 즉시 사용 가능하다.
// 사진이 없거나(fallback 아이콘만 있는 경우) 아주 드물게 taint 등으로
// 굽기 자체가 실패하면 조용히 건너뛰고 기존 방식 그대로 진행한다(더
// 나빠지지 않음).
async function withCaptureSafePhoto<T>(container: HTMLElement, run: () => Promise<T>): Promise<T> {
  const img = container.querySelector('img');
  const photoContainer = img?.parentElement ?? null;
  if (!img || !photoContainer) return run();

  const originalDisplay = img.style.display;
  let overlay: HTMLImageElement | null = null;

  try {
    if (!img.complete) {
      await new Promise<void>((resolve) => {
        const done = () => {
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          resolve();
        };
        img.addEventListener('load', done);
        img.addEventListener('error', done);
      });
    }
    if (typeof img.decode === 'function') {
      await img.decode().catch(() => undefined);
    }

    const containerRect = photoContainer.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    if (containerRect.width > 0 && containerRect.height > 0 && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const pixelRatio = Math.min(3, window.devicePixelRatio || 2);
      const bakeCanvas = document.createElement('canvas');
      bakeCanvas.width = Math.max(1, Math.round(containerRect.width * pixelRatio));
      bakeCanvas.height = Math.max(1, Math.round(containerRect.height * pixelRatio));
      const ctx = bakeCanvas.getContext('2d');
      if (ctx) {
        const destX = (imgRect.left - containerRect.left) * pixelRatio;
        const destY = (imgRect.top - containerRect.top) * pixelRatio;
        const destW = imgRect.width * pixelRatio;
        const destH = imgRect.height * pixelRatio;
        ctx.drawImage(img, destX, destY, destW, destH);
        const dataUrl = bakeCanvas.toDataURL('image/png');

        overlay = document.createElement('img');
        overlay.decoding = 'sync';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.objectFit = 'cover';
        overlay.src = dataUrl;
        img.style.display = 'none';
        photoContainer.appendChild(overlay);
        await new Promise<void>((resolve) => {
          if (!overlay || overlay.complete) return resolve();
          overlay.onload = () => resolve();
          overlay.onerror = () => resolve();
        });
      }
    }
  } catch (bakeError) {
    console.debug('[PROFILE_CARD_EXPORT] photo_bake_failed', { message: String(bakeError) });
  }

  try {
    return await run();
  } finally {
    overlay?.remove();
    img.style.display = originalDisplay;
  }
}

// html-to-image는 <input>/<select>/<textarea> 같은 네이티브 폼 컨트롤을
// SVG <foreignObject> 안에서 제대로 그리지 못하는 경우가 많다(내부 텍스트가
// 아예 안 보이거나, 아이콘 없는 회색 상자로만 나오거나, 값이 깨져 보이는
// 등 - 브라우저가 폼 컨트롤을 OS 위젯으로 그리기 때문에 SVG로 표현할 수
// 없는 부분이다). 캡처 직전에만 각 필드를 "완전히 같은 스타일을 가진,
// 같은 값이 적힌 일반 텍스트" div로 바꿔치기해서 이 문제를 원천적으로
// 피한다 - className을 그대로 물려받으므로 배경/테두리/둥근모서리/폰트는
// 100% 동일하고, flex 정렬만 더해 입력창의 세로 중앙 정렬을 그대로
// 재현한다. 캡처가 끝나면 항상 원래 엘리먼트로 되돌린다.
async function withCaptureSafeFormFields<T>(container: HTMLElement, run: () => Promise<T>): Promise<T> {
  const fields = Array.from(container.querySelectorAll('input, select, textarea')) as Array<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >;
  const swaps: Array<{ original: Element; placeholder: HTMLDivElement }> = [];

  for (const field of fields) {
    const isSelect = field.tagName === 'SELECT';
    const isTextarea = field.tagName === 'TEXTAREA';
    const value = isSelect ? (field as HTMLSelectElement).selectedOptions[0]?.text ?? '' : field.value;
    const placeholderText = isSelect ? '' : (field as HTMLInputElement | HTMLTextAreaElement).placeholder;
    const displayText = value || placeholderText || '';

    const placeholder = document.createElement('div');
    placeholder.className = field.className;
    placeholder.style.display = 'flex';
    placeholder.style.alignItems = isTextarea ? 'flex-start' : 'center';
    if (isTextarea) {
      placeholder.style.whiteSpace = 'pre-wrap';
      placeholder.style.wordBreak = 'break-word';
    } else {
      placeholder.style.overflow = 'hidden';
      placeholder.style.whiteSpace = 'nowrap';
      placeholder.style.textOverflow = 'ellipsis';
    }
    if (!value) placeholder.style.opacity = '0.5';
    placeholder.textContent = displayText;

    field.replaceWith(placeholder);
    swaps.push({ original: field, placeholder });
  }

  try {
    return await run();
  } finally {
    swaps.forEach(({ original, placeholder }) => placeholder.replaceWith(original));
  }
}

// ProfileFormPage의 대표사진 조정 편집기와 동일한 방식(드래그/핀치/휠로
// 위치·확대 조절) - 행사 프로필 카드 사진도 같은 방식으로 조정할 수
// 있어야 한다는 요청에 따라 같은 수식을 그대로 재사용한다.
function clampCardCropOffset(offset: number, scale: number) {
  const maxOffsetFraction = Math.max(0, (scale - 1) / 2);
  return Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, offset));
}

function getCardCropEditorBoxSize() {
  if (typeof window === 'undefined') return 320;
  return Math.min(window.innerWidth * 0.96, 430);
}

// The entire /events/:eventId/mode route is "행사모드" - it intentionally
// never renders <BottomTabs/> on any sub-screen (wait screen, conversation,
// transition, fallback), so a participant who entered via "행사 입장" only
// sees the regular app nav again after tapping "나가기" back to /my-events.
export default function EventModePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [ticket, setTicket] = useState<MyEventTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ParticipantRoundProgress | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [connTick, setConnTick] = useState(() => Date.now());
  const progressGuardRef = useRef(createRequestGuard());
  // 추가시간 호감도 제출처럼 "지금 이 화면에서 서버로 뭔가 확정 짓는 중"인
  // 짧은 구간 동안은 poll이 도착해도 화면을 덮어쓰지 않는다 - 안 그러면
  // 제출 응답이 오기 전에 poll이 먼저 "다음 단계로 넘어감" 상태를 받아와
  // 화면이 강제로 넘어가버릴 수 있다(실제 행사에서 발생 확인). 제출이
  // 끝나면 곧바로 poll을 한 번 더 해서 최신 상태로 따라잡는다.
  const suspendPollRef = useRef(false);
  const pollNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    const intervalId = window.setInterval(() => setConnTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const isStale = isConnectionStale(lastSuccessAt, connTick);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const tickets = await fetchMyEventTickets();
        if (!active) return;
        setTicket(tickets.find((item) => item.eventId === eventId && item.status === '참가 확정' && Boolean(item.checkedInAt)) ?? null);
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

  // Only starts once entry is confirmed (checked-in, 참가 확정) - this is the
  // sole gate today, matching TicketDetailPage's "행사 입장" button, and is
  // re-verified here rather than trusted from a route param so a
  // typed-in URL can't skip it. Before the operator presses 행사 시작 on
  // AdminEventPreparePage, no event_progress row exists yet, so the server
  // reports stage: undefined and the wait screen renders below.
  useEffect(() => {
    if (!eventId || !ticket) return undefined;
    let active = true;
    const poll = async () => {
      if (suspendPollRef.current) return;
      try {
        await progressGuardRef.current.run(
          () => fetchParticipantRoundProgress(eventId),
          (next) => {
            if (active && !suspendPollRef.current) {
              setProgress(next);
              setLastSuccessAt(Date.now());
            }
          },
          { skipIfInFlight: true },
        );
      } catch {
        // Keep showing the last known state on a transient failure.
      }
    };
    pollNowRef.current = () => void poll();
    void poll();
    const intervalId = window.setInterval(() => void poll(), progressPollIntervalMs);
    const handleReconnectSignal = () => void poll();
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
  }, [eventId, ticket]);

  // Hooks의 규칙(조건부 return 뒤에 hook을 두지 않기)을 지키기 위해 아래
  // loading/ticket 조건부 return보다 반드시 앞에 둬야 한다 - 원래 이
  // 두 useCallback이 return 아래에 있어서, "불러오는 중"/"입장 확인 필요"
  // 화면에서 실제 참가 화면으로 넘어가는 바로 그 렌더에서 hook 호출
  // 개수가 늘어나 "Rendered more hooks than during the previous render"
  // 오류로 화면이 완전히 하얗게 죽는 버그가 있었다(이번 기능 작업 중
  // 발견 - 이번 기능과 무관하게 기존에 있던 문제라 함께 고쳤다).
  const handleCriticalSubmitStart = useCallback(() => {
    suspendPollRef.current = true;
  }, []);
  const handleCriticalSubmitEnd = useCallback(() => {
    suspendPollRef.current = false;
    pollNowRef.current();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-white px-4 pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-6rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </main>
    );
  }

  if (!ticket) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-white px-4 pt-12 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-6rem)] place-items-center">
          <section className="w-full rounded-[24px] bg-white p-6 text-center shadow-calendar">
            <p className="text-[14px] font-black text-meet-blue">입장 확인 필요</p>
            <h1 className="mt-3 text-[27px] font-black leading-tight">아직 입장할 수 없어요</h1>
            <p className="mt-4 text-[15px] font-extrabold leading-relaxed text-[#777]">행사 당일 운영자의 QR 인증 후 입장할 수 있어요.</p>
            <PrimaryButton className="mt-6" onClick={() => navigate('/my-events')}>
              내 행사로 돌아가기
            </PrimaryButton>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <ConnectionStatusBanner visible={isStale} />
      <ParticipantEventScreen
        eventId={ticket.eventId}
        eventTitle={ticket.eventTitle}
        onCriticalSubmitEnd={handleCriticalSubmitEnd}
        onCriticalSubmitStart={handleCriticalSubmitStart}
        progress={progress}
      />
    </main>
  );
}

function ParticipantEventScreen({
  eventId,
  eventTitle,
  onCriticalSubmitEnd,
  onCriticalSubmitStart,
  progress,
}: {
  eventId: string;
  eventTitle: string;
  onCriticalSubmitEnd: () => void;
  onCriticalSubmitStart: () => void;
  progress: ParticipantRoundProgress | null;
}) {
  const navigate = useNavigate();
  const onBack = () => navigate(`/my-events/ticket/${eventId}`);

  // 행사모드에 머무는 동안은 참가자가 한동안 화면을 안 만져도(대화 중,
  // 타이머만 보는 중 등) 잠기지 않게 한다.
  useScreenWakeLock(true);

  if (!progress) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-6rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </div>
    );
  }

  // No event_progress row yet (행사 시작 전), or the operator has started
  // the event but is still on 자리유도/소개영상/라운드 대기 - this entire
  // span now renders ONE component (EventProfileCardScreen) instead of a
  // plain wait screen, so the participant can write today's profile card
  // while waiting. Because it's the same mounted component across all three
  // stages (no remount when intro_video → round_waiting), whatever they've
  // typed survives the phase change without needing a separate autosave.
  if (!progress.stage || progress.stage === 'seat_guide' || progress.stage === 'intro_video' || progress.stage === 'round_waiting') {
    return <EventProfileCardScreen eventId={eventId} eventTitle={eventTitle} onBack={onBack} />;
  }

  // 지각 체크인: 전원 체크인을 기다리지 않고 행사가 시작되므로, 라운드가
  // 이미 진행 중인 뒤에 체크인하는 사람도 있을 수 있다. 그런 사람은 아직
  // 프로필 카드를 한 번도 제출한 적이 없으므로(=아무 상대도 본 적 없음)
  // 최종선택 전까지는 라운드 진행 중에도 카드 작성 화면을 계속 보여준다.
  // 제출하고 나면 서버가 다음 라운드부터 자동으로 로테이션에 끼워 넣는다
  // (그 전까지는 이번 라운드가 그냥 "쉬어가는 시간"으로 보일 뿐이다).
  if (
    progress.hasSubmittedProfileCard === false &&
    progress.stage !== 'final_selection' &&
    progress.stage !== 'ended'
  ) {
    return <EventProfileCardScreen eventId={eventId} eventTitle={eventTitle} onBack={onBack} />;
  }

  // bonus_matching은 더 이상 살아있는 stage가 아니다(대화 종료 시 매칭을
  // current_round를 올리지 않은 채 미리 계산해두고 bonus_seat_guide로 바로
  // 전환) - 도달하지 않지만 혹시 남아있는 이전 상태를 위해 대기 화면으로
  // 안전하게 fallback한다.
  if (progress.stage === 'bonus_matching') {
    return <BonusMatchingScreen onBack={onBack} />;
  }

  // 추가시간 통합 1분 phase: 방금 끝난 상대에 대한 호감도 수정과(있다면) 다음
  // 상대 자리 이동 안내를 한 화면에서 같이 보여준다 - 예전에는 이게
  // bonus_rating(수정만) + bonus_seat_guide(안내만) 두 단계였다.
  if (progress.stage === 'bonus_seat_guide') {
    return (
      <BonusSeatGuideScreen
        eventId={eventId}
        onBack={onBack}
        onCriticalSubmitEnd={onCriticalSubmitEnd}
        onCriticalSubmitStart={onCriticalSubmitStart}
        progress={progress}
      />
    );
  }

  // 성비 불균형으로 이번 라운드에 상대가 배정되지 않은 참가자(순환 휴식) -
  // undefined 닉네임이나 빈 프로필을 그대로 보여주는 대신 명시적으로 안내한다.
  // 서버가 다음 라운드부터 다시 상대를 배정하므로 폴링만으로 자동 복귀된다.
  if (progress.stage === 'round_active' && progress.isResting) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <section className="w-full rounded-[24px] bg-white p-6 text-center shadow-calendar">
            <p className="text-[18px] font-black leading-tight">이번 라운드는 잠시 쉬어가는 시간이에요</p>
            <p className="mt-3 text-[14px] font-extrabold text-[#888]">다음 라운드부터 다시 만남이 이어집니다</p>
          </section>
        </div>
      </div>
    );
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'conversation') {
    return <ConversationScreen eventId={eventId} onBack={onBack} progress={progress} />;
  }

  if (progress.stage === 'round_active' && progress.roundPhase === 'transition') {
    return <RatingScreen eventId={eventId} onBack={onBack} progress={progress} />;
  }

  // 마지막 추가시간까지 끝난 뒤(또는 추가시간 0회 설정 시 정규 라운드
  // 종료 직후) 도달하는 단계.
  if (progress.stage === 'final_selection') {
    return <FinalSelectionScreen eventId={eventId} onBack={onBack} />;
  }

  // 정규 라운드 종료 후 운영자가 재개하기 전까지의 휴식 phase - 화려한
  // 전용 화면을 새로 만들지 않고 기존 제출 완료 대기 화면과 같은 톤을
  // 유지하되, "행사가 마무리되었습니다"(진짜 종료 문구)와는 구분한다.
  // 운영자가 재개하기 전까지는 서버 stage 자체가 바뀌지 않으므로 이
  // 화면에서 "행운의 상대" 화면으로 넘어갈 방법이 없다.
  if (progress.stage === 'round_complete') {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <section className="w-full rounded-[24px] bg-white p-6 text-center shadow-calendar">
            <p className="text-[18px] font-black leading-tight">잠시 쉬어가는 시간이에요</p>
            <p className="mt-3 text-[14px] font-extrabold text-[#888]">곧 다음 안내가 시작됩니다</p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />
      <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
        <section className="w-full rounded-[24px] bg-white p-6 text-center shadow-calendar">
          <p className="text-[18px] font-black leading-tight">행사가 마무리되었습니다</p>
          <p className="mt-3 text-[14px] font-extrabold text-[#888]">잠시만 기다려주세요</p>
        </section>
      </div>
    </div>
  );
}

function ScreenHeader({ onBack, title }: { onBack: () => void; title?: string }) {
  const navigate = useNavigate();
  return (
    <header className="mx-auto flex w-full max-w-[520px] items-center justify-between gap-2 rounded-[20px] bg-white px-2 py-2 shadow-calendar">
      <button aria-label="뒤로가기" className="grid h-10 w-10 shrink-0 place-items-center text-[#333]" onClick={onBack} type="button">
        <BackIcon />
      </button>
      {title ? <h1 className="min-w-0 flex-1 truncate text-center text-[18px] font-black">{title}</h1> : <span className="flex-1" />}
      <button
        className="shrink-0 rounded-[10px] border border-[#e5e5e5] px-3 py-2 text-[13px] font-black text-[#777]"
        onClick={() => navigate('/my-events')}
        type="button"
      >
        나가기
      </button>
    </header>
  );
}

const toastDisplayMs = 2_400;

// Shared by the wait screen (call_staff only) and the conversation screen
// (pause + call_staff) - a toast confirms the request landed, and buttons
// stay enabled the whole time since a participant may need to ask again.
function useHelpRequest(eventId: string, tableNumber: number | undefined) {
  const [sendingType, setSendingType] = useState<'call_staff' | 'pause' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(toastTimerRef.current);
  }, []);

  const sendRequest = async (type: 'call_staff' | 'pause') => {
    if (sendingType) return;
    setSendingType(type);
    setErrorMessage('');
    try {
      await createParticipantPauseRequest(eventId, tableNumber, type);
      window.clearTimeout(toastTimerRef.current);
      setToast('요청이 완료되었습니다');
      toastTimerRef.current = window.setTimeout(() => setToast(''), toastDisplayMs);
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : '요청을 전달하지 못했습니다.');
    } finally {
      setSendingType(null);
    }
  };

  return { errorMessage, sendingType, sendRequest, toast };
}

function ToastBanner({ toast }: { toast: string }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-[14px] bg-[#1f292d] px-4 py-3 text-[13px] font-black text-white shadow-lg">
        <CheckGlyph />
        {toast}
      </div>
    </div>
  );
}

// 체크인 이후 라운드가 시작되기 전까지(자리유도/소개영상/라운드 대기 전
// 구간 전체) 대기 화면 대신 이 컴포넌트 하나가 계속 렌더된다 - stage가
// 바뀌어도 리마운트되지 않으므로 여기서 쓴 값은 phase 전환으로 초기화되지
// 않는다. 제출은 서버(save_event_profile_card_for_session)에 남고,
// 새로고침/재접속 후에도 fetchMyEventProfileCard로 그대로 복원된다.
function EventProfileCardScreen({ eventId, eventTitle, onBack }: { eventId: string; eventTitle: string; onBack: () => void }) {
  const { errorMessage: helpErrorMessage, sendingType, sendRequest, toast } = useHelpRequest(eventId, undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadRetryTick, setLoadRetryTick] = useState(0);
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState<number | null>(null);
  const [job, setJob] = useState('');
  const [height, setHeight] = useState('');
  const [defaultPhotoPath, setDefaultPhotoPath] = useState<string | null>(null);
  const [defaultPhotoCrop, setDefaultPhotoCrop] = useState<RepresentativeCrop | undefined>(undefined);
  const [ownPhotos, setOwnPhotos] = useState<Array<{ path: string; signedUrl: string | null }>>([]);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoCrop, setPhotoCrop] = useState<RepresentativeCrop | undefined>(undefined);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [hobby, setHobby] = useState('');
  const [mbti, setMbti] = useState('');
  const [idealType, setIdealType] = useState('');
  const [contactStyle, setContactStyle] = useState('');
  const [dateStyle, setDateStyle] = useState('');
  const [dateDestination, setDateDestination] = useState('');
  const [smoking, setSmoking] = useState('');
  const [drinkingFrequency, setDrinkingFrequency] = useState('');
  const [drinkingAmount, setDrinkingAmount] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordOptions, setKeywordOptions] = useState<ProfileKeywordOption[]>(PROFILE_KEYWORD_OPTIONS);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(undefined);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 촬영/앨범으로 새 사진을 고른 직후 ~ 업로드가 끝나기 전까지만 쓰는
  // 로컬 blob 미리보기. photoUrl(서버가 확정한 값)과 분리해 둬야 업로드
  // 실패 시 "방금 고른 사진이 반영된 것처럼 보이는데 실제로는 저장 안 됨"
  // 상태 없이 바로 마지막 정상 사진으로 되돌릴 수 있다.
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const cardCaptureRef = useRef<HTMLDivElement>(null);
  const [cardImageSaving, setCardImageSaving] = useState(false);
  const [cardImageSaveError, setCardImageSaveError] = useState('');

  // 대표사진 조정 편집기와 동일한 방식으로, 사진을 새로 고를 때마다
  // 원 안에서 위치/확대를 직접 조정할 수 있게 하는 전체화면 편집기.
  const [cropEditor, setCropEditor] = useState<{ path: string | null; photoUrl: string } | null>(null);
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [cropOffsetY, setCropOffsetY] = useState(0);
  const [cropScale, setCropScale] = useState(1);
  const [cropMinScale, setCropMinScale] = useState(1);
  const cropDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const cropPinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
  const cropActivePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    let active = true;
    void loadProfileKeywordOptions().then((options) => {
      if (active) setKeywordOptions(options);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    fetchMyEventProfileCard(eventId)
      .then((result) => {
        if (!active || !result) return;
        setNickname(result.nickname);
        setAge(result.age);
        setJob(result.job);
        setHeight(result.height);
        setDefaultPhotoPath(result.defaultPhotoPath);
        setDefaultPhotoCrop(result.defaultPhotoCrop);
        setOwnPhotos(result.ownPhotos);
        setPhotoPath(result.photoPath);
        // 행사 전용 사진을 아직 고르지 않았으면(photoPath 없음) 기본
        // 대표사진을 보여주는 것과 마찬가지로 그 대표사진의 crop/zoom/
        // position(scale, offsetX, offsetY 전부 포함된 단일 객체)도 그대로
        // 재현해야 한다 - 카드 전용 photoCrop은 아직 없으므로(null) 여기서
        // defaultPhotoCrop으로 대체하지 않으면 원본이 중앙/무확대로 보인다.
        setPhotoCrop(result.photoPath ? result.photoCrop : result.defaultPhotoCrop);
        setPhotoUrl(result.photoUrl);
        setHobby(result.hobby);
        setMbti(result.mbti);
        setIdealType(result.idealType);
        setContactStyle(result.contactStyle);
        setDateStyle(result.dateStyle);
        setDateDestination(result.dateDestination);
        setSmoking(result.smoking);
        setDrinkingFrequency(result.drinkingFrequency);
        setDrinkingAmount(result.drinkingAmount);
        setKeywords(result.keywords);
        setSubmittedAt(result.submittedAt);
      })
      .catch((caughtError) => {
        if (!active) return;
        setLoadError(caughtError instanceof Error ? caughtError.message : '프로필 카드 정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, loadRetryTick]);

  // 기존에 쓰던 대표사진을 그대로 고르면 원래 crop에서 시작하고, 다른
  // 사진으로 바꾸면 중앙/확대없음 기본값에서 시작한다 - 어느 쪽이든
  // 대표사진 조정 화면과 동일한 전체화면 편집기로 이어져 직접 위치/확대를
  // 조정할 수 있다.
  const cropEditorObjectUrlRef = useRef<string | null>(null);

  const openCropEditor = (path: string | null, url: string, initialCrop: RepresentativeCrop | undefined) => {
    setCropOffsetX(initialCrop?.offsetX ?? 0);
    setCropOffsetY(initialCrop?.offsetY ?? 0);
    setCropScale(initialCrop?.scale ?? 1);
    setCropMinScale(1);
    setCropEditor({ path, photoUrl: url });
  };

  const closeCropEditorCleanup = () => {
    if (cropEditorObjectUrlRef.current) {
      URL.revokeObjectURL(cropEditorObjectUrlRef.current);
      cropEditorObjectUrlRef.current = null;
    }
    setCropEditor(null);
  };

  const selectPhoto = (path: string | null) => {
    setPhotoUploadError('');
    setPhotoPickerOpen(false);
    const effectivePath = path ?? defaultPhotoPath;
    const url = ownPhotos.find((photo) => photo.path === effectivePath)?.signedUrl ?? null;
    if (!url) return;
    const initialCrop = path === null ? defaultPhotoCrop : path === defaultPhotoPath ? defaultPhotoCrop : { offsetX: 0, offsetY: 0, scale: 1 };
    openCropEditor(path, url, initialCrop);
  };

  // 촬영/앨범에서 새로 고른 파일 업로드. 성공 전까지는 photoPath(=실제
  // 제출될 값)를 건드리지 않고 pendingPreviewUrl로만 미리보기를 바꾼다.
  // 업로드가 끝나면 곧장 반영하지 않고 조정 편집기를 연다.
  const handlePhotoFileChosen = async (file: File) => {
    setPhotoPickerOpen(false);
    setPhotoUploadError('');
    const localUrl = URL.createObjectURL(file);
    setPendingPreviewUrl(localUrl);
    setPhotoUploading(true);
    try {
      const result = await uploadEventProfileCardPhoto(eventId, file);
      const finalUrl = result.photoUrl ?? localUrl;
      if (!result.photoUrl) cropEditorObjectUrlRef.current = localUrl;
      openCropEditor(result.photoPath, finalUrl, { offsetX: 0, offsetY: 0, scale: 1 });
    } catch (caughtError) {
      setPhotoUploadError(caughtError instanceof Error ? caughtError.message : '사진 업로드에 실패했습니다.');
    } finally {
      setPhotoUploading(false);
      setPendingPreviewUrl((current) => {
        if (current && current !== cropEditorObjectUrlRef.current) URL.revokeObjectURL(current);
        return null;
      });
    }
  };

  const confirmCropEditor = () => {
    if (!cropEditor) return;
    setPhotoPath(cropEditor.path);
    setPhotoCrop({ offsetX: cropOffsetX, offsetY: cropOffsetY, scale: cropScale });
    setPhotoUrl(cropEditor.photoUrl);
    closeCropEditorCleanup();
  };

  const cancelCropEditor = () => {
    closeCropEditorCleanup();
  };

  const getCropPointerDistance = () => {
    const pointers = Array.from(cropActivePointersRef.current.values());
    if (pointers.length < 2) return 0;
    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  };

  const handleCropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    cropActivePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (cropActivePointersRef.current.size === 2) {
      cropPinchStartRef.current = { distance: getCropPointerDistance(), scale: cropScale };
      cropDragStartRef.current = null;
      return;
    }
    cropDragStartRef.current = { x: event.clientX, y: event.clientY, offsetX: cropOffsetX, offsetY: cropOffsetY };
  };

  const handleCropPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!cropActivePointersRef.current.has(event.pointerId)) return;
    cropActivePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (cropActivePointersRef.current.size >= 2 && cropPinchStartRef.current) {
      const distance = getCropPointerDistance();
      if (cropPinchStartRef.current.distance > 0) {
        const maxScale = Math.max(2.6, cropMinScale + 1.5);
        const nextScale = Math.min(
          maxScale,
          Math.max(cropMinScale, Number((cropPinchStartRef.current.scale * (distance / cropPinchStartRef.current.distance)).toFixed(2))),
        );
        setCropScale(nextScale);
        setCropOffsetX((current) => clampCardCropOffset(current, nextScale));
        setCropOffsetY((current) => clampCardCropOffset(current, nextScale));
      }
      return;
    }
    if (!cropDragStartRef.current) return;
    const boxSize = getCardCropEditorBoxSize();
    setCropOffsetX(clampCardCropOffset(cropDragStartRef.current.offsetX + (event.clientX - cropDragStartRef.current.x) / boxSize, cropScale));
    setCropOffsetY(clampCardCropOffset(cropDragStartRef.current.offsetY + (event.clientY - cropDragStartRef.current.y) / boxSize, cropScale));
  };

  const handleCropPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    cropActivePointersRef.current.delete(event.pointerId);
    cropDragStartRef.current = null;
    cropPinchStartRef.current = null;
  };

  const handleCropWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const maxScale = Math.max(2.6, cropMinScale + 1.5);
    setCropScale((current) => {
      const nextScale = Math.min(maxScale, Math.max(cropMinScale, Number((current + (event.deltaY > 0 ? -0.08 : 0.08)).toFixed(2))));
      setCropOffsetX((currentOffsetX) => clampCardCropOffset(currentOffsetX, nextScale));
      setCropOffsetY((currentOffsetY) => clampCardCropOffset(currentOffsetY, nextScale));
      return nextScale;
    });
  };

  // 어떤 이유로든(구형 브라우저, 캔버스 변환 실패, Web Share 미지원 등)
  // 저장에 실패해도 조용히 에러 텍스트만 보여줄 뿐 화면/행사 진행에는
  // 전혀 영향이 없다.
  const handleSaveCardImage = async () => {
    if (!cardCaptureRef.current || cardImageSaving) return;
    setCardImageSaving(true);
    setCardImageSaveError('');
    try {
      // 화면 진입 시 한 번 발급받은 사진 서명 URL은 10분짜리다
      // (get-my-event-profile-card). 항목이 여러 개라 실제로 다 채우는 데
      // 그보다 오래 걸리면, 화면엔 브라우저 캐시 덕에 여전히 사진이
      // 보이지만 캡처 시점엔 이미 만료된 URL이라 fetch/toPng이 조용히
      // 실패한다(안드로이드/사파리 등 브라우저 종류와 무관하게 동일하게
      // 발생 - 서버 쪽 만료라서 그렇다). 캡처 직전에 항상 최신 서명 URL을
      // 다시 받아 갱신한다 - 행사 전용 사진(photoPath)을 골랐는지와
      // 무관하게(기본 대표사진을 그대로 쓰는 경우도 photoUrl은 마찬가지로
      // 서명 URL이라 똑같이 만료될 수 있다 - 예전엔 photoPath가 있을 때만
      // 갱신해서, 기본 대표사진을 쓰는 참가자는 카드 작성에 시간이 걸리면
      // 사진만 빠진 채로 저장되는 문제가 있었다).
      if (photoUrl) {
        try {
          const fresh = await fetchMyEventProfileCard(eventId);
          if (fresh?.photoUrl) setPhotoUrl(fresh.photoUrl);
        } catch (refreshError) {
          console.debug('[PROFILE_CARD_EXPORT] photo_url_refresh_failed', { message: String(refreshError) });
        }
        // setPhotoUrl은 다음 렌더에서만 <img src>에 반영된다 -
        // waitForImagesToLoad가 새 src를 기다리게 하려면 그 커밋이 먼저
        // 끝나 있어야 한다.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      // 이 앱은 별도 웹폰트를 로드하지 않고 시스템 폰트 스택을 그대로
      // 쓰지만(styles.css의 폰트 스택 참고), 혹시 나중에 웹폰트가 추가돼도
      // 캡처가 안전하도록 폰트 로딩 완료를 한 번 기다려둔다(구형 브라우저는
      // API 자체가 없을 수 있어 optional chaining으로 건너뛴다).
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready.catch(() => undefined);
      }
      // toPng는 캡처 시점에 <img>가 아직 픽셀을 다 그리지 못했으면 그
      // 자리를 그냥 비워버린다 - 사진을 방금 고른 직후처럼 브라우저가
      // 아직 디코딩 중인 상태에서 버튼을 누르면 화면엔 보여도 캡처에는
      // 빠질 수 있다. 캡처 직전에 카드 안의 모든 이미지가 실제로 로드+
      // 디코딩까지 끝났는지 기다린다.
      await waitForImagesToLoad(cardCaptureRef.current);
      console.debug('[PROFILE_CARD_EXPORT] images_ready');
      // cacheBust: true는 html-to-image가 이미지를 다시 받아올 때 URL 끝에
      // ?타임스탬프를 붙여 캐시를 무력화하는 옵션인데, withCaptureSafeImages가
      // 방금 바꿔치기한 <img src>는 blob: URL이라 쿼리스트링이 붙는 순간
      // 존재하지 않는 다른 주소가 돼버려 net::ERR_FILE_NOT_FOUND로 실패한다
      // (실제로 이 조합 때문에 저장이 100% 실패하고 있었다). 캡처 직전마다
      // 매번 새로 만드는 고유 blob: URL을 쓰므로 애초에 캐시 무력화가
      // 필요 없다 - 아예 끈다.
      //
      // 세 겹으로 감싼다: (1) withCaptureSafeImages가 사진을 blob: URL로
      // 바꿔 CORS 자체를 우회하고, (2) withCaptureSafePhoto가 지금 화면에
      // 실제로 보이는 사진(크롭 위치 포함)을 네이티브 canvas로 한 번 구워
      // data: URL 오버레이로 덮어씌우고("사진을 캡처 라이브러리에 맡기지
      // 말고 우리가 직접 그려서 보여준다" - iOS Safari에서 사진만 빈 채로
      // 캡처되는 문제의 근본 원인이 SVG foreignObject 안의 crossOrigin
      // 이미지 래스터화 자체이므로, 그 경로를 아예 타지 않게 한다), (3)
      // withCaptureSafeFormFields가 input/select/textarea를 같은 스타일의
      // 일반 텍스트로 바꿔 네이티브 폼 위젯이 회색 상자로 깨지는 문제를
      // 없앤다. 실패해도 항상 finally에서 원래 DOM으로 복구되므로 화면
      // 자체는 전혀 바뀌지 않는다.
      const dataUrl = await withCaptureSafeImages(cardCaptureRef.current, () =>
        withCaptureSafePhoto(cardCaptureRef.current as HTMLElement, () =>
          withCaptureSafeFormFields(cardCaptureRef.current as HTMLElement, () =>
            toPng(cardCaptureRef.current as HTMLElement, { backgroundColor: '#ffffff', pixelRatio: 2 }),
          ),
        ),
      );
      console.debug('[PROFILE_CARD_EXPORT] capture_done');
      const fileName = `${nickname || '프로필카드'}.png`;

      // iOS/Safari는 <a download>가 이미지 저장으로 이어지지 않는 경우가
      // 많아, Web Share API가 있으면 공유 시트(사진 앱에 저장 포함)를
      // 우선 시도한다. 단, share()는 캡처 과정의 여러 await(이미지 로드
      // 대기, 캔버스 변환, blob 변환)를 거친 뒤 호출되는데, 일부 브라우저는
      // 클릭 시점의 user gesture(활성화 상태)가 그 사이 만료됐다고 보고
      // NotAllowedError로 거부하거나, 공유를 받을 앱이 없어 실패하기도
      // 한다 - 이런 실패까지 전부 "저장 실패"로 끝내지 않고, 사용자가
      // 명시적으로 취소한 것(AbortError)이 아니라면 일반 다운로드로
      // 대체한다.
      const canShareFiles = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
      if (canShareFiles) {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], fileName, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            console.debug('[PROFILE_CARD_EXPORT] share_succeeded');
            return;
          }
          console.debug('[PROFILE_CARD_EXPORT] canShare_false_falling_back_to_download');
        } catch (shareError) {
          if (shareError instanceof Error && shareError.name === 'AbortError') {
            console.debug('[PROFILE_CARD_EXPORT] share_cancelled_by_user');
            return;
          }
          console.debug('[PROFILE_CARD_EXPORT] share_failed_falling_back_to_download', { message: String(shareError) });
        }
      }

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      console.debug('[PROFILE_CARD_EXPORT] download_triggered');
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.name === 'AbortError') return;
      console.debug('[PROFILE_CARD_EXPORT] failed', {
        message: caughtError instanceof Error ? caughtError.message : String(caughtError),
        name: caughtError instanceof Error ? caughtError.name : undefined,
      });
      setCardImageSaveError('프로필 카드를 저장하지 못했습니다.');
    } finally {
      setCardImageSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (saving || photoUploading) return;
    setSaving(true);
    setSaveError('');
    try {
      const result = await saveEventProfileCard(
        eventId,
        { contactStyle, dateDestination, dateStyle, drinkingAmount, drinkingFrequency, hobby, idealType, keywords, mbti, photoCrop, photoPath, smoking },
        true,
      );
      setSubmittedAt(result.submittedAt);
    } catch (caughtError) {
      // 실패해도 hobby/mbti 등 로컬 state는 그대로 남아있다 - 여기서
      // 아무것도 초기화하지 않으므로 작성 중이던 내용은 사라지지 않는다.
      setSaveError(caughtError instanceof Error ? caughtError.message : '프로필 카드 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} title="프로필 카드 작성" />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} title="프로필 카드 작성" />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center px-4 text-center">
          <div>
            <p className="text-[16px] font-black text-meet-pink">{loadError}</p>
            <button
              className="mt-4 rounded-full bg-meet-blue px-6 py-3 text-[14px] font-black text-white"
              onClick={() => setLoadRetryTick((tick) => tick + 1)}
              type="button"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="프로필 카드 작성" />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        <div>
        {/* 이 div가 곧 "프로필카드 저장" 캡처 대상이다 - 카드 디자인(둥근
            모서리/배경/여백/그림자)을 이 요소 자체에 둬서, 저장된 이미지가
            화면에 보이는 카드와 동일하게 나오도록 한다. 예전엔 이 스타일이
            바깥 section에만 있고 캡처 대상은 스타일 없는 안쪽 div였어서,
            저장된 이미지에 둥근 모서리/배경/여백/그림자가 전부 빠진 채로
            나왔다(제출/저장 버튼은 원래도 카드 내용이 아니므로 캡처 대상
            밖으로 그대로 뺀다). */}
        <div className="rounded-[24px] bg-white p-6 text-center shadow-calendar" ref={cardCaptureRef}>
          <div className="relative mx-auto w-fit rounded-full bg-gradient-to-br from-meet-pinkSoft via-white to-meet-blueSoft p-[3px]">
            <ParticipantPhoto
              className="rounded-full bg-[#f5f7fa]"
              crop={pendingPreviewUrl ? { offsetX: 0, offsetY: 0, scale: 1 } : photoCrop}
              fallback={<PersonPlaceholderGlyph />}
              photoUrl={pendingPreviewUrl ?? photoUrl}
              sizePx={120}
            />
            {photoUploading ? (
              <div className="absolute inset-0 grid place-items-center rounded-full bg-black/35">
                <span className="text-[11px] font-black text-white">업로드 중</span>
              </div>
            ) : null}
            <button
              aria-label="대표사진 변경"
              className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full bg-meet-blue text-white shadow-md disabled:opacity-60"
              disabled={photoUploading}
              onClick={() => setPhotoPickerOpen(true)}
              type="button"
            >
              <CameraGlyph />
            </button>
          </div>
          {photoUploadError ? <p className="mt-2 text-[12px] font-bold text-meet-pink">{photoUploadError}</p> : null}
          <p className="text-fluid-safe mt-4 break-keep text-[26px] font-black leading-tight">{nickname}</p>
          <p className="mt-1 text-[14px] font-bold text-[#999]">{[age ? `${age}세` : null, job, formatHeightLabel(height)].filter(Boolean).join(' · ')}</p>

          <div className="mt-6 grid grid-cols-2 gap-3 text-left">
            <CardField label="취미" onChange={setHobby} placeholder="예) 영화 감상, 요가" value={hobby} />
            <CardField label="MBTI" onChange={setMbti} placeholder="예) ENFP" value={mbti} />
            <CardField label="이성을 볼 때 중요한 것" onChange={setIdealType} placeholder="예) 따뜻하고 유머있는 사람" value={idealType} />
            <CardField label="연락스타일" onChange={setContactStyle} placeholder="예) 바쁘면 가끔, 연락은 자주" value={contactStyle} />
            <CardField label="원하는 데이트 스타일" onChange={setDateStyle} placeholder="예) 맛집 탐방, 영화 데이트" value={dateStyle} />
            <CardField label="연인과 함께 가고 싶은 곳" onChange={setDateDestination} placeholder="예) 한강, 바다, 일본여행" value={dateDestination} />
          </div>

          <div className="mt-3 rounded-[16px] bg-white p-3 text-left shadow-sm">
            <p className="text-[12px] font-black text-[#888]">흡연 및 음주</p>
            <input
              className="mt-1.5 h-9 w-full rounded-[10px] bg-[#f7f8fa] px-2.5 text-[13px] font-bold outline-none"
              onChange={(event) => setSmoking(event.target.value)}
              placeholder="예) 비흡연"
              value={smoking}
            />
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <select
                className="h-9 w-full rounded-[10px] bg-[#f7f8fa] px-2 text-[13px] font-bold outline-none"
                onChange={(event) => setDrinkingFrequency(event.target.value)}
                value={drinkingFrequency}
              >
                <option value="">음주 빈도 선택</option>
                {DRINKING_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="h-9 w-full rounded-[10px] bg-[#f7f8fa] px-2 text-[13px] font-bold outline-none"
                onChange={(event) => setDrinkingAmount(event.target.value)}
                value={drinkingAmount}
              >
                <option value="">주량 선택</option>
                {DRINKING_AMOUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 text-left">
            <h2 className="text-[15px] font-black">나를 표현하는 키워드를 선택해주세요</h2>
            <div className="mt-3">
              <ProfileKeywordPicker onChange={setKeywords} options={keywordOptions} selected={keywords} />
            </div>
            {/* 추가라운드 "나를 맞혀봐" 미션이 상대가 고른 개수만큼 진행되므로,
                최소 3개는 있어야 아이스브레이킹으로 의미가 있다 - 최대 개수는
                제한하지 않는다. */}
            {keywords.length < profileKeywordMinCount ? (
              <p className="mt-2 text-[12px] font-bold text-meet-pink">
                특징 키워드를 최소 {profileKeywordMinCount}개 이상 선택해주세요. ({keywords.length}/{profileKeywordMinCount})
              </p>
            ) : null}
          </div>
        </div>

          <div className="text-center">
            {submittedAt ? (
              <p className="mt-5 rounded-[14px] bg-meet-blueSoft px-4 py-3 text-[13px] font-black text-meet-blue">
                제출 완료 · 라운드 시작 전까지 언제든 다시 수정할 수 있어요
              </p>
            ) : null}
            {saveError ? <p className="mt-3 text-[13px] font-bold text-meet-pink">{saveError}</p> : null}

            <button
              className="mt-5 h-14 w-full rounded-[18px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99] disabled:opacity-60"
              disabled={saving || photoUploading || keywords.length < profileKeywordMinCount}
              onClick={() => void handleSubmit()}
              type="button"
            >
              {photoUploading ? '사진 업로드 중' : saving ? '저장하는 중' : submittedAt ? '다시 제출' : '프로필 카드 제출'}
            </button>

            {cardImageSaveError ? <p className="mt-3 text-[13px] font-bold text-meet-pink">{cardImageSaveError}</p> : null}
            <button
              className="mt-3 h-12 w-full rounded-[16px] border border-meet-blue text-[14px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={cardImageSaving}
              onClick={() => void handleSaveCardImage()}
              type="button"
            >
              {cardImageSaving ? '저장하는 중' : '프로필카드 저장'}
            </button>
          </div>
        </div>

        <section className="rounded-[24px] bg-white p-4 shadow-calendar">
          <p className="mb-2 flex items-center gap-2 text-[12px] font-bold text-[#999]">
            <CalendarGlyph />
            {eventTitle}
          </p>
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-meet-blue text-[14px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
            disabled={sendingType === 'call_staff'}
            onClick={() => void sendRequest('call_staff')}
            type="button"
          >
            <HeadsetGlyph />
            운영자 호출
          </button>
          {helpErrorMessage ? <p className="mt-2 text-center text-[12px] font-bold text-[#ef554a]">{helpErrorMessage}</p> : null}
        </section>
      </div>

      {photoPickerOpen ? (
        <PhotoPickerSheet
          defaultPhotoPath={defaultPhotoPath}
          onClose={() => setPhotoPickerOpen(false)}
          onFileChosen={(file) => void handlePhotoFileChosen(file)}
          onSelect={selectPhoto}
          ownPhotos={ownPhotos}
          selectedPath={photoPath ?? defaultPhotoPath}
        />
      ) : null}

      {cropEditor ? (
        <EventCardPhotoCropEditor
          minScale={cropMinScale}
          offsetX={cropOffsetX}
          offsetY={cropOffsetY}
          onCancel={cancelCropEditor}
          onConfirm={confirmCropEditor}
          onImageLoad={(naturalWidth, naturalHeight) => {
            if (!naturalWidth || !naturalHeight) return;
            const aspect = naturalWidth / naturalHeight;
            const minScale = Number((aspect >= 1 ? 1 : 1 / aspect).toFixed(2));
            setCropMinScale(minScale);
            setCropScale((current) => Math.max(current, minScale));
          }}
          onPointerCancel={handleCropPointerUp}
          onPointerDown={handleCropPointerDown}
          onPointerMove={handleCropPointerMove}
          onPointerUp={handleCropPointerUp}
          onReset={() => {
            setCropOffsetX(0);
            setCropOffsetY(0);
            setCropScale(cropMinScale);
          }}
          onWheel={handleCropWheel}
          photoUrl={cropEditor.photoUrl}
          scale={cropScale}
        />
      ) : null}

      <ToastBanner toast={toast} />
    </div>
  );
}

function CardField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="rounded-[16px] bg-white p-3 shadow-sm">
      <p className="text-[11.5px] font-black text-[#9aa0a8]">{label}</p>
      <input
        className="mt-1.5 h-9 w-full rounded-[10px] bg-[#f7f8fa] px-2.5 text-[13px] font-bold text-[#222] outline-none"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

// ProfileFormPage의 대표사진 조정 전체화면 편집기와 동일한 레이아웃/조작
// 방식(드래그로 이동, 핀치/휠로 확대) - 행사 프로필 카드 사진도 신청서
// 대표사진처럼 원 안에서 직접 위치/확대를 조정할 수 있어야 한다는 요청에
// 따라 새로 만들었다.
function EventCardPhotoCropEditor({
  minScale,
  offsetX,
  offsetY,
  onCancel,
  onConfirm,
  onImageLoad,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onReset,
  onWheel,
  photoUrl,
  scale,
}: {
  minScale: number;
  offsetX: number;
  offsetY: number;
  onCancel: () => void;
  onConfirm: () => void;
  onImageLoad: (naturalWidth: number, naturalHeight: number) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onReset: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  photoUrl: string;
  scale: number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080d13] text-white">
      <div className="flex h-[86px] shrink-0 items-center justify-between px-5">
        <button
          aria-label="사진 조정 취소"
          className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/10 text-[34px] font-light leading-none"
          onClick={onCancel}
          type="button"
        >
          ×
        </button>
        <h2 className="text-[20px] font-black">사진 조정</h2>
        <button
          aria-label="사진 조정 완료"
          className="grid h-12 w-12 place-items-center rounded-full bg-meet-blue text-[28px] font-black leading-none"
          onClick={onConfirm}
          type="button"
        >
          ✓
        </button>
      </div>
      <div className="flex shrink-0 justify-center pb-3">
        <button className="rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-[13px] font-extrabold text-white/85" onClick={onReset} type="button">
          초기화
        </button>
      </div>
      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-black"
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <div className="absolute left-1/2 top-1/2 h-[96vw] max-h-[430px] w-[96vw] max-w-[430px] -translate-x-1/2 -translate-y-1/2">
          <img
            alt="사진 조정"
            className="absolute left-1/2 top-1/2 h-full max-w-none select-none"
            draggable={false}
            onLoad={(event) => onImageLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            src={photoUrl}
            style={{ ...representativeCropTransform({ offsetX, offsetY, scale }, getCardCropEditorBoxSize()), touchAction: 'none' }}
          />
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[96vw] max-h-[430px] w-[96vw] max-w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.55)]" />
      </div>
      <p className="shrink-0 py-4 text-center text-[13px] font-bold text-white/60">
        최소 {minScale.toFixed(1)}배 ~ 드래그로 이동, 손가락으로 확대/축소
      </p>
    </div>
  );
}

function PhotoPickerSheet({
  defaultPhotoPath,
  onClose,
  onFileChosen,
  onSelect,
  ownPhotos,
  selectedPath,
}: {
  defaultPhotoPath: string | null;
  onClose: () => void;
  onFileChosen: (file: File) => void;
  onSelect: (path: string | null) => void;
  ownPhotos: Array<{ path: string; signedUrl: string | null }>;
  selectedPath: string | null;
}) {
  const inputsRef = useRef<PhotoSourceInputsHandle>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-[18px] font-black">대표사진 변경</h3>
          <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
            닫기
          </button>
        </div>
        <p className="mt-1 text-[12px] font-bold text-[#999]">이번 행사에서 상대에게 보여줄 사진을 골라주세요</p>

        {ownPhotos.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {ownPhotos.map((photo) => (
              <button
                className={[
                  'relative aspect-square overflow-hidden rounded-[14px] border-2',
                  selectedPath === photo.path ? 'border-meet-blue' : 'border-transparent',
                ].join(' ')}
                key={photo.path}
                onClick={() => onSelect(photo.path)}
                type="button"
              >
                {photo.signedUrl ? <img alt="" className="h-full w-full object-cover" src={photo.signedUrl} /> : <div className="h-full w-full bg-[#f5f7fa]" />}
                {photo.path === defaultPhotoPath ? (
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-black text-white">기본</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 pb-4">
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-meet-blueSoft text-[14px] font-black text-meet-blue"
            onClick={() => inputsRef.current?.openCamera()}
            type="button"
          >
            <CameraGlyph />
            사진 촬영
          </button>
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#f2f4f7] text-[14px] font-black text-[#333]"
            onClick={() => inputsRef.current?.openGallery()}
            type="button"
          >
            앨범에서 선택
          </button>
          <button className="h-12 w-full text-[14px] font-bold text-[#999]" onClick={onClose} type="button">
            취소
          </button>
        </div>

        {/* ProfileFormPage(신청서 작성)의 촬영/앨범 로직과 같은 공용
            컴포넌트 - <input type=file>이라 네이티브 WebView 래퍼 코드가
            필요 없다(이 프로젝트는 순수 웹앱이라 그런 래퍼 자체가 없다). */}
        <PhotoSourceInputs onFiles={(files) => { if (files[0]) onFileChosen(files[0]); }} ref={inputsRef} />
      </div>
    </div>
  );
}

function CameraGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ConversationScreen({
  eventId,
  onBack,
  progress,
}: {
  eventId: string;
  onBack: () => void;
  progress: ParticipantRoundProgress;
}) {
  const { errorMessage, sendingType, sendRequest, toast } = useHelpRequest(eventId, progress.tableNumber);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // 상대가 바뀔 때마다(라운드 변경) null로 리셋한 뒤 새로 불러오므로, 이전
  // 상대의 카드/키워드 하이라이트가 남아있는 일이 없다.
  const [card, setCard] = useState<PartnerEventProfileCard | null>(null);
  const [keywordOptions, setKeywordOptions] = useState<ProfileKeywordOption[]>(PROFILE_KEYWORD_OPTIONS);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;
    void loadProfileKeywordOptions().then((options) => {
      if (active) setKeywordOptions(options);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let retryTimeoutId: number | undefined;
    setCard(null);

    // 일시적인 네트워크 오류/서버 함수 콜드스타트로 첫 조회가 실패하면 한
    // 번 더 시도한다 - 예전에는 조용히 포기해서 상대 카드 전체가 아무
    // 표시 없이 그냥 사라졌었다(다음 라운드가 될 때까지 재시도 자체가
    // 없었음).
    const load = (isRetry: boolean) => {
      void fetchParticipantPartnerPhoto(eventId)
        .then((result) => {
          if (active) setCard(result);
        })
        .catch((caughtError) => {
          if (!active) return;
          if (!isRetry) {
            retryTimeoutId = window.setTimeout(() => load(true), 3_000);
            return;
          }
          console.error('[event-mode] failed to load partner profile card', caughtError);
        });
    };
    load(false);

    return () => {
      active = false;
      if (retryTimeoutId) window.clearTimeout(retryTimeoutId);
    };
  }, [eventId, progress.partnerApplicationId]);

  const phaseDuration = phaseDurationSeconds(progress.roundPhase, progress.isBonusRound, progress.conversationDurationSeconds);
  const elapsedSeconds = computeLiveElapsedSeconds(
    {
      timerPositionSeconds: progress.timerPositionSeconds ?? 0,
      timerStatus: progress.timerStatus ?? 'paused',
      timerUpdatedAt: progress.timerUpdatedAt,
    },
    nowTick + (progress.clockOffsetMs ?? 0),
  );
  const remaining = Math.max(0, phaseDuration - elapsedSeconds);
  // 추가라운드 시작 후 약 5초 뒤부터 "나를 맞혀봐" 미션이 등장한다 - 로컬
  // 타이머가 아니라 서버 타이머 스냅샷 기준 경과 시간이라 새로고침해도
  // 매번 정확히 같은 시점에 나타난다. 일반 라운드에서는 절대 등장하지
  // 않는다(progress.isBonusRound가 false).
  const bonusMissionActive = Boolean(progress.isBonusRound) && elapsedSeconds >= bonusMissionRevealDelaySeconds;

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        <section className="rounded-[24px] bg-white px-6 py-8 text-center shadow-calendar">
          <p className="text-[15px] font-black text-meet-blue">현재 대화 중</p>
          <ParticipantPhoto
            className="mx-auto mt-4 rounded-full bg-[#f5f7fa]"
            crop={card?.representativeCrop}
            fallback={<PersonPlaceholderGlyph />}
            photoUrl={card?.photoUrl}
            sizePx={136}
          />
          <p className="text-fluid-safe mt-4 break-keep text-[clamp(30px,8vw,40px)] font-black leading-none">
            {progress.partnerNickname ?? '상대 확인 중'}
          </p>
          {progress.partnerAge || progress.partnerJob || progress.partnerHeight ? (
            <p className="mt-1.5 text-[15px] font-bold text-[#888]">
              {[progress.partnerAge ? `${progress.partnerAge}세` : null, progress.partnerJob, formatHeightLabel(progress.partnerHeight)]
                .filter(Boolean)
                .join(' / ')}
            </p>
          ) : null}
          {progress.timerUpdatedAt ? (
            <p className="mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-full bg-[#f5f7fa] px-3.5 py-1.5 text-[13px] font-black tabular-nums text-[#666]">
              <ClockGlyph />
              남은 시간 {formatCountdown(remaining)}
            </p>
          ) : null}

          {card ? (
            <PartnerProfileCardDetails
              card={card}
              eventId={eventId}
              // 상대가 바뀌면(라운드 전환) 미션 상태를 완전히 새로 시작해야
              // 하므로 key로 강제 리마운트한다 - 이전 상대의 추측/결과가
              // 새 상대 화면에 잠깐이라도 섞여 보이는 일이 없게 한다.
              key={progress.partnerApplicationId ?? 'no-partner'}
              keywordOptions={keywordOptions}
              missionActive={bonusMissionActive}
            />
          ) : null}
        </section>

        <section className="rounded-[24px] bg-white p-5 shadow-calendar">
          <h2 className="text-[16px] font-black">도움이 필요할 때</h2>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-meet-blueSoft text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'pause'}
              onClick={() => void sendRequest('pause')}
              type="button"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-meet-blue text-white">
                <PauseGlyph />
              </span>
              일시정지 요청
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">운영자에게 일시정지 요청이 전달됩니다</p>
          </div>

          <div className="mt-4 space-y-1.5">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-meet-blue text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'call_staff'}
              onClick={() => void sendRequest('call_staff')}
              type="button"
            >
              <HeadsetGlyph />
              운영자 호출
            </button>
            <p className="text-center text-[12px] font-bold text-[#999]">운영자가 직접 테이블로 와서 도와드립니다</p>
          </div>

          {errorMessage ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{errorMessage}</p> : null}

          <div className="mt-4 flex items-center gap-2 rounded-[16px] bg-[#f5f7fa] px-4 py-3 text-[12px] font-bold text-[#888]">
            <InfoGlyph />
            대화가 끝나면 호감도 작성 및 자리 이동 화면으로 자동 전환됩니다
          </div>
        </section>
      </div>

      <ToastBanner toast={toast} />
    </div>
  );
}

const partnerCardFields: Array<{ key: keyof PartnerEventProfileCard; label: string }> = [
  { key: 'hobby', label: '취미' },
  { key: 'mbti', label: 'MBTI' },
  { key: 'idealType', label: '이성을 볼 때 중요한 것' },
  { key: 'contactStyle', label: '연락스타일' },
  { key: 'dateStyle', label: '원하는 데이트 스타일' },
  { key: 'dateDestination', label: '연인과 함께 가고 싶은 곳' },
  { key: 'smoking', label: '흡연' },
  { key: 'drinking', label: '음주' },
];

// 상대가 프로필 카드를 작성했으면 읽기 전용으로 보여준다 - 아직 작성 전인
// 필드는 빈 값이라 자연히 표시되지 않고, 전체 카드를 아예 안 만들었어도
// (fetchParticipantPartnerPhoto가 항상 빈 문자열/빈 배열을 내려주므로)
// undefined 값이나 오류 없이 조용히 빈 섹션이 된다.
function PartnerProfileCardDetails({
  card,
  eventId,
  keywordOptions,
  missionActive,
}: {
  card: PartnerEventProfileCard;
  eventId: string;
  keywordOptions: ProfileKeywordOption[];
  missionActive: boolean;
}) {
  const filledFields = partnerCardFields.filter((field) => card[field.key]);
  const myKeywordSet = new Set(card.myKeywords);

  if (filledFields.length === 0 && card.keywords.length === 0) return null;

  return (
    <div className="mt-6 border-t border-[#f0f0f0] pt-5 text-left">
      {filledFields.length > 0 ? (
        <div className="grid grid-cols-2 gap-2.5">
          {filledFields.map((field) => (
            <div className="rounded-[14px] bg-[#fafbfc] p-3" key={field.key}>
              <p className="text-[10.5px] font-black text-[#9aa0a8]">{field.label}</p>
              <p className="mt-1 text-[13px] font-bold text-[#333]">{card[field.key] as string}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* 추가라운드에서는(missionActive) 키워드 영역만 "나를 맞혀봐" 미션
          모드로 바뀐다 - 나머지 프로필 정보(사진/닉네임/나이/직업 등)는
          위쪽에서 이미 그대로 유지된다. 일반 라운드에서는 지금까지와
          동일하게 키워드가 그대로 공개된다. */}
      {missionActive ? (
        card.keywords.length > 0 ? <BonusKeywordGuessMission eventId={eventId} /> : null
      ) : card.keywords.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.keywords.map((keyword) => {
            const isCommon = myKeywordSet.has(keyword);
            return (
              <span
                className={[
                  'rounded-full border px-2.5 py-1 text-[12px] font-bold',
                  isCommon ? 'border-meet-pink bg-meet-pinkSoft text-meet-pink' : 'border-[#eee] bg-white text-[#777]',
                ].join(' ')}
                key={keyword}
              >
                {resolveProfileKeywordLabel(keyword, keywordOptions)}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// "나를 맞혀봐" - 상대가 실제로 고른 키워드 수만큼(targetCount) 추측할 수
// 있다. 완료 전에는 서버가 정답 목록을 절대 내려주지 않고(각 선택의
// 정답/오답만) 개별 선택 시 계산해 알려준다 - 완료되는 순간에만 놓친
// 정답(파랑)을 포함한 전체 결과가 함께 내려온다. 결과는 이 컴포넌트가
// 마운트돼 있는 한(=해당 추가라운드가 끝날 때까지) 그대로 유지된다.
function BonusKeywordGuessMission({ eventId }: { eventId: string }) {
  const [state, setState] = useState<BonusKeywordMissionState | null>(null);
  const [pendingKeyword, setPendingKeyword] = useState<string | null>(null);
  const [keywordOptions, setKeywordOptions] = useState<ProfileKeywordOption[]>(PROFILE_KEYWORD_OPTIONS);

  useEffect(() => {
    let active = true;
    void loadProfileKeywordOptions().then((options) => {
      if (active) setKeywordOptions(options);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchBonusKeywordMission(eventId)
      .then((result) => {
        if (active) setState(result);
      })
      .catch((caughtError) => {
        console.error('[bonus-keyword-mission] failed to load mission state', caughtError);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  // active=false면(상대가 이번 라운드 키워드를 아예 고르지 않은 등) 조용히
  // 아무것도 보여주지 않는다 - 별도의 실패/빈 상태 문구를 만들지 않는다
  // (요청 9: 결과 문구/연출 없이 아이스브레이킹으로만 짧게 끝나야 함).
  const guessedMap = useMemo(
    () => new Map((state?.guesses ?? []).map((guess) => [guess.keyword, guess.correct])),
    [state],
  );
  const revealSet = useMemo(() => new Set(state?.revealKeywords ?? []), [state]);
  // 추측 버튼 목록은 관리자가 콘텐츠 관리에서 실시간으로 바꿀 수 있는
  // keywordOptions(live)를 기준으로 하되, 코드 기본값(PROFILE_KEYWORD_
  // OPTIONS)과 실제 정답/이미 고른 키워드에 등장하지만 두 목록 어디에도
  // 없는 키(아주 오래된/비활성화된 키)까지 전부 합쳐 절대 빠지지 않게
  // 한다 - 그래야 상대가 실제로 고른 키워드가 관리자 목록에서 나중에
  // 빠지거나 이름이 바뀌어도 항상 추측 가능하고, 놓친 정답(파랑)도 항상
  // 표시할 수 있다.
  // 상대가 "+ 직접 입력"으로 추가한 custom keyword(정규화된 "#"로 시작하는
  // 자유 문구)는 고정 카탈로그 어디에도 없으므로 항상 별도로, 항상 기본
  // 목록 맨 뒤에 추가한다 - customKeywordOptions는 완료 여부와 무관하게
  // 서버가 항상 내려주는 "이 옵션이 존재한다" 목록일 뿐 정답 여부는
  // 알려주지 않는다(그건 revealKeywords가 완료 후에만 담당).
  const guessableOptions = useMemo(() => {
    const merged = new Map<string, ProfileKeywordOption>();
    for (const option of PROFILE_KEYWORD_OPTIONS) merged.set(option.key, option);
    for (const option of keywordOptions) merged.set(option.key, option);
    // 예전엔 쓰였지만 지금은 카탈로그에서 빠진 고정 키(문구 변경/비활성화)도
    // 놓치지 않는다 - "#"로 시작하는 custom keyword는 아래에서 별도로
    // 다루므로 여기서는 제외한다.
    for (const key of [...guessedMap.keys(), ...revealSet]) {
      if (key.startsWith('#')) continue;
      if (!merged.has(key)) merged.set(key, { key, label: profileKeywordLabel(key) });
    }

    const labelSet = new Set(Array.from(merged.values(), (option) => option.label));
    const customKeys = new Set<string>();
    for (const raw of [...(state?.customKeywordOptions ?? []), ...guessedMap.keys(), ...revealSet]) {
      if (!raw.startsWith('#')) continue;
      const trimmed = raw.trim();
      // 빈 문자열 제외 + 기본 키워드(key 또는 화면에 보이는 label)와
      // 완전히 같은 문구는 중복 표시하지 않는다.
      if (!trimmed || merged.has(trimmed) || labelSet.has(trimmed) || customKeys.has(trimmed)) continue;
      customKeys.add(trimmed);
    }

    return [...merged.values(), ...Array.from(customKeys, (key) => ({ key, label: key }))];
  }, [keywordOptions, guessedMap, revealSet, state?.customKeywordOptions]);

  if (!state || !state.active) return null;

  const handlePick = async (keyword: string) => {
    if (pendingKeyword || guessedMap.has(keyword) || state.completed) return;
    setPendingKeyword(keyword);
    try {
      const result = await submitBonusKeywordGuess(eventId, keyword);
      setState(result);
      playKeywordGuessSound(result.correct ? 'correct' : 'incorrect');
    } catch (caughtError) {
      console.error('[bonus-keyword-mission] guess failed', caughtError);
    } finally {
      setPendingKeyword(null);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-black text-meet-pink">🔮 나를 맞혀봐</p>
        <p className="text-[12.5px] font-black tabular-nums text-[#666]">
          {state.guesses.length} / {state.targetCount}
        </p>
      </div>
      <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-[#999]">
        상대 프로필의 키워드가 모두 비활성화되었어요. 첫 번째 대화를 떠올리며 상대가 선택했던 키워드를 맞혀보세요.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {guessableOptions.map((option) => {
          const wasGuessed = guessedMap.has(option.key);
          const guessedCorrect = guessedMap.get(option.key);
          const isMissedAnswer = state.completed && !wasGuessed && revealSet.has(option.key);
          const colorClassName = wasGuessed
            ? guessedCorrect
              ? 'border-[#3f9142] bg-[#eaf7ea] text-[#2f7a34]'
              : 'border-[#ef554a] bg-[#fdeceb] text-[#d8433a]'
            : isMissedAnswer
              ? 'border-meet-blue bg-meet-blueSoft text-meet-blue'
              : 'border-[#eee] bg-white text-[#999]';
          return (
            <button
              className={`rounded-full border px-2.5 py-1 text-[12px] font-bold transition disabled:active:scale-100 ${colorClassName}`}
              disabled={wasGuessed || state.completed || pendingKeyword !== null}
              key={option.key}
              onClick={() => void handlePick(option.key)}
              type="button"
            >
              {resolveProfileKeywordLabel(option.key, keywordOptions)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 첨부 와이어프레임이 이 화면의 최종 디자인이므로 배치/여백/문구를 그대로
// 재현한다 - 다른 화면들처럼 구조를 재해석하지 않는다.
function BonusMatchingScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="보너스 매칭" />
      <div className="mobile-container mx-auto mt-6 pb-8">
        <section className="rounded-[24px] bg-white px-6 py-10 text-center shadow-calendar">
          <BonusMatchingIllustration />

          <p className="mt-8 text-[24px] font-black leading-tight">
            <span style={{ color: '#1c2541' }}>보너스 대화 </span>
            <span style={{ color: '#ef4d7a' }}>매칭 중</span>
          </p>
          <p className="mt-4 text-[15px] font-bold leading-relaxed" style={{ color: '#4b5468' }}>
            지금까지의 만남을 바탕으로
            <br />
            조금 더 이야기해보고 싶은 상대를 찾고 있어요.
          </p>

          <BonusMatchingDots />

          <p className="mx-auto mt-10 flex w-fit items-center gap-2 rounded-full bg-[#fdeef2] px-4 py-2 text-[13px] font-black text-[#ef4d7a]">
            <ClockGlyph />
            잠시만 기다려주세요
          </p>
        </section>
      </div>
    </div>
  );
}

function BonusMatchingIllustration() {
  return (
    <div className="relative mx-auto h-[230px] w-full max-w-[300px]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(45% 55% at 32% 42%, rgba(130,175,255,0.22), transparent 70%), radial-gradient(45% 55% at 68% 42%, rgba(255,140,175,0.22), transparent 70%)',
        }}
      />

      <SparkleGlyph className="absolute left-[6%] top-[4%] h-6 w-6" color="#8fb3f5" />
      <SparkleGlyph className="absolute right-[10%] top-[9%] h-4 w-4" color="#f39db5" />
      <span className="absolute left-[4%] top-[52%] h-2 w-2 rounded-full bg-[#a9c6f7]" />

      <svg className="absolute inset-0 h-full w-full" fill="none" viewBox="0 0 300 230">
        <path d="M78 128 C95 78 130 62 150 82" stroke="#a9c6f7" strokeDasharray="5 6" strokeLinecap="round" strokeWidth="2" />
        <path d="M150 82 C170 62 205 78 222 128" stroke="#f3aec1" strokeDasharray="5 6" strokeLinecap="round" strokeWidth="2" />
      </svg>

      <div className="absolute bottom-[6%] left-1/2 h-5 w-[62%] -translate-x-1/2 rounded-full bg-black/[0.06] blur-md" />

      <div className="absolute bottom-[10%] left-[7%] z-0 flex h-[68%] w-[38%] -rotate-3 flex-col items-center rounded-[16px] border border-[#dbe7fb] bg-[#f2f6ff] p-2.5 shadow-[0_10px_20px_rgba(120,150,220,0.15)]">
        <span className="relative mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#cddbfa]">
          <PersonSilhouetteGlyph color="#6f96e6" />
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white shadow-sm">
            <TinyHeartGlyph color="#ef7a9a" />
          </span>
        </span>
        <span className="mt-2.5 h-1 w-[70%] rounded-full bg-[#cddbfa]" />
        <span className="mt-1.5 h-1 w-[50%] rounded-full bg-[#dbe7fb]" />
      </div>

      <div className="absolute bottom-[16%] left-1/2 z-10 flex h-[76%] w-[40%] -translate-x-1/2 flex-col items-center justify-center rounded-[18px] border border-[#f4f0f6] bg-white p-2.5 shadow-[0_14px_26px_rgba(200,150,180,0.2)]">
        <HeartGlyph className="h-12 w-12" />
      </div>

      <div className="absolute bottom-[10%] right-[7%] z-0 flex h-[68%] w-[38%] rotate-3 flex-col items-center rounded-[16px] border border-[#fbdde6] bg-[#fff1f5] p-2.5 shadow-[0_10px_20px_rgba(230,150,180,0.15)]">
        <span className="relative mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#fbd0dd]">
          <PersonSilhouetteGlyph color="#ef7a9a" />
          <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white shadow-sm">
            <TinyHeartGlyph color="#ef7a9a" />
          </span>
        </span>
        <span className="mt-2.5 h-1 w-[70%] rounded-full bg-[#fbd0dd]" />
        <span className="mt-1.5 h-1 w-[50%] rounded-full bg-[#fce3ea]" />
      </div>
    </div>
  );
}

function BonusMatchingDots() {
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full bg-[#9db8f0]" style={{ animation: 'bonus-dot-pulse 1.2s ease-in-out infinite' }} />
      <span className="h-2.5 w-2.5 rounded-full bg-[#ef7a9a]" style={{ animation: 'bonus-dot-pulse 1.2s ease-in-out 0.2s infinite' }} />
      <span className="h-2.5 w-2.5 rounded-full bg-[#9db8f0]" style={{ animation: 'bonus-dot-pulse 1.2s ease-in-out 0.4s infinite' }} />
      <style>{`
        @keyframes bonus-dot-pulse {
          0%, 80%, 100% { opacity: 0.35; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// Nickname length has no server-side cap, so font-size is tiered by
// character count rather than assumed short - short nicknames get the big
// wireframe-scale font, long ones shrink and are allowed to wrap onto a
// second line (capped there as a safety net, never overflowing the card).
function nicknameFontStyle(nickname: string): CSSProperties {
  const length = nickname.length;
  const fontSize = length <= 6 ? 'clamp(34px, 11vw, 46px)' : length <= 10 ? 'clamp(26px, 8.5vw, 36px)' : 'clamp(20px, 7vw, 28px)';
  return {
    display: '-webkit-box',
    fontSize,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  };
}

function guidanceFontStyle(text: string): CSSProperties {
  const length = text.length;
  const fontSize = length <= 14 ? 'clamp(19px, 5.6vw, 23px)' : length <= 20 ? 'clamp(16px, 4.8vw, 19px)' : 'clamp(14px, 4.2vw, 16px)';
  return { fontSize };
}

// 첨부 와이어프레임이 이 화면(자리 이동 1분 phase)의 최종 디자인이므로
// 카드 구조/색감/배치를 그대로 재현한다. 남/여 안내 문구만 성별에 따라
// 분기하고, 참가자에게는 숫자 테이블 번호를 절대 노출하지 않는다 -
// event_table_assignments.table_number는 useHelpRequest로 운영자 호출
// 컨텍스트에만 조용히 전달된다.
// 추가시간 통합 1분 phase: 방금 끝난 대화 상대에 대한 호감도/메모/해시태그
// 수정(RatingForm, submitMyBonusRating이 원래 정규 라운드 행을 그대로
// upsert)과, 다음 추가시간이 남아있을 때만 그 상대의 자리 이동 안내를 한
// 화면에서 같이 보여준다. 마지막 추가시간이면(progress.nextPartnerNickname
// 없음) 이동 안내 카드 자체를 숨긴다.
function BonusSeatGuideScreen({
  eventId,
  onBack,
  onCriticalSubmitEnd,
  onCriticalSubmitStart,
  progress,
}: {
  eventId: string;
  onBack: () => void;
  onCriticalSubmitEnd: () => void;
  onCriticalSubmitStart: () => void;
  progress: ParticipantRoundProgress;
}) {
  const [photo, setPhoto] = useState<ParticipantPhotoInfo | null>(null);
  const [nextPhoto, setNextPhoto] = useState<ParticipantPhotoInfo | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [locallySubmitted, setLocallySubmitted] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const { errorMessage: helpErrorMessage, sendingType, sendRequest, toast } = useHelpRequest(eventId, progress.tableNumber);

  // reveal(자리이동 안내 전용, 첫 추가시간 진입 시) 동안에는 호감도를
  // 수정할 대상 자체가 없으므로 폼을 절대 보여주지 않는다. transition
  // (1분, 두 번째 추가시간부터) 동안은 제출 여부에 따라 폼과 "행운의
  // 상대" 리빌을 배타적으로 보여준다 - 서버가 계산해 내려주는
  // hasSubmittedBonusRating이 새로고침에도 살아남는 기준이고,
  // locallySubmitted는 제출 버튼을 누른 즉시 다음 폴링을 기다리지 않고
  // 바로 화면을 넘기기 위한 낙관적 업데이트일 뿐이다.
  const isReveal = progress.roundPhase === 'reveal';
  const showReveal = isReveal || locallySubmitted || Boolean(progress.hasSubmittedBonusRating);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Keyed on partnerApplicationId so a refresh, or landing on a later
  // 추가시간 for a different partner, always re-loads the right person
  // rather than keeping stale state from the previous phase.
  useEffect(() => {
    let active = true;
    setPhoto(null);
    setScore(null);
    setMemo('');
    setAutoSubmitted(false);
    setLocallySubmitted(false);
    setReportModalOpen(false);
    if (isReveal) return undefined;
    void fetchParticipantPartnerPhoto(eventId)
      .then((result) => {
        if (active) setPhoto(result);
      })
      .catch(() => undefined);
    if (!progress.currentRound || !progress.partnerApplicationId) return undefined;
    void fetchMyBonusRating(eventId, progress.currentRound, progress.partnerApplicationId)
      .then((existing) => {
        if (!active) return;
        if (existing.score !== undefined) setScore(existing.score);
        if (existing.memo) setMemo(existing.memo);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId, isReveal, progress.currentRound, progress.partnerApplicationId]);

  useEffect(() => {
    let active = true;
    setNextPhoto(null);
    if (!progress.nextPartnerNickname) return undefined;
    void fetchParticipantPartnerPhoto(eventId, true)
      .then((result) => {
        if (active) setNextPhoto(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId, progress.nextPartnerNickname, progress.nextTableNumber]);

  const isFemale = progress.gender === '여성';
  const nextNickname = progress.nextPartnerNickname;
  const hasNextPartner = Boolean(nextNickname);

  const phaseDuration = phaseDurationSeconds(progress.roundPhase, progress.isBonusRound, progress.conversationDurationSeconds, hasNextPartner);
  const remaining = Math.max(
    0,
    phaseDuration -
      computeLiveElapsedSeconds(
        {
          timerPositionSeconds: progress.timerPositionSeconds ?? 0,
          timerStatus: progress.timerStatus ?? 'paused',
          timerUpdatedAt: progress.timerUpdatedAt,
        },
        nowTick + (progress.clockOffsetMs ?? 0),
      ),
  );

  const handleSubmit = async () => {
    if (score === null || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    // 제출 응답이 오기 전에 poll이 먼저 도착해 "다음 단계로 넘어감"을
    // 받아오면, 방금 누른 제출이 채 끝나기도 전에 화면이 강제로 넘어가
    // 버릴 수 있다(실제 행사에서 발생 확인) - 응답이 올 때까지 poll이
    // 화면을 덮어쓰지 않게 잠깐 막아둔다.
    onCriticalSubmitStart();
    try {
      if (!progress.currentRound || !progress.partnerApplicationId) throw new Error('추가시간 상대 정보를 찾을 수 없습니다.');
      await submitMyBonusRating(eventId, progress.currentRound, progress.partnerApplicationId, score, memo);
      setLocallySubmitted(true);
    } catch (caughtError) {
      setSubmitError(caughtError instanceof Error ? caughtError.message : '저장하지 못했습니다.');
    } finally {
      setSubmitting(false);
      onCriticalSubmitEnd();
    }
  };

  // 1분이 끝나기 전까지 수정하지 않으면 마지막으로 입력한 값을 그대로
  // 저장해둔다(호감도를 아예 고르지 않았다면 0점을 임의로 만들지 않고
  // 그대로 둔다 - 정규 라운드에서 이미 남긴 원래 점수가 유지된다). 이
  // 자동 제출도 handleSubmit과 동일하게 poll을 잠깐 막아둔다 - 오히려
  // 이 경로가 실제 사고 지점에 더 가깝다: 타이머가 딱 끝나는 그 순간은
  // poll도 "이제 다음 단계"라고 판단하기 딱 좋은 순간이라, 자동 제출
  // 요청과 poll이 거의 동시에 서버로 향할 수 있다.
  useEffect(() => {
    if (isReveal || remaining > 0 || autoSubmitted || score === null || submitting) return;
    if (!progress.currentRound || !progress.partnerApplicationId) return;
    setAutoSubmitted(true);
    onCriticalSubmitStart();
    void submitMyBonusRating(eventId, progress.currentRound, progress.partnerApplicationId, score, memo)
      .then(() => setLocallySubmitted(true))
      .catch(() => undefined)
      .finally(() => onCriticalSubmitEnd());
  }, [autoSubmitted, eventId, isReveal, memo, onCriticalSubmitEnd, onCriticalSubmitStart, progress.currentRound, progress.partnerApplicationId, remaining, score, submitting]);

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-5 pb-8">
        {!showReveal ? (
          <RatingForm
            memo={memo}
            onMemoChange={setMemo}
            onScoreChange={setScore}
            onSubmit={() => void handleSubmit()}
            partnerLabel={[
              progress.partnerNickname ?? '상대 확인 중',
              progress.partnerAge ? `${progress.partnerAge}세` : null,
              progress.partnerJob,
              formatHeightLabel(progress.partnerHeight),
            ]
              .filter(Boolean)
              .join(' / ')}
            photo={photo}
            reportButton={
              progress.partnerApplicationId ? (
                <button className="text-[12px] font-bold text-[#aaa] underline" onClick={() => setReportModalOpen(true)} type="button">
                  신고
                </button>
              ) : undefined
            }
            score={score}
            submitError={submitError}
            submitting={submitting}
            title={
              <>
                방금 대화한 분에게
                <br />
                호감도를 수정해보세요 💗
              </>
            }
          />
        ) : hasNextPartner ? (
          <section className="rounded-[24px] bg-white px-6 py-8 text-center shadow-calendar">
            <span className="mx-auto flex w-fit items-center rounded-full bg-meet-blueSoft px-4 py-1.5 text-[13px] font-black text-meet-blue">
              추가시간
            </span>
            <h1 className="mt-4 break-keep text-[22px] font-black leading-tight">다시 만나게 된 행운의 상대</h1>

            <ParticipantPhoto
              className="mx-auto mt-5 rounded-full bg-[#f5f7fa] shadow-[0_10px_24px_rgba(30,43,63,0.12)]"
              crop={nextPhoto?.representativeCrop}
              fallback={<PersonPlaceholderGlyph />}
              photoUrl={nextPhoto?.photoUrl}
              sizePx={140}
            />

            <p className="mx-auto mt-4 max-w-full break-words font-black leading-tight" style={nicknameFontStyle(nextNickname ?? '')}>
              {nextNickname}
            </p>
            <p className="mt-2 text-[15px] font-bold text-[#888]">
              {[progress.nextPartnerAge ? `${progress.nextPartnerAge}세` : null, progress.nextPartnerJob, formatHeightLabel(progress.nextPartnerHeight)]
                .filter(Boolean)
                .join(' | ')}
            </p>

            <div className="mt-5 flex items-center gap-3 rounded-[18px] bg-meet-blueSoft px-4 py-4 text-left">
              <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-meet-blue shadow-sm">
                {isFemale ? <SeatedPersonGlyph /> : <ChairGlyph />}
                {!isFemale ? (
                  <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-meet-blue text-white">
                    <ArrowRightGlyph />
                  </span>
                ) : null}
              </span>
              <p
                className="min-w-0 flex-1 break-keep font-black leading-snug text-[#1c2541]"
                style={guidanceFontStyle(isFemale ? '자리에서 잠시 기다려주세요' : `${nextNickname}님의 테이블로 이동해주세요`)}
              >
                {isFemale ? (
                  '자리에서 잠시 기다려주세요'
                ) : (
                  <>
                    <span className="break-words">{nextNickname}</span>님의 테이블로 이동해주세요
                  </>
                )}
              </p>
            </div>
          </section>
        ) : (
          <section className="rounded-[24px] bg-white px-6 py-10 text-center shadow-calendar">
            <p className="text-[15px] font-black text-meet-blue">제출 완료</p>
            <p className="mt-3 break-keep text-[18px] font-black leading-tight">곧 최종 선택으로 넘어갑니다</p>
          </section>
        )}

        {progress.timerUpdatedAt ? (
          <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-[#888]">
            <ClockGlyph />
            {!showReveal ? '다음 단계까지' : hasNextPartner ? '다음 대화까지' : '최종 선택까지'}{' '}
            <span className="font-black text-meet-blue tabular-nums">{formatCountdown(remaining)}</span>
          </p>
        ) : null}

        <section className="rounded-[24px] bg-white p-5 shadow-calendar">
          <h2 className="text-[16px] font-black">도움이 필요하신가요?</h2>
          <div className="mt-4">
            <button
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] border border-meet-blue text-[16px] font-black text-meet-blue transition active:scale-[0.99] disabled:opacity-60"
              disabled={sendingType === 'call_staff'}
              onClick={() => void sendRequest('call_staff')}
              type="button"
            >
              <HeadsetGlyph />
              운영자 호출
            </button>
          </div>
          {helpErrorMessage ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{helpErrorMessage}</p> : null}
        </section>
      </div>

      {reportModalOpen && progress.partnerApplicationId ? (
        <ReportModal
          eventId={eventId}
          onClose={() => setReportModalOpen(false)}
          reportedApplicationId={progress.partnerApplicationId}
          reportedNickname={progress.partnerNickname}
        />
      ) : null}

      <ToastBanner toast={toast} />
    </div>
  );
}

function SparkleGlyph({ className, color }: { className?: string; color: string }) {
  return (
    <svg aria-hidden="true" className={className} fill={color} viewBox="0 0 24 24">
      <path d="M12 2c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" />
    </svg>
  );
}

function PersonSilhouetteGlyph({ color }: { color: string }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.4" stroke={color} strokeWidth="1.8" />
      <path d="M5 20c1.3-3.8 4-5.6 7-5.6s5.7 1.8 7 5.6" stroke={color} strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function TinyHeartGlyph({ color }: { color: string }) {
  return (
    <svg aria-hidden="true" className="h-2.5 w-2.5" fill={color} viewBox="0 0 24 24">
      <path d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

function HeartGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z"
        fill="#ef7a9a"
        stroke="#ef7a9a"
        strokeWidth="0.5"
      />
    </svg>
  );
}

const ratingMemoMaxLength = 200;

function ratingCopy(score: number): { subtitle: string; title: string } {
  if (score <= 1) return { subtitle: '조금 더 시간을 가져봐도 좋을 것 같아요.', title: '아직은 잘 모르겠어요' };
  if (score <= 2) return { subtitle: '다음에 또 이야기해보고 싶어요.', title: '조금 더 알아가면 좋을 것 같아요' };
  if (score <= 3) return { subtitle: '무난하고 좋은 시간이었어요.', title: '편안한 대화였어요' };
  if (score <= 4) return { subtitle: '다시 만나면 반가울 것 같아요.', title: '좋은 인상을 받았어요!' };
  if (score < 5) return { subtitle: '한 번 더 대화하고 싶은 마음이에요.', title: '한 번 더 대화하고 싶어요!' };
  return { subtitle: '정말 특별한 느낌이었어요.', title: '내가 찾던 사람이에요!' };
}

// Shared by RatingScreen(정규) and BonusSeatGuideScreen(추가시간 통합
// phase) - photo/score/memo/report all render and behave identically in
// both, only the surrounding chrome (timer, "다음 상대" banner, submit-
// then-lock vs always-editable) differs per caller. 상대 평가용 hashtag
// UI("어떤 점이 좋았나요?")는 완전히 제거됐다 - 상대를 표현하는 키워드는
// 이제 EventProfileCardScreen에서 본인이 직접 작성하는 개념으로 대체.
function RatingForm({
  memo,
  onMemoChange,
  onScoreChange,
  onSubmit,
  partnerLabel,
  photo,
  reportButton,
  score,
  submitError,
  submitting,
  title,
}: {
  memo: string;
  onMemoChange: (value: string) => void;
  onScoreChange: (value: number) => void;
  onSubmit: () => void;
  partnerLabel: string;
  photo: ParticipantPhotoInfo | null;
  reportButton?: ReactNode;
  score: number | null;
  submitError: string;
  submitting: boolean;
  title: ReactNode;
}) {
  const copy = score !== null ? ratingCopy(score) : null;

  return (
    <section className="rounded-[24px] bg-white p-5 shadow-calendar">
      <p className="text-center text-[17px] font-black leading-snug">{title}</p>

      <ParticipantPhoto
        className="mt-4 aspect-[4/3] w-full rounded-[20px] bg-[#f5f7fa]"
        crop={photo?.representativeCrop}
        fallback={<PersonPlaceholderGlyph />}
        photoUrl={photo?.photoUrl}
      />

      <div className="mt-3 flex items-center justify-center gap-2">
        <p className="text-center text-[16px] font-black">{partnerLabel}</p>
        {reportButton}
      </div>

      <p className="mt-6 text-center text-[15px] font-black text-[#333]">마음에 드셨나요?</p>
      <HeartRatingInput onChange={onScoreChange} value={score} />
      {score !== null ? (
        <p className="mx-auto mt-1 w-fit rounded-full bg-[#fdeef2] px-3 py-1 text-[13px] font-black text-[#ef4d7a]">{score.toFixed(1)}/5 선택</p>
      ) : null}

      {copy ? (
        <div className="mt-4 rounded-[16px] bg-[#fdeef2] px-4 py-3 text-center">
          <p className="text-[14px] font-black text-[#ef4d7a]">{copy.title}</p>
          <p className="mt-1 text-[12px] font-bold text-[#c77b93]">{copy.subtitle}</p>
        </div>
      ) : null}

      <div className="mt-5">
        <label className="text-[13px] font-black text-[#555]" htmlFor="rating-memo">
          메모
        </label>
        <textarea
          className="mt-1.5 h-20 w-full resize-none rounded-[14px] border border-[#eee] bg-[#f9fafb] p-3 text-[14px] font-bold outline-none"
          id="rating-memo"
          maxLength={ratingMemoMaxLength}
          onChange={(event) => onMemoChange(event.target.value)}
          placeholder="상대방에 대한 메모를 작성해보세요 (선택)"
          value={memo}
        />
        <p className="mt-1 text-right text-[11px] font-bold text-[#aaa]">
          {memo.length}/{ratingMemoMaxLength}
        </p>
      </div>

      {submitError ? <p className="mt-2 text-center text-[12px] font-bold text-[#ef554a]">{submitError}</p> : null}

      <button
        className="mt-2 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        disabled={score === null || submitting}
        onClick={onSubmit}
        type="button"
      >
        {submitting ? '저장 중' : '제출하기'}
      </button>
    </section>
  );
}

const reportReasonOptions = ['부적절한 언행', '무례한 태도', '허위 정보 기재', '기타'];
const reportReasonMaxLength = 200;

// 운영자 호출/일시정지 요청과는 완전히 별개 기능 - 실제로 대화한 상대만
// 신고 가능 여부는 서버(create_participant_report)가 검증한다.
function ReportModal({
  eventId,
  onClose,
  reportedApplicationId,
  reportedNickname,
}: {
  eventId: string;
  onClose: () => void;
  reportedApplicationId: string;
  reportedNickname?: string;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    const finalReason = (reason === '기타' ? customReason : reason)?.trim();
    if (!finalReason) {
      setError('신고 사유를 선택해주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createParticipantReport(eventId, reportedApplicationId, finalReason);
      setDone(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '신고를 접수하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-t-[28px] bg-white p-6" onClick={(event) => event.stopPropagation()}>
        {done ? (
          <>
            <p className="text-center text-[16px] font-black">신고가 접수되었습니다</p>
            <p className="mt-2 text-center text-[13px] font-bold text-[#999]">운영자가 확인 후 처리합니다</p>
            <button
              className="mt-6 h-12 w-full rounded-[14px] bg-meet-blue text-[15px] font-black text-white"
              onClick={onClose}
              type="button"
            >
              닫기
            </button>
          </>
        ) : (
          <>
            <p className="text-[17px] font-black">{reportedNickname ?? '상대방'}님을 신고하시겠어요?</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {reportReasonOptions.map((option) => (
                <button
                  className={`rounded-full border px-3 py-1.5 text-[13px] font-bold transition ${
                    reason === option ? 'border-meet-pink bg-meet-pinkSoft text-meet-pink' : 'border-[#eee] bg-white text-[#777]'
                  }`}
                  key={option}
                  onClick={() => setReason(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            {reason === '기타' ? (
              <textarea
                className="mt-3 h-20 w-full resize-none rounded-[14px] border border-[#eee] bg-[#f9fafb] p-3 text-[13px] font-bold outline-none"
                maxLength={reportReasonMaxLength}
                onChange={(event) => setCustomReason(event.target.value)}
                placeholder="구체적인 사유를 입력해주세요"
                value={customReason}
              />
            ) : null}
            {error ? <p className="mt-2 text-[12px] font-bold text-[#ef554a]">{error}</p> : null}
            <div className="mt-5 flex gap-2">
              <button
                className="h-12 flex-1 rounded-[14px] border border-[#eee] text-[14px] font-black text-[#777]"
                onClick={onClose}
                type="button"
              >
                취소
              </button>
              <button
                className="h-12 flex-1 rounded-[14px] bg-[#ef554a] text-[14px] font-black text-white disabled:opacity-60"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                type="button"
              >
                {submitting ? '접수 중' : '신고하기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 2분 이동 및 호감도 작성 phase: the participant rates the partner they
// were just matched with (progress.roundPhase === 'transition' still
// resolves to that just-finished round's match, since current_round only
// advances once this phase itself expires). Editing is allowed for as long
// as the server still reports this same round as current -
// submit_round_rating enforces that server-side too. (추가시간 쪽은 더 이상
// 이 컴포넌트를 쓰지 않는다 - 통합된 BonusSeatGuideScreen 참고.)
function RatingScreen({ eventId, onBack, progress }: { eventId: string; onBack: () => void; progress: ParticipantRoundProgress }) {
  const roundNumber = progress.currentRound ?? 1;
  const [photo, setPhoto] = useState<ParticipantPhotoInfo | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [reportModalOpen, setReportModalOpen] = useState(false);
  // null while checking the server for an existing submission (avoids
  // flashing the form before immediately swapping to the complete screen).
  const [submitted, setSubmitted] = useState<boolean | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Reloads on (eventId, roundNumber) change - covers first entry, refresh,
  // AND landing back on this phase for a new round without a full page
  // reload in between.
  useEffect(() => {
    let active = true;
    setScore(null);
    setMemo('');
    setPhoto(null);
    setSubmitted(null);
    setReportModalOpen(false);
    void fetchParticipantPartnerPhoto(eventId)
      .then((result) => {
        if (active) setPhoto(result);
      })
      .catch(() => undefined);
    void fetchMyRoundRating(eventId, roundNumber)
      .then((existing) => {
        if (!active) return;
        if (existing.score !== undefined) setScore(existing.score);
        if (existing.memo) setMemo(existing.memo);
        setSubmitted(existing.score !== undefined);
      })
      .catch(() => {
        if (active) setSubmitted(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, roundNumber]);

  const phaseDuration = phaseDurationSeconds('transition');
  const remaining = Math.max(
    0,
    phaseDuration -
      computeLiveElapsedSeconds(
        {
          timerPositionSeconds: progress.timerPositionSeconds ?? 0,
          timerStatus: progress.timerStatus ?? 'paused',
          timerUpdatedAt: progress.timerUpdatedAt,
        },
        nowTick + (progress.clockOffsetMs ?? 0),
      ),
  );

  const handleSubmit = async () => {
    if (score === null || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitRoundRating(eventId, roundNumber, score, memo);
      setSubmitted(true);
    } catch (caughtError) {
      setSubmitError(caughtError instanceof Error ? caughtError.message : '저장하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // 2분이 끝나기 전까지 제출하기를 누르지 않으면 현재까지 입력한 내용을
  // 그대로 자동 저장한다(호감도를 아예 고르지 않았다면 0점을 임의로
  // 만들지 않는다 - 다음 라운드 진행 자체는 서버 stage 전환이 담당하므로
  // 막지 않음).
  // Deliberately not watching `handleSubmit`/`submitting` here (both change
  // every render) - `submitting`'s own check inside handleSubmit already
  // guards against overlapping calls while remaining sits at 0.
  useEffect(() => {
    if (remaining > 0 || submitted !== false || score === null || submitting) return;
    void handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, submitted, score]);

  if (submitted === null) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} title="호감도 작성" />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return <RatingCompleteScreen onBack={onBack} />;
  }

  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="호감도 작성" />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-4 pb-8">
        <RatingForm
          memo={memo}
          onMemoChange={setMemo}
          onScoreChange={setScore}
          onSubmit={() => void handleSubmit()}
          partnerLabel={[
            progress.partnerNickname ?? '상대 확인 중',
            progress.partnerAge ? `${progress.partnerAge}세` : null,
            progress.partnerJob,
            formatHeightLabel(progress.partnerHeight),
          ]
            .filter(Boolean)
            .join(' / ')}
          photo={photo}
          reportButton={
            progress.partnerApplicationId ? (
              <button className="text-[12px] font-bold text-[#aaa] underline" onClick={() => setReportModalOpen(true)} type="button">
                신고
              </button>
            ) : undefined
          }
          score={score}
          submitError={submitError}
          submitting={submitting}
          title={
            <>
              지금 대화를 나눈 분에게
              <br />
              호감도를 남겨주세요 💗
            </>
          }
        />

        {progress.timerUpdatedAt ? (
          <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-[#888]">
            <ClockGlyph />
            다음 라운드 진행까지 <span className="font-black text-meet-blue tabular-nums">{formatCountdown(remaining)}</span>
          </p>
        ) : null}
      </div>

      {reportModalOpen && progress.partnerApplicationId ? (
        <ReportModal
          eventId={eventId}
          onClose={() => setReportModalOpen(false)}
          reportedApplicationId={progress.partnerApplicationId}
          reportedNickname={progress.partnerNickname}
        />
      ) : null}
    </div>
  );
}

// Shown once the server confirms this round's rating is saved. Deliberately
// minimal by design request - no status text, no progress/count of other
// participants, no timer, no buttons - the next-phase transition is handled
// entirely by the outer polling in ParticipantEventScreen re-rendering past
// this component once the server round phase moves on.
function RatingCompleteScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="호감도 작성" />
      <div className="mobile-container mx-auto mt-6 pb-8">
        <section className="rounded-[24px] bg-white px-6 py-14 text-center shadow-calendar">
          <img alt="" className="mx-auto h-[200px] w-[200px] object-contain" src="/assets/rating-complete-heart.png" />
          <p className="mt-6 text-[26px] font-black leading-tight">
            <span style={{ color: '#1c2541' }}>호감도 제출 </span>
            <span style={{ color: '#ef4d7a' }}>완료!</span>
          </p>
          <p className="mt-4 text-[15px] font-bold leading-relaxed" style={{ color: '#4b5468' }}>
            다른 참가자들이 호감도를 작성하는 동안
            <br />
            잠시만 기다려주세요.
          </p>
        </section>
      </div>
    </div>
  );
}

// 최종 선택(5단계: 안내 -> 선택하기 -> 선택 확인 -> 제출 확인 -> 완료).
// stage는 서버가 'final_selection' 하나만 보고하므로, 5단계 중 어디에 있는지는
// 이 컴포넌트 안의 로컬 상태로 관리한다 - 단 "이미 제출했는가"만큼은 절대
// 로컬 상태로 판단하지 않고 매번 서버(get_final_selection_candidates의
// submitted)를 기준으로 삼는다. 그래야 새로고침/뒤로가기/직접 URL 접근 어떤
// 경로로 이 화면에 재진입해도 이미 제출한 사람은 항상 곧바로 완료 화면만
// 보고, 선택을 다시 바꿀 수 없다.
function FinalSelectionScreen({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<FinalSelectionData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [photoMap, setPhotoMap] = useState<Map<string, FinalSelectionCandidateProfile>>(new Map());
  const [step, setStep] = useState<'announce' | 'pick' | 'review'>('announce');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 마음 한 줄 - 최종선택과 완전히 독립된 선택사항(같은 화면의 review
  // step에서 함께 작성하지만, 대상/제출 데이터는 서버에서도 분리 저장).
  const [heartNoteTargetId, setHeartNoteTargetId] = useState<string | null>(null);
  const [heartNoteMessage, setHeartNoteMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | undefined>(undefined);
  // 프로필 상세보기 모달 open/close 상태 - selectedIds/step과 완전히
  // 독립적이라, 프로필을 열었다 닫아도 최종선택 진행 상태는 그대로다.
  const [viewingCandidateId, setViewingCandidateId] = useState<string | null>(null);
  const [keywordOptions, setKeywordOptions] = useState<ProfileKeywordOption[]>(PROFILE_KEYWORD_OPTIONS);

  useEffect(() => {
    let active = true;
    void loadProfileKeywordOptions().then((options) => {
      if (active) setKeywordOptions(options);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchFinalSelectionCandidates(eventId)
      .then((result) => {
        if (!active) return;
        setData(result);
        setSelectedIds(result.selectedApplicationIds);
      })
      .catch((caughtError) => {
        if (active) setLoadError(caughtError instanceof Error ? caughtError.message : '불러오지 못했습니다.');
      });
    void fetchFinalSelectionCandidatePhotos(eventId)
      .then((map) => {
        if (active) setPhotoMap(map);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    return () => window.clearTimeout(toastTimerRef.current);
  }, []);

  if (!data) {
    return (
      <div className="px-4 pt-12 min-[380px]:px-5">
        <ScreenHeader onBack={onBack} />
        <div className="mobile-container mx-auto grid min-h-[calc(100dvh-14rem)] place-items-center">
          <p className="text-[16px] font-black text-[#999]">{loadError || '불러오는 중'}</p>
        </div>
      </div>
    );
  }

  // justSubmitted(방금 이 화면에서 제출)일 때만 후기 안내로 이어간다 -
  // data.submitted만 true인 건 이미 제출된 뒤 다시 들어온 경우(뒤로가기
  // 등)라 매번 후기 안내를 다시 보여주면 불편하므로 기존 완료 화면 그대로.
  if (justSubmitted) {
    return <ReviewPromptScreen eventId={eventId} onSkip={() => navigate('/my-events')} />;
  }
  if (data.submitted) {
    return <FinalSelectionCompleteScreen onGoHome={() => navigate('/my-events')} />;
  }

  const limit = data.finalSelectionLimit;

  const handleToggle = (applicationId: string) => {
    setSelectedIds((current) => {
      if (current.includes(applicationId)) return current.filter((id) => id !== applicationId);
      if (current.length >= limit) {
        window.clearTimeout(toastTimerRef.current);
        setToast(`최대 ${limit}명까지 선택할 수 있어요`);
        toastTimerRef.current = window.setTimeout(() => setToast(''), toastDisplayMs);
        return current;
      }
      return [...current, applicationId];
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitFinalSelection(eventId, selectedIds, heartNoteTargetId, heartNoteMessage);
      setConfirmOpen(false);
      setJustSubmitted(true);
    } catch (caughtError) {
      setSubmitError(caughtError instanceof Error ? caughtError.message : '제출하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'announce') {
    return <FinalSelectionAnnounceScreen limit={limit} onBack={onBack} onStart={() => setStep('pick')} />;
  }

  if (step === 'pick') {
    return (
      <>
        <FinalSelectionPickScreen
          candidates={data.candidates}
          limit={limit}
          onBack={() => setStep('announce')}
          onNext={() => setStep('review')}
          onToggle={handleToggle}
          onViewProfile={setViewingCandidateId}
          photoMap={photoMap}
          selectedIds={selectedIds}
        />
        <ToastBanner toast={toast} />
        {viewingCandidateId ? (
          <FinalSelectionProfileModal
            candidate={data.candidates.find((item) => item.applicationId === viewingCandidateId) ?? null}
            keywordOptions={keywordOptions}
            onClose={() => setViewingCandidateId(null)}
            profile={photoMap.get(viewingCandidateId)}
          />
        ) : null}
      </>
    );
  }

  const selectedCandidates = data.candidates.filter((candidate) => selectedIds.includes(candidate.applicationId));

  return (
    <>
      <FinalSelectionReviewScreen
        candidates={data.candidates}
        heartNoteMessage={heartNoteMessage}
        heartNoteTargetId={heartNoteTargetId}
        onBack={() => setStep('pick')}
        onHeartNoteMessageChange={setHeartNoteMessage}
        onHeartNoteTargetChange={setHeartNoteTargetId}
        onReselect={() => setStep('pick')}
        onSubmitClick={() => setConfirmOpen(true)}
        photoMap={photoMap}
        selectedCandidates={selectedCandidates}
      />
      {confirmOpen ? (
        <FinalSelectionSubmitConfirmModal
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void handleSubmit()}
          submitError={submitError}
          submitting={submitting}
        />
      ) : null}
    </>
  );
}

function FinalSelectionAnnounceScreen({ limit, onBack, onStart }: { limit: number; onBack: () => void; onStart: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} />
      <div className="mobile-container mx-auto mt-6 pb-8">
        <section className="rounded-[24px] bg-white px-6 py-10 text-center shadow-calendar">
          <p className="text-[15px] font-black text-meet-blue">이제 마지막 단계예요!</p>
          <h1 className="mt-3 break-keep text-[26px] font-black leading-tight">
            마음에 드는 분을
            <br />
            최대 {limit}명 선택해주세요
          </h1>

          <div className="mt-8 space-y-4 border-t border-[#f0f0f0] pt-6 text-left">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fdeef2] text-[#ef4d7a]">
                <SmallHeartGlyph />
              </span>
              <p className="mt-1.5 text-[14px] font-extrabold leading-snug text-[#333]">
                추가시간까지 함께한 모든 분 중<br />
                마음에 드는 분을 선택해주세요
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-meet-blueSoft text-meet-blue">
                <PencilGlyph />
              </span>
              <p className="mt-1.5 text-[14px] font-extrabold leading-snug text-[#333]">
                최대 {limit}명까지 선택할 수 있어요
                <br />
                (선택하지 않아도 괜찮아요)
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f5f7fa] text-[#666]">
                <LockGlyph />
              </span>
              <p className="mt-1.5 text-[14px] font-extrabold leading-snug text-[#333]">
                선택 결과는 매칭이 된 상대에게만
                <br />
                공개됩니다.
              </p>
            </div>
          </div>

          <button
            className="mt-8 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
            onClick={onStart}
            type="button"
          >
            선택 시작하기
          </button>
        </section>
      </div>
    </div>
  );
}

function FinalSelectionPickScreen({
  candidates,
  limit,
  onBack,
  onNext,
  onToggle,
  onViewProfile,
  photoMap,
  selectedIds,
}: {
  candidates: FinalSelectionCandidate[];
  limit: number;
  onBack: () => void;
  onNext: () => void;
  onToggle: (applicationId: string) => void;
  onViewProfile: (applicationId: string) => void;
  photoMap: Map<string, FinalSelectionCandidateProfile>;
  selectedIds: string[];
}) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="최종 선택" />

      <div className="mobile-container mx-auto mt-5 flex flex-col gap-3 pb-32">
        <p className="text-center text-[14px] font-bold text-[#888]">
          마음에 드는 분을 선택해주세요
          <br />
          <span className="text-[12px] text-[#aaa]">최대 {limit}명 선택 가능</span>
        </p>

        {candidates.map((candidate) => (
          <FinalSelectionCandidateCard
            candidate={candidate}
            key={candidate.applicationId}
            onToggle={() => onToggle(candidate.applicationId)}
            onViewProfile={() => onViewProfile(candidate.applicationId)}
            photo={photoMap.get(candidate.applicationId)}
            selected={selectedIds.includes(candidate.applicationId)}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-[#f0f0f0] bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 min-[380px]:px-5">
        <div className="mobile-container mx-auto flex items-center gap-3">
          <p className="shrink-0 text-[14px] font-black text-[#333]">
            선택 {selectedIds.length} / {limit}명
          </p>
          <button
            className="h-12 flex-1 rounded-[14px] bg-meet-blue text-[15px] font-black text-white transition active:scale-[0.99]"
            onClick={onNext}
            type="button"
          >
            다음
          </button>
        </div>
      </div>
    </div>
  );
}

function FinalSelectionCandidateCard({
  candidate,
  onToggle,
  onViewProfile,
  photo,
  selected,
}: {
  candidate: FinalSelectionCandidate;
  onToggle: () => void;
  onViewProfile: () => void;
  photo?: FinalSelectionCandidateProfile;
  selected: boolean;
}) {
  return (
    <div className="rounded-[20px] bg-white p-3 shadow-calendar">
      <div className="flex items-start gap-3">
        <button className="shrink-0" onClick={onViewProfile} type="button">
          <ParticipantPhoto
            className="rounded-full bg-[#f5f7fa]"
            crop={photo?.representativeCrop}
            fallback={<PersonPlaceholderGlyph />}
            photoUrl={photo?.photoUrl}
            sizePx={64}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button className="min-w-0 text-left" onClick={onViewProfile} type="button">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-[16px] font-black">{candidate.nickname}</p>
              </div>
              <p className="mt-0.5 text-[13px] font-bold text-[#999]">
                {[candidate.age ? `${candidate.age}세` : null, candidate.job].filter(Boolean).join(' · ')}
              </p>
            </button>

            <button
              aria-label={selected ? '선택 해제' : '선택하기'}
              className={[
                'grid h-9 w-9 shrink-0 place-items-center rounded-full transition active:scale-95',
                selected ? 'bg-[#ef4d7a] text-white' : 'bg-[#f5f7fa] text-[#c3cad1]',
              ].join(' ')}
              onClick={onToggle}
              type="button"
            >
              <HeartToggleGlyph filled={selected} />
            </button>
          </div>

          {candidate.score !== undefined ? (
            <p className="mt-2 flex items-center gap-1 text-[12px] font-black text-[#ef4d7a]">
              <SmallHeartGlyph />
              내 호감도 {candidate.score.toFixed(1)}
            </p>
          ) : null}

          {candidate.memo ? <p className="mt-1.5 line-clamp-2 text-[12px] font-bold leading-snug text-[#888]">{candidate.memo}</p> : null}

          <button className="mt-2 text-[12px] font-black text-meet-blue underline underline-offset-2" onClick={onViewProfile} type="button">
            프로필 보기
          </button>
        </div>
      </div>
    </div>
  );
}

const finalSelectionProfileFields: Array<{ key: keyof FinalSelectionCandidateProfile; label: string }> = [
  { key: 'hobby', label: '취미' },
  { key: 'mbti', label: 'MBTI' },
  { key: 'idealType', label: '이성을 볼 때 중요한 것' },
  { key: 'contactStyle', label: '연락스타일' },
  { key: 'dateStyle', label: '원하는 데이트 스타일' },
  { key: 'dateDestination', label: '연인과 함께 가고 싶은 곳' },
  { key: 'smoking', label: '흡연' },
  { key: 'drinking', label: '음주' },
];

// 최종선택 후보의 행사 프로필카드 상세 - PartnerProfileCardDetails/
// AdminParticipantProfileCardView와 동일한 필드목록+그리드+키워드칩
// 패턴을 그대로 재사용한다. 열고 닫아도 selectedIds/step 등 최종선택
// 진행 상태는 전혀 건드리지 않는(참고용) 모달.
function FinalSelectionProfileModal({
  candidate,
  keywordOptions,
  onClose,
  profile,
}: {
  candidate: FinalSelectionCandidate | null;
  keywordOptions: ProfileKeywordOption[];
  onClose: () => void;
  profile: FinalSelectionCandidateProfile | undefined;
}) {
  const filledFields = profile ? finalSelectionProfileFields.filter((field) => profile[field.key]) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] bg-white pb-[calc(20px+env(safe-area-inset-bottom))]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-[18px] font-black">프로필</h3>
            <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
              닫기
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-4 pt-4 text-center">
          <ParticipantPhoto
            className="mx-auto rounded-full bg-[#f5f7fa]"
            crop={profile?.representativeCrop}
            fallback={<PersonPlaceholderGlyph />}
            photoUrl={profile?.photoUrl}
            sizePx={96}
          />
          <p className="mt-3 text-[20px] font-black">{candidate?.nickname}</p>
          <p className="mt-1 text-[14px] font-bold text-[#999]">
            {[candidate?.age ? `${candidate.age}세` : null, candidate?.job].filter(Boolean).join(' · ')}
          </p>

          {!profile?.hasSubmittedCard ? (
            <p className="mt-6 text-[13px] font-bold text-[#bbb]">아직 행사 프로필 카드를 작성하지 않았어요</p>
          ) : (
            <>
              {filledFields.length > 0 ? (
                <div className="mt-5 grid grid-cols-2 gap-2.5 text-left">
                  {filledFields.map((field) => (
                    <div className="rounded-[14px] bg-[#fafbfc] p-3" key={field.key}>
                      <p className="text-[10.5px] font-black text-[#9aa0a8]">{field.label}</p>
                      <p className="mt-1 text-[13px] font-bold text-[#333]">{profile[field.key] as string}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {profile.keywords.length > 0 ? (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {profile.keywords.map((keyword) => (
                    <span className="rounded-full border border-[#eee] bg-white px-2.5 py-1 text-[12px] font-bold text-[#777]" key={keyword}>
                      {resolveProfileKeywordLabel(keyword, keywordOptions)}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 선택 확인 화면(3번) - 문구는 요청대로 최소화: "최종 선택" 타이틀 하나와
// 선택한 사람 목록뿐, "선택을 완료했어요" 류 설명 문구는 추가하지 않는다.
const heartNoteMaxLength = 200;

function FinalSelectionReviewScreen({
  candidates,
  heartNoteMessage,
  heartNoteTargetId,
  onBack,
  onHeartNoteMessageChange,
  onHeartNoteTargetChange,
  onReselect,
  onSubmitClick,
  photoMap,
  selectedCandidates,
}: {
  candidates: FinalSelectionCandidate[];
  heartNoteMessage: string;
  heartNoteTargetId: string | null;
  onBack: () => void;
  onHeartNoteMessageChange: (value: string) => void;
  onHeartNoteTargetChange: (applicationId: string | null) => void;
  onReselect: () => void;
  onSubmitClick: () => void;
  photoMap: Map<string, FinalSelectionCandidateProfile>;
  selectedCandidates: FinalSelectionCandidate[];
}) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <ScreenHeader onBack={onBack} title="최종 선택" />

      <div className="mobile-container mx-auto mt-6 flex flex-col gap-4 pb-8">
        <section>
          <h2 className="px-1 text-[15px] font-black">내가 선택한 분</h2>
          {selectedCandidates.length === 0 ? (
            <section className="mt-2.5 rounded-[24px] bg-white px-6 py-12 text-center shadow-calendar">
              <p className="text-[15px] font-extrabold text-[#888]">선택한 분이 없어요</p>
            </section>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2.5">
              {selectedCandidates.map((candidate) => (
                <div className="flex items-center gap-3 rounded-[18px] bg-white p-3 shadow-calendar" key={candidate.applicationId}>
                  <ParticipantPhoto
                    className="rounded-full bg-[#f5f7fa]"
                    crop={photoMap.get(candidate.applicationId)?.representativeCrop}
                    fallback={<PersonPlaceholderGlyph />}
                    photoUrl={photoMap.get(candidate.applicationId)?.photoUrl}
                    sizePx={56}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-black">{candidate.nickname}</p>
                    <p className="text-[12px] font-bold text-[#999]">
                      {[candidate.age ? `${candidate.age}세` : null, candidate.job].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <SmallHeartGlyph />
                </div>
              ))}
            </div>
          )}
        </section>

        <HeartNoteSection
          candidates={candidates}
          message={heartNoteMessage}
          onMessageChange={onHeartNoteMessageChange}
          onTargetChange={onHeartNoteTargetChange}
          photoMap={photoMap}
          targetId={heartNoteTargetId}
        />

        <div className="mt-2 flex flex-col gap-2">
          <button
            className="h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
            onClick={onSubmitClick}
            type="button"
          >
            제출하기
          </button>
          <button
            className="h-12 w-full rounded-[16px] border border-[#e5e5e5] text-[14px] font-black text-[#555] transition active:scale-[0.99]"
            onClick={onReselect}
            type="button"
          >
            다시 선택하기
          </button>
        </div>
      </div>
    </div>
  );
}

// 마음 한 줄 - 최종선택과 완전히 독립된 선택 기능. 대상은 한 명만(최종선택
// 대상과 같아도, 달라도 무방), 메시지는 선택사항. 참가자 화면에는 절대
// 다시 노출되지 않고(운영자만 확인) 안내 문구로 그 사실을 명시한다.
//
// 만난 참가자 전원을 처음부터 세로로 나열하면 인원이 많을수록 이 영역이
// 지나치게 길어진다 - "참가자 선택" 버튼으로 목록을 시트에 접어두고,
// 선택한 한 명만 본문에 보여준 뒤(변경하기로 언제든 재선택 가능) 그 아래
// 넓은 메시지 입력창을 배치한다.
function HeartNoteSection({
  candidates,
  message,
  onMessageChange,
  onTargetChange,
  photoMap,
  targetId,
}: {
  candidates: FinalSelectionCandidate[];
  message: string;
  onMessageChange: (value: string) => void;
  onTargetChange: (applicationId: string | null) => void;
  photoMap: Map<string, FinalSelectionCandidateProfile>;
  targetId: string | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedCandidate = candidates.find((candidate) => candidate.applicationId === targetId) ?? null;

  return (
    <section className="rounded-[24px] bg-white p-5 shadow-calendar">
      <div className="flex items-center gap-1.5">
        <SmallHeartGlyph />
        <h2 className="text-[16px] font-black">마음 한 줄 (선택)</h2>
      </div>
      <p className="mt-2 text-[12.5px] font-bold leading-relaxed text-[#888]">
        다시 한번 만나보고 싶은 상대에게 전하고 싶은 말을 남겨주세요.
        <br />
        상대가 승낙하면 호스트가 개인 채팅방을 만들어드려요.
      </p>

      <div className="mt-4">
        {selectedCandidate ? (
          <div className="flex items-center gap-3 rounded-[16px] border border-[#eee] bg-white p-3">
            <ParticipantPhoto
              className="rounded-full bg-[#f5f7fa]"
              crop={photoMap.get(selectedCandidate.applicationId)?.representativeCrop}
              fallback={<PersonPlaceholderGlyph />}
              photoUrl={photoMap.get(selectedCandidate.applicationId)?.photoUrl}
              sizePx={48}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-black">{selectedCandidate.nickname}</p>
              <p className="text-[12px] font-bold text-[#999]">
                {[selectedCandidate.age ? `${selectedCandidate.age}세` : null, selectedCandidate.job].filter(Boolean).join(' · ')}
              </p>
              <button
                className="mt-0.5 text-[12px] font-black text-meet-pink"
                onClick={() => setPickerOpen(true)}
                type="button"
              >
                변경하기 &gt;
              </button>
            </div>
          </div>
        ) : (
          <button
            className="h-12 w-full rounded-[16px] border border-dashed border-meet-pink text-[14px] font-black text-meet-pink transition active:scale-[0.99]"
            onClick={() => setPickerOpen(true)}
            type="button"
          >
            참가자 선택
          </button>
        )}
      </div>

      {selectedCandidate ? (
        <div className="mt-4">
          <textarea
            className="h-40 w-full resize-none rounded-[16px] bg-[#f7f8fa] p-3.5 text-[14px] font-medium leading-relaxed outline-none"
            maxLength={heartNoteMaxLength}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="마음을 전하고 싶은 말을 자유롭게 작성해주세요."
            value={message}
          />
          <p className="mt-1 text-right text-[11px] font-bold text-[#bbb]">
            {message.length} / {heartNoteMaxLength}
          </p>
          <p className="mt-1 text-[11.5px] font-bold text-[#ef8ba3]">연락처, SNS ID 등 개인정보는 남기지 말아주세요.</p>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] font-bold text-[#bbb]">
        마음 한 줄은 참가자에게 바로 공개되지 않고 운영자만 확인해요. 내용을 확인한 뒤 필요한 경우에만 개인 카카오톡으로 전달해드려요.
      </p>

      {pickerOpen ? (
        <HeartNoteTargetPickerSheet
          candidates={candidates}
          onClose={() => setPickerOpen(false)}
          onSelect={(applicationId) => {
            onTargetChange(applicationId);
            setPickerOpen(false);
          }}
          photoMap={photoMap}
          targetId={targetId}
        />
      ) : null}
    </section>
  );
}

// "참가자 선택" 버튼으로 열리는 시트 - 이번 행사에서 만난 이성 참가자
// 목록(candidates, 최종선택 화면과 동일한 목록)에서 한 명을 고르면 즉시
// 선택되고 시트가 닫힌다.
function HeartNoteTargetPickerSheet({
  candidates,
  onClose,
  onSelect,
  photoMap,
  targetId,
}: {
  candidates: FinalSelectionCandidate[];
  onClose: () => void;
  onSelect: (applicationId: string) => void;
  photoMap: Map<string, FinalSelectionCandidateProfile>;
  targetId: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-[18px] font-black">마음을 전할 상대 선택</h3>
          <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {candidates.map((candidate) => {
            const selected = candidate.applicationId === targetId;
            return (
              <button
                className={[
                  'flex items-center gap-3 rounded-[16px] border p-2.5 text-left transition active:scale-[0.99]',
                  selected ? 'border-meet-pink bg-meet-pinkSoft' : 'border-[#eee] bg-white',
                ].join(' ')}
                key={candidate.applicationId}
                onClick={() => onSelect(candidate.applicationId)}
                type="button"
              >
                <ParticipantPhoto
                  className="rounded-full bg-[#f5f7fa]"
                  crop={photoMap.get(candidate.applicationId)?.representativeCrop}
                  fallback={<PersonPlaceholderGlyph />}
                  photoUrl={photoMap.get(candidate.applicationId)?.photoUrl}
                  sizePx={44}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-black">{candidate.nickname}</p>
                  <p className="text-[11px] font-bold text-[#999]">
                    {[candidate.age ? `${candidate.age}세` : null, candidate.job].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span
                  className={[
                    'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[12px] font-black text-white',
                    selected ? 'border-meet-pink bg-meet-pink' : 'border-[#ddd] bg-white',
                  ].join(' ')}
                >
                  {selected ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FinalSelectionSubmitConfirmModal({
  onCancel,
  onConfirm,
  submitError,
  submitting,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  submitError: string;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onCancel}>
      <div
        className="w-full max-w-[520px] rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <h3 className="mt-4 text-center text-[18px] font-black">선택을 제출하시겠어요?</h3>
        <p className="mt-2 text-center text-[13px] font-bold text-[#999]">제출 후에는 수정할 수 없어요.</p>

        {submitError ? <p className="mt-3 text-center text-[12px] font-bold text-[#ef554a]">{submitError}</p> : null}

        <div className="mt-5 flex flex-col gap-2">
          <button
            className="h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99] disabled:opacity-60"
            disabled={submitting}
            onClick={onConfirm}
            type="button"
          >
            {submitting ? '제출하는 중' : '제출하기'}
          </button>
          <button
            className="h-12 w-full rounded-[16px] text-[14px] font-black text-[#999] disabled:opacity-60"
            disabled={submitting}
            onClick={onCancel}
            type="button"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// 완료 화면(5번) - 요청대로 문구/버튼 딱 두 개만: 완료 문구 + 메인화면으로
// 돌아가기. 결과 공개/마이페이지 안내 등은 이번 범위에서 의도적으로 제외.
// 최종선택 제출 직후에만 보여준다("다시 방문"이 아니라 "방금 제출"). "후기
// 작성하기"는 종료 티켓에서도 재사용하는 ReviewFormPage로 이동하고,
// "다음에 작성하기"는 아무 것도 저장/변경하지 않고 그냥 메인으로 간다 -
// 후기를 강제로 작성해야만 나갈 수 있는 느낌이 들면 안 된다는 요청에 따라
// Secondary 버튼은 덜 강조된 text 스타일로 둔다.
function ReviewPromptScreen({ eventId, onSkip }: { eventId: string; onSkip: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <div className="mobile-container mx-auto mt-16 pb-8 text-center">
        <img alt="" className="mx-auto h-[160px] w-[160px] object-contain" src="/assets/rating-complete-heart.png" />
        <p className="mt-8 text-[24px] font-black leading-tight">최종 선택이 완료되었어요!</p>
        <p className="mt-4 text-[15px] font-bold leading-relaxed text-[#666]">
          참여자 여러분들의 후기는 앞으로의 행사와
          <br />
          타임투밋 운영에 큰 힘이 됩니다! 부탁드립니다 💗
        </p>

        <button
          className="mt-10 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
          onClick={() => navigate(`/my-events/ticket/${eventId}/review`)}
          type="button"
        >
          후기 작성하기
        </button>
        <button className="mt-4 text-[14px] font-bold text-[#999] underline underline-offset-2" onClick={onSkip} type="button">
          다음에 작성하기
        </button>
      </div>
    </div>
  );
}

function FinalSelectionCompleteScreen({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="px-4 pt-12 min-[380px]:px-5">
      <div className="mobile-container mx-auto mt-16 pb-8">
        <img alt="" className="mx-auto h-[180px] w-[180px] object-contain" src="/assets/rating-complete-heart.png" />
        <p className="mt-8 text-center text-[24px] font-black leading-tight">최종 선택이 완료되었어요!</p>
        <button
          className="mt-10 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white transition active:scale-[0.99]"
          onClick={onGoHome}
          type="button"
        >
          메인화면으로 돌아가기
        </button>
      </div>
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="m13 7 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <rect height="10" rx="2" stroke="currentColor" strokeWidth="1.8" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function HeartToggleGlyph({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path
        d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
      <rect height="14" rx="1.5" width="4.5" x="6" y="5" />
      <rect height="14" rx="1.5" width="4.5" x="13.5" y="5" />
    </svg>
  );
}

function HeadsetGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 13v-1a8 8 0 1 1 16 0v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <rect height="7" rx="2" width="4" x="3" y="12" stroke="currentColor" strokeWidth="1.8" />
      <rect height="7" rx="2" width="4" x="17" y="12" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19 19v.5a2.5 2.5 0 0 1-2.5 2.5H13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5.5M12 8v.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 12.5 2.5 2.5L16 9.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.2 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <rect height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="5" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ChairGlyph() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M5 10h14l-1 4H6l-1-4Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M6.5 14 6 20M17.5 14l.5 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SmallHeartGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-meet-blue" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 20.5s-7.5-4.6-10-9.2C.4 8 2 4.5 5.4 3.8c2-.4 4 .5 5.1 2.3.4.6.9.6 1.3 0 1.1-1.8 3.1-2.7 5.1-2.3C20.3 4.5 21.9 8 20.4 11.3 17.5 15.9 12 20.5 12 20.5Z" />
    </svg>
  );
}

function ArrowRightGlyph() {
  return (
    <svg aria-hidden="true" className="h-3 w-3" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h13M13 6l7 6-7 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function SeatedPersonGlyph() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 18v-3.5a5 5 0 0 1 10 0V18M6 20h12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PersonPlaceholderGlyph() {
  return (
    <svg aria-hidden="true" className="h-12 w-12" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}
