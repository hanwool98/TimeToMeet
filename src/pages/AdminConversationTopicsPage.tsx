import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  createConversationTopic,
  deleteConversationTopic,
  fetchAdminConversationTopics,
  setConversationTopicActive,
  updateConversationTopic,
  type ConversationTopic,
} from '../services/supabaseApplications';

const categories = ['밸런스게임', '일반 대화주제'];
type CategoryFilter = '전체' | (typeof categories)[number];

export default function AdminConversationTopicsPage() {
  const navigate = useNavigate();
  const [topics, setTopics] = useState<ConversationTopic[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>('전체');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState(categories[0]);
  const [addOpen, setAddOpen] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState(categories[0]);
  const [savePending, setSavePending] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setTopics(await fetchAdminConversationTopics());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '대화주제를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!topics) return [];
    if (filter === '전체') return topics;
    return topics.filter((topic) => topic.category === filter);
  }, [topics, filter]);

  const startEdit = (topic: ConversationTopic) => {
    setEditingId(topic.id);
    setEditContent(topic.content);
    setEditCategory(topic.category);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (topicId: string) => {
    if (!editContent.trim() || savePending) return;
    setSavePending(true);
    try {
      await updateConversationTopic(topicId, editContent, editCategory);
      setEditingId(null);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '질문을 수정하지 못했습니다.');
    } finally {
      setSavePending(false);
    }
  };

  const toggleActive = async (topic: ConversationTopic) => {
    try {
      await setConversationTopicActive(topic.id, !topic.isActive);
      setTopics((current) => current?.map((item) => (item.id === topic.id ? { ...item, isActive: !topic.isActive } : item)) ?? null);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '상태를 변경하지 못했습니다.');
    }
  };

  const removeTopic = async (topic: ConversationTopic) => {
    if (!window.confirm('이 대화주제를 삭제하시겠습니까?')) return;
    try {
      await deleteConversationTopic(topic.id);
      setTopics((current) => current?.filter((item) => item.id !== topic.id) ?? null);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '질문을 삭제하지 못했습니다.');
    }
  };

  const submitNewTopic = async () => {
    if (!newContent.trim() || savePending) return;
    setSavePending(true);
    try {
      await createConversationTopic(newContent, newCategory);
      setNewContent('');
      setAddOpen(false);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '질문을 추가하지 못했습니다.');
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
          <h1 className="text-[22px] font-black">대화주제 관리</h1>
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
              태블릿 라운드 화면의 대화주제 카드뭉치에 사용됩니다. 총 {topics?.length ?? 0}개 · 사용중 {topics?.filter((topic) => topic.isActive).length ?? 0}개
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {(['전체', ...categories] as CategoryFilter[]).map((option) => (
                <button
                  className={[
                    'rounded-[10px] px-3 py-1.5 text-[12px] font-black transition',
                    filter === option ? 'bg-meet-pink text-white' : 'bg-meet-pinkSoft text-meet-pink',
                  ].join(' ')}
                  key={option}
                  onClick={() => setFilter(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
              <button
                className="ml-auto rounded-[10px] bg-[#1f292d] px-3 py-1.5 text-[12px] font-black text-white"
                onClick={() => setAddOpen((open) => !open)}
                type="button"
              >
                {addOpen ? '취소' : '+ 새 대화주제'}
              </button>
            </div>

            {addOpen ? (
              <div className="mt-3 rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
                <textarea
                  className="h-20 w-full resize-none rounded-[12px] bg-[#f7f8fa] p-3 text-[14px] font-bold outline-none"
                  onChange={(changeEvent) => setNewContent(changeEvent.target.value)}
                  placeholder="새 대화주제 내용을 입력하세요"
                  value={newContent}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <select
                    className="h-10 rounded-[10px] bg-[#f7f8fa] px-3 text-[13px] font-black outline-none"
                    onChange={(changeEvent) => setNewCategory(changeEvent.target.value)}
                    value={newCategory}
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <button
                    className="h-10 rounded-[10px] bg-meet-pink px-5 text-[13px] font-black text-white disabled:opacity-50"
                    disabled={!newContent.trim() || savePending}
                    onClick={() => void submitNewTopic()}
                    type="button"
                  >
                    추가
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-2.5 pb-6">
              {filtered.map((topic) => (
                <article className="rounded-[16px] border border-[#f0f3f6] bg-white p-4 shadow-sm" key={topic.id}>
                  {editingId === topic.id ? (
                    <div>
                      <textarea
                        className="h-20 w-full resize-none rounded-[12px] bg-[#f7f8fa] p-3 text-[14px] font-bold outline-none"
                        onChange={(changeEvent) => setEditContent(changeEvent.target.value)}
                        value={editContent}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <select
                          className="h-10 rounded-[10px] bg-[#f7f8fa] px-3 text-[13px] font-black outline-none"
                          onChange={(changeEvent) => setEditCategory(changeEvent.target.value)}
                          value={editCategory}
                        >
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                        <div className="ml-auto flex gap-2">
                          <button className="h-10 rounded-[10px] px-4 text-[13px] font-black text-[#888]" onClick={cancelEdit} type="button">
                            취소
                          </button>
                          <button
                            className="h-10 rounded-[10px] bg-meet-pink px-4 text-[13px] font-black text-white disabled:opacity-50"
                            disabled={savePending}
                            onClick={() => void saveEdit(topic.id)}
                            type="button"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded-[8px] bg-meet-pinkSoft px-2 py-0.5 text-[11px] font-black text-meet-pink">{topic.category}</span>
                        <button
                          className={[
                            'shrink-0 rounded-[8px] px-2.5 py-1 text-[11px] font-black',
                            topic.isActive ? 'bg-[#e8f8ee] text-[#2f9e5c]' : 'bg-[#f2f2f2] text-[#999]',
                          ].join(' ')}
                          onClick={() => void toggleActive(topic)}
                          type="button"
                        >
                          {topic.isActive ? '사용' : '미사용'}
                        </button>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[14px] font-extrabold leading-relaxed text-[#333]">{topic.content}</p>
                      <div className="mt-2 flex justify-end gap-3">
                        <button className="text-[12px] font-black text-meet-blue" onClick={() => startEdit(topic)} type="button">
                          수정
                        </button>
                        <button className="text-[12px] font-black text-[#e0554a]" onClick={() => void removeTopic(topic)} type="button">
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
              {filtered.length === 0 ? <p className="pt-6 text-center text-[13px] font-bold text-[#999]">등록된 대화주제가 없습니다.</p> : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
