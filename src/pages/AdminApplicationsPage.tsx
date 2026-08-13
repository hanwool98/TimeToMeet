import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import { getAvatarPosition } from '../components/ParticipantList';
import useOperationalData from '../hooks/useOperationalData';
import { confirmBankTransferInSupabase, rejectBankTransferInSupabase, updateApplicationReviewInSupabase } from '../services/supabaseApplications';
import type { ParticipantProfile } from '../types/participant';
import type { StoredApplication } from '../utils/adminApplications';

type ApplicationTab = 'review' | 'waiting' | 'payment' | 'completed';

const tabs: Array<{ id: ApplicationTab; label: string }> = [
  { id: 'review', label: '프로필 심사' },
  { id: 'waiting', label: '참여 대기자 관리' },
  { id: 'payment', label: '결제 환불' },
  { id: 'completed', label: '심사 완료' },
];

const dateOptions = ['전체', '8월 16일 로테이션'];
const filterOptions = ['성별', '나이', '재참여 여부', '심사대기', '참여확정', '반려'];
const adminProfileSheet = '/assets/admin-profile-photos.svg';

export default function AdminApplicationsPage() {
  const navigate = useNavigate();
  const { applications, error, loading, reload } = useOperationalData({ admin: true });
  const [activeTab, setActiveTab] = useState<ApplicationTab>('review');
  const [dateFilter, setDateFilter] = useState('전체');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('성별');
  const [reviewingApplication, setReviewingApplication] = useState<StoredApplication | null>(null);

  const applicationsWithAutoCancel = useMemo(
    () =>
      applications.map((application) =>
        application.status === '결제 대기' &&
        application.paymentDeadline &&
        new Date(application.paymentDeadline).getTime() < Date.now()
          ? { ...application, status: '자동 취소' as const }
          : application,
      ),
    [applications],
  );

  const filteredApplications = useMemo(() => {
    return applicationsWithAutoCancel
      .filter((item) => {
        if (activeTab === 'review') return item.status === '심사 대기';
        if (activeTab === 'waiting') return item.status === '참여 보류';
        if (activeTab === 'payment') return item.status === '결제 대기' || item.status === '입금 확인 중' || item.status === '환불 완료' || item.status === '자동 취소';
        return item.status === '참가 확정' || item.status === '반려';
      })
      .filter((item) => (dateFilter === '전체' ? true : item.eventDate === '8월 16일'))
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
        const priority = (status: StoredApplication['status']) => (status === '심사 대기' ? 0 : status === '입금 확인 중' ? 1 : status === '반려' ? 2 : status === '결제 대기' ? 3 : 4);
        return priority(a.status) - priority(b.status);
      });
  }, [activeTab, applicationsWithAutoCancel, dateFilter, filter, search]);

  const reviewCount = applicationsWithAutoCancel.filter((item) => item.status === '심사 대기').length;
  const waitingCount = applicationsWithAutoCancel.filter((item) => item.status === '참여 보류').length;
  const paymentCount = applicationsWithAutoCancel.filter((item) => item.status === '결제 대기' || item.status === '입금 확인 중' || item.status === '환불 완료' || item.status === '자동 취소').length;
  const completedCount = applicationsWithAutoCancel.filter((item) => item.status === '참가 확정' || item.status === '반려').length;
  const newReviewCount = applicationsWithAutoCancel.filter((item) => item.status === '심사 대기' && item.isNew).length;

  const decideReview = async (status: '결제 대기' | '참여 보류' | '반려') => {
    if (!reviewingApplication) return;
    const now = new Date();
    const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const reviewedAt = now.toISOString();
    const paymentDeadline = status === '결제 대기' ? deadline.toISOString() : reviewingApplication.paymentDeadline;
    const paymentNoticeSentAt = status === '결제 대기' ? now.toISOString() : reviewingApplication.paymentNoticeSentAt;
    await updateApplicationReviewInSupabase(reviewingApplication, status, {
      paymentDeadline,
      paymentNoticeSentAt,
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
      await confirmBankTransferInSupabase(applicationToUpdate);
      await reload();
    }
  };

  const failPayment = async (applicationId: string) => {
    const applicationToUpdate = applications.find((application) => application.id === applicationId);
    if (!applicationToUpdate) return;
    const reason = window.prompt('참가자에게 표시할 확인 실패 사유를 입력해주세요.', '입금 내역을 확인하지 못했습니다.');
    if (!reason) return;
    await rejectBankTransferInSupabase(applicationToUpdate, reason);
    await reload();
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
                <option key={option} value={option}>
                  {option}
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
          profile={reviewingApplication.profile}
        />
      ) : null}
    </main>
  );
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
  return (
    <article className={['w-full max-w-full min-w-0 rounded-[14px] border bg-white px-4 py-4 shadow-sm', highlighted ? 'border-meet-blue' : 'border-[#edf1f5]'].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="shrink-0 text-[17px] font-black text-[#263149]">{application.id}</h2>
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
          {application.status === '입금 확인 중' ? (
            <div className="mt-3 rounded-[12px] bg-meet-pinkSoft px-3 py-2 text-[12px] font-black leading-snug text-[#263149]">
              <p>입금 확인 요청</p>
              <p className="mt-1 text-meet-pink">
                {application.depositRequestedAt ? formatDateTime(application.depositRequestedAt) : '요청 시간 없음'} · 입금자 {application.depositorName || application.profile?.name || '-'}
              </p>
            </div>
          ) : null}
        </div>
        <StatusBadge status={application.status} />
      </div>
      {application.status === '결제 대기' || application.status === '입금 확인 중' ? (
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <DecisionTime application={application} />
          <div className="flex flex-wrap gap-2">
            <button
              className="h-10 rounded-[12px] bg-meet-blue px-4 text-[13px] font-black text-white disabled:bg-[#d9d9d9]"
              disabled={application.status !== '입금 확인 중'}
              onClick={onPaymentComplete}
              type="button"
            >
              참가 확정
            </button>
            <button
              className="h-10 rounded-[12px] bg-[#d9d9d9] px-4 text-[13px] font-black text-black disabled:opacity-50"
              disabled={application.status !== '입금 확인 중'}
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
  const color = status === '심사 대기' ? 'bg-[#f2f3f5] text-[#555]' : status === '참가 확정' ? 'bg-meet-blueSoft text-meet-blue' : status === '반려' || status === '자동 취소' ? 'bg-meet-pinkSoft text-meet-pink' : status === '참여 보류' ? 'bg-[#f5f5f5] text-[#777]' : status === '입금 확인 중' ? 'bg-meet-pinkSoft text-meet-pink' : 'bg-meet-blueSoft text-meet-blue';
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
  profile,
}: {
  application: StoredApplication;
  onClose: () => void;
  onDecide: (status: '결제 대기' | '참여 보류' | '반려') => void | Promise<void>;
  profile: ParticipantProfile;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-40 grid place-items-center bg-black/35 px-4"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="max-h-[88dvh] w-full max-w-[390px] min-w-0 overflow-y-auto rounded-[22px] bg-white p-4 shadow-calendar min-[380px]:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-extrabold text-[#8a8a8a]">{application.id} · {application.userId}</p>
            <h2 className="mt-1 text-[23px] font-black leading-tight">심사용 프로필</h2>
          </div>
          <button
            aria-label="심사용 프로필 닫기"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <ReviewRow label="3. 이름" value={profile.name} />
          <ReviewRow label="4. 생년월일" value={profile.birthDate} />
          <ReviewRow label="5. 성별" value={profile.genderLabel} />
          <ReviewRow label="6. 거주지" value={profile.residence} />
          <ReviewRow label="7. 전화번호" value={profile.phone} />
          <ReviewRow label="8. 결혼 및 교제 여부" value={profile.relationshipStatus} />
          <ReviewImage label="9. 본인확인용 신분증 사진 첨부" offset={2} value={profile.idPhotoStatus} />
          <ReviewRow label="10. 닉네임" value={profile.nickname} />
          <ReviewPhotos value={profile.profilePhotos} />
          <ReviewVoice />
          <ReviewRow label="13. 키" value={profile.height} />
          <ReviewRow label="14. 직업" value={profile.job} />
          <ReviewImage label="15. 재직 증명" offset={3} value={profile.employmentProof} />
          <ReviewRow label="16. 접속 경로" value={profile.accessRoute} />
          <ReviewRow label="17. 촬영 동의 (모자이크)" value={profile.shootingConsent} />
          <ReviewRow label="18. 인터뷰 여부" value={profile.interviewConsent} />
          <ReviewRow label="19. 환불규정" value={profile.refundAgreement} />
          <ReviewRow label="20. 타임투밋 문의사항" value={profile.inquiry} />
          <ReviewRow label="21. 심사 후 개별 연락 안내" value={profile.reviewNotice} />
        </div>

        <div className="sticky bottom-0 mt-5 grid w-full max-w-full min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-3 bg-white pt-3">
          <button
            aria-label="통과"
            className="grid h-12 place-items-center rounded-[16px] bg-meet-blue text-[24px] font-black text-white"
            onClick={() => onDecide('결제 대기')}
            type="button"
          >
            ✓
          </button>
          <button
            aria-label="보류"
            className="grid h-12 place-items-center rounded-[16px] bg-[#d9d9d9] text-[22px] font-black text-black"
            onClick={() => onDecide('참여 보류')}
            type="button"
          >
            ⏸
          </button>
          <button
            aria-label="반려"
            className="grid h-12 place-items-center rounded-[16px] bg-meet-pink text-[24px] font-black text-white"
            onClick={() => onDecide('반려')}
            type="button"
          >
            ×
          </button>
        </div>
      </section>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[16px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[12px] font-black text-[#8a8a8a]">{label}</p>
      <p className="mt-1 text-fluid-safe text-[15px] font-black leading-snug text-black">{value}</p>
    </section>
  );
}

function ReviewImage({ label, offset, value }: { label: string; offset: number; value: string }) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[16px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[12px] font-black text-[#8a8a8a]">{label}</p>
      <p className="mt-1 text-[15px] font-black text-black">{value}</p>
      <div
        className="mt-3 h-[160px] rounded-[14px] bg-cover bg-center"
        style={{
          backgroundImage: `url(${adminProfileSheet})`,
          backgroundPosition: getAvatarPosition(offset),
          backgroundSize: '440% 330%',
        }}
      />
    </section>
  );
}

function ReviewPhotos({ value }: { value: string }) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[16px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[12px] font-black text-[#8a8a8a]">11. 프로필 사진</p>
      <p className="mt-1 text-[15px] font-black text-black">{value}</p>
      <div className="mt-3 space-y-3">
        {['대표사진', '사진 2', '사진 3'].map((label, index) => (
          <div className="overflow-hidden rounded-[16px] bg-white shadow-sm" key={label}>
            <div
              className="aspect-[4/5] bg-cover bg-center"
              style={{
                backgroundImage: `url(${adminProfileSheet})`,
                backgroundPosition: getAvatarPosition(index + 1),
                backgroundSize: '440% 330%',
              }}
            />
            <p className="px-4 py-3 text-[13px] font-black text-black">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewVoice() {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[16px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[12px] font-black text-[#8a8a8a]">12. 너의 목소리가 보여</p>
      <button
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-white text-[14px] font-black text-meet-pink shadow-sm"
        onClick={() => window.alert('샘플 음성입니다.')}
        type="button"
      >
        <span className="h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-meet-pink" />
        5초 자기소개 재생
      </button>
    </section>
  );
}
