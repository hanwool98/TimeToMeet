import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import { fetchInquiryDetail, type InquiryDetail } from '../services/inquiries';

export default function InquiryDetailPage() {
  const navigate = useNavigate();
  const { inquiryId } = useParams<{ inquiryId: string }>();
  const [detail, setDetail] = useState<InquiryDetail | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!inquiryId) return;
    let active = true;
    setDetail(undefined);
    setError('');
    void fetchInquiryDetail(inquiryId)
      .then((row) => {
        if (active) setDetail(row);
      })
      .catch((caughtError) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : '문의를 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, [inquiryId]);

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 py-10 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <ShellHeader onBack={() => navigate('/mypage/inquiries')} />

        {error ? (
          <EmptyCard message={error} />
        ) : detail === undefined ? (
          <EmptyCard message="불러오는 중" />
        ) : detail === null ? (
          <EmptyCard message="문의를 찾을 수 없습니다." />
        ) : detail.isLocked ? (
          <EmptyCard message={'비밀글입니다.\n작성자만 확인할 수 있습니다.'} />
        ) : (
          <div className="mt-8">
            <div className="flex items-center gap-2">
              {detail.isPrivate ? (
                <span className="rounded-[8px] bg-[#f3f4f6] px-2 py-1 text-[11px] font-black text-[#8a8a8a]">비밀글</span>
              ) : null}
              <StatusPill status={detail.status ?? 'pending'} />
            </div>
            <h1 className="mt-3 text-fluid-safe text-[22px] font-black leading-tight">{detail.title}</h1>
            <p className="mt-2 text-[12.5px] font-extrabold text-[#9aa0a7]">{detail.createdAt ? formatDate(detail.createdAt) : ''}</p>

            <section className="mt-6 rounded-[16px] bg-white p-5 shadow-card">
              <p className="whitespace-pre-line text-[15px] font-bold leading-relaxed text-[#333]">{detail.content}</p>
            </section>

            <section className="mt-4 rounded-[16px] bg-meet-blueSoft p-5">
              <p className="text-[12.5px] font-black text-meet-blue">관리자 답변</p>
              {detail.adminReply ? (
                <>
                  <p className="mt-2 whitespace-pre-line text-[14.5px] font-bold leading-relaxed text-[#333]">{detail.adminReply}</p>
                  {detail.repliedAt ? (
                    <p className="mt-2 text-[11.5px] font-extrabold text-[#8a9bb0]">{formatDate(detail.repliedAt)}</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-[14px] font-bold text-[#8a9bb0]">답변 대기 중입니다.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: 'pending' | 'answered' }) {
  const answered = status === 'answered';
  return (
    <span
      className={`rounded-[8px] px-2 py-1 text-[11px] font-black ${
        answered ? 'bg-meet-blueSoft text-meet-blue' : 'bg-[#f3f4f6] text-[#8a8a8a]'
      }`}
    >
      {answered ? '답변 완료' : '답변 대기'}
    </span>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <section className="mt-8 rounded-[24px] bg-white p-6 text-center shadow-calendar">
      <p className="whitespace-pre-line text-fluid-safe text-[15px] font-black leading-relaxed text-[#777]">{message}</p>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function ShellHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="flex items-center justify-between">
      <button aria-label="뒤로 가기" className="grid h-11 w-11 place-items-center text-black" onClick={onBack} type="button">
        <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
          <path d="M18 12L7 23L18 34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
          <path d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
        </svg>
      </button>
      <LogoMark className="h-14 w-14 rounded-full" />
    </header>
  );
}
