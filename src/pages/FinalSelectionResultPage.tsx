import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PrimaryButton from '../components/PrimaryButton';
import { fetchMyEventTickets, fetchMyFinalSelectionOutcome, type MyFinalSelectionOutcome } from '../services/supabaseApplications';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([fetchMyEventTickets(), fetchMyFinalSelectionOutcome(eventId)])
      .then(([tickets, outcomeResult]) => {
        if (!active) return;
        const ticket = tickets.find((item) => item.eventId === eventId);
        setEventTitle(ticket?.eventTitle ?? '');
        setNickname(ticket?.nickname ?? '');
        setOutcome(outcomeResult ?? { matchCount: 0, ready: false, receivedCount: 0 });
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
                <p className="mt-2 text-[13px] font-bold leading-relaxed text-[#999]">
                  모든 참가자의 최종선택 제출과 운영자 확인이 끝나면
                  <br />
                  결과를 알려드릴게요.
                </p>
              </section>
            ) : (
              <ResultMessageCard nickname={nickname} outcome={outcome} />
            )}

            <section className="rounded-[20px] bg-meet-pinkSoft px-5 py-5 text-center">
              <p className="text-[14px] font-black leading-relaxed text-meet-pink">
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
      <section className="rounded-[24px] bg-white px-6 py-10 text-center shadow-calendar">
        <p className="text-[40px] leading-none">💕</p>
        <p className="mt-5 text-[16px] font-bold leading-relaxed text-[#333]">
          오늘 <strong className="font-black text-meet-pink">{name}</strong>님은 {outcome.receivedCount}명의 이성분에게 최종선택을
          받으셨으며,
          <br />
          그중 {outcome.matchCount}명의 이성분과 서로 선택해 매칭되었습니다 💕
        </p>
        <p className="mt-5 text-[13.5px] font-bold leading-relaxed text-[#888]">
          곧 호스트가 매칭된 분과 개인 채팅방을 만들어드릴 예정이에요.
          <br />
          즐거운 시간 보내세요 💗
        </p>
      </section>
    );
  }

  if (outcome.receivedCount > 0) {
    return (
      <section className="rounded-[24px] bg-white px-6 py-10 text-center shadow-calendar">
        <p className="text-[40px] leading-none">🌸</p>
        <p className="mt-5 text-[16px] font-bold leading-relaxed text-[#333]">
          오늘 <strong className="font-black text-meet-pink">{name}</strong>님은 {outcome.receivedCount}명의 이성분에게 최종선택을
          받으셨습니다.
        </p>
        <p className="mt-5 text-[13.5px] font-bold leading-relaxed text-[#888]">
          아쉽게도 이번에는 서로의 선택이 이어지지는 않았어요.
          <br />
          오늘 나눈 대화와 시간이 좋은 기억으로 남았길 바랍니다.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[24px] bg-white px-6 py-10 text-center shadow-calendar">
      <p className="text-[40px] leading-none">🍀</p>
      <p className="mt-5 text-[16px] font-bold leading-relaxed text-[#333]">
        오늘 <strong className="font-black text-meet-pink">{name}</strong>님은 아쉽게도 최종선택을 받지 못하셨습니다.
      </p>
      <p className="mt-5 text-[13.5px] font-bold leading-relaxed text-[#888]">
        짧은 시간 안에 서로를 알아가는 자리인 만큼
        <br />
        한 번의 결과가 모든 매력을 보여주는 건 아니에요.
        <br />
        오늘의 만남이 좋은 경험으로 남았길 바랍니다 💗
      </p>
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
