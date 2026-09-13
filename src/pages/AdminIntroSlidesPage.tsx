import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import { INTRO_SLIDE_ASPECT_CLASS } from '../constants/introSlides';
import {
  createIntroSlide,
  deleteIntroSlide,
  fetchAdminIntroSlides,
  reorderIntroSlides,
  updateIntroSlide,
  uploadIntroSlidePhoto,
  type IntroSlide,
} from '../services/supabaseApplications';

// 관리자 "행사 소개 슬라이드 관리" - 행사 진행 화면(AdminEventLivePage)과
// 태블릿(AdminTabletSeatPage)이 함께 쓰는 전역 슬라이드 덱을 여기서
// 등록/수정/삭제/순서변경한다. 행사별로 따로 관리하지 않는다.
export default function AdminIntroSlidesPage() {
  const navigate = useNavigate();
  const [slides, setSlides] = useState<IntroSlide[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState('');
  const newFileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetId = useRef<string | null>(null);

  const load = async () => {
    setLoadError('');
    try {
      const result = await fetchAdminIntroSlides();
      setSlides(result);
      setDrafts(Object.fromEntries(result.map((slide) => [slide.id, slide.title])));
      setPreviewId((current) => current ?? result[0]?.id ?? null);
    } catch (caughtError) {
      setLoadError(caughtError instanceof Error ? caughtError.message : '슬라이드 목록을 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const previewSlide = slides?.find((slide) => slide.id === previewId) ?? slides?.[0] ?? null;

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!slides) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= slides.length) return;
    const next = [...slides];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setSlides(next);
    setActionError('');
    try {
      await reorderIntroSlides(next.map((slide) => slide.id));
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '순서를 저장하지 못했습니다.');
      await load();
    }
  };

  const handleSaveTitle = async (slideId: string) => {
    setBusyId(slideId);
    setActionError('');
    try {
      await updateIntroSlide(slideId, drafts[slideId] ?? '');
      await load();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '제목을 저장하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReplaceImage = (slideId: string) => {
    replaceTargetId.current = slideId;
    replaceFileInputRef.current?.click();
  };

  const handleReplaceFileChosen = async (file: File) => {
    const slideId = replaceTargetId.current;
    if (!slideId) return;
    setBusyId(slideId);
    setActionError('');
    try {
      const uploaded = await uploadIntroSlidePhoto(file);
      await updateIntroSlide(slideId, drafts[slideId] ?? '', uploaded.photoPath);
      await load();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '이미지를 교체하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (slideId: string) => {
    if (!window.confirm('이 슬라이드를 삭제할까요? 삭제하면 되돌릴 수 없습니다.')) return;
    setBusyId(slideId);
    setActionError('');
    try {
      await deleteIntroSlide(slideId);
      await load();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '슬라이드를 삭제하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = () => {
    newFileInputRef.current?.click();
  };

  const handleNewFileChosen = async (file: File) => {
    setCreating(true);
    setActionError('');
    try {
      const uploaded = await uploadIntroSlidePhoto(file);
      await createIntroSlide(newTitle, uploaded.photoPath);
      setNewTitle('');
      await load();
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : '슬라이드를 추가하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-8 pt-4 min-[390px]:px-5">
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-black">행사 소개 슬라이드 관리</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/content')} type="button">
            ← 콘텐츠 관리
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] font-bold text-[#999]">
          행사 진행 화면과 태블릿에서 순서대로 보여줄 소개 슬라이드입니다. 여기서 만든 순서/내용이 모든 행사에 공통으로 적용됩니다.
        </p>

        {!slides ? (
          loadError ? (
            <DataErrorState message={loadError} onRetry={() => void load()} />
          ) : (
            <DataLoadingState />
          )
        ) : (
          <>
            {/* 태블릿 비율 미리보기 - 실제 태블릿/운영자 화면과 동일한
                aspect ratio + object-contain으로 렌더링해, 여기서 본 모습이
                실제 진행 화면에서 보이는 모습과 그대로 일치하게 한다. */}
            <section className="mt-5 rounded-[20px] bg-[#111] p-3">
              <p className="mb-2 text-[11px] font-black text-white/60">태블릿 화면 미리보기</p>
              <div className={`${INTRO_SLIDE_ASPECT_CLASS} w-full overflow-hidden rounded-[12px] bg-black`}>
                {previewSlide?.imageUrl ? (
                  <img alt="" className="h-full w-full object-contain" src={previewSlide.imageUrl} />
                ) : (
                  <div className="grid h-full w-full place-items-center text-[13px] font-bold text-white/50">슬라이드 없음</div>
                )}
              </div>
              {previewSlide ? <p className="mt-2 text-center text-[12px] font-bold text-white/80">{previewSlide.title || '(제목 없음)'}</p> : null}
            </section>

            {actionError ? <p className="mt-4 text-[13px] font-bold text-meet-pink">{actionError}</p> : null}

            <div className="mt-5 flex flex-col gap-3">
              {slides.map((slide, index) => (
                <section className="rounded-[18px] border border-[#f0f3f6] bg-white p-3 shadow-calendar" key={slide.id}>
                  <div className="flex gap-3">
                    <button
                      className={`shrink-0 ${INTRO_SLIDE_ASPECT_CLASS} w-24 overflow-hidden rounded-[10px] bg-[#f5f7fa]`}
                      onClick={() => setPreviewId(slide.id)}
                      type="button"
                    >
                      {slide.imageUrl ? <img alt="" className="h-full w-full object-contain" src={slide.imageUrl} /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-black text-[#999]">
                        {index + 1}번째 슬라이드
                      </p>
                      <input
                        className="mt-1 h-10 w-full rounded-[10px] bg-[#f7f8fa] px-3 text-[14px] font-bold outline-none"
                        onChange={(event) => setDrafts((current) => ({ ...current, [slide.id]: event.target.value }))}
                        placeholder="슬라이드 제목"
                        value={drafts[slide.id] ?? ''}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          className="rounded-[8px] bg-[#f1f3f5] px-2.5 py-1.5 text-[11px] font-black text-[#555] disabled:opacity-40"
                          disabled={index === 0}
                          onClick={() => void handleMove(index, -1)}
                          type="button"
                        >
                          ↑ 위로
                        </button>
                        <button
                          className="rounded-[8px] bg-[#f1f3f5] px-2.5 py-1.5 text-[11px] font-black text-[#555] disabled:opacity-40"
                          disabled={index === slides.length - 1}
                          onClick={() => void handleMove(index, 1)}
                          type="button"
                        >
                          ↓ 아래로
                        </button>
                        <button
                          className="rounded-[8px] bg-meet-blueSoft px-2.5 py-1.5 text-[11px] font-black text-meet-blue disabled:opacity-40"
                          disabled={busyId === slide.id}
                          onClick={() => handleReplaceImage(slide.id)}
                          type="button"
                        >
                          이미지 교체
                        </button>
                        <button
                          className="rounded-[8px] bg-meet-blue px-2.5 py-1.5 text-[11px] font-black text-white disabled:opacity-40"
                          disabled={busyId === slide.id || (drafts[slide.id] ?? '') === slide.title}
                          onClick={() => void handleSaveTitle(slide.id)}
                          type="button"
                        >
                          저장
                        </button>
                        <button
                          className="rounded-[8px] bg-[#fdeceb] px-2.5 py-1.5 text-[11px] font-black text-[#d8433a] disabled:opacity-40"
                          disabled={busyId === slide.id}
                          onClick={() => void handleDelete(slide.id)}
                          type="button"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <section className="mt-5 rounded-[18px] border border-dashed border-[#ddd] bg-[#fafbfc] p-4">
              <p className="text-[13px] font-black text-[#666]">새 슬라이드 추가</p>
              <input
                className="mt-2 h-10 w-full rounded-[10px] bg-white px-3 text-[14px] font-bold outline-none"
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="슬라이드 제목"
                value={newTitle}
              />
              <button
                className="mt-2 h-11 w-full rounded-[12px] bg-meet-blue text-[14px] font-black text-white transition active:scale-[0.99] disabled:opacity-50"
                disabled={creating}
                onClick={handleCreate}
                type="button"
              >
                {creating ? '추가하는 중' : '+ 이미지 선택 후 추가'}
              </button>
              <p className="mt-1.5 text-[11px] font-bold text-[#aaa]">항상 목록 맨 뒤에 추가됩니다. 순서는 위/아래 버튼으로 바꿀 수 있어요.</p>
            </section>
          </>
        )}

        <input
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleNewFileChosen(file);
          }}
          ref={newFileInputRef}
          type="file"
        />
        <input
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleReplaceFileChosen(file);
          }}
          ref={replaceFileInputRef}
          type="file"
        />
      </div>
    </main>
  );
}
