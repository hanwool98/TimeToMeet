import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAdminInquiryDetail, submitAdminInquiryReply, type AdminInquiryDetail } from '../services/inquiries';

export default function AdminInquiryDetailPage() {
  const navigate = useNavigate();
  const { inquiryId } = useParams<{ inquiryId: string }>();
  const [detail, setDetail] = useState<AdminInquiryDetail | null | undefined>(undefined);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!inquiryId) return;
    setDetail(undefined);
    setError('');
    void fetchAdminInquiryDetail(inquiryId)
      .then((row) => {
        setDetail(row);
        setReply(row?.adminReply ?? '');
      })
      .catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : '문의를 불러오지 못했습니다.');
      });
  };

  useEffect(load, [inquiryId]);

  const handleSaveReply = async () => {
    if (!inquiryId || !reply.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await submitAdminInquiryReply(inquiryId, reply);
      load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '답변 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[20px] font-black">문의 상세</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin/inquiries')} type="button">
            ← 문의 목록
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-[18px] bg-meet-pinkSoft p-4 text-center text-[14px] font-black text-meet-pink">{error}</p>
        ) : detail === undefined ? (
          <p className="mt-8 text-center text-[14px] font-bold text-[#9a9a9a]">불러오는 중</p>
        ) : detail === null ? (
          <p className="mt-8 text-center text-[14px] font-bold text-[#9a9a9a]">문의를 찾을 수 없습니다.</p>
        ) : (
          <>
            <article className="mt-4 rounded-[18px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-black text-[#8a8a8a]">
                  {detail.authorLabel} · {formatDateTime(detail.createdAt)}
                </p>
                <div className="flex items-center gap-1.5">
                  {detail.isPrivate ? (
                    <span className="rounded-[8px] bg-[#f3f4f6] px-2 py-0.5 text-[11px] font-black text-[#8a8a8a]">비밀글</span>
                  ) : null}
                  <span
                    className={`rounded-[8px] px-2 py-0.5 text-[11px] font-black ${
                      detail.status === 'answered' ? 'bg-meet-blueSoft text-meet-blue' : 'bg-meet-pinkSoft text-meet-pink'
                    }`}
                  >
                    {detail.status === 'answered' ? '답변 완료' : '답변 대기'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-[17px] font-black text-black">{detail.title}</p>
              <p className="mt-2 whitespace-pre-wrap text-[14px] font-extrabold leading-relaxed text-[#333]">{detail.content}</p>
            </article>

            <section className="mt-4 rounded-[18px] border border-[#f0f3f6] bg-white p-4 shadow-sm">
              <p className="text-[13px] font-black text-black">관리자 답변</p>
              <textarea
                className="mt-2 min-h-[160px] w-full resize-none rounded-[12px] border border-[#e5e9ef] bg-white p-3 text-[14px] font-bold leading-relaxed outline-none focus:border-meet-blue"
                onChange={(event) => setReply(event.target.value)}
                placeholder="답변 내용을 입력해주세요"
                value={reply}
              />
              <button
                className="mt-3 h-11 w-full rounded-[12px] bg-meet-blue text-[14px] font-black text-white disabled:opacity-50"
                disabled={!reply.trim() || saving}
                onClick={handleSaveReply}
                type="button"
              >
                {saving ? '저장 중' : detail.adminReply ? '답변 수정' : '답변 등록'}
              </button>
              {detail.repliedAt ? (
                <p className="mt-2 text-[11.5px] font-extrabold text-[#9aa0a7]">최근 답변 {formatDateTime(detail.repliedAt)}</p>
              ) : null}
            </section>
          </>
        )}
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
