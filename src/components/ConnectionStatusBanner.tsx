const defaultLines = ['연결이 불안정합니다. 행사 진행 상태를 다시 확인하고 있어요.'];

// Overlay shown on top of the existing screen (not a replacement for it)
// when a live event-mode screen hasn't heard back from the server in a
// while - see src/utils/connectionStatus.ts for the staleness rule.
// `lines` lets a specific screen (e.g. the server-timer-dependent tablet)
// use stronger wording without changing the default shown elsewhere.
export default function ConnectionStatusBanner({ lines = defaultLines, visible }: { lines?: string[]; visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#333] px-4 py-2.5 text-center text-[13px] font-bold text-white shadow-lg">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#ffb020]" />
        <span>
          {lines.map((line, index) => (
            <span key={line}>
              {index > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
