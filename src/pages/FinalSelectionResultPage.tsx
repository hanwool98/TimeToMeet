import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PrimaryButton from '../components/PrimaryButton';
import {
  acceptHeartNote,
  fetchMyEventTickets,
  fetchMyFinalSelectionOutcome,
  fetchMyReceivedHeartNotes,
  rejectHeartNote,
  type MyFinalSelectionOutcome,
  type MyReceivedHeartNote,
} from '../services/supabaseApplications';

// 내 행사 종료 티켓 "결과 확인" 버튼의 도착 화면. 결과 데이터 자체는 후기
// 작성 여부와 무관하게 행사 종료 시점에 이미 계산/확정되어 있고(서버의
// get_my_final_selection_outcome, events.ended_at 기준) 여기서는 그 값을
// 그대로 보여주기만 한다 - 후기 작성은 이 화면에 "들어올 수 있는지"를
// 결정하는 티켓 버튼 라벨에만 관여했을 뿐 결과 자체와는 무관하다.
// 참가자는 본인 결과만 볼 수 있다(서버가 호출자 본인 수치만 반환).
export default function FinalSelectionResultPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [eventTitle, setEventTitle] = useState('');
  const [nickname, setNickname] = useState('');
  const [outcome, setOutcome] = useState<MyFinalSelectionOutcome | null>(null);
  const [heartNotes, setHeartNotes] = useState<MyReceivedHeartNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([fetchMyEventTickets(), fetchMyFinalSelectionOutcome(eventId), fetchMyReceivedHeartNotes(eventId)])
      .then(([tickets, outcomeResult, heartNoteResult]) => {
        if (!active) return;
        const ticket = tickets.find((item) => item.eventId === eventId);
        setEventTitle(ticket?.eventTitle ?? '');
        setNickname(ticket?.nickname ?? '');
        setOutcome(outcomeResult ?? { matchCount: 0, ready: false, receivedCount: 0 });
        setHeartNotes(heartNoteResult.notes);
      })
      .catch((caughtError) => {
        if (active) setLoadError(caughtError instanceof Error ? caughtError.message : '결과를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  // 버튼은 처리 중(loading) 동안만 즉시 disable한다 - 실제로 표시할
  // response는 절대 "내가 누른 버튼"으로 미리 정하지 않고, 서버 RPC가
  // 반환한 최종 response를 그대로 반영한다. 거의 동시에 수락/거절이
  // 들어온 경우 서버가 먼저 확정된 쪽을 돌려주므로(예: 이미 accepted인
  // 상태에서 거절을 호출해도 응답은 accepted) 화면도 항상 그 값을
  // 따라간다 - DB 안전성을 프론트 낙관적 업데이트에 기대지 않는다.
  const [processingId, setProcessingId] = useState<string | null>(null);

  const applyResponse = (noteId: string, response: MyReceivedHeartNote['response']) => {
    setHeartNotes((current) => current.map((item) => (item.id === noteId ? { ...item, response } : item)));
  };

  const handleAccept = async (note: MyReceivedHeartNote) => {
    if (processingId) return;
    setProcessingId(note.id);
    try {
      const result = await acceptHeartNote(note.id);
      applyResponse(note.id, result.response as MyReceivedHeartNote['response']);
      if (result.matched && eventId) {
        // 새 매칭이 생겼을 수 있으니 매칭 인원 수를 다시 불러온다.
        void fetchMyFinalSelectionOutcome(eventId).then((next) => next && setOutcome(next));
      }
    } catch {
      // 실패 시 response는 건드리지 않는다(여전히 null이면 버튼이 그대로
      // 남아 재시도할 수 있다).
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (note: MyReceivedHeartNote) => {
    if (processingId) return;
    setProcessingId(note.id);
    try {
      const result = await rejectHeartNote(note.id);
      applyResponse(note.id, result.response as MyReceivedHeartNote['response']);
    } catch {
      // 실패 시 response는 건드리지 않는다(여전히 null이면 버튼이 그대로
      // 남아 재시도할 수 있다).
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 pt-6 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-6rem)] flex-col gap-5 pb-8">
        <header className="relative grid h-12 place-items-center border-b border-[#f1f1f1]">
          <button
            aria-label="뒤로가기"
            className="absolute left-0 grid h-10 w-10 place-items-center rounded-full text-[#333] transition active:scale-[0.95]"
            onClick={() => navigate('/my-events')}
            type="button"
          >
            <BackGlyph />
          </button>
          <h1 className="text-[18px] font-black">결과 확인</h1>
        </header>

        {loading ? (
          <div className="grid min-h-[calc(100dvh-16rem)] place-items-center">
            <p className="text-[16px] font-black text-[#999]">불러오는 중</p>
          </div>
        ) : loadError ? (
          <div className="grid min-h-[calc(100dvh-16rem)] place-items-center text-center">
            <p className="text-[15px] font-bold text-meet-pink">{loadError}</p>
          </div>
        ) : (
          <>
            {eventTitle ? <p className="-mt-2 text-center text-[13px] font-bold text-[#999]">{eventTitle}</p> : null}

            {!outcome?.ready ? (
              <section className="rounded-[24px] bg-white px-6 py-14 text-center shadow-calendar">
                <img alt="" className="mx-auto h-[120px] w-[120px] object-contain" src="/assets/rating-complete-heart.png" />
                <p className="mt-6 text-[17px] font-black leading-relaxed">아직 결과가 준비되지 않았어요</p>
                <p className="mt-2 break-keep text-[13px] font-bold leading-relaxed text-[#999]">
                  모든 참가자의 최종선택 제출과 운영자 확인이 끝나면 결과를 알려드릴게요.
                </p>
              </section>
            ) : (
              <>
                <ResultMessageCard nickname={nickname} outcome={outcome} />
                {heartNotes.length > 0 ? (
                  <HeartNoteSection
                    notes={heartNotes}
                    onAccept={(note) => void handleAccept(note)}
                    onReject={(note) => void handleReject(note)}
                    processingId={processingId}
                  />
                ) : null}
              </>
            )}

            <section className="rounded-[20px] bg-meet-pinkSoft px-5 py-5 text-center">
              <p className="break-keep text-[14px] font-black leading-relaxed text-meet-pink">
                다음 만남도 타임투밋과 함께해요 💗
                <br />
                재참가 시 5,000원 할인 혜택을 드려요.
              </p>
            </section>

            <PrimaryButton onClick={() => navigate('/my-events')}>내 행사로 돌아가기</PrimaryButton>
          </>
        )}
      </div>
    </main>
  );
}

function ResultMessageCard({ nickname, outcome }: { nickname: string; outcome: MyFinalSelectionOutcome }) {
  const name = nickname || '참가자';

  if (outcome.receivedCount > 0 && outcome.matchCount > 0) {
    return (
      <section className="rounded-[24px] bg-white px-5 py-10 text-center shadow-calendar">
        <p className="text-[40px] leading-none">💕</p>
        <p className="mt-5 break-keep text-[15px] font-bold leading-relaxed text-[#333]">
          오늘 <strong className="font-black text-meet-pink">{name}</strong>님은 {outcome.receivedCount}명의 이성분에게 최종선택을
          받으셨으며,
          <br />
          그중 {outcome.matchCount}명의 이성분과 서로 선택해 매칭되었습니다 💕
        </p>
        <p className="mt-5 break-keep text-[13.5px] font-bold leading-relaxed text-[#888]">
          곧 호스트가 매칭된 분과 개인 채팅방을 만들어드릴 예정이에요. 즐거운 시간 보내세요 💗
        </p>
      </section>
    );
  }

  if (outcome.receivedCount > 0) {
    return (
      <section className="rounded-[24px] bg-white px-5 py-10 text-center shadow-calendar">
        <p className="text-[40px] leading-none">🌸</p>
        <p className="mt-5 break-keep text-[15px] font-bold leading-relaxed text-[#333]">
          오늘 <strong className="font-black text-meet-pink">{name}</strong>님은 {outcome.receivedCount}명의 이성분에게 최종선택을
          받으셨습니다.
        </p>
        <p className="mt-5 break-keep text-[13.5px] font-bold leading-relaxed text-[#888]">
          아쉽게도 이번에는 서로의 선택이 이어지지는 않았어요. 오늘 나눈 대화와 시간이 좋은 기억으로 남았길 바랍니다.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[24px] bg-white px-5 py-10 text-center shadow-calendar">
      <p className="text-[40px] leading-none">🍀</p>
      <p className="mt-5 break-keep text-[15px] font-bold leading-relaxed text-[#333]">
        오늘 <strong className="font-black text-meet-pink">{name}</strong>님은 아쉽게도 최종선택을 받지 못하셨습니다.
      </p>
      <p className="mt-5 break-keep text-[13.5px] font-bold leading-relaxed text-[#888]">
        짧은 시간 안에 서로를 알아가는 자리인 만큼 한 번의 결과가 모든 매력을 보여주는 건 아니에요.
        <br />
        오늘의 만남이 좋은 경험으로 남았길 바랍니다 💗
      </p>
    </section>
  );
}

// "받은 마음 한 줄" - 아직 응답하지 않은 항목만 수락/거절 버튼을 보여주고,
// 응답한 항목은 처리 완료 상태 문구로 대체한다. 수락/거절 모두 서버가
// idempotent하게 처리하므로 여기서는 버튼 disable로 중복 클릭만 막는다.
function HeartNoteSection({
  notes,
  onAccept,
  onReject,
  processingId,
}: {
  notes: MyReceivedHeartNote[];
  onAccept: (note: MyReceivedHeartNote) => void;
  onReject: (note: MyReceivedHeartNote) => void;
  processingId: string | null;
}) {
  return (
    <section className="rounded-[24px] bg-white px-5 py-6 shadow-calendar">
      <h2 className="text-[16px] font-black">받은 마음 한 줄 💌</h2>
      <p className="mt-1 text-[12px] font-bold text-[#999]">누군가 회원님에게 마음을 전했어요. 수락하면 서로 매칭됩니다.</p>
      <div className="mt-4 flex flex-col gap-3">
        {notes.map((note) => (
          <div className="rounded-[16px] border border-[#f0d9e2] bg-[#fff8fa] px-4 py-3.5" key={note.id}>
            <p className="text-[13px] font-black text-meet-pink">{note.senderNickname}</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] font-bold leading-relaxed text-[#333]">
              {note.message ? `"${note.message}"` : '(메시지 없음)'}
            </p>
            {note.response == null ? (
              <div className="mt-3 flex gap-2">
                <button
                  className="h-10 flex-1 rounded-[12px] bg-meet-pink text-[13px] font-black text-white transition active:scale-[0.98] disabled:opacity-50"
                  disabled={processingId === note.id}
                  onClick={() => onAccept(note)}
                  type="button"
                >
                  수락
                </button>
                <button
                  className="h-10 flex-1 rounded-[12px] bg-[#eee] text-[13px] font-black text-[#666] transition active:scale-[0.98] disabled:opacity-50"
                  disabled={processingId === note.id}
                  onClick={() => onReject(note)}
                  type="button"
                >
                  거절
                </button>
              </div>
            ) : (
              <p className={`mt-3 text-[12.5px] font-black ${note.response === 'accepted' ? 'text-meet-pink' : 'text-[#999]'}`}>
                {note.response === 'accepted' ? '수락했어요 💕' : '거절했어요'}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function BackGlyph() {
  return (
    <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}
