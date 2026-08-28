import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PrimaryButton from '../components/PrimaryButton';
import { fetchMyEventReview, fetchMyEventTickets, saveEventReview } from '../services/supabaseApplications';

const reviewMaxLength = 2000;

// 최종선택 완료 직후 후기 안내 화면(EventModePage의 ReviewPromptScreen)과
// "내 행사" 종료 티켓의 "후기 작성" 버튼, 양쪽에서 재사용하는 후기 작성/
// 수정 화면. 후기는 final_selections와 완전히 분리된 데이터라 여기서
// 무엇을 하든 최종선택 결과에는 영향이 없다.
export default function ReviewFormPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [eventTitle, setEventTitle] = useState('');
  const [content, setContent] = useState('');
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([fetchMyEventReview(eventId), fetchMyEventTickets()])
      .then(([review, tickets]) => {
        if (!active) return;
        setContent(review.content);
        setSubmittedAt(review.submittedAt);
        setEventTitle(tickets.find((ticket) => ticket.eventId === eventId)?.eventTitle ?? '');
      })
      .catch((caughtError) => {
        if (active) setLoadError(caughtError instanceof Error ? caughtError.message : '후기 정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  const handleSubmit = async () => {
    if (!eventId || saving || !content.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const result = await saveEventReview(eventId, content);
      setSubmittedAt(result.submittedAt);
      setJustSaved(true);
    } catch (caughtError) {
      setSaveError(caughtError instanceof Error ? caughtError.message : '후기 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 pt-12 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-10rem)] flex-col gap-6 pb-8">
        <button
          aria-label="뒤로가기"
          className="grid h-10 w-10 place-items-center rounded-full text-[#333] transition active:scale-[0.95]"
          onClick={() => navigate('/my-events')}
          type="button"
        >
          <BackGlyph />
        </button>

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
            <header>
              <h1 className="text-[26px] font-black leading-tight">후기 작성</h1>
              {eventTitle ? <p className="mt-1.5 text-[14px] font-bold text-[#999]">{eventTitle}</p> : null}
            </header>

            <section className="rounded-[24px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
              <textarea
                className="h-56 w-full resize-none rounded-[16px] bg-[#f7f8fa] p-4 text-[15px] font-medium leading-relaxed outline-none"
                maxLength={reviewMaxLength}
                onChange={(event) => setContent(event.target.value)}
                placeholder="오늘 행사는 어떠셨나요? 느끼신 점을 자유롭게 남겨주세요."
                value={content}
              />
              <p className="mt-1.5 text-right text-[12px] font-bold text-[#bbb]">
                {content.length} / {reviewMaxLength}
              </p>

              {submittedAt && !justSaved ? (
                <p className="mt-2 rounded-[14px] bg-meet-blueSoft px-4 py-3 text-[13px] font-black text-meet-blue">
                  이전에 작성한 후기예요 · 언제든 수정할 수 있어요
                </p>
              ) : null}
              {justSaved ? (
                <p className="mt-2 rounded-[14px] bg-meet-pinkSoft px-4 py-3 text-[13px] font-black text-meet-pink">
                  후기가 저장됐어요. 소중한 의견 감사합니다 💗
                </p>
              ) : null}
              {saveError ? <p className="mt-2 text-[13px] font-bold text-meet-pink">{saveError}</p> : null}

              <div className="mt-4">
                <PrimaryButton disabled={saving || !content.trim()} onClick={() => void handleSubmit()}>
                  {saving ? '저장하는 중' : submittedAt ? '후기 수정하기' : '후기 남기기'}
                </PrimaryButton>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function BackGlyph() {
  return (
    <svg fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}
