import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import {
  fetchAdminPreroundSeatPlan,
  movePreroundSeat,
  setParticipantAttendanceStatus,
  setPreroundLateFlag,
  type AdminPreroundSeat,
} from '../services/supabaseApplications';

// 자리유도(get_event_table_seat_guide_by_roster)가 실제로 쓰고 있는 배치를
// 그대로 보여준다 - 여기서 새로 배치를 만드는 게 아니라, 이미 체크인 즉시
// 반영되고 있는 기존 배치를 운영자가 확인/수정하는 화면이다. 1라운드가
// 시작되면(roundOneStarted) 그 이후로는 수정할 수 없다(기존 라운드
// 로테이션 보호).
export default function AdminPreroundSeatsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [rows, setRows] = useState<AdminPreroundSeat[]>([]);
  const [roundOneStarted, setRoundOneStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyApplicationId, setBusyApplicationId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ applicationId: string; gender: 'male' | 'female'; nickname: string } | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    try {
      const result = await fetchAdminPreroundSeatPlan(eventId);
      setRows(result.rows);
      setRoundOneStarted(result.roundOneStarted);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '자리배치를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleLate = async (applicationId: string, nextLate: boolean) => {
    setBusyApplicationId(applicationId);
    try {
      await setPreroundLateFlag(applicationId, nextLate);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '지각 표시 변경에 실패했습니다.');
    } finally {
      setBusyApplicationId(null);
    }
  };

  const handleCancel = async (applicationId: string, nickname: string) => {
    if (!window.confirm(`${nickname}님을 참여취소 처리할까요?\n로테이션에서 제외되고, 남은 인원 기준으로 자리가 다시 정리됩니다.`)) return;
    setBusyApplicationId(applicationId);
    try {
      await setParticipantAttendanceStatus(applicationId, 'no_show');
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '참여취소 처리에 실패했습니다.');
    } finally {
      setBusyApplicationId(null);
    }
  };

  const handleMoveConfirm = async (targetTableNumber: number) => {
    if (!eventId || !moveTarget) return;
    setBusyApplicationId(moveTarget.applicationId);
    try {
      await movePreroundSeat(eventId, moveTarget.applicationId, targetTableNumber);
      setMoveTarget(null);
      await load();
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '자리 이동에 실패했습니다.');
    } finally {
      setBusyApplicationId(null);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-[#fffaf4] text-[#1f292d]">
      <div className="mx-auto min-h-screen w-full max-w-[430px] px-5 pb-[calc(32px+env(safe-area-inset-bottom))] pt-[calc(18px+env(safe-area-inset-top))]">
        <header className="flex items-center gap-3">
          <button
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#333]"
            onClick={() => navigate(`/admin/events/${eventId}/prepare`)}
            type="button"
          >
            <BackIcon />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-[19px] font-black">자리배치 확인</h1>
          <span className="w-10 shrink-0" />
        </header>

        {roundOneStarted ? (
          <section className="mt-5 rounded-[16px] bg-[#fff1ee] px-4 py-3 text-center">
            <p className="text-[13px] font-black text-[#a35850]">이미 1라운드가 시작되어 자리를 수정할 수 없습니다</p>
          </section>
        ) : (
          <section className="mt-5 rounded-[16px] bg-[#f2f4f7] px-4 py-3 text-center">
            <p className="text-[13px] font-bold text-[#666]">체크인 즉시 반영되는 실제 자리배치입니다. 행사 시작 전까지 자유롭게 수정할 수 있어요.</p>
          </section>
        )}

        <div className="mt-5 space-y-3">
          {rows.map((row) => (
            <div className="rounded-[20px] border border-[#f0f3f6] bg-white p-4 shadow-sm" key={row.tableNumber}>
              <p className="mb-3 text-[13px] font-black text-[#999]">테이블 {row.tableNumber}</p>
              <div className="grid grid-cols-2 gap-3">
                <SeatSlot
                  applicationId={row.maleApplicationId}
                  busy={busyApplicationId === row.maleApplicationId}
                  checkedIn={row.maleCheckedIn}
                  disabled={roundOneStarted}
                  isLate={row.maleIsLate}
                  nickname={row.maleNickname}
                  onCancel={() => row.maleApplicationId && row.maleNickname && void handleCancel(row.maleApplicationId, row.maleNickname)}
                  onMove={() => row.maleApplicationId && row.maleNickname && setMoveTarget({ applicationId: row.maleApplicationId, gender: 'male', nickname: row.maleNickname })}
                  onToggleLate={(next) => row.maleApplicationId && void handleToggleLate(row.maleApplicationId, next)}
                  tone="male"
                />
                <SeatSlot
                  applicationId={row.femaleApplicationId}
                  busy={busyApplicationId === row.femaleApplicationId}
                  checkedIn={row.femaleCheckedIn}
                  disabled={roundOneStarted}
                  isLate={row.femaleIsLate}
                  nickname={row.femaleNickname}
                  onCancel={() => row.femaleApplicationId && row.femaleNickname && void handleCancel(row.femaleApplicationId, row.femaleNickname)}
                  onMove={() => row.femaleApplicationId && row.femaleNickname && setMoveTarget({ applicationId: row.femaleApplicationId, gender: 'female', nickname: row.femaleNickname })}
                  onToggleLate={(next) => row.femaleApplicationId && void handleToggleLate(row.femaleApplicationId, next)}
                  tone="female"
                />
              </div>
            </div>
          ))}
          {rows.length === 0 ? <p className="py-10 text-center text-[13px] font-bold text-[#999]">참가 확정된 인원이 없습니다.</p> : null}
        </div>
      </div>

      {moveTarget ? (
        <MoveSheet
          currentTableNumbers={rows.map((row) => row.tableNumber)}
          gender={moveTarget.gender}
          nickname={moveTarget.nickname}
          onClose={() => setMoveTarget(null)}
          onSelect={(tableNumber) => void handleMoveConfirm(tableNumber)}
          rows={rows}
        />
      ) : null}
    </main>
  );
}

function SeatSlot({
  applicationId,
  busy,
  checkedIn,
  disabled,
  isLate,
  nickname,
  onCancel,
  onMove,
  onToggleLate,
  tone,
}: {
  applicationId?: string;
  busy: boolean;
  checkedIn: boolean;
  disabled: boolean;
  isLate: boolean;
  nickname?: string;
  onCancel: () => void;
  onMove: () => void;
  onToggleLate: (next: boolean) => void;
  tone: 'male' | 'female';
}) {
  if (!applicationId || !nickname) {
    return (
      <div className="rounded-[14px] bg-[#fafafa] px-3 py-3 text-center">
        <p className="text-[12px] font-black text-[#999]">자리 없음</p>
      </div>
    );
  }

  return (
    <div className={['rounded-[14px] px-3 py-3', tone === 'male' ? 'bg-[#eef4fc]' : 'bg-[#fbeaf0]'].join(' ')}>
      <button
        className="block w-full truncate text-left text-[14px] font-black disabled:opacity-60"
        disabled={disabled || busy}
        onClick={onMove}
        type="button"
      >
        {nickname}
      </button>
      <p className="mt-0.5 text-[11px] font-bold text-[#888]">{checkedIn ? '체크인 완료' : '체크인 전'}</p>

      <div className="mt-2 flex gap-1.5">
        <button
          className={[
            'h-7 flex-1 rounded-full text-[11px] font-black disabled:opacity-50',
            isLate ? 'bg-[#f0a742] text-white' : 'border border-[#ddd] bg-white text-[#666]',
          ].join(' ')}
          disabled={disabled || busy}
          onClick={() => onToggleLate(!isLate)}
          type="button"
        >
          {isLate ? '지각 표시됨' : '지각'}
        </button>
        <button
          className="h-7 flex-1 rounded-full border border-[#ef554a]/50 bg-white text-[11px] font-black text-[#ef554a] disabled:opacity-50"
          disabled={disabled || busy}
          onClick={onCancel}
          type="button"
        >
          참여취소
        </button>
      </div>
    </div>
  );
}

function MoveSheet({
  currentTableNumbers,
  gender,
  nickname,
  onClose,
  onSelect,
  rows,
}: {
  currentTableNumbers: number[];
  gender: 'male' | 'female';
  nickname: string;
  onClose: () => void;
  onSelect: (tableNumber: number) => void;
  rows: AdminPreroundSeat[];
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <h3 className="mt-4 text-[16px] font-black">{nickname}님을 어느 테이블로 이동할까요?</h3>
        <p className="mt-1 text-[12px] font-bold text-[#999]">선택한 테이블에 이미 있는 사람과 자리가 서로 바뀝니다</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {currentTableNumbers.map((tableNumber) => {
            const row = rows.find((item) => item.tableNumber === tableNumber);
            const occupant = gender === 'male' ? row?.maleNickname : row?.femaleNickname;
            return (
              <button
                className="rounded-[14px] border border-[#eee] bg-[#fafafa] py-3 text-center"
                key={tableNumber}
                onClick={() => onSelect(tableNumber)}
                type="button"
              >
                <p className="text-[13px] font-black">{tableNumber}번</p>
                <p className="mt-0.5 truncate text-[11px] font-bold text-[#999]">{occupant ?? '빈자리'}</p>
              </button>
            );
          })}
        </div>
        <button className="mt-4 h-11 w-full rounded-[14px] border border-[#ddd] text-[14px] font-black text-[#555]" onClick={onClose} type="button">
          취소
        </button>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}
