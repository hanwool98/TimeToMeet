import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAdminInquiries, type AdminInquiryListItem } from '../services/inquiries';

export default function AdminInquiriesPage() {
  const navigate = useNavigate();
  const [inquiries, setInquiries] = useState<AdminInquiryListItem[] | null>(null);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setError('');
    void fetchAdminInquiries(search)
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

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[22px] font-black">문의 관리</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin')} type="button">
            ← 관리자 홈
          </button>
        </div>
        <p className="mt-1 text-[13px] font-extrabold text-[#8a8a8a]">전체 {inquiries?.length ?? 0}건</p>

        <input
          className="mt-4 h-11 w-full rounded-[14px] border border-[#e5e9ef] bg-white px-3.5 text-[14px] font-bold outline-none placeholder:text-[#a2a8b0] focus:border-meet-blue"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="작성자, 제목, 내용으로 검색"
          type="search"
          value={searchInput}
        />

        {error ? (
          <p className="mt-4 rounded-[18px] bg-meet-pinkSoft p-4 text-center text-[14px] font-black text-meet-pink">{error}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {inquiries && inquiries.length === 0 ? (
            <p className="rounded-[18px] bg-meet-blueSoft p-4 text-center text-[14px] font-black text-[#555]">
              {search ? '검색 결과가 없습니다.' : '등록된 문의가 없습니다.'}
            </p>
          ) : null}
          {(inquiries ?? []).map((inquiry) => (
            <button
              className="block w-full rounded-[18px] border border-[#f0f3f6] bg-white p-4 text-left shadow-sm transition active:scale-[0.99]"
              key={inquiry.id}
              onClick={() => navigate(`/admin/inquiries/${inquiry.id}`)}
              type="button"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-black text-[#8a8a8a]">
                  {inquiry.authorLabel} · {formatDateTime(inquiry.createdAt)}
                </p>
                <div className="flex items-center gap-1.5">
                  {inquiry.isPrivate ? (
                    <span className="rounded-[8px] bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-black text-[#8a8a8a]">비밀글</span>
                  ) : null}
                  <span
                    className={`rounded-[8px] px-2 py-0.5 text-[11px] font-black ${
                      inquiry.status === 'answered' ? 'bg-meet-blueSoft text-meet-blue' : 'bg-meet-pinkSoft text-meet-pink'
                    }`}
                  >
                    {inquiry.status === 'answered' ? '답변 완료' : '답변 대기'}
                  </span>
                </div>
              </div>
              <p className="mt-2 truncate text-[15px] font-black text-black">{inquiry.title}</p>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hours}:${minutes}`;
}
