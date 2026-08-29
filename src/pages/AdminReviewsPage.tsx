import { useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import ParticipantPhoto from '../components/ParticipantPhoto';
import { fetchAdminEventReviews, type AdminEventReview } from '../services/supabaseApplications';

// 콘텐츠 관리 > 후기 관리. AdminProfileKeywordsPage/AdminConversationTopicsPage와
// 동일한 목록+필터 스타일을 재사용한다(읽기 전용 + 이미지 저장만, CRUD 아님).
export default function AdminReviewsPage() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<AdminEventReview[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState<string>('전체');
  const [imageTarget, setImageTarget] = useState<AdminEventReview | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setReviews(await fetchAdminEventReviews());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '후기를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const eventOptions = useMemo(() => {
    if (!reviews) return [];
    const seen = new Map<string, string>();
    for (const review of reviews) seen.set(review.eventId, review.eventTitle);
    return Array.from(seen.entries()).map(([eventId, eventTitle]) => ({ eventId, eventTitle }));
  }, [reviews]);

  const filtered = useMemo(() => {
    if (!reviews) return [];
    if (eventFilter === '전체') return reviews;
    return reviews.filter((review) => review.eventId === eventFilter);
  }, [reviews, eventFilter]);

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-8 pt-4 min-[390px]:px-5">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[22px] font-black">후기 관리</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/content')} type="button">
            ← 콘텐츠 관리
          </button>
        </div>

        {loading ? (
          <DataLoadingState />
        ) : error ? (
          <DataErrorState message={error} onRetry={load} />
        ) : (
          <div className="mt-4">
            <p className="text-[13px] font-extrabold text-[#8a8a8a]">참가자가 작성한 모든 후기입니다 · 총 {reviews?.length ?? 0}개</p>

            {eventOptions.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {['전체', ...eventOptions.map((option) => option.eventId)].map((eventId) => {
                  const label = eventId === '전체' ? '전체' : eventOptions.find((option) => option.eventId === eventId)?.eventTitle ?? eventId;
                  return (
                    <button
                      className={[
                        'rounded-[10px] px-3 py-1.5 text-[12px] font-black transition',
                        eventFilter === eventId ? 'bg-meet-pink text-white' : 'bg-meet-pinkSoft text-meet-pink',
                      ].join(' ')}
                      key={eventId}
                      onClick={() => setEventFilter(eventId)}
                      type="button"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-4 space-y-2.5 pb-6">
              {filtered.map((review) => (
                <article className="rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm" key={review.applicationId}>
                  <div className="flex items-start gap-3">
                    <ParticipantPhoto className="shrink-0 rounded-full bg-[#f5f7fa]" photoUrl={review.photoUrl} sizePx={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <p className="truncate text-[14px] font-black">{review.nickname}</p>
                        <p className="text-[12px] font-bold text-[#999]">
                          {[review.age ? `${review.age}세` : null, review.job].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-[8px] bg-meet-blueSoft px-2 py-0.5 text-[11px] font-black text-meet-blue">{review.eventTitle}</span>
                        <span className="text-[11px] font-bold text-[#bbb]">{formatReviewDate(review.submittedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-[13.5px] font-bold leading-relaxed text-[#333]">{review.content}</p>
                  {review.images.length > 0 ? (
                    <div className="mt-3 flex gap-2 overflow-x-auto">
                      {review.images.map((url, index) => (
                        <button
                          className="h-20 w-20 shrink-0 overflow-hidden rounded-[12px] bg-[#f5f7fa]"
                          key={url}
                          onClick={() => setLightboxUrl(url)}
                          type="button"
                        >
                          <img alt={`첨부 사진 ${index + 1}`} className="h-full w-full object-cover" src={url} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2.5 flex justify-end">
                    <button className="text-[12px] font-black text-meet-blue" onClick={() => setImageTarget(review)} type="button">
                      이미지 저장
                    </button>
                  </div>
                </article>
              ))}
              {filtered.length === 0 ? <p className="pt-6 text-center text-[13px] font-bold text-[#999]">등록된 후기가 없습니다.</p> : null}
            </div>
          </div>
        )}
      </div>

      {imageTarget ? <ReviewImageExportModal onClose={() => setImageTarget(null)} review={imageTarget} /> : null}
      {lightboxUrl ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={() => setLightboxUrl(null)}>
          <img alt="" className="max-h-full max-w-full rounded-[12px] object-contain" src={lightboxUrl} />
        </div>
      ) : null}
    </main>
  );
}

function formatReviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

// 저장되는 이미지에는 닉네임/나이/후기 내용만 들어간다 - 사진/직업/행사명은
// 관리자 화면에는 보여도 저장 이미지에는 절대 포함하지 않는다(요청 그대로).
// 텍스트만 있는 카드라 이전 프로필카드 PNG 문제(html-to-image가 서명 URL
// 이미지를 다시 fetch하다 실패)가 구조적으로 발생하지 않는다 - 외부 이미지가
// 전혀 없으므로 waitForImagesToLoad류의 대응이 필요 없고, 한글 웹폰트
// 로딩만 기다리면 된다.
function ReviewImageExportModal({ onClose, review }: { onClose: () => void; review: AdminEventReview }) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSave = async () => {
    if (!captureRef.current || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const dataUrl = await toPng(captureRef.current, { backgroundColor: '#ffffff', cacheBust: true, pixelRatio: 2 });
      const fileName = `${review.nickname || '후기'}-후기.png`;

      const canShareFiles = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
      if (canShareFiles) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      }

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.name === 'AbortError') return;
      setSaveError('이미지를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5" onClick={onClose}>
      <div className="w-full max-w-[420px]" onClick={(event) => event.stopPropagation()}>
        <div
          className="mx-auto w-full max-w-[420px] rounded-[24px] border border-[#f5e3ea] bg-white p-7 shadow-calendar"
          ref={captureRef}
        >
          <div className="flex items-baseline gap-2">
            <p className="text-[18px] font-black text-black">{review.nickname}</p>
            {review.age ? <p className="text-[13px] font-bold text-[#aaa]">{review.age}세</p> : null}
          </div>
          <p className="mt-4 whitespace-pre-wrap break-keep text-[17px] font-bold leading-[1.6] text-[#333]">{review.content}</p>
          <div className="mt-6 flex items-center gap-1.5 text-[11px] font-black tracking-wide text-meet-pink/70">
            <span className="h-1.5 w-1.5 rounded-full bg-meet-pink" />
            time 2 meet
          </div>
        </div>

        <div className="mt-4 rounded-[18px] bg-white p-3 text-center">
          {saveError ? <p className="mb-2 text-[13px] font-bold text-meet-pink">{saveError}</p> : null}
          <div className="flex gap-2">
            <button className="h-12 flex-1 rounded-[14px] bg-[#eee] text-[14px] font-black text-black" onClick={onClose} type="button">
              닫기
            </button>
            <button
              className="h-12 flex-1 rounded-[14px] bg-meet-blue text-[14px] font-black text-white disabled:opacity-60"
              disabled={saving}
              onClick={() => void handleSave()}
              type="button"
            >
              {saving ? '저장하는 중' : '이미지로 저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
