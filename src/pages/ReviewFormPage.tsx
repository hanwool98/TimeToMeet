import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PhotoSourceInputs, { type PhotoSourceInputsHandle } from '../components/PhotoSourceInputs';
import PrimaryButton from '../components/PrimaryButton';
import { fetchMyEventReview, fetchMyEventTickets, saveEventReview, uploadEventReviewPhoto } from '../services/supabaseApplications';

const reviewMaxLength = 2000;
const maxReviewImages = 3;

// 후기 사진 슬롯 - 기존에 저장된 사진(existingPath)과 이번에 새로 고른
// 파일(file)을 같은 배열로 다룬다. 실제 업로드는 제출(handleSubmit) 시점
// 에만 일어나므로("다음에 작성하기"는 이 화면 진입 전이라 애초에 사진을
// 고를 수 없고, 이 화면에서 사진만 고르고 그냥 나가도 업로드가 전혀
// 일어나지 않아 Storage에 아무것도 안 남는다), previewUrl은 새 파일이면
// object URL, 기존 사진이면 서명 URL을 그대로 쓴다.
interface ReviewImageSlot {
  existingPath?: string;
  file?: File;
  key: string;
  previewUrl: string;
}

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
  const [images, setImages] = useState<ReviewImageSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const photoInputsRef = useRef<PhotoSourceInputsHandle>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

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
        setImages(
          review.images.map((image, index) => ({
            existingPath: image.path,
            key: `existing-${index}-${image.path}`,
            previewUrl: image.url ?? '',
          })),
        );
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

  // 새로 고른 파일의 object URL은 이 화면을 벗어날 때 반드시 정리한다.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleFilesChosen = (files: File[]) => {
    const remainingSlots = maxReviewImages - images.length;
    if (remainingSlots <= 0 || files.length === 0) return;
    const nextSlots = files.slice(0, remainingSlots).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      return { file, key: `new-${Date.now()}-${Math.random()}`, previewUrl };
    });
    setImages((current) => [...current, ...nextSlots]);
  };

  const removeImage = (key: string) => {
    setImages((current) => {
      const target = current.find((image) => image.key === key);
      if (target && !target.existingPath && objectUrlsRef.current.has(target.previewUrl)) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      return current.filter((image) => image.key !== key);
    });
  };

  const handleSubmit = async () => {
    if (!eventId || saving || !content.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      // 실제 Storage 업로드는 여기, 제출 버튼을 눌렀을 때만 일어난다 -
      // 새로 고른 파일만 업로드하고 기존에 이미 저장돼 있던 사진은 경로를
      // 그대로 재사용한다(다시 업로드하지 않음).
      const finalPaths = await Promise.all(
        images.map(async (image) => {
          if (image.existingPath) return image.existingPath;
          const uploaded = await uploadEventReviewPhoto(eventId, image.file as File);
          return uploaded.photoPath;
        }),
      );
      const result = await saveEventReview(eventId, content, finalPaths);
      setSubmittedAt(result.submittedAt);
      setJustSaved(true);
    } catch (caughtError) {
      setSaveError(caughtError instanceof Error ? caughtError.message : '후기 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const canAddMore = images.length < maxReviewImages;

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
          <h1 className="text-[18px] font-black">후기 작성</h1>
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

              <div className="mt-5">
                <p className="text-[13px] font-black text-[#666]">사진 추가 (선택)</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {images.map((image) => (
                    <div className="relative aspect-square overflow-hidden rounded-[14px] bg-[#f5f7fa]" key={image.key}>
                      {image.previewUrl ? (
                        <img alt="" className="h-full w-full object-cover" src={image.previewUrl} />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-[11px] font-bold text-[#bbb]">사진</div>
                      )}
                      <button
                        aria-label="사진 삭제"
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white"
                        onClick={() => removeImage(image.key)}
                        type="button"
                      >
                        <CloseGlyph />
                      </button>
                    </div>
                  ))}
                  {canAddMore ? (
                    <button
                      className="grid aspect-square place-items-center rounded-[14px] border border-dashed border-[#ddd] bg-white text-[#aaa] transition active:scale-[0.97]"
                      onClick={() => photoInputsRef.current?.openGallery()}
                      type="button"
                    >
                      <PlusGlyph />
                    </button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[11px] font-bold text-[#bbb]">최대 {maxReviewImages}장까지 첨부할 수 있어요</p>
                <PhotoSourceInputs multiple onFiles={handleFilesChosen} ref={photoInputsRef} />
              </div>

              {submittedAt && !justSaved ? (
                <p className="mt-5 rounded-[14px] bg-meet-blueSoft px-4 py-3 text-[13px] font-black text-meet-blue">
                  이전에 작성한 후기예요 · 언제든 수정할 수 있어요
                </p>
              ) : null}
              {justSaved ? (
                <p className="mt-5 rounded-[14px] bg-meet-pinkSoft px-4 py-3 text-[13px] font-black text-meet-pink">
                  후기가 저장됐어요. 소중한 의견 감사합니다 💗
                </p>
              ) : null}
              {saveError ? <p className="mt-5 text-[13px] font-bold text-meet-pink">{saveError}</p> : null}

              <div className="mt-6">
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

function PlusGlyph() {
  return (
    <svg fill="none" height="22" viewBox="0 0 24 24" width="22">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}
