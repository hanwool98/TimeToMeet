import { useNavigate } from 'react-router-dom';

const actionLabels = [
  '로그인',
  '카카오로 로그인하기',
  '이메일로 로그인하기',
  '회원가입',
  '아이디 찾기',
  '비밀번호 찾기',
  '비회원으로 계속하기',
];

function showPreparing() {
  window.alert('준비중!');
}

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-5 py-12 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-[430px] flex-col justify-center">
        <section className="relative rounded-[30px] border border-[#f0f3f6] bg-white px-7 pb-9 pt-28 shadow-calendar">
          <button
            aria-label="뒤로 가기"
            className="absolute left-5 top-5 grid h-11 w-11 place-items-center text-black transition hover:opacity-70"
            onClick={() => navigate(-1)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-9 w-9"
              fill="none"
              viewBox="0 0 48 48"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M18 12L7 23L18 34"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="6"
              />
              <path
                d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="6"
              />
            </svg>
          </button>
          <div
            aria-label="로고 영역"
            className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm"
            role="img"
          >
            로고
          </div>

          <div className="mx-auto text-center text-[31px] font-black leading-none tracking-normal">
            로고
          </div>

          <form className="mt-16 space-y-7" onSubmit={(event) => event.preventDefault()}>
            <label className="block">
              <span className="text-[16px] font-extrabold text-[#8a8a8a]">아이디</span>
              <input
                aria-label="아이디"
                className="mt-1 h-10 w-full border-0 border-b-2 border-[#9d9d9d] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue"
                type="text"
              />
            </label>

            <label className="block">
              <span className="text-[16px] font-extrabold text-[#8a8a8a]">비밀번호</span>
              <input
                aria-label="비밀번호"
                className="mt-1 h-10 w-full border-0 border-b-2 border-[#9d9d9d] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue"
                type="password"
              />
            </label>
          </form>

          <div className="mt-8 space-y-3">
            {actionLabels.slice(0, 3).map((label, index) => (
              <button
                className={[
                  'h-14 w-full rounded-[18px] px-5 text-[16px] font-extrabold shadow-sm transition active:scale-[0.99]',
                  index === 0 ? 'bg-meet-blue text-white hover:bg-[#5aa7e9]' : '',
                  index === 1 ? 'bg-[#FEE500] text-black hover:bg-[#f2dc00]' : '',
                  index === 2 ? 'bg-[#d9d9d9] text-black hover:bg-[#d0d0d0]' : '',
                ].join(' ')}
                key={label}
                onClick={showPreparing}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[15px] font-extrabold text-[#777]">
            {actionLabels.slice(3, 6).map((label, index) => (
              <span className="flex items-center gap-x-2" key={label}>
                <button className="transition hover:text-black" onClick={showPreparing} type="button">
                  {label}
                </button>
                {index < 2 ? <span aria-hidden="true">/</span> : null}
              </span>
            ))}
          </div>

          <button
            className="mx-auto mt-8 block border-b-2 border-black pb-1 text-[17px] font-black leading-none"
            onClick={showPreparing}
            type="button"
          >
            비회원으로 계속하기
          </button>

          <p className="mx-auto mt-7 max-w-[310px] break-keep text-center text-[17px] font-black leading-snug">
            타임투밋 회원이 되시면 프로필 저장/쿠폰 등 다양한 혜택을 받으실 수 있습니다!
          </p>
        </section>
      </div>
    </main>
  );
}
