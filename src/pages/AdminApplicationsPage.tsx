import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import useOperationalData from '../hooks/useOperationalData';
import { confirmBankTransferInSupabase, fetchAdminApplicationFiles, rejectBankTransferInSupabase, resetGuestPinForAdmin, updateApplicationReviewInSupabase } from '../services/supabaseApplications';
import type { AdminApplicationFiles, SignedApplicationFile } from '../services/supabaseApplications';
import type { StoredApplication } from '../utils/adminApplications';

type ApplicationTab = 'review' | 'waiting' | 'payment' | 'completed';

const tabs: Array<{ id: ApplicationTab; label: string }> = [
  { id: 'review', label: '프로필 심사' },
  { id: 'waiting', label: '참여 대기자 관리' },
  { id: 'payment', label: '결제 환불' },
  { id: 'completed', label: '심사 완료' },
];

const filterOptions = ['성별', '나이', '재참여 여부', '심사대기', '참여확정', '반려'];

export default function AdminApplicationsPage() {
  const navigate = useNavigate();
  const { applications, error, loading, reload } = useOperationalData({ admin: true });
  const [activeTab, setActiveTab] = useState<ApplicationTab>('review');
  const [dateFilter, setDateFilter] = useState('전체');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('성별');
  const [reviewingApplication, setReviewingApplication] = useState<StoredApplication | null>(null);
  const [actionError, setActionError] = useState('');

  const dateOptions = useMemo(() => {
    const byEventId = new Map<string, string>();
    for (const application of applications) {
      if (!application.eventId) continue;
      byEventId.set(application.eventId, `${application.eventDate} ${application.eventType}`);
    }
    return [
      { label: '전체', value: '전체' },
      ...Array.from(byEventId.entries()).map(([value, label]) => ({ label, value })),
    ];
  }, [applications]);

  const filteredApplications = useMemo(() => {
    return applications
      .filter((item) => {
        if (activeTab === 'review') return item.status === '심사 대기';
        if (activeTab === 'waiting') return item.status === '참여 보류';
        if (activeTab === 'payment') return item.status === '결제 대기' || item.status === '결제중' || item.status === '입금 확인 중' || item.status === '환불 완료' || item.status === '자동 취소';
        return item.status === '참가 확정' || item.status === '반려' || item.status === '신청 취소';
      })
      .filter((item) => (dateFilter === '전체' ? true : item.eventId === dateFilter))
      .filter((item) => {
        const keyword = search.trim().toLowerCase();
        if (!keyword) return true;
        return item.id.toLowerCase().includes(keyword) || item.userId.toLowerCase().includes(keyword);
      })
      .filter((item) => {
        if (filter === '심사대기') return item.status === '심사 대기';
        if (filter === '참여확정') return item.status === '참가 확정';
        if (filter === '반려') return item.status === '반려';
        return true;
      })
      .sort((a, b) => {
        const priority = (status: StoredApplication['status']) => (status === '심사 대기' ? 0 : status === '결제중' || status === '입금 확인 중' ? 1 : status === '반려' ? 2 : status === '결제 대기' ? 3 : 4);
        return priority(a.status) - priority(b.status);
      });
  }, [activeTab, applications, dateFilter, filter, search]);

  const reviewCount = applications.filter((item) => item.status === '심사 대기').length;
  const waitingCount = applications.filter((item) => item.status === '참여 보류').length;
  const paymentCount = applications.filter((item) => item.status === '결제 대기' || item.status === '결제중' || item.status === '입금 확인 중' || item.status === '환불 완료' || item.status === '자동 취소').length;
  const completedCount = applications.filter((item) => item.status === '참가 확정' || item.status === '반려' || item.status === '신청 취소').length;
  const newReviewCount = applications.filter((item) => item.status === '심사 대기' && item.isNew).length;

  const decideReview = async (status: '결제 대기' | '참여 보류' | '반려') => {
    if (!reviewingApplication) return;
    const reason =
      status === '반려'
        ? window.prompt(`${reviewingApplication.id} 신청을 참가 거부 처리합니다. 거부 사유를 입력해주세요.`)
        : status === '참여 보류'
          ? window.prompt(`${reviewingApplication.id} 신청을 참가 대기 처리합니다. 대기 사유를 입력해주세요.`, '성비 및 신청 현황 고려')
          : '';
    if ((status === '반려' || status === '참여 보류') && !reason?.trim()) return;
    const now = new Date();
    const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const reviewedAt = now.toISOString();
    const paymentDeadline = status === '결제 대기' ? deadline.toISOString() : reviewingApplication.paymentDeadline;
    const paymentNoticeSentAt = status === '결제 대기' ? now.toISOString() : reviewingApplication.paymentNoticeSentAt;
    await updateApplicationReviewInSupabase(reviewingApplication, status, {
      paymentDeadline,
      paymentNoticeSentAt,
      reason: reason?.trim() || undefined,
      reviewedAt,
    });
    await reload();
    setReviewingApplication(null);
    if (status === '참여 보류') setActiveTab('waiting');
    if (status === '결제 대기') setActiveTab('payment');
  };

  const completePayment = async (applicationId: string) => {
    const applicationToUpdate = applications.find((application) => application.id === applicationId);
    if (applicationToUpdate) {
      setActionError('');
      try {
        await confirmBankTransferInSupabase(applicationToUpdate);
        await reload();
      } catch (error) {
        const message = getActionErrorMessage(error, '입금 확인 처리에 실패했습니다.');
        console.error('Bank transfer confirmation failed', error);
        setActionError(message);
      }
    }
  };

  const failPayment = async (applicationId: string) => {
    const applicationToUpdate = applications.find((application) => application.id === applicationId);
    if (!applicationToUpdate) return;
    const reason = window.prompt('참가자에게 표시할 확인 실패 사유를 입력해주세요.', '입금 내역을 확인하지 못했습니다.');
    if (!reason) return;
    setActionError('');
    try {
      await rejectBankTransferInSupabase(applicationToUpdate, reason);
      await reload();
    } catch (error) {
      const message = getActionErrorMessage(error, '입금 내역 없음 처리에 실패했습니다.');
      console.error('Bank transfer rejection failed', error);
      setActionError(message);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <section className="w-full max-w-full min-w-0 rounded-[22px] border border-[#f0f3f6] bg-white px-4 py-5 shadow-calendar">
          <h1 className="text-center text-[22px] font-black">참가 신청 관리</h1>

          <label className="mx-auto mt-5 flex h-12 w-full max-w-[210px] min-w-0 items-center gap-3 rounded-[18px] border border-[#edf1f5] bg-white px-4 shadow-sm">
            <span aria-hidden="true" className="text-[18px]">📅</span>
            <select className="w-full max-w-full min-w-0 flex-1 appearance-none bg-transparent text-center text-[17px] font-black outline-none" onChange={(event) => setDateFilter(event.target.value)} value={dateFilter}>
              {dateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-5 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2 min-[390px]:grid-cols-[repeat(4,minmax(0,1fr))]">
            <SummaryCard count={reviewCount} label="심사 대기" newCount={newReviewCount} />
            <SummaryCard count={waitingCount} label="참여 대기" />
            <SummaryCard count={paymentCount} label="결제·환불" />
            <SummaryCard count={completedCount} label="심사 완료" />
          </div>

          <div className="mt-5 grid w-full max-w-full min-w-0 grid-cols-[repeat(4,minmax(0,1fr))] border-b border-[#edf1f5] text-center">
            {tabs.map((tab) => (
              <button
                className={[
                  'relative min-w-0 break-keep pb-3 text-[11px] font-black min-[390px]:text-[14px]',
                  activeTab === tab.id ? 'text-meet-blue' : 'text-[#555]',
                ].join(' ')}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                {tab.label}
                {tab.id === 'review' && newReviewCount > 0 ? <span className="ml-1 text-meet-pink">N</span> : null}
                {activeTab === tab.id ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-meet-blue" /> : null}
              </button>
            ))}
          </div>

          <div className="mt-5 grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_54px] gap-2 min-[380px]:gap-3">
            <label className="flex h-12 w-full max-w-full min-w-0 items-center gap-2 rounded-[16px] border border-[#edf1f5] bg-white px-4 shadow-sm">
              <span className="text-[18px] text-[#9aa3ad]">⌕</span>
              <input
                className="w-full max-w-full min-w-0 flex-1 text-[14px] font-extrabold outline-none placeholder:text-[#aeb6bf]"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="신청번호 · 아이디 검색"
                value={search}
              />
            </label>
            <label className="grid h-12 w-full max-w-full min-w-0 place-items-center rounded-[16px] border border-[#edf1f5] bg-white shadow-sm">
              <select aria-label="필터" className="h-full w-full max-w-full min-w-0 appearance-none rounded-[16px] bg-transparent text-center text-[12px] font-black outline-none" onChange={(event) => setFilter(event.target.value)} value={filter}>
                {filterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 space-y-3">
            {actionError ? (
              <p className="rounded-[16px] bg-meet-pinkSoft p-4 text-[13px] font-black leading-relaxed text-meet-pink">{actionError}</p>
            ) : null}
            {filteredApplications.map((application, index) => (
              <ApplicationCard
                application={application}
                highlighted={index === 0 && activeTab === 'review'}
                key={application.id}
                onPaymentFail={() => void failPayment(application.id)}
                onReview={() => setReviewingApplication(application)}
                onPaymentComplete={() => void completePayment(application.id)}
              />
            ))}
          </div>

          <button className="mx-auto mt-5 block text-sm font-extrabold text-meet-blue" onClick={() => navigate('/admin')} type="button">
            관리자페이지로 돌아가기
          </button>
        </section>
      </div>
      {reviewingApplication && reviewingApplication.profile ? (
        <ReviewProfileModal
          application={reviewingApplication}
          onClose={() => setReviewingApplication(null)}
          onDecide={decideReview}
        />
      ) : null}
    </main>
  );
}

function getActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { details?: unknown; hint?: unknown; message?: unknown };
    return [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ') || fallback;
  }
  return fallback;
}

function SummaryCard({ count, label, newCount = 0 }: { count: number; label: string; newCount?: number }) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[14px] border border-[#edf1f5] bg-white px-3 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-fluid-safe text-[13px] font-black text-[#555]">{label}</p>
        {newCount > 0 ? <span className="text-[18px] font-black italic text-meet-pink">N</span> : null}
      </div>
      <p className="mt-3 text-[30px] font-black leading-none text-[#23314d]">{count}</p>
    </section>
  );
}

function ApplicationCard({
  application,
  highlighted,
  onPaymentFail,
  onPaymentComplete,
  onReview,
}: {
  application: StoredApplication;
  highlighted: boolean;
  onPaymentFail: () => void;
  onPaymentComplete: () => void;
  onReview: () => void;
}) {
  const isFemale = application.gender === '여성';

  return (
    <article
      className={[
        'w-full max-w-full min-w-0 rounded-[14px] border px-4 py-4 shadow-sm',
        isFemale ? 'bg-meet-pinkSoft/50' : 'bg-white',
        highlighted ? 'border-meet-blue' : isFemale ? 'border-meet-pink/25' : 'border-[#edf1f5]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="shrink-0 text-[17px] font-black text-[#263149]">{application.id}</h2>
            {isFemale ? (
              <span className="shrink-0 rounded-[8px] bg-meet-pink/15 px-2 py-0.5 text-[11px] font-black text-meet-pink">여성</span>
            ) : null}
            <p className="min-w-0 text-fluid-safe text-[13px] font-extrabold text-[#5e6878]">{application.userId}</p>
          </div>
          <p className="mt-3 text-fluid-safe text-[13px] font-extrabold leading-snug text-[#263149]">
            {application.gender} · {application.age}세 <span className="mx-2 text-[#ccd3dc]">|</span>
            {application.eventDate} {application.eventType}
          </p>
          <p className="mt-2 text-fluid-safe text-[13px] font-extrabold leading-snug text-[#263149]">
            {application.appliedAt}
            <span className="ml-3 rounded-[8px] bg-[#f1f3f5] px-2 py-1 text-[11px] font-black text-[#555]">{application.returning}</span>
          </p>
          {application.status === '결제 대기' && application.paymentDeadline ? (
            <div className="mt-3 rounded-[12px] bg-meet-blueSoft px-3 py-2 text-[12px] font-black leading-snug text-[#263149]">
              <p>앱 안내 발송 완료</p>
              <p className="mt-1 text-meet-blue">결제 기한 {formatDateTime(application.paymentDeadline)}</p>
            </div>
          ) : null}
          {application.status === '결제중' || application.status === '입금 확인 중' ? (
            <div className="mt-3 rounded-[12px] bg-meet-pinkSoft px-3 py-2 text-[12px] font-black leading-snug text-[#263149]">
              <p>결제중</p>
              <p className="mt-1 text-meet-pink">
                {application.transferGuideConfirmedAt || application.depositRequestedAt ? formatDateTime(application.transferGuideConfirmedAt || application.depositRequestedAt || '') : '확인 시간 없음'} · 입금자 {application.depositorName || application.profile?.name || '-'}
              </p>
              <p className="mt-1 text-[#555]">결제 방식 {application.paymentMethod === 'bank_transfer' ? '계좌이체' : application.paymentMethod || '-'}</p>
              <p className="mt-1 text-[#555]">환불 규정 {application.refundPolicyConfirmed ? '확인 완료' : '미확인'}</p>
            </div>
          ) : null}
        </div>
        <StatusBadge status={application.status} />
      </div>
      {application.status === '결제 대기' || application.status === '결제중' || application.status === '입금 확인 중' ? (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <DecisionTime application={application} />
          <div className="flex flex-wrap gap-2">
            <button
              className="h-10 rounded-[12px] bg-meet-blue px-4 text-[13px] font-black text-white disabled:bg-[#d9d9d9]"
              disabled={application.status !== '결제중' && application.status !== '입금 확인 중'}
              onClick={onPaymentComplete}
              type="button"
            >
              참가 확정
            </button>
            <button
              className="h-10 rounded-[12px] bg-[#d9d9d9] px-4 text-[13px] font-black text-black disabled:opacity-50"
              disabled={application.status !== '결제중' && application.status !== '입금 확인 중'}
              onClick={onPaymentFail}
              type="button"
            >
              입금 내역 없음
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <DecisionTime application={application} />
          <button
            className="h-10 rounded-[12px] border border-meet-blue px-4 text-[13px] font-black text-meet-blue"
            onClick={onReview}
            type="button"
          >
            프로필 심사
          </button>
        </div>
      )}
    </article>
  );
}

function DecisionTime({ application }: { application: StoredApplication }) {
  if (!application.reviewedAt) return <span />;
  return (
    <p className="min-w-0 text-fluid-safe text-[12px] font-black leading-snug text-meet-pink">
      {application.status} {formatDateTime(application.reviewedAt)}
    </p>
  );
}

function StatusBadge({ status }: { status: StoredApplication['status'] }) {
  const color = status === '심사 대기' ? 'bg-[#f2f3f5] text-[#555]' : status === '참가 확정' ? 'bg-meet-blueSoft text-meet-blue' : status === '반려' || status === '자동 취소' || status === '신청 취소' ? 'bg-meet-pinkSoft text-meet-pink' : status === '참여 보류' ? 'bg-[#f5f5f5] text-[#777]' : status === '결제중' || status === '입금 확인 중' ? 'bg-[#fff4e8] text-[#ba7a2a]' : 'bg-meet-blueSoft text-meet-blue';
  return <span className={`max-w-[44%] shrink-0 truncate rounded-[10px] px-3 py-2 text-[12px] font-black ${color}`}>{status}</span>;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hours}:${minutes}`;
}

function ReviewProfileModal({
  application,
  onClose,
  onDecide,
}: {
  application: StoredApplication;
  onClose: () => void;
  onDecide: (status: '결제 대기' | '참여 보류' | '반려') => void | Promise<void>;
}) {
  const profile = application.profile;
  const [files, setFiles] = useState<AdminApplicationFiles | null>(null);
  const [filesError, setFilesError] = useState('');
  const [filesLoading, setFilesLoading] = useState(true);
  const [expandedPhoto, setExpandedPhoto] = useState<{ photos: SignedApplicationFile[]; index: number; title: string } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const canReview = application.status === '심사 대기' || application.status === '참여 보류';
  const [resettingPin, setResettingPin] = useState(false);

  const handleResetGuestPin = async () => {
    if (!application.userUuid || resettingPin) return;
    const ok = window.confirm(`${application.userId}의 PIN을 초기화할까요? 기존 PIN은 더 이상 사용할 수 없습니다.`);
    if (!ok) return;
    setResettingPin(true);
    try {
      const newPin = await resetGuestPinForAdmin(application.userUuid);
      window.alert(`새 PIN: ${newPin}\n참가자에게 안내해주세요.`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'PIN을 초기화하지 못했습니다.');
    } finally {
      setResettingPin(false);
    }
  };
  const filesReady = !filesLoading && !filesError && files !== null;
  const canDecide = canReview && filesReady;

  const loadFiles = async () => {
    setFilesLoading(true);
    setFilesError('');
    try {
      setFiles(await fetchAdminApplicationFiles(application));
    } catch (error) {
      setFilesError(error instanceof Error ? error.message : '신청 자료를 불러오지 못했습니다.');
      setFiles(null);
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    void loadFiles();
  }, [application.dbId]);

  const requestDecision = async (status: '결제 대기' | '참여 보류' | '반려') => {
    if (!canDecide || deciding) return;
    const label = status === '결제 대기' ? '참가 승인' : status === '참여 보류' ? '참가 대기' : '참가 거부';
    const ok = window.confirm(`${application.id} · ${profile?.name ?? application.userId}\n처리 결과: ${label}\n이대로 처리할까요?`);
    if (!ok) return;
    setDeciding(true);
    try {
      await onDecide(status);
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-40 grid place-items-center bg-black/35 px-3"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="max-h-[92dvh] w-full max-w-[430px] min-w-0 overflow-y-auto rounded-[22px] bg-white shadow-calendar"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[#eef1f5] px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <img alt="time2meet" className="h-auto w-[120px] object-contain" src="/assets/time2meet-logo.png" />
              <h2 className="mt-4 text-[26px] font-black leading-tight">참가신청 심사</h2>
            </div>
            <button
              aria-label="참가신청 심사 닫기"
              className="grid h-11 w-11 shrink-0 place-items-center text-[42px] font-light leading-none text-[#454b54]"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <div className="px-5 pb-[calc(112px+env(safe-area-inset-bottom))] pt-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[24px] font-black leading-tight">{application.id}</p>
              <StatusBadge status={application.status} />
            </div>
            <p className="mt-2 text-[17px] font-black leading-snug text-[#263149]">{application.eventDate} {application.eventType} 소개팅</p>
            <p className="mt-2 text-[15px] font-extrabold text-[#7a828c]">{application.accountType === 'guest' ? '비회원' : '회원'} {application.userId}</p>
            {application.accountType === 'guest' && application.userUuid ? (
              <button
                className="mt-2 h-9 rounded-[10px] border border-meet-blue px-3 text-[12px] font-black text-meet-blue disabled:opacity-50"
                disabled={resettingPin}
                onClick={() => void handleResetGuestPin()}
                type="button"
              >
                {resettingPin ? 'PIN 초기화 중' : 'PIN 초기화'}
              </button>
            ) : null}
          </div>

          {profile ? (
            <section className="mt-5 rounded-[18px] border border-[#e9edf2] bg-white p-4 shadow-sm">
              <div className="grid grid-cols-[78px_minmax(0,1fr)] gap-4">
                <RepresentativeThumb file={files?.profilePhotos[files.representativeIndex] ?? files?.profilePhotos[0]} loading={filesLoading} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[22px] font-black">{profile.name}</p>
                      <p className="mt-1 text-[15px] font-extrabold text-[#747b84]">{profile.nickname}</p>
                    </div>
                    <p className="shrink-0 text-[15px] font-black text-[#263149]">{profile.phone}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] font-extrabold text-[#5d6672]">
                    <span>📅 {formatBirthDate(profile.birthDate)}</span>
                    <span>{profile.genderLabel}</span>
                    <span>📍 {profile.residence}</span>
                    <span>💼 {profile.job}</span>
                    <span>{profile.height}cm</span>
                    <span>{application.returning}</span>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {filesError ? (
            <div className="mt-4 rounded-[16px] bg-meet-pinkSoft px-4 py-3 text-[14px] font-black text-meet-pink">
              {filesError}
              <button className="ml-2 underline" onClick={() => void loadFiles()} type="button">다시 불러오기</button>
            </div>
          ) : null}

          <div className="mt-6 space-y-6">
            <ReviewSection title="본인확인">
              <FilePreviewCard
                emptyText="제출된 사진이 없습니다."
                failed={Boolean(filesError)}
                file={files?.idPhoto}
                loading={filesLoading}
                onOpen={() => files?.idPhoto?.signedUrl && setExpandedPhoto({ photos: [files.idPhoto], index: 0, title: '신분증 사진' })}
                onRetry={() => void loadFiles()}
                title="신분증 사진 1장"
              />
            </ReviewSection>

            <ReviewSection
              actionText={files?.profilePhotos.length ? `${files.profilePhotos.length}장 · 눌러서 크게 보기` : undefined}
              title="프로필 사진"
            >
              <ProfilePhotoGrid
                failed={Boolean(filesError)}
                files={files?.profilePhotos ?? []}
                loading={filesLoading}
                onOpen={(index) => {
                  const photos = (files?.profilePhotos ?? []).filter((file) => file.signedUrl);
                  if (photos.length) setExpandedPhoto({ photos, index: Math.min(index, photos.length - 1), title: '프로필 사진' });
                }}
                onRetry={() => void loadFiles()}
                representativeIndex={files?.representativeIndex ?? 0}
              />
            </ReviewSection>

            <ReviewSection title="목소리 소개">
              <ReviewAudioPlayer
                failed={Boolean(filesError)}
                file={files?.voiceIntro}
                loading={filesLoading}
                onRefresh={() => void loadFiles()}
              />
            </ReviewSection>

            <ReviewSection title="첨부파일">
              <AttachmentCard
                emptyText="첨부파일이 없습니다."
                failed={Boolean(filesError)}
                file={files?.employmentProof}
                loading={filesLoading}
                onRetry={() => void loadFiles()}
                title="재직 증명"
              />
            </ReviewSection>

            {profile ? (
              <ReviewSection title="신청 내용">
                <div className="grid gap-2">
                  <ReviewField label="3. 이름" value={profile.name} />
                  <ReviewField label="4. 생년월일" value={formatBirthDate(profile.birthDate)} />
                  <ReviewField label="5. 성별" value={profile.genderLabel} />
                  <ReviewField label="6. 거주지" value={profile.residence} />
                  <ReviewField label="7. 전화번호" value={profile.phone} />
                  <ReviewField label="8. 결혼 및 교제 여부" value={profile.relationshipStatus} />
                  <ReviewField label="10. 닉네임" value={profile.nickname} />
                  <ReviewField label="13. 키" value={`${profile.height}cm`} />
                  <ReviewField label="14. 직업" value={profile.job} />
                  <ReviewField label="16. 접속 경로" value={profile.accessRoute} />
                  <ReviewField label="17. 촬영 동의" value={profile.shootingConsent} />
                  <ReviewField label="18. 인터뷰 여부" value={profile.interviewConsent} />
                  <ReviewField label="19. 환불규정" value={profile.refundAgreement} />
                  <ReviewField label="20. 타임투밋 문의사항" value={profile.inquiry || '입력 없음'} />
                  <ReviewField label="21. 심사 후 개별 연락 안내" value={profile.reviewNotice} />
                </div>
              </ReviewSection>
            ) : null}
          </div>
        </div>

        <div className="sticky bottom-0 grid w-full max-w-full min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-2 border-t border-[#eef1f5] bg-white px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-3">
          <button
            className="flex h-14 min-w-0 items-center justify-center gap-2 rounded-[14px] bg-meet-blue px-2 text-[14px] font-black text-white disabled:bg-[#d8dee6]"
            disabled={!canDecide || deciding}
            onClick={() => void requestDecision('결제 대기')}
            type="button"
          >
            <span className="text-[22px]">✓</span>
            참가 승인
          </button>
          <button
            className="flex h-14 min-w-0 items-center justify-center gap-2 rounded-[14px] bg-[#eef0f3] px-2 text-[14px] font-black text-[#4b515a] disabled:opacity-45"
            disabled={!canDecide || deciding}
            onClick={() => void requestDecision('참여 보류')}
            type="button"
          >
            <span className="text-[18px]">Ⅱ</span>
            참가 대기
          </button>
          <button
            className="flex h-14 min-w-0 items-center justify-center gap-2 rounded-[14px] bg-meet-pink px-2 text-[14px] font-black text-white disabled:bg-[#f4b6cc]"
            disabled={!canDecide || deciding}
            onClick={() => void requestDecision('반려')}
            type="button"
          >
            <span className="text-[24px]">×</span>
            참가 거부
          </button>
          {!filesReady ? (
            <p className="col-span-3 text-center text-[12px] font-black text-[#8a929c]">
              심사 자료를 불러온 후 처리할 수 있습니다
            </p>
          ) : null}
        </div>
      </section>
      {expandedPhoto ? (
        <PhotoViewer
          onClose={() => setExpandedPhoto(null)}
          onMove={(nextIndex) => setExpandedPhoto((current) => current && { ...current, index: nextIndex })}
          state={expandedPhoto}
        />
      ) : null}
    </div>
  );
}

function ReviewSection({ actionText, children, title }: { actionText?: string; children: ReactNode; title: string }) {
  return (
    <section className="w-full max-w-full min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[20px] font-black leading-tight">{title}</h3>
        {actionText ? <p className="shrink-0 text-[13px] font-black text-meet-blue">{actionText}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-[14px] bg-[#f7f9fb] px-4 py-3">
      <p className="text-[12px] font-black text-[#828b96]">{label}</p>
      <p className="mt-1 break-words text-[15px] font-black leading-snug text-[#111]">{value}</p>
    </section>
  );
}

function RepresentativeThumb({ file, loading }: { file?: SignedApplicationFile; loading: boolean }) {
  if (loading) return <div className="h-[78px] w-[78px] rounded-[24px] bg-[#f0f4f8]" />;
  if (!file?.signedUrl) {
    return (
      <div className="grid h-[78px] w-[78px] place-items-center rounded-[24px] bg-[#f0f4f8] text-[11px] font-black text-[#8a929c]">
        사진 없음
      </div>
    );
  }

  return (
    <img
      alt="대표사진"
      className="h-[78px] w-[78px] rounded-[24px] object-cover"
      src={file.signedUrl}
    />
  );
}

function FilePreviewCard({
  emptyText,
  failed,
  file,
  loading,
  onOpen,
  onRetry,
  title,
}: {
  emptyText: string;
  failed: boolean;
  file?: SignedApplicationFile;
  loading: boolean;
  onOpen: () => void;
  onRetry: () => void;
  title: string;
}) {
  if (loading) return <SkeletonCard />;
  if (failed) return <RetryCard onRetry={onRetry} text="심사 자료를 불러오지 못했습니다." />;
  if (!file) return <EmptyCard text={emptyText} />;
  if (!file.signedUrl) return <RetryCard onRetry={onRetry} text={file.errorMessage || '사진 URL을 발급하지 못했습니다.'} />;

  return (
    <button
      className="flex w-full max-w-full min-w-0 items-center gap-4 rounded-[18px] border border-[#e9edf2] bg-white p-3 text-left shadow-sm"
      onClick={onOpen}
      type="button"
    >
      <img alt={title} className="h-[82px] w-[116px] shrink-0 rounded-[12px] object-cover" src={file.signedUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-black">{title}</p>
        <p className="mt-2 text-[14px] font-black text-meet-blue">확대 보기 ›</p>
      </div>
      <span className="shrink-0 text-[28px] text-[#444]">›</span>
    </button>
  );
}

function ProfilePhotoGrid({
  failed,
  files,
  loading,
  onOpen,
  onRetry,
  representativeIndex,
}: {
  failed: boolean;
  files: SignedApplicationFile[];
  loading: boolean;
  onOpen: (index: number) => void;
  onRetry: () => void;
  representativeIndex: number;
}) {
  if (loading) return <SkeletonCard />;
  if (failed) return <RetryCard onRetry={onRetry} text="심사 자료를 불러오지 못했습니다." />;
  if (!files.length) return <EmptyCard text="제출된 사진이 없습니다." />;

  return (
    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
      {files.map((file, index) => (
        <button
          className="relative aspect-square min-w-0 overflow-hidden rounded-[14px] bg-[#f4f6f8]"
          key={`${file.path}-${index}`}
          disabled={!file.signedUrl}
          onClick={() => onOpen(index)}
          type="button"
        >
          {file.signedUrl ? (
            <img alt={`프로필 사진 ${index + 1}`} className="h-full w-full object-cover" src={file.signedUrl} />
          ) : (
            <span className="grid h-full w-full place-items-center px-2 text-center text-[12px] font-black text-[#8a929c]">
              불러오기 실패
            </span>
          )}
          {index === representativeIndex ? (
            <span className="absolute left-2 top-2 rounded-[8px] bg-meet-blue px-2 py-1 text-[11px] font-black text-white">
              대표사진
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function AttachmentCard({
  emptyText,
  failed,
  file,
  loading,
  onRetry,
  title,
}: {
  emptyText: string;
  failed: boolean;
  file?: SignedApplicationFile;
  loading: boolean;
  onRetry: () => void;
  title: string;
}) {
  if (loading) return <SkeletonCard />;
  if (failed) return <RetryCard onRetry={onRetry} text="심사 자료를 불러오지 못했습니다." />;
  if (!file) return <EmptyCard text={emptyText} />;
  if (!file.signedUrl) return <RetryCard onRetry={onRetry} text={file.errorMessage || '첨부파일 URL을 발급하지 못했습니다.'} />;

  return (
    <a
      className="flex min-w-0 items-center gap-4 rounded-[18px] border border-[#e9edf2] bg-white p-4 shadow-sm"
      href={file.signedUrl}
      rel="noreferrer"
      target="_blank"
    >
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[14px] bg-meet-pink text-[13px] font-black text-white">FILE</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-black text-[#8a929c]">{title}</span>
        <span className="block truncate text-[17px] font-black text-black">{file.fileName}</span>
      </span>
      <span className="shrink-0 text-[15px] font-black text-meet-blue">확인 ›</span>
    </a>
  );
}

function ReviewAudioPlayer({
  failed,
  file,
  loading,
  onRefresh,
}: {
  failed: boolean;
  file?: SignedApplicationFile;
  loading: boolean;
  onRefresh: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    setDuration(0);
    setError('');
    setIsPlaying(false);
    setTime(0);
  }, [file?.signedUrl]);

  if (loading) return <SkeletonCard />;
  if (failed) return <RetryCard onRetry={onRefresh} text="심사 자료를 불러오지 못했습니다." />;
  if (!file) return <EmptyCard text="업로드된 음성이 없습니다." />;
  if (!file.signedUrl) return <RetryCard onRetry={onRefresh} text={file.errorMessage || '음성 URL을 발급하지 못했습니다.'} />;

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError('');
    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch {
      setError('음성을 재생하지 못했습니다. 다시 불러온 뒤 시도해주세요.');
      onRefresh();
    }
  };

  const replay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    await togglePlay();
  };

  return (
    <section className="rounded-[18px] border border-[#e9edf2] bg-white p-4 shadow-sm">
      <audio
        onEnded={() => setIsPlaying(false)}
        onError={() => setError('음성을 재생하지 못했습니다.')}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={file.signedUrl}
      />
      <div className="flex items-center gap-4">
        <button
          aria-label={isPlaying ? '음성 일시정지' : '음성 재생'}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-meet-blue text-white"
          onClick={() => void togglePlay()}
          type="button"
        >
          {isPlaying ? 'Ⅱ' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-black">5초 자기소개</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e9edf2]">
            <div className="h-full rounded-full bg-meet-blue" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-[13px] font-extrabold text-[#7a828c]">{formatAudioTime(time)} / {formatAudioTime(duration || 5)}</p>
        </div>
        <button className="shrink-0 text-[13px] font-black text-meet-blue" onClick={() => void replay()} type="button">
          다시 듣기
        </button>
      </div>
      {error ? <p className="mt-3 text-[13px] font-black text-meet-pink">{error}</p> : null}
    </section>
  );
}

function PhotoViewer({
  onClose,
  onMove,
  state,
}: {
  onClose: () => void;
  onMove: (index: number) => void;
  state: { photos: SignedApplicationFile[]; index: number; title: string };
}) {
  const photo = state.photos[state.index];
  const canMove = state.photos.length > 1;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 px-3" onClick={onClose}>
      <section className="w-full max-w-[430px] rounded-[18px] bg-white p-3" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[17px] font-black">{state.title} {state.index + 1}/{state.photos.length}</p>
          <button aria-label="사진 닫기" className="text-[30px] leading-none" onClick={onClose} type="button">×</button>
        </div>
        {photo ? <img alt={state.title} className="max-h-[70dvh] w-full rounded-[12px] object-contain" src={photo.signedUrl} /> : <EmptyCard text="사진을 불러오지 못했습니다." />}
        {canMove ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="h-11 rounded-[12px] bg-[#f0f2f4] text-[14px] font-black"
              onClick={() => onMove((state.index - 1 + state.photos.length) % state.photos.length)}
              type="button"
            >
              이전
            </button>
            <button
              className="h-11 rounded-[12px] bg-[#f0f2f4] text-[14px] font-black"
              onClick={() => onMove((state.index + 1) % state.photos.length)}
              type="button"
            >
              다음
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SkeletonCard() {
  return <div className="h-[108px] animate-pulse rounded-[18px] bg-[#f2f5f8]" />;
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="grid min-h-[108px] place-items-center rounded-[18px] border border-dashed border-[#dce3eb] bg-[#f9fbfd] px-4 text-center text-[15px] font-black text-[#8a929c]">
      {text}
    </div>
  );
}

function RetryCard({ onRetry, text }: { onRetry: () => void; text: string }) {
  return (
    <div className="grid min-h-[108px] place-items-center rounded-[18px] border border-dashed border-meet-pink/30 bg-meet-pinkSoft px-4 text-center">
      <div>
        <p className="text-[15px] font-black text-meet-pink">{text}</p>
        <button className="mt-2 text-[14px] font-black text-meet-pink underline" onClick={onRetry} type="button">
          다시 불러오기
        </button>
      </div>
    </div>
  );
}

function formatBirthDate(value: string) {
  return value.replace(/-/g, '.');
}

function formatAudioTime(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
