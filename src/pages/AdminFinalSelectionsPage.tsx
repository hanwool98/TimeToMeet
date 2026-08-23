import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  fetchAdminFinalSelectionEvents,
  type AdminFinalSelectionEventSummary,
} from '../services/supabaseApplications';

export default function AdminFinalSelectionsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<AdminFinalSelectionEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await fetchAdminFinalSelectionEvents());
      setError('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '최종선택 기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;

  return (
    <main className="admin-page min-h-screen w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full min-w-0 px-4 pb-10 pt-4 min-[390px]:px-5">
        <header className="flex min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-black">최종선택</h1>
          <button className="shrink-0 text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/content')} type="button">
            ← 콘텐츠 관리
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {events.length === 0 ? (
            <section className="rounded-[20px] border border-[#eef3f7] bg-white px-5 py-12 text-center shadow-calendar">
              <p className="text-[15px] font-bold text-[#999]">최종선택 기록이 없습니다.</p>
            </section>
          ) : (
            events.map((event) => (
              <button
                className="w-full min-w-0 rounded-[18px] border border-[#eef3f7] bg-white px-4 py-4 text-left shadow-calendar transition active:scale-[0.99]"
                key={event.eventId}
                onClick={() => navigate(`/admin/content/final-selections/${encodeURIComponent(event.eventId)}`)}
                type="button"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-keep text-[17px] font-black leading-snug">{event.title}</p>
                    <p className="mt-1 text-[13px] font-bold text-[#888]">{formatDate(event.eventDate)}</p>
                  </div>
                  <ChevronRight />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-bold text-[#666]">
                  <p className="rounded-[10px] bg-[#f7f9fb] px-3 py-2">최종선택 {event.submittedCount}/{event.totalParticipants}</p>
                  <p className="rounded-[10px] bg-[#fff2f4] px-3 py-2 text-[#e64c70]">상호 매칭 {event.mutualMatchCount}쌍</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day}`;
}

function ChevronRight() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-[#9aa1aa]" fill="none" viewBox="0 0 24 24">
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" />
    </svg>
  );
}
