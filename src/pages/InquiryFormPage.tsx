import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import { getAppSession } from '../services/appAuth';
import { createInquiry } from '../services/inquiries';

export default function InquiryFormPage() {
  const navigate = useNavigate();
  const session = getAppSession();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!session) {
    return (
      <main className="app-page min-h-screen bg-white px-4 py-10 text-black min-[380px]:px-5">
        <div className="mobile-container mx-auto">
          <ShellHeader onBack={() => navigate(-1)} />
          <section className="mt-8 rounded-[24px] bg-white p-6 text-center shadow-calendar">
            <p className="text-[16px] font-black text-[#777]">로그인 후 문의를 작성할 수 있습니다.</p>
            <PrimaryButton className="mt-5" onClick={() => navigate('/login?returnTo=/mypage/inquiries/new')}>
              로그인
            </PrimaryButton>
          </section>
        </div>
      </main>
    );
  }

  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const inquiryId = await createInquiry(title, content, isPrivate);
      navigate(`/mypage/inquiries/${inquiryId}`, { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '문의 등록에 실패했습니다.');
      setSaving(false);
    }
  };

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 py-10 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <ShellHeader onBack={() => navigate(-1)} />

        <h1 className="mt-8 text-[28px] font-black leading-tight">문의 작성</h1>

        <div className="mt-6 flex flex-col gap-4">
          <label className="block">
            <span className="text-[13px] font-black text-[#777]">제목</span>
            <input
              className="mt-2 h-12 w-full rounded-[16px] bg-meet-blueSoft px-4 text-[15px] font-bold outline-none placeholder:text-[#96a3b3] focus:ring-2 focus:ring-meet-blue"
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="문의 제목을 입력해주세요"
              value={title}
            />
          </label>

          <label className="block">
            <span className="text-[13px] font-black text-[#777]">내용</span>
            <textarea
              className="mt-2 min-h-[220px] w-full resize-none rounded-[16px] bg-meet-blueSoft p-4 text-[15px] font-bold leading-relaxed outline-none placeholder:text-[#96a3b3] focus:ring-2 focus:ring-meet-blue"
              maxLength={4000}
              onChange={(event) => setContent(event.target.value)}
              placeholder="문의하실 내용을 자세히 적어주세요"
              value={content}
            />
          </label>

          <label className="flex items-center gap-2.5 py-1">
            <input
              checked={isPrivate}
              className="h-5 w-5 accent-meet-blue"
              onChange={(event) => setIsPrivate(event.target.checked)}
              type="checkbox"
            />
            <span className="text-[14px] font-bold text-[#555]">비밀글로 작성</span>
          </label>
          {isPrivate ? (
            <p className="-mt-2 text-[12.5px] font-bold leading-relaxed text-[#9aa0a7]">
              비밀글은 작성자 본인과 운영진만 제목과 내용을 확인할 수 있어요.
            </p>
          ) : null}

          {error ? <p className="text-center text-[13px] font-black text-meet-pink">{error}</p> : null}

          <PrimaryButton className="mt-2" disabled={!canSubmit} onClick={handleSubmit}>
            {saving ? '등록 중' : '등록하기'}
          </PrimaryButton>
        </div>
      </div>
    </main>
  );
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
