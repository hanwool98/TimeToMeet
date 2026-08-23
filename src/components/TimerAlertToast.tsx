import type { TabletTimerAlertToast } from '../hooks/useTabletTimerAlerts';

// Small pill, not a modal - deliberately doesn't cover the timer/round info
// underneath. Shown regardless of whether the audio chime actually played,
// since a failed/blocked sound must never mean the operator's guests get no
// signal at all that time is almost up.
export default function TimerAlertToast({ toast }: { toast: TabletTimerAlertToast | null }) {
  if (!toast) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[65] flex justify-center"
      key={toast.key}
      style={{ top: 'max(64px, calc(env(safe-area-inset-top) + 56px))' }}
    >
      <div className="pointer-events-auto rounded-full bg-[#1f292d]/90 px-5 py-2.5 text-[15px] font-black text-white shadow-lg">
        {toast.type === 'warning' ? '🔔 1분 남았습니다' : '🔔 시간 종료'}
      </div>
    </div>
  );
}
