import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import IntroContentSections from '../components/IntroContentSections';
import useOperationalData from '../hooks/useOperationalData';
import {
  createIntroSection,
  deleteIntroImage,
  deleteIntroSection,
  fetchAdminIntroContent,
  removeIntroDefaultCover,
  reorderIntroImages,
  reorderIntroSections,
  setIntroSectionVisible,
  updateIntroDefaultInfo,
  updateIntroImageCaption,
  updateIntroSection,
  uploadIntroDefaultCover,
  uploadIntroImage,
  type IntroDefaultInfo,
  type IntroImage,
  type IntroSection,
} from '../services/introContent';
import { fetchEventCoverUrls } from '../services/supabaseApplications';
import type { EventData } from '../types/event';

// 관리자 "행사소개 관리" - 타임투밋 공통 행사소개 페이지(참가자
// /event-info, /events/:eventId/info 하단)에 붙는 텍스트/이미지 갤러리
// 콘텐츠를 관리한다. 행사별로 따로 관리하지 않는다 - 여기서 만든 콘텐츠는
// 모든 행사 소개 페이지에 동일하게 노출된다. 날짜/장소/가격/인원 같은
// 운영 정보는 각 행사의 수정 화면에서만 관리한다.
export default function AdminIntroContentPage() {
  const navigate = useNavigate();
  const { error, events, loading, reload: reloadEvents } = useOperationalData({ admin: true });

  const [sections, setSections] = useState<IntroSection[] | null>(null);
  const [defaultInfo, setDefaultInfo] = useState<IntroDefaultInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [savedFlashId, setSavedFlashId] = useState('');

  const load = async () => {
    setLoadError('');
    try {
      const payload = await fetchAdminIntroContent();
      setSections(payload.sections);
      setDefaultInfo(payload.defaultInfo);
    } catch (caughtError) {
      setLoadError(caughtError instanceof Error ? caughtError.message : '행사소개를 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const flashSaved = (id: string) => {
    setSavedFlashId(id);
    window.setTimeout(() => setSavedFlashId((current) => (current === id ? '' : current)), 1500);
  };

  const patchSection = (sectionId: string, updater: (section: IntroSection) => IntroSection) => {
    setSections((current) => (current ? current.map((row) => (row.id === sectionId ? updater(row) : row)) : current));
  };

  const handleAddSection = async (type: 'text' | 'gallery') => {
    if (busy) return;
    setBusy(true);
    try {
      await createIntroSection(type, '', '');
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '섹션을 추가하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveText = async (section: IntroSection) => {
    setBusy(true);
    try {
      await updateIntroSection(section.id, section.title ?? '', section.content ?? '');
      flashSaved(section.id);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '섹션을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleVisible = async (section: IntroSection) => {
    patchSection(section.id, (row) => ({ ...row, isVisible: !row.isVisible }));
    try {
      await setIntroSectionVisible(section.id, !section.isVisible);
    } catch (caughtError) {
      patchSection(section.id, (row) => ({ ...row, isVisible: section.isVisible }));
      window.alert(caughtError instanceof Error ? caughtError.message : '노출 상태를 변경하지 못했습니다.');
    }
  };

  const handleMoveSection = async (index: number, direction: -1 | 1) => {
    if (!sections || busy) return;
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const reordered = [...sections];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setSections(reordered);
    setBusy(true);
    try {
      await reorderIntroSections(reordered.map((row) => row.id));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '순서를 변경하지 못했습니다.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSection = async (section: IntroSection) => {
    if (!window.confirm('이 섹션을 삭제할까요? 안의 이미지도 함께 삭제되며 되돌릴 수 없습니다.')) return;
    setBusy(true);
    try {
      await deleteIntroSection(section.id);
      setSections((current) => (current ? current.filter((row) => row.id !== section.id) : current));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '섹션을 삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadImages = async (section: IntroSection, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const image = await uploadIntroImage(section.id, file);
        patchSection(section.id, (row) => ({ ...row, images: [...row.images, image] }));
      }
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceImage = async (section: IntroSection, image: IntroImage, file: File) => {
    setBusy(true);
    try {
      const next = await uploadIntroImage(section.id, file, image.caption, image.id);
      patchSection(section.id, (row) => ({
        ...row,
        images: row.images.map((item) => (item.id === image.id ? next : item)),
      }));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지 교체에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteImage = async (section: IntroSection, image: IntroImage) => {
    if (!window.confirm('이 이미지를 삭제할까요?')) return;
    setBusy(true);
    try {
      await deleteIntroImage(image.id);
      patchSection(section.id, (row) => ({ ...row, images: row.images.filter((item) => item.id !== image.id) }));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지를 삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveImage = async (section: IntroSection, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= section.images.length || busy) return;
    const reordered = [...section.images];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    patchSection(section.id, (row) => ({ ...row, images: reordered }));
    setBusy(true);
    try {
      await reorderIntroImages(section.id, reordered.map((row) => row.id));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지 순서를 변경하지 못했습니다.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleCaptionBlur = async (section: IntroSection, image: IntroImage, value: string) => {
    if (value === image.caption) return;
    try {
      await updateIntroImageCaption(image.id, value);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '캡션을 저장하지 못했습니다.');
    }
  };

  const handleSaveDefaultInfo = async (next: IntroDefaultInfo) => {
    setBusy(true);
    try {
      await updateIntroDefaultInfo(next);
      setDefaultInfo(next);
      flashSaved('default-info');
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '기본 행사 정보를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadDefaultCover = async (file: File) => {
    setBusy(true);
    try {
      const coverUrl = await uploadIntroDefaultCover(file);
      setDefaultInfo((current) => (current ? { ...current, coverUrl } : current));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '대표 이미지 업로드에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveDefaultCover = async () => {
    if (!window.confirm('기본 대표 이미지를 삭제할까요?')) return;
    setBusy(true);
    try {
      await removeIntroDefaultCover();
      setDefaultInfo((current) => (current ? { ...current, coverUrl: null } : current));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '대표 이미지 삭제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reloadEvents} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-24 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[20px] font-black">행사소개 관리</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/content')} type="button">
            ← 콘텐츠 관리로
          </button>
        </div>
        <p className="mt-1 text-[12px] font-bold leading-relaxed text-[#aab0b8]">
          여기서 만든 소개글/이미지는 모든 행사의 소개 페이지에 공통으로 노출됩니다. 행사명·날짜·장소·가격·인원은 각 행사 수정
          화면 값이 자동으로 표시되며 여기서 입력하지 않습니다.
        </p>

        <button
          className="mt-4 h-10 rounded-[12px] bg-meet-blue px-3.5 text-[12.5px] font-black text-white disabled:opacity-50"
          disabled={!sections}
          onClick={() => setShowPreview(true)}
          type="button"
        >
          👀 미리보기
        </button>

        {loadError ? (
          <p className="mt-4 rounded-[16px] bg-meet-pinkSoft p-4 text-center text-[13px] font-black text-meet-pink">{loadError}</p>
        ) : !sections || !defaultInfo ? (
          <p className="mt-8 text-center text-[13px] font-bold text-[#9a9a9a]">불러오는 중</p>
        ) : (
          <>
            <DefaultInfoCard
              busy={busy}
              defaultInfo={defaultInfo}
              onRemoveCover={() => void handleRemoveDefaultCover()}
              onSave={handleSaveDefaultInfo}
              onUploadCover={(file) => void handleUploadDefaultCover(file)}
              saved={savedFlashId === 'default-info'}
            />

            <h2 className="mb-2.5 mt-8 text-[15px] font-black text-black">소개 콘텐츠</h2>
          <div className="space-y-3">
            {sections.length === 0 ? (
              <p className="rounded-[18px] bg-meet-blueSoft p-4 text-center text-[13px] font-black text-[#555]">
                아직 등록된 소개 콘텐츠가 없습니다.
              </p>
            ) : null}
            {sections.map((section, index) =>
              section.sectionType === 'text' ? (
                <TextSectionCard
                  busy={busy}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === sections.length - 1}
                  key={section.id}
                  onChange={(updater) => patchSection(section.id, updater)}
                  onDelete={() => void handleDeleteSection(section)}
                  onMove={(direction) => void handleMoveSection(index, direction)}
                  onSave={() => void handleSaveText(section)}
                  onToggleVisible={() => void handleToggleVisible(section)}
                  saved={savedFlashId === section.id}
                  section={section}
                />
              ) : (
                <GallerySectionCard
                  busy={busy}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === sections.length - 1}
                  key={section.id}
                  onCaptionBlur={(image, value) => void handleCaptionBlur(section, image, value)}
                  onDelete={() => void handleDeleteSection(section)}
                  onDeleteImage={(image) => void handleDeleteImage(section, image)}
                  onMove={(direction) => void handleMoveSection(index, direction)}
                  onMoveImage={(imgIndex, direction) => void handleMoveImage(section, imgIndex, direction)}
                  onReplaceImage={(image, file) => void handleReplaceImage(section, image, file)}
                  onToggleVisible={() => void handleToggleVisible(section)}
                  onUpload={(files) => void handleUploadImages(section, files)}
                  section={section}
                />
              ),
            )}
          </div>
          </>
        )}

        <div className="mt-5 flex gap-2">
          <button
            className="h-12 flex-1 rounded-[14px] bg-meet-blueSoft text-[13.5px] font-black text-meet-blue disabled:opacity-50"
            disabled={busy}
            onClick={() => void handleAddSection('text')}
            type="button"
          >
            + 텍스트 섹션
          </button>
          <button
            className="h-12 flex-1 rounded-[14px] bg-meet-blueSoft text-[13.5px] font-black text-meet-blue disabled:opacity-50"
            disabled={busy}
            onClick={() => void handleAddSection('gallery')}
            type="button"
          >
            + 이미지 갤러리
          </button>
        </div>
      </div>

      {showPreview ? (
        <PreviewOverlay
          defaultInfo={defaultInfo}
          events={events}
          onClose={() => setShowPreview(false)}
          sections={sections ?? []}
        />
      ) : null}
    </main>
  );
}

function TextSectionCard({
  busy,
  index,
  isFirst,
  isLast,
  onChange,
  onDelete,
  onMove,
  onSave,
  onToggleVisible,
  saved,
  section,
}: {
  busy: boolean;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (updater: (section: IntroSection) => IntroSection) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onSave: () => void;
  onToggleVisible: () => void;
  saved: boolean;
  section: IntroSection;
}) {
  return (
    <article className="rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
      <SectionHeader
        busy={busy}
        index={index}
        isFirst={isFirst}
        isLast={isLast}
        isVisible={section.isVisible}
        label="텍스트"
        onDelete={onDelete}
        onMove={onMove}
        onToggleVisible={onToggleVisible}
      />
      <input
        className="mt-3 h-11 w-full rounded-[12px] bg-[#f7f9fb] px-3 text-[14px] font-black outline-none focus:ring-2 focus:ring-meet-blue"
        onChange={(event) => onChange((row) => ({ ...row, title: event.target.value }))}
        placeholder="제목 (선택)"
        value={section.title ?? ''}
      />
      <textarea
        className="mt-2 min-h-[110px] w-full resize-none rounded-[12px] bg-[#f7f9fb] p-3 text-[13.5px] font-bold leading-relaxed outline-none focus:ring-2 focus:ring-meet-blue"
        onChange={(event) => onChange((row) => ({ ...row, content: event.target.value }))}
        placeholder="본문"
        value={section.content ?? ''}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {saved ? <span className="text-[12px] font-black text-[#2f9e5c]">저장됨</span> : null}
        <button
          className="h-9 rounded-[10px] bg-meet-blue px-4 text-[12.5px] font-black text-white disabled:opacity-50"
          disabled={busy}
          onClick={onSave}
          type="button"
        >
          저장
        </button>
      </div>
    </article>
  );
}

function GallerySectionCard({
  busy,
  index,
  isFirst,
  isLast,
  onCaptionBlur,
  onDelete,
  onDeleteImage,
  onMove,
  onMoveImage,
  onReplaceImage,
  onToggleVisible,
  onUpload,
  section,
}: {
  busy: boolean;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onCaptionBlur: (image: IntroImage, value: string) => void;
  onDelete: () => void;
  onDeleteImage: (image: IntroImage) => void;
  onMove: (direction: -1 | 1) => void;
  onMoveImage: (imageIndex: number, direction: -1 | 1) => void;
  onReplaceImage: (image: IntroImage, file: File) => void;
  onToggleVisible: () => void;
  onUpload: (files: FileList | null) => void;
  section: IntroSection;
}) {
  const addInputRef = useRef<HTMLInputElement>(null);

  return (
    <article className="rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
      <SectionHeader
        busy={busy}
        index={index}
        isFirst={isFirst}
        isLast={isLast}
        isVisible={section.isVisible}
        label="이미지 갤러리"
        onDelete={onDelete}
        onMove={onMove}
        onToggleVisible={onToggleVisible}
      />

      <p className="mt-2.5 text-[11.5px] font-bold text-[#9aa0a7]">권장 이미지 크기 1080×1350 (4:5)</p>

      <div className="mt-2.5 space-y-2.5">
        {section.images.map((image, imgIndex) => (
          <GalleryImageRow
            image={image}
            index={imgIndex}
            isFirst={imgIndex === 0}
            isLast={imgIndex === section.images.length - 1}
            key={image.id}
            onCaptionBlur={(value) => onCaptionBlur(image, value)}
            onDelete={() => onDeleteImage(image)}
            onMove={(direction) => onMoveImage(imgIndex, direction)}
            onReplace={(file) => onReplaceImage(image, file)}
          />
        ))}
        {section.images.length === 0 ? <p className="py-3 text-center text-[12.5px] font-bold text-[#9a9a9a]">등록된 이미지가 없습니다.</p> : null}
      </div>

      <input
        accept="image/*"
        className="hidden"
        multiple
        onChange={(event) => {
          onUpload(event.target.files);
          event.target.value = '';
        }}
        ref={addInputRef}
        style={{ display: 'none' }}
        type="file"
      />
      <button
        className="mt-3 h-10 w-full rounded-[10px] bg-meet-blueSoft text-[12.5px] font-black text-meet-blue disabled:opacity-50"
        disabled={busy}
        onClick={() => addInputRef.current?.click()}
        type="button"
      >
        + 이미지 추가
      </button>
    </article>
  );
}

function GalleryImageRow({
  image,
  isFirst,
  isLast,
  onCaptionBlur,
  onDelete,
  onMove,
  onReplace,
}: {
  image: IntroImage;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onCaptionBlur: (value: string) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onReplace: (file: File) => void;
}) {
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState(image.caption);

  return (
    <div className="flex gap-2.5 rounded-[12px] bg-[#f7f9fb] p-2.5">
      <div className="h-[64px] w-[64px] shrink-0 overflow-hidden rounded-[8px] bg-[#e5e9ef]">
        {image.imageUrl ? <img alt="" className="h-full w-full object-cover" src={image.imageUrl} /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <input
          className="h-8 w-full rounded-[8px] bg-white px-2 text-[12px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
          onBlur={() => onCaptionBlur(caption)}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="캡션 (선택)"
          value={caption}
        />
        <div className="flex items-center gap-1.5">
          <button className="rounded-[6px] bg-white px-1.5 py-0.5 text-[11px] font-black text-[#555] disabled:opacity-40" disabled={isFirst} onClick={() => onMove(-1)} type="button">
            ↑
          </button>
          <button className="rounded-[6px] bg-white px-1.5 py-0.5 text-[11px] font-black text-[#555] disabled:opacity-40" disabled={isLast} onClick={() => onMove(1)} type="button">
            ↓
          </button>
          <input
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onReplace(file);
              event.target.value = '';
            }}
            ref={replaceInputRef}
            style={{ display: 'none' }}
            type="file"
          />
          <button className="text-[11px] font-black text-meet-blue" onClick={() => replaceInputRef.current?.click()} type="button">
            교체
          </button>
          <button className="ml-auto text-[11px] font-black text-[#e0554a]" onClick={onDelete} type="button">
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  busy,
  index,
  isFirst,
  isLast,
  isVisible,
  label,
  onDelete,
  onMove,
  onToggleVisible,
}: {
  busy: boolean;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isVisible: boolean;
  label: string;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onToggleVisible: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-black text-[#999]">#{index + 1}</span>
      <span className="rounded-[8px] bg-[#eef2ff] px-2 py-0.5 text-[11px] font-black text-[#5c6bc0]">{label}</span>
      <button
        className={`rounded-[8px] px-2 py-0.5 text-[11px] font-black ${isVisible ? 'bg-[#e8f8ee] text-[#2f9e5c]' : 'bg-[#f2f2f2] text-[#999]'}`}
        onClick={onToggleVisible}
        type="button"
      >
        {isVisible ? '노출' : '비노출'}
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <button className="rounded-[8px] bg-[#f2f4f6] px-2 py-1 text-[12px] font-black text-[#555] disabled:opacity-40" disabled={isFirst || busy} onClick={() => onMove(-1)} type="button">
          ↑
        </button>
        <button className="rounded-[8px] bg-[#f2f4f6] px-2 py-1 text-[12px] font-black text-[#555] disabled:opacity-40" disabled={isLast || busy} onClick={() => onMove(1)} type="button">
          ↓
        </button>
        <button className="text-[12px] font-black text-[#e0554a]" onClick={onDelete} type="button">
          삭제
        </button>
      </div>
    </div>
  );
}

function DefaultInfoCard({
  busy,
  defaultInfo,
  onRemoveCover,
  onSave,
  onUploadCover,
  saved,
}: {
  busy: boolean;
  defaultInfo: IntroDefaultInfo;
  onRemoveCover: () => void;
  onSave: (next: IntroDefaultInfo) => void;
  onUploadCover: (file: File) => void;
  saved: boolean;
}) {
  const [draft, setDraft] = useState(defaultInfo);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof IntroDefaultInfo>(key: K, value: IntroDefaultInfo[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toNumberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

  return (
    <section className="mt-6 rounded-[16px] bg-meet-blueSoft p-4">
      <h2 className="text-[15px] font-black text-black">기본 행사 정보</h2>
      <p className="mt-1.5 text-[12px] font-bold leading-relaxed text-[#6f7f92]">
        아래 정보는 연결된 행사가 없을 때 사용하는 기본값입니다. 특정 행사에서 행사소개 페이지를 열면 실제 행사 정보가 우선
        적용됩니다.
      </p>

      <div className="mt-4">
        <span className="text-[11.5px] font-black text-[#6f7f92]">기본 대표 이미지</span>
        <div className="mt-1 flex gap-3">
          <div className="w-[104px] shrink-0 overflow-hidden rounded-[12px] bg-white" style={{ aspectRatio: '4 / 3' }}>
            {defaultInfo.coverUrl ? (
              <img alt="" className="h-full w-full object-cover" src={defaultInfo.coverUrl} />
            ) : (
              <div className="grid h-full w-full place-items-center text-[10px] font-bold text-[#9aa0a7]">이미지 없음</div>
            )}
          </div>
          <div className="flex flex-col justify-center gap-1.5">
            <input
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUploadCover(file);
                event.target.value = '';
              }}
              ref={coverInputRef}
              style={{ display: 'none' }}
              type="file"
            />
            <button
              className="h-8 rounded-[8px] bg-white px-3 text-[12px] font-black text-meet-blue"
              onClick={() => coverInputRef.current?.click()}
              type="button"
            >
              {defaultInfo.coverUrl ? '이미지 변경' : '이미지 업로드'}
            </button>
            {defaultInfo.coverUrl ? (
              <button className="h-8 rounded-[8px] bg-white px-3 text-[12px] font-black text-[#e0554a]" onClick={onRemoveCover} type="button">
                삭제
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2.5">
        <LabeledInput label="기본 행사명">
          <input
            className="h-10 w-full rounded-[10px] bg-white px-3 text-[13.5px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
            onChange={(event) => update('title', event.target.value)}
            placeholder="타임투밋 로테이션소개팅"
            value={draft.title ?? ''}
          />
        </LabeledInput>

        <div className="grid grid-cols-2 gap-2.5">
          <LabeledInput label="기본 날짜">
            <input
              className="h-10 w-full rounded-[10px] bg-white px-2 text-[13px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
              onChange={(event) => update('dateLabel', event.target.value || null)}
              placeholder="예: 매주 일요일"
              value={draft.dateLabel ?? ''}
            />
          </LabeledInput>
          <LabeledInput label="시작 시간">
            <input
              className="h-10 w-full rounded-[10px] bg-white px-2 text-[13px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
              onChange={(event) => update('startTime', event.target.value || null)}
              type="time"
              value={draft.startTime?.slice(0, 5) ?? ''}
            />
          </LabeledInput>
        </div>

        <LabeledInput label="기본 장소">
          <input
            className="h-10 w-full rounded-[10px] bg-white px-3 text-[13.5px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
            onChange={(event) => update('location', event.target.value)}
            placeholder="성남"
            value={draft.location ?? ''}
          />
        </LabeledInput>

        <div className="grid grid-cols-2 gap-2.5">
          <LabeledInput label="남성 참가비">
            <input
              className="h-10 w-full rounded-[10px] bg-white px-2 text-[13px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
              inputMode="numeric"
              onChange={(event) => update('malePrice', toNumberOrNull(event.target.value))}
              value={draft.malePrice ?? ''}
            />
          </LabeledInput>
          <LabeledInput label="여성 참가비">
            <input
              className="h-10 w-full rounded-[10px] bg-white px-2 text-[13px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
              inputMode="numeric"
              onChange={(event) => update('femalePrice', toNumberOrNull(event.target.value))}
              value={draft.femalePrice ?? ''}
            />
          </LabeledInput>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <LabeledInput label="남성 모집 인원">
            <input
              className="h-10 w-full rounded-[10px] bg-white px-2 text-[13px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
              inputMode="numeric"
              onChange={(event) => update('maleCapacity', toNumberOrNull(event.target.value))}
              value={draft.maleCapacity ?? ''}
            />
          </LabeledInput>
          <LabeledInput label="여성 모집 인원">
            <input
              className="h-10 w-full rounded-[10px] bg-white px-2 text-[13px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
              inputMode="numeric"
              onChange={(event) => update('femaleCapacity', toNumberOrNull(event.target.value))}
              value={draft.femaleCapacity ?? ''}
            />
          </LabeledInput>
        </div>

        <LabeledInput label="할인/얼리버드 안내 (선택, 참가비 아래에 표시)">
          <textarea
            className="min-h-[64px] w-full resize-none rounded-[10px] bg-white p-3 text-[13px] font-bold leading-relaxed outline-none focus:ring-2 focus:ring-meet-blue"
            onChange={(event) => update('discountNote', event.target.value)}
            placeholder="예: 얼리버드 신청 시 5,000원 할인"
            value={draft.discountNote ?? ''}
          />
        </LabeledInput>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        {saved ? <span className="text-[12px] font-black text-[#2f9e5c]">저장됨</span> : null}
        <button
          className="h-9 rounded-[10px] bg-meet-blue px-4 text-[12.5px] font-black text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => onSave(draft)}
          type="button"
        >
          저장
        </button>
      </div>
    </section>
  );
}

function LabeledInput({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-black text-[#6f7f92]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function PreviewOverlay({
  defaultInfo,
  events,
  onClose,
  sections,
}: {
  defaultInfo: IntroDefaultInfo | null;
  events: EventData[];
  onClose: () => void;
  sections: IntroSection[];
}) {
  const upcomingEvents = events
    .filter((event) => new Date(`${event.date}T00:00:00`).getTime() >= new Date().setHours(0, 0, 0, 0))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const nearestEvent = upcomingEvents[0];

  // 실제 메인페이지 "행사 소개 보기"(/event-info)는 예정 행사 유무와
  // 무관하게 항상 기본값을 보여주므로, 미리보기도 기본값 모드로 시작한다.
  const [previewMode, setPreviewMode] = useState<'default' | 'event'>('default');
  const [selectedEventId, setSelectedEventId] = useState(nearestEvent?.id ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const previewEvent = previewMode === 'event' ? upcomingEvents.find((event) => event.id === selectedEventId) : undefined;

  useEffect(() => {
    if (!previewEvent) {
      setCoverUrl(null);
      return;
    }
    let active = true;
    void fetchEventCoverUrls([previewEvent.id]).then((covers) => {
      if (active) setCoverUrl(covers[previewEvent.id] ?? null);
    });
    return () => {
      active = false;
    };
  }, [previewEvent?.id]);

  const hasDefaultInfo = Boolean(defaultInfo && (defaultInfo.title || defaultInfo.location || defaultInfo.dateLabel));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-8" onClick={onClose} role="presentation">
      <div
        className="flex h-full max-h-[820px] w-full max-w-[402px] flex-col overflow-hidden rounded-[20px] bg-white"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f0f3f6] px-4 py-3">
          <p className="text-[13px] font-black text-[#555]">참가자 화면 미리보기</p>
          <button className="text-[13px] font-black text-meet-blue" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[#f0f3f6] px-4 py-2.5">
          <button
            className={`h-8 flex-1 rounded-[8px] text-[12px] font-black ${previewMode === 'default' ? 'bg-meet-blue text-white' : 'bg-[#f2f4f6] text-[#666]'}`}
            onClick={() => setPreviewMode('default')}
            type="button"
          >
            기본값으로 미리보기
          </button>
          <button
            className={`h-8 flex-1 rounded-[8px] text-[12px] font-black ${previewMode === 'event' ? 'bg-meet-blue text-white' : 'bg-[#f2f4f6] text-[#666]'}`}
            disabled={upcomingEvents.length === 0}
            onClick={() => setPreviewMode('event')}
            type="button"
          >
            예정 행사로 미리보기
          </button>
        </div>
        {previewMode === 'event' && upcomingEvents.length > 0 ? (
          <div className="border-b border-[#f0f3f6] px-4 py-2.5">
            <select
              className="h-9 w-full rounded-[8px] bg-[#f2f4f6] px-2 text-[12.5px] font-bold outline-none"
              onChange={(event) => setSelectedEventId(event.target.value)}
              value={selectedEventId}
            >
              {upcomingEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} ({event.date})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-5">
          {previewMode === 'event' && previewEvent ? (
            <>
              <div className="overflow-hidden rounded-[16px] bg-[#f1f3f5]" style={{ aspectRatio: '4 / 3' }}>
                {coverUrl ? <img alt="" className="h-full w-full object-cover" src={coverUrl} /> : null}
              </div>
              <h1 className="mt-4 text-[19px] font-black leading-tight">{previewEvent.title}</h1>
              <div className="mt-3 rounded-[16px] bg-meet-blueSoft p-4 text-[13px] font-extrabold leading-relaxed text-[#555]">
                <p className="font-black text-black">일시</p>
                <p>
                  {previewEvent.date} {previewEvent.startTime}~{previewEvent.endTime}
                </p>
                <p className="mt-3 font-black text-black">장소</p>
                <p>{previewEvent.location}</p>
                <p className="mt-3 font-black text-black">모집 인원</p>
                <p>
                  남성 {previewEvent.maleCapacity ?? '-'}명 · 여성 {previewEvent.femaleCapacity ?? '-'}명
                </p>
                <p className="mt-3 font-black text-black">참가비</p>
                <p>
                  남성 {previewEvent.malePrice.toLocaleString('ko-KR')}원 · 여성 {previewEvent.femalePrice.toLocaleString('ko-KR')}원
                </p>
              </div>
            </>
          ) : previewMode === 'default' && hasDefaultInfo && defaultInfo ? (
            <>
              {defaultInfo.coverUrl ? (
                <div className="overflow-hidden rounded-[16px] bg-[#f1f3f5]" style={{ aspectRatio: '4 / 3' }}>
                  <img alt="" className="h-full w-full object-cover" src={defaultInfo.coverUrl} />
                </div>
              ) : (
                <div className="grid min-h-[110px] place-items-center rounded-[16px] bg-[#f1f3f5] text-[12px] font-bold text-[#9a9a9a]">
                  대표 이미지 없음(기본값 미리보기)
                </div>
              )}
              <h1 className="mt-4 text-[19px] font-black leading-tight">{defaultInfo.title || '타임투밋 로테이션소개팅'}</h1>
              <div className="mt-3 rounded-[16px] bg-meet-blueSoft p-4 text-[13px] font-extrabold leading-relaxed text-[#555]">
                <p className="font-black text-black">일시</p>
                <p>
                  {defaultInfo.dateLabel ?? '일정 안내 예정'} {defaultInfo.startTime?.slice(0, 5) ?? ''}
                </p>
                <p className="mt-3 font-black text-black">장소</p>
                <p>{defaultInfo.location ?? '장소 안내 예정'}</p>
                {defaultInfo.maleCapacity != null || defaultInfo.femaleCapacity != null ? (
                  <>
                    <p className="mt-3 font-black text-black">모집 인원</p>
                    <p>
                      남성 {defaultInfo.maleCapacity ?? '-'}명 · 여성 {defaultInfo.femaleCapacity ?? '-'}명
                    </p>
                  </>
                ) : null}
                {defaultInfo.malePrice != null || defaultInfo.femalePrice != null ? (
                  <>
                    <p className="mt-3 font-black text-black">참가비</p>
                    <p>
                      남성 {(defaultInfo.malePrice ?? 0).toLocaleString('ko-KR')}원 · 여성{' '}
                      {(defaultInfo.femalePrice ?? 0).toLocaleString('ko-KR')}원
                    </p>
                    {defaultInfo.discountNote ? <p className="mt-2 text-meet-blue">{defaultInfo.discountNote}</p> : null}
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <p className="rounded-[16px] bg-meet-blueSoft p-4 text-center text-[13px] font-black text-[#555]">
              {previewMode === 'event' ? '예정된 행사가 없습니다.' : '기본 행사 정보가 아직 입력되지 않았습니다.'}
            </p>
          )}
          <IntroContentSections sections={sections} />
          {sections.filter((section) => section.isVisible).length === 0 ? (
            <p className="mt-8 text-center text-[13px] font-bold text-[#9a9a9a]">노출 중인 소개 콘텐츠가 없습니다.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
