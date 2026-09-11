import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import { getAppSession } from '../services/appAuth';
import { fetchInquiries, type InquiryListItem } from '../services/inquiries';

// 마이페이지 "문의하기" -> 전체 참가자가 함께 보는 일반 고객문의
// 게시판(1:1 문의함이 아님). 비밀글은 목록에서 제목만 "비밀글입니다."로
// 가려지고, 실제 접근 제어는 DB RPC가 처리한다(list_inquiries_for_session).
export default function InquiryListPage() {
  const navigate = useNavigate();
  const [inquiries, setInquiries] = useState<InquiryListItem[] | null>(null);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const loggedIn = Boolean(getAppSession());

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setError('');
    void fetchInquiries(search)
      .then((rows) => {
        if (active) setInquiries(rows);
      })
      .catch((caughtError) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : '문의 목록을 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, [search]);

  const handleWrite = () => {
    if (!loggedIn) {
      navigate('/login?returnTo=/mypage/inquiries/new');
      return;
    }
    navigate('/mypage/inquiries/new');
  };

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 py-10 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <ShellHeader onBack={() => navigate('/mypage')} />

        <div className="mt-8 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-black leading-tight">문의하기</h1>
            <p className="mt-1.5 text-[13px] font-extrabold text-[#8a8a8a]">
              궁금한 점을 남겨주시면 운영진이 답변해드려요.
            </p>
          </div>
          <button
            className="h-11 shrink-0 rounded-[16px] bg-meet-blue px-4 text-[14px] font-black text-white transition active:scale-[0.97]"
            onClick={handleWrite}
            type="button"
          >
            문의 작성
          </button>
        </div>

        <input
          className="mt-5 h-12 w-full rounded-[16px] bg-meet-blueSoft px-4 text-[15px] font-bold outline-none placeholder:text-[#96a3b3] focus:ring-2 focus:ring-meet-blue"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="제목, 내용으로 검색"
          type="search"
          value={searchInput}
        />

        <div className="mt-5">
          {error ? (
            <p className="rounded-[16px] bg-meet-pinkSoft p-5 text-center text-[14px] font-black text-meet-pink">{error}</p>
          ) : !inquiries ? (
            <p className="py-10 text-center text-[14px] font-bold text-[#9a9a9a]">불러오는 중</p>
          ) : inquiries.length === 0 ? (
            <p className="py-14 text-center text-[14px] font-bold text-[#9a9a9a]">
              {search ? '검색 결과가 없습니다.' : '등록된 문의가 없습니다.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {inquiries.map((inquiry) => (
                <li key={inquiry.id}>
                  <button
                    className="flex w-full items-center gap-3 rounded-[16px] bg-white px-4 py-4 text-left shadow-card transition active:scale-[0.99]"
                    onClick={() => navigate(`/mypage/inquiries/${inquiry.id}`)}
                    type="button"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-[15px] font-black text-black">
                        {inquiry.isLocked ? <LockIcon /> : null}
                        <span className={`min-w-0 truncate ${inquiry.isLocked ? 'text-[#9aa0a7]' : ''}`}>{inquiry.title}</span>
                      </p>
                      <p className="mt-1.5 text-[12px] font-extrabold text-[#9aa0a7]">{formatDate(inquiry.createdAt)}</p>
                    </div>
                    <StatusPill status={inquiry.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: InquiryListItem['status'] }) {
  const answered = status === 'answered';
  return (
    <span
      className={`shrink-0 rounded-[10px] px-2.5 py-1.5 text-[11px] font-black ${
        answered ? 'bg-meet-blueSoft text-meet-blue' : 'bg-[#f3f4f6] text-[#8a8a8a]'
      }`}
    >
      {answered ? '답변 완료' : '답변 대기'}
    </span>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#b3b8bf]" fill="none" viewBox="0 0 24 24">
      <rect height="10" rx="2.4" stroke="currentColor" strokeWidth="2.2" width="15" x="4.5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
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
