import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  fetchAdminProfileKeywords,
  setAdminProfileKeywordActive,
  upsertAdminProfileKeyword,
  type AdminProfileKeyword,
} from '../services/supabaseApplications';

// 프로필 카드 "나를 표현하는 키워드" 관리 - AdminConversationTopicsPage와
// 동일한 목록/추가/수정/비활성 CRUD 패턴을 재사용한다. "삭제"는 실제
// delete가 아니라 비활성 토글이다 - key가 참가자 카드에 이미 저장돼
// 있으므로 실제로 지우면 과거 카드 표시가 깨진다.
export default function AdminProfileKeywordsPage() {
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState<AdminProfileKeyword[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editSortOrder, setEditSortOrder] = useState('0');
  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [savePending, setSavePending] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setKeywords(await fetchAdminProfileKeywords());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '키워드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (keyword: AdminProfileKeyword) => {
    setEditingKey(keyword.key);
    setEditLabel(keyword.label);
    setEditSortOrder(String(keyword.sortOrder));
  };

  const cancelEdit = () => setEditingKey(null);

  const saveEdit = async (key: string) => {
    if (!editLabel.trim() || savePending) return;
    setSavePending(true);
    try {
      await upsertAdminProfileKeyword(key, editLabel, Number(editSortOrder) || 0);
      setEditingKey(null);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '키워드를 수정하지 못했습니다.');
    } finally {
      setSavePending(false);
    }
  };

  const toggleActive = async (keyword: AdminProfileKeyword) => {
    try {
      await setAdminProfileKeywordActive(keyword.key, !keyword.isActive);
      setKeywords((current) => current?.map((item) => (item.key === keyword.key ? { ...item, isActive: !keyword.isActive } : item)) ?? null);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '상태를 변경하지 못했습니다.');
    }
  };

  const submitNewKeyword = async () => {
    const cleanKey = newKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleanKey || !newLabel.trim() || savePending) return;
    setSavePending(true);
    try {
      await upsertAdminProfileKeyword(cleanKey, newLabel);
      setNewKey('');
      setNewLabel('');
      setAddOpen(false);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '키워드를 추가하지 못했습니다.');
    } finally {
      setSavePending(false);
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
          <h1 className="text-[22px] font-black">키워드 관리</h1>
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
            <p className="text-[13px] font-extrabold text-[#8a8a8a]">
              행사 프로필 카드의 "나를 표현하는 키워드"에 사용됩니다. 총 {keywords?.length ?? 0}개 · 사용중{' '}
              {keywords?.filter((keyword) => keyword.isActive).length ?? 0}개
            </p>
            <p className="mt-1 text-[12px] font-bold text-[#bbb]">
              참가자가 직접 입력한 키워드는 여기 자동으로 등록되지 않습니다. "삭제"는 목록에서 완전히 지우지 않고 미사용으로
              전환해 이미 저장된 참가자 카드가 깨지지 않게 합니다.
            </p>

            <div className="mt-3 flex justify-end">
              <button
                className="rounded-[10px] bg-[#1f292d] px-3 py-1.5 text-[12px] font-black text-white"
                onClick={() => setAddOpen((open) => !open)}
                type="button"
              >
                {addOpen ? '취소' : '+ 새 키워드'}
              </button>
            </div>

            {addOpen ? (
              <div className="mt-3 rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
                <input
                  className="h-10 w-full rounded-[10px] bg-[#f7f8fa] px-3 text-[13px] font-bold outline-none"
                  onChange={(event) => setNewKey(event.target.value)}
                  placeholder="key (영문, 예: likes_coffee) - 저장 후 변경 불가"
                  value={newKey}
                />
                <input
                  className="mt-2 h-10 w-full rounded-[10px] bg-[#f7f8fa] px-3 text-[13px] font-bold outline-none"
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder="화면에 보일 문구 (예: #커피좋아함)"
                  value={newLabel}
                />
                <div className="mt-2 flex justify-end">
                  <button
                    className="h-10 rounded-[10px] bg-meet-pink px-5 text-[13px] font-black text-white disabled:opacity-50"
                    disabled={!newKey.trim() || !newLabel.trim() || savePending}
                    onClick={() => void submitNewKeyword()}
                    type="button"
                  >
                    추가
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-2.5 pb-6">
              {keywords?.map((keyword) => (
                <article className="rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm" key={keyword.key}>
                  {editingKey === keyword.key ? (
                    <div>
                      <p className="text-[11px] font-black text-[#bbb]">key: {keyword.key}</p>
                      <input
                        className="mt-1.5 h-10 w-full rounded-[10px] bg-[#f7f8fa] px-3 text-[14px] font-bold outline-none"
                        onChange={(event) => setEditLabel(event.target.value)}
                        value={editLabel}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          className="h-10 w-20 rounded-[10px] bg-[#f7f8fa] px-3 text-[13px] font-black outline-none"
                          inputMode="numeric"
                          onChange={(event) => setEditSortOrder(event.target.value)}
                          value={editSortOrder}
                        />
                        <span className="text-[12px] font-bold text-[#999]">표시 순서</span>
                        <div className="ml-auto flex gap-2">
                          <button className="h-10 rounded-[10px] px-4 text-[13px] font-black text-[#888]" onClick={cancelEdit} type="button">
                            취소
                          </button>
                          <button
                            className="h-10 rounded-[10px] bg-meet-pink px-4 text-[13px] font-black text-white disabled:opacity-50"
                            disabled={savePending}
                            onClick={() => void saveEdit(keyword.key)}
                            type="button"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-extrabold text-[#333]">{keyword.label}</p>
                        <p className="text-[11px] font-bold text-[#bbb]">key: {keyword.key} · 순서 {keyword.sortOrder}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          className={[
                            'rounded-[8px] px-2.5 py-1 text-[11px] font-black',
                            keyword.isActive ? 'bg-[#e8f8ee] text-[#2f9e5c]' : 'bg-[#f2f2f2] text-[#999]',
                          ].join(' ')}
                          onClick={() => void toggleActive(keyword)}
                          type="button"
                        >
                          {keyword.isActive ? '사용' : '미사용'}
                        </button>
                        <button className="text-[12px] font-black text-meet-blue" onClick={() => startEdit(keyword)} type="button">
                          수정
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
              {keywords?.length === 0 ? <p className="pt-6 text-center text-[13px] font-bold text-[#999]">등록된 키워드가 없습니다.</p> : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
