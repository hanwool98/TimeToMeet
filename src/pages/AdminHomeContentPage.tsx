import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import HomeContentCropEditor from '../components/HomeContentCropEditor';
import ParticipantPhoto from '../components/ParticipantPhoto';
import {
  deleteHomeContent,
  fetchAdminHomeContents,
  homeContentAspectRatio,
  reorderHomeContents,
  setHomeContentVisible,
  updateHomeContent,
  uploadHomeContent,
  type AdminHomeContent,
  type HomeContentCrop,
  type HomeContentSection,
} from '../services/supabaseApplications';

const DEFAULT_CROP: HomeContentCrop = { offsetX: 0, offsetY: 0, scale: 1 };

const sections: { key: HomeContentSection; label: string; managed: boolean; hint: string }[] = [
  { hint: '홈 "타임투밋이 사랑받는 이유" 캐러셀에 노출됩니다. 권장 이미지 크기 1100 x 400 px (비율 11:4).', key: 'love_reason', label: '타임투밋이 사랑받는 이유', managed: true },
  { hint: '홈 "모집방식 & 신청방식" 캐러셀에 노출됩니다. "사랑받는 이유"와 같은 크기 — 권장 1100 x 400 px (비율 11:4).', key: 'recruitment_application', label: '모집방식 & 신청방식', managed: true },
  { hint: '홈 "현장 스케치" 영역에 앞쪽 순서 3개가 노출됩니다. 가로 썸네일(4:3), 캡션(해시태그) 입력 가능.', key: 'field_sketch', label: '현장 스케치', managed: true },
];

export default function AdminHomeContentPage() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<HomeContentSection>('love_reason');
  const [items, setItems] = useState<AdminHomeContent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<AdminHomeContent | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await fetchAdminHomeContents());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '홈 콘텐츠를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const sectionMeta = sections.find((section) => section.key === activeSection)!;
  const sectionItems = useMemo(
    () => (items ?? []).filter((item) => item.sectionType === activeSection).sort((a, b) => a.sortOrder - b.sortOrder),
    [items, activeSection],
  );
  const visibleCount = sectionItems.filter((item) => item.isVisible).length;

  const replaceItems = (updater: (current: AdminHomeContent[]) => AdminHomeContent[]) => {
    setItems((current) => (current ? updater(current) : current));
  };

  const handleToggleVisible = async (item: AdminHomeContent) => {
    replaceItems((current) => current.map((row) => (row.id === item.id ? { ...row, isVisible: !item.isVisible } : row)));
    try {
      await setHomeContentVisible(item.id, !item.isVisible);
    } catch (caughtError) {
      replaceItems((current) => current.map((row) => (row.id === item.id ? { ...row, isVisible: item.isVisible } : row)));
      window.alert(caughtError instanceof Error ? caughtError.message : '노출 상태를 변경하지 못했습니다.');
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sectionItems.length || busy) return;
    const reordered = [...sectionItems];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const withOrder = reordered.map((row, position) => ({ ...row, sortOrder: position + 1 }));
    replaceItems((current) => [...current.filter((row) => row.sectionType !== activeSection), ...withOrder]);
    setBusy(true);
    try {
      await reorderHomeContents(activeSection, withOrder.map((row) => row.id));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '순서를 변경하지 못했습니다.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item: AdminHomeContent) => {
    if (!window.confirm('이 이미지를 삭제할까요? 되돌릴 수 없습니다.')) return;
    setBusy(true);
    try {
      await deleteHomeContent(item.id);
      replaceItems((current) => current.filter((row) => row.id !== item.id));
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '삭제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-8 pt-4 min-[390px]:px-5">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[22px] font-black">홈 콘텐츠 관리</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/content')} type="button">
            ← 콘텐츠 관리
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {sections.map((section) => (
            <button
              className={[
                'rounded-[10px] px-3 py-1.5 text-[12px] font-black transition',
                activeSection === section.key ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-meet-blue',
              ].join(' ')}
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>

        {loading ? (
          <DataLoadingState />
        ) : error ? (
          <DataErrorState message={error} onRetry={load} />
        ) : (
          <div className="mt-4">
            <p className="text-[13px] font-extrabold text-[#8a8a8a]">{sectionMeta.hint}</p>

            {sectionMeta.managed ? (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[13px] font-black text-[#555]">
                    현재 {sectionItems.length}개 · 노출 {visibleCount}개
                  </p>
                  <button
                    className="rounded-[10px] bg-[#1f292d] px-3 py-1.5 text-[12px] font-black text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setUploadOpen(true)}
                    type="button"
                  >
                    + 이미지 추가
                  </button>
                </div>

                <div className="mt-4 space-y-2.5 pb-6">
                  {sectionItems.map((item, index) => (
                    <article className="flex gap-3 rounded-[16px] border border-[#f0f3f6] bg-white p-3 shadow-sm" key={item.id}>
                      <ParticipantPhoto
                        className="w-[104px] shrink-0 rounded-[12px] bg-[#f1f3f5]"
                        crop={item.cropPosition}
                        photoUrl={item.imageUrl}
                        style={{ aspectRatio: homeContentAspectRatio(activeSection) }}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-black text-[#999]">#{index + 1}</span>
                          <button
                            className={[
                              'rounded-[8px] px-2 py-0.5 text-[11px] font-black',
                              item.isVisible ? 'bg-[#e8f8ee] text-[#2f9e5c]' : 'bg-[#f2f2f2] text-[#999]',
                            ].join(' ')}
                            onClick={() => void handleToggleVisible(item)}
                            type="button"
                          >
                            {item.isVisible ? '노출' : '비노출'}
                          </button>
                        </div>
                        {activeSection === 'field_sketch' ? (
                          <p className="mt-1 truncate text-[13px] font-extrabold text-[#333]">{item.caption || '(캡션 없음)'}</p>
                        ) : null}
                        <div className="mt-auto flex items-center gap-1.5 pt-2">
                          <button
                            className="rounded-[8px] bg-[#f2f4f6] px-2 py-1 text-[12px] font-black text-[#555] disabled:opacity-40"
                            disabled={index === 0 || busy}
                            onClick={() => void handleMove(index, -1)}
                            type="button"
                          >
                            ↑
                          </button>
                          <button
                            className="rounded-[8px] bg-[#f2f4f6] px-2 py-1 text-[12px] font-black text-[#555] disabled:opacity-40"
                            disabled={index === sectionItems.length - 1 || busy}
                            onClick={() => void handleMove(index, 1)}
                            type="button"
                          >
                            ↓
                          </button>
                          <button className="ml-auto text-[12px] font-black text-meet-blue" onClick={() => setEditing(item)} type="button">
                            수정
                          </button>
                          <button className="text-[12px] font-black text-[#e0554a]" onClick={() => void handleDelete(item)} type="button">
                            삭제
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {sectionItems.length === 0 ? (
                    <p className="pt-6 text-center text-[13px] font-bold text-[#999]">등록된 이미지가 없습니다.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-[16px] border border-dashed border-[#d8dee4] bg-[#fafbfc] p-6 text-center text-[13px] font-bold text-[#999]">
                이 섹션은 관리 구조만 준비되어 있습니다.
              </div>
            )}
          </div>
        )}
      </div>

      {uploadOpen ? (
        <HomeContentUploadModal
          onClose={() => setUploadOpen(false)}
          onSaved={(created) => {
            setUploadOpen(false);
            replaceItems((current) => [...current, created]);
          }}
          section={activeSection}
          withCaption={activeSection === 'field_sketch'}
        />
      ) : null}

      {editing ? (
        <HomeContentEditModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(caption, crop) => {
            replaceItems((current) =>
              current.map((row) => (row.id === editing.id ? { ...row, caption, cropPosition: crop } : row)),
            );
            setEditing(null);
          }}
          withCaption={editing.sectionType === 'field_sketch'}
        />
      ) : null}
    </main>
  );
}

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-5">
      <div className="max-h-[90vh] w-full max-w-[380px] overflow-y-auto rounded-[22px] bg-white p-5 shadow-calendar">{children}</div>
    </div>
  );
}

function HomeContentUploadModal({
  onClose,
  onSaved,
  section,
  withCaption,
}: {
  onClose: () => void;
  onSaved: (created: AdminHomeContent) => void;
  section: HomeContentSection;
  withCaption: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [crop, setCrop] = useState<HomeContentCrop>(DEFAULT_CROP);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setCrop(DEFAULT_CROP);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleSave = async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      const created = await uploadHomeContent(section, file, withCaption ? caption.trim() : '', crop);
      onSaved(created);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '업로드에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell>
      <h2 className="text-[17px] font-black">이미지 추가</h2>
      <input
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        ref={fileInputRef}
        type="file"
      />
      {!file ? (
        <button
          className="mt-4 h-28 w-full rounded-[16px] border-2 border-dashed border-[#cdd5dc] text-[13px] font-black text-[#8a94a0]"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          이미지 파일 선택 (JPG / PNG / WEBP)
        </button>
      ) : (
        <div className="mt-4">
          {previewUrl ? (
            <HomeContentCropEditor aspectRatio={homeContentAspectRatio(section)} imageUrl={previewUrl} onChange={setCrop} value={crop} />
          ) : null}
          <button className="mt-2 text-[12px] font-black text-meet-blue" onClick={() => fileInputRef.current?.click()} type="button">
            다른 파일 선택
          </button>
        </div>
      )}

      {withCaption ? (
        <label className="mt-4 block">
          <span className="text-[12px] font-black text-[#666]">캡션 / 해시태그 (선택)</span>
          <input
            className="mt-1.5 h-11 w-full rounded-[12px] bg-[#f5f6f8] px-3 text-[14px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
            onChange={(event) => setCaption(event.target.value)}
            placeholder="#편안한 분위기"
            value={caption}
          />
        </label>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="h-12 rounded-[14px] bg-[#e8e8e8] text-[14px] font-black text-black" onClick={onClose} type="button">
          취소
        </button>
        <button
          className="h-12 rounded-[14px] bg-meet-blue text-[14px] font-black text-white disabled:opacity-50"
          disabled={!file || saving}
          onClick={() => void handleSave()}
          type="button"
        >
          {saving ? '업로드 중' : '저장'}
        </button>
      </div>
    </ModalShell>
  );
}

function HomeContentEditModal({
  item,
  onClose,
  onSaved,
  withCaption,
}: {
  item: AdminHomeContent;
  onClose: () => void;
  onSaved: (caption: string, crop: HomeContentCrop) => void;
  withCaption: boolean;
}) {
  const [crop, setCrop] = useState<HomeContentCrop>(item.cropPosition);
  const [caption, setCaption] = useState(item.caption);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const nextCaption = withCaption ? caption.trim() : item.caption;
      await updateHomeContent(item.id, nextCaption, crop);
      onSaved(nextCaption, crop);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '수정에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell>
      <h2 className="text-[17px] font-black">이미지 수정</h2>
      <div className="mt-4">
        {item.imageUrl ? (
          <HomeContentCropEditor
            aspectRatio={homeContentAspectRatio(item.sectionType)}
            imageUrl={item.imageUrl}
            onChange={setCrop}
            value={crop}
          />
        ) : (
          <p className="text-[13px] font-bold text-[#999]">이미지를 불러올 수 없습니다.</p>
        )}
      </div>

      {withCaption ? (
        <label className="mt-4 block">
          <span className="text-[12px] font-black text-[#666]">캡션 / 해시태그 (선택)</span>
          <input
            className="mt-1.5 h-11 w-full rounded-[12px] bg-[#f5f6f8] px-3 text-[14px] font-bold outline-none focus:ring-2 focus:ring-meet-blue"
            onChange={(event) => setCaption(event.target.value)}
            placeholder="#편안한 분위기"
            value={caption}
          />
        </label>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="h-12 rounded-[14px] bg-[#e8e8e8] text-[14px] font-black text-black" onClick={onClose} type="button">
          취소
        </button>
        <button
          className="h-12 rounded-[14px] bg-meet-blue text-[14px] font-black text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void handleSave()}
          type="button"
        >
          {saving ? '저장 중' : '저장'}
        </button>
      </div>
    </ModalShell>
  );
}
