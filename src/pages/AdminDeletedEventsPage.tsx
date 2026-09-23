import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  fetchAdminDeletedEvents,
  restoreDeletedEvent,
  type AdminDeletedEventSummary,
} from '../services/supabaseApplications';

// 관리자 '삭제된 행사' 목록 - 삭제 요청 후 72시간 유예기간 중인 행사만
// 여기서 보인다(예정/종료 행사 목록에는 더 이상 나타나지 않는다). 여기서는
// 오직 복구하기만 할 수 있고, 참가자 관리/행사 수정/행사모드 등은 전부
// AdminEventParticipantsPage 쪽에서 event가 목록에 없다는 이유로 이미
// 막혀 있다.
export default function AdminDeletedEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<AdminDeletedEventSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<AdminDeletedEventSummary | null>(null);
  // 남은 유예기간 표시가 계속 흘러가도록 1분마다 다시 그린다 - 서버 값
  // 자체(scheduledPurgeAt)는 그대로 두고 화면 렌더링만 다시 트리거한다.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEvents(await fetchAdminDeletedEvents());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '삭제된 행사 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoringId(restoreTarget.id);
    try {
      await restoreDeletedEvent(restoreTarget.id);
      setRestoreTarget(null);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '행사를 복구하지 못했습니다.');
    } finally {
      setRestoringId(null);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto flex min-h-screen w-full max-w-full min-w-0 flex-col px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <h1 className="mt-6 text-[24px] font-black">삭제된 행사</h1>
        <p className="mt-1 text-[13px] font-bold text-[#8a93a3]">
          삭제 요청 후 72시간 동안 이 목록에 남아 있으며, 그 안에는 복구할 수 있습니다. 유예기간이 지나면 자동으로 영구 삭제됩니다.
        </p>

        <div className="mt-6 space-y-4">
          {events.length === 0 ? (
            <div className="rounded-[22px] border border-[#ececec] bg-white px-5 py-10 text-center shadow-sm">
              <p className="text-[15px] font-black text-[#888]">삭제 대기 중인 행사가 없습니다</p>
            </div>
          ) : (
            events.map((event) => (
              <DeletedEventCard
                event={event}
                key={event.id}
                onRestore={() => setRestoreTarget(event)}
                restoring={restoringId === event.id}
              />
            ))
          )}
        </div>

        <button
          className="mx-auto mt-8 text-sm font-extrabold text-meet-blue"
          onClick={() => navigate('/admin/events')}
          type="button"
        >
          행사 관리로 돌아가기
        </button>
      </div>

      {restoreTarget ? (
        <RestoreConfirmModal
          event={restoreTarget}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={() => void handleRestore()}
          restoring={restoringId === restoreTarget.id}
        />
      ) : null}
    </main>
  );
}

function DeletedEventCard({
  event,
  onRestore,
  restoring,
}: {
  event: AdminDeletedEventSummary;
  onRestore: () => void;
  restoring: boolean;
}) {
  const remaining = formatRemaining(event.scheduledPurgeAt);

  return (
    <article className="rounded-[22px] border border-[#f2dfe2] bg-white px-5 py-5 shadow-calendar">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-fluid-safe text-[18px] font-black leading-tight">
          {event.title}
          {event.isTestEvent ? <span className="ml-2 text-[12px] font-black text-meet-blue">🧪 TEST</span> : null}
        </h2>
      </div>
      <dl className="mt-3 space-y-1.5 text-[13px] font-bold text-[#666]">
        <div className="flex gap-2">
          <dt className="shrink-0 text-[#999]">행사일</dt>
          <dd>{formatFullDate(event.date)} {event.startTime}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-[#999]">삭제 요청</dt>
          <dd>{formatFullDateTime(event.deletedAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-[#999]">영구 삭제 예정</dt>
          <dd>{formatFullDateTime(event.scheduledPurgeAt)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[14px] font-black text-meet-pink">
        {remaining ? `남은 기간: ${remaining}` : '곧 영구 삭제됩니다'}
      </p>
      {event.purgeAttemptCount > 0 ? (
        <p className="mt-2 rounded-[12px] bg-[#fff2ef] px-3 py-2 text-[12px] font-bold leading-relaxed text-meet-pink">
          ⚠️ 영구 삭제 절차가 이미 시작되어({event.purgeAttemptCount}번 시도{event.purgeLastError ? `, 최근 오류: ${event.purgeLastError}` : ''}) 더 이상 복구할 수 없습니다. 계속 자동으로 재시도됩니다.
        </p>
      ) : null}
      <button
        className="mt-4 h-12 w-full rounded-[14px] bg-meet-blue text-[14px] font-black text-white transition active:scale-[0.99] disabled:opacity-50"
        disabled={restoring || event.purgeAttemptCount > 0}
        onClick={onRestore}
        type="button"
      >
        {restoring ? '복구 중' : '복구하기'}
      </button>
    </article>
  );
}

function RestoreConfirmModal({
  event,
  onCancel,
  onConfirm,
  restoring,
}: {
  event: AdminDeletedEventSummary;
  onCancel: () => void;
  onConfirm: () => void;
  restoring: boolean;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5" onClick={onCancel} role="dialog">
      <section className="w-full max-w-[340px] rounded-[24px] bg-white p-6 text-center shadow-calendar" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <h2 className="text-[19px] font-black">이 행사를 복구하시겠습니까?</h2>
        <p className="mt-3 text-[14px] font-extrabold leading-relaxed text-[#666]">
          복구하면 행사와 참가자 티켓이 삭제 이전 상태로 돌아갑니다.
        </p>
        <p className="mt-2 text-[13px] font-bold text-[#999]">{event.title}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className="h-12 rounded-[16px] bg-[#eee] text-[14px] font-black text-black" onClick={onCancel} type="button">
            취소
          </button>
          <button
            className="h-12 rounded-[16px] bg-meet-blue text-[14px] font-black text-white disabled:opacity-50"
            disabled={restoring}
            onClick={onConfirm}
            type="button"
          >
            {restoring ? '복구 중' : '복구하기'}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatFullDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}(${dayNames[date.getDay()]})`;
}

function formatFullDateTime(isoValue: string) {
  const date = new Date(isoValue);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}(${dayNames[date.getDay()]}) ${hour}:${minute}`;
}

// "n일 n시간" 단위로 남은 유예기간을 표시한다(scheduledPurgeAt은 서버가
// 저장한 절대 시각이라, 새로고침/재로그인해도 항상 정확하게 다시 계산된다).
function formatRemaining(scheduledPurgeAtValue: string) {
  const remainingMs = new Date(scheduledPurgeAtValue).getTime() - Date.now();
  if (remainingMs <= 0) return null;
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}
