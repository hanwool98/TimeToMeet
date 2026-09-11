import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import EventIntroSections from '../components/EventIntroSections';
import useOperationalData from '../hooks/useOperationalData';
import {
  copyEventIntroFromEvent,
  createEventIntroSection,
  deleteEventIntroImage,
  deleteEventIntroSection,
  fetchAdminEventIntro,
  reorderEventIntroImages,
  reorderEventIntroSections,
  setEventIntroSectionVisible,
  updateEventIntroImageCaption,
  updateEventIntroSection,
  uploadEventIntroImage,
  type EventIntroImage,
  type EventIntroSection,
} from '../services/eventIntro';

// 관리자 "행사 소개 편집" - 참가자 /events/:eventId/info 하단에 붙는
// 텍스트/이미지 갤러리 섹션을 행사별로 관리한다. 날짜/장소/가격/인원 같은
// 운영 정보는 여기서 건드리지 않는다(행사 수정 화면이 그대로 담당).
export default function AdminEventIntroPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { error, events, loading, reload: reloadEvents } = useOperationalData({ admin: true });
  const event = events.find((item) => item.id === eventId);

  const [sections, setSections] = useState<EventIntroSection[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [copying, setCopying] = useState(false);
  const [savedFlashId, setSavedFlashId] = useState('');

  const load = async () => {
    if (!eventId) return;
    setLoadError('');
    try {
      setSections(await fetchAdminEventIntro(eventId));
    } catch (caughtError) {
      setLoadError(caughtError instanceof Error ? caughtError.message : '행사 소개를 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const flashSaved = (id: string) => {
    setSavedFlashId(id);
    window.setTimeout(() => setSavedFlashId((current) => (current === id ? '' : current)), 1500);
  };

  const patchSection = (sectionId: string, updater: (section: EventIntroSection) => EventIntroSection) => {
    setSections((current) => (current ? current.map((row) => (row.id === sectionId ? updater(row) : row)) : current));
  };

  const handleAddSection = async (type: 'text' | 'gallery') => {
    if (!eventId || busy) return;
    setBusy(true);
    try {
      await createEventIntroSection(eventId, type, '', '');
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '섹션을 추가하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveText = async (section: EventIntroSection) => {
    setBusy(true);
    try {
      await updateEventIntroSection(section.id, section.title ?? '', section.content ?? '');
      flashSaved(section.id);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '섹션을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleVisible = async (section: EventIntroSection) => {
    patchSection(section.id, (row) => ({ ...row, isVisible: !row.isVisible }));
    try {
      await setEventIntroSectionVisible(section.id, !section.isVisible);
    } catch (caughtError) {
      patchSection(section.id, (row) => ({ ...row, isVisible: section.isVisible }));
      window.alert(caughtError instanceof Error ? caughtError.message : '노출 상태를 변경하지 못했습니다.');
    }
  };

  const handleMoveSection = async (index: number, direction: -1 | 1) => {
    if (!sections || !eventId || busy) return;
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const reordered = [...sections];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setSections(reordered);
    setBusy(true);
    try {
      await reorderEventIntroSections(eventId, reordered.map((row) => row.id));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '순서를 변경하지 못했습니다.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSection = async (section: EventIntroSection) => {
    if (!window.confirm('이 섹션을 삭제할까요? 안의 이미지도 함께 삭제되며 되돌릴 수 없습니다.')) return;
    setBusy(true);
    try {
      await deleteEventIntroSection(section.id);
      setSections((current) => (current ? current.filter((row) => row.id !== section.id) : current));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '섹션을 삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadImages = async (section: EventIntroSection, files: FileList | null) => {
    if (!eventId || !files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const image = await uploadEventIntroImage(eventId, section.id, file);
        patchSection(section.id, (row) => ({ ...row, images: [...row.images, image] }));
      }
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceImage = async (section: EventIntroSection, image: EventIntroImage, file: File) => {
    if (!eventId) return;
    setBusy(true);
    try {
      const next = await uploadEventIntroImage(eventId, section.id, file, image.caption, image.id);
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

  const handleDeleteImage = async (section: EventIntroSection, image: EventIntroImage) => {
    if (!window.confirm('이 이미지를 삭제할까요?')) return;
    setBusy(true);
    try {
      await deleteEventIntroImage(image.id);
      patchSection(section.id, (row) => ({ ...row, images: row.images.filter((item) => item.id !== image.id) }));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지를 삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveImage = async (section: EventIntroSection, index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= section.images.length || busy) return;
    const reordered = [...section.images];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    patchSection(section.id, (row) => ({ ...row, images: reordered }));
    setBusy(true);
    try {
      await reorderEventIntroImages(section.id, reordered.map((row) => row.id));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '이미지 순서를 변경하지 못했습니다.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleCaptionBlur = async (section: EventIntroSection, image: EventIntroImage, value: string) => {
    if (value === image.caption) return;
    try {
      await updateEventIntroImageCaption(image.id, value);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '캡션을 저장하지 못했습니다.');
    }
  };

  const handleCopyFrom = async (sourceEventId: string) => {
    if (!eventId || copying) return;
    setCopying(true);
    try {
      const result = await copyEventIntroFromEvent(sourceEventId, eventId);
      setShowCopyPicker(false);
      await load();
      window.alert(`섹션 ${result.copiedSections}개, 이미지 ${result.copiedImages}장을 불러왔습니다.`);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '소개 콘텐츠를 불러오지 못했습니다.');
    } finally {
      setCopying(false);
    }
  };

  const otherEvents = useMemo(() => events.filter((item) => item.id !== eventId), [events, eventId]);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reloadEvents} />;
  if (!event) {
    return (
      <main className="admin-page min-h-screen bg-white p-6 text-black">
        <p className="text-[15px] font-black">행사를 찾을 수 없습니다.</p>
        <button className="mt-4 text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/events')} type="button">
          ← 행사 목록으로
        </button>
      </main>
    );
  }

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-24 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[20px] font-black">행사 소개 편집</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate(`/admin/events/${event.id}/edit`)} type="button">
            ← 행사 수정으로
          </button>
        </div>
        <p className="mt-1 truncate text-[13px] font-extrabold text-[#8a8a8a]">{event.title}</p>
        <p className="mt-1 text-[12px] font-bold leading-relaxed text-[#aab0b8]">
          날짜·시간·장소·가격·인원은 여기서 수정할 수 없어요. 행사 수정 화면 값이 참가자 소개 페이지에 그대로 표시됩니다.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="h-10 rounded-[12px] bg-meet-blue px-3.5 text-[12.5px] font-black text-white disabled:opacity-50"
            disabled={!sections}
            onClick={() => setShowPreview(true)}
            type="button"
          >
            👀 미리보기
          </button>
          <button
            className="h-10 rounded-[12px] bg-[#f2f4f6] px-3.5 text-[12.5px] font-black text-[#555] disabled:opacity-50"
            disabled={otherEvents.length === 0}
            onClick={() => setShowCopyPicker(true)}
            type="button"
          >
            📋 기존 행사에서 불러오기
          </button>
        </div>

        {loadError ? (
          <p className="mt-4 rounded-[16px] bg-meet-pinkSoft p-4 text-center text-[13px] font-black text-meet-pink">{loadError}</p>
        ) : !sections ? (
          <p className="mt-8 text-center text-[13px] font-bold text-[#9a9a9a]">불러오는 중</p>
        ) : (
          <div className="mt-5 space-y-3">
            {sections.length === 0 ? (
              <p className="rounded-[18px] bg-meet-blueSoft p-4 text-center text-[13px] font-black text-[#555]">
                아직 등록된 소개 콘텐츠가 없습니다. 없으면 참가자 화면에는 기본 안내가 대신 보여요.
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
        )}

        <div className="mt-5 flex gap-2">
          <button
            className="h-12 flex-1 rounded-[14px] bg-meet-blueSoft text-[13.5px] font-black text-meet-blue disabled:opacity-50"
            disabled={busy || !eventId}
            onClick={() => void handleAddSection('text')}
            type="button"
          >
            + 텍스트 섹션
          </button>
          <button
            className="h-12 flex-1 rounded-[14px] bg-meet-blueSoft text-[13.5px] font-black text-meet-blue disabled:opacity-50"
            disabled={busy || !eventId}
            onClick={() => void handleAddSection('gallery')}
            type="button"
          >
            + 이미지 갤러리
          </button>
        </div>
      </div>

      {showPreview ? <PreviewOverlay event={event} onClose={() => setShowPreview(false)} sections={sections ?? []} /> : null}
      {showCopyPicker ? (
        <CopyPickerOverlay
          busy={copying}
          events={otherEvents}
          onClose={() => setShowCopyPicker(false)}
          onSelect={(id) => void handleCopyFrom(id)}
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
  onChange: (updater: (section: EventIntroSection) => EventIntroSection) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onSave: () => void;
  onToggleVisible: () => void;
  saved: boolean;
  section: EventIntroSection;
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
  onCaptionBlur: (image: EventIntroImage, value: string) => void;
  onDelete: () => void;
  onDeleteImage: (image: EventIntroImage) => void;
  onMove: (direction: -1 | 1) => void;
  onMoveImage: (imageIndex: number, direction: -1 | 1) => void;
  onReplaceImage: (image: EventIntroImage, file: File) => void;
  onToggleVisible: () => void;
  onUpload: (files: FileList | null) => void;
  section: EventIntroSection;
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

      <div className="mt-3 space-y-2.5">
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
        style={{ display: 'none' }}
        ref={addInputRef}
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
  image: EventIntroImage;
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
            style={{ display: 'none' }}
            ref={replaceInputRef}
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

function PreviewOverlay({
  event,
  onClose,
  sections,
}: {
  event: ReturnType<typeof useOperationalData>['events'][number];
  onClose: () => void;
  sections: EventIntroSection[];
}) {
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
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <h1 className="text-[19px] font-black leading-tight">{event.title}</h1>
          <div className="mt-3 rounded-[16px] bg-meet-blueSoft p-4 text-[13px] font-extrabold leading-relaxed text-[#555]">
            <p className="font-black text-black">일시</p>
            <p>
              {event.date} {event.startTime}~{event.endTime}
            </p>
            <p className="mt-3 font-black text-black">장소</p>
            <p>{event.location}</p>
            <p className="mt-3 font-black text-black">참가비</p>
            <p>
              남성 {event.malePrice.toLocaleString('ko-KR')}원 · 여성 {event.femalePrice.toLocaleString('ko-KR')}원
            </p>
          </div>
          <EventIntroSections sections={sections} />
          {sections.filter((section) => section.isVisible).length === 0 ? (
            <p className="mt-8 text-center text-[13px] font-bold text-[#9a9a9a]">
              노출 중인 소개 콘텐츠가 없어 기본 안내 문구가 대신 표시됩니다.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CopyPickerOverlay({
  busy,
  events,
  onClose,
  onSelect,
}: {
  busy: boolean;
  events: ReturnType<typeof useOperationalData>['events'];
  onClose: () => void;
  onSelect: (eventId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5" onClick={onClose} role="presentation">
      <div
        className="max-h-[70vh] w-full max-w-[360px] overflow-hidden rounded-[18px] bg-white"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f0f3f6] px-4 py-3">
          <p className="text-[13px] font-black text-[#555]">불러올 행사 선택</p>
          <button className="text-[13px] font-black text-meet-blue" onClick={onClose} type="button">
            닫기
          </button>
        </div>
        <div className="max-h-[56vh] overflow-y-auto p-2">
          {events.map((item) => (
            <button
              className="block w-full rounded-[12px] px-3 py-3 text-left text-[13.5px] font-bold text-black transition hover:bg-[#f7f9fb] disabled:opacity-50"
              disabled={busy}
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              {item.title}
              <span className="ml-2 text-[11.5px] font-extrabold text-[#9a9a9a]">{item.date}</span>
            </button>
          ))}
          {events.length === 0 ? <p className="p-4 text-center text-[13px] font-bold text-[#9a9a9a]">불러올 다른 행사가 없습니다.</p> : null}
        </div>
      </div>
    </div>
  );
}
