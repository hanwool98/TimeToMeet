import { useLocation, useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';

const reasons = [
  {
    title: '전용 앱으로 편안하게',
    body: ['타임투밋은 전용 앱을 사용합니다', '행사 중에도 앱이 설치된 태블릿을 사용하여', '더욱 쉽게 즐길 수 있습니다'],
  },
  {
    title: '닉네임으로 부담없이',
    body: ['행사 중에는 닉네임을 사용합니다.', '실명 및 연락처는 매칭 전까지', '공개되지 않습니다.'],
  },
  {
    title: '첫인상은 외모만이 아닙니다',
    body: ['참가자들을 만나보기 전에', '목소리를 먼저 들어보세요!'],
  },
  {
    title: 'I도 편하게 즐길 수 있는 대화',
    body: ['태블릿을 통해 100개가 넘은 대화 주제를', '제공 받아 누구나 편하게 대화할 수 있어요'],
  },
  {
    title: '불편한 순간엔 바로 신고',
    body: ['상대방의 부적절한 언행을 발견하면', '개인 휴대전화의 앱을 통해', '즉시 운영자에게 알릴 수 있어요'],
  },
  {
    title: '만남이 아쉬웠다면 한번 더',
    body: ['첫번째 대화가 끝난 후 호감도를 반영해', '특정 인물 2-3인과', '2nd 대화 찬스가 제공됩니다.'],
  },
  {
    title: '차분한 자리의 소개팅',
    body: ['차를 마시며 편안하게 대화할 수 있는', '분위기에서 진행됩니다.'],
  },
];

const steps = [
  '입장 및 안내',
  '1 : 1 로테이션 대화',
  '호감도 작성 및 메모',
  '자리 이동',
  '2nd 대화 찬스',
  '최종선택',
  '매칭',
];

const reviews = ['image', 'image', 'image', 'image'];

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
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
  );
}

function SwipeSection({
  items,
  title,
}: {
  items: Array<string | { title: string; body: string[] }>;
  title: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="px-1 text-[20px] font-black text-black">{title}</h2>
      <div className="mt-4 flex max-w-full snap-x gap-3 overflow-x-auto pb-3 [-webkit-overflow-scrolling:touch]">
        {items.map((item) => (
          <article
            className="grid min-h-[146px] min-w-[128px] snap-start place-items-center rounded-none bg-[#d9d9d9] p-3 text-center"
            key={typeof item === 'string' ? item : item.title}
          >
            {typeof item === 'string' ? (
              <p className="break-keep text-[13px] font-black leading-snug text-white">{item}</p>
            ) : (
              <>
                <h3 className="break-keep text-[13px] font-black leading-snug text-black">{item.title}</h3>
                <div className="mt-2 space-y-1 break-keep text-[10px] font-extrabold leading-snug text-[#555]">
                  {item.body.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function EventInfoPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams();
  const { error, events, loading, reload } = useOperationalData();
  const isTabEventInfo = location.pathname === '/event-info';
  const event =
    events.find((item) => item.id === eventId) ??
    events
      .filter((item) => getDaysUntilEvent(item.date) >= 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
  const counts = { male: event?.maleConfirmed ?? 0, female: event?.femaleConfirmed ?? 0 };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-3 with-bottom-tabs pt-12 text-black min-[380px]:px-4">
      <div className="mobile-container mx-auto">
        <section className="relative rounded-[30px] border border-[#f0f3f6] bg-white px-4 pb-7 pt-16 shadow-calendar min-[380px]:px-5">
          <button
            aria-label="뒤로 가기"
            className="absolute left-5 top-5 grid h-10 w-10 place-items-center text-black transition hover:opacity-70"
            onClick={() => navigate(-1)}
            type="button"
          >
            <BackIcon />
          </button>

          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>

          <div className="mt-6 grid min-h-[156px] place-items-center bg-[#d9d9d9] px-4 py-7 text-center">
            <div>
              <p className="text-[18px] font-black text-black">행사 대표 이미지</p>
              <p className="mt-7 text-[15px] font-extrabold italic text-white">image</p>
            </div>
          </div>

          <section className="mt-9 space-y-6 px-1">
            <h2 className="text-[20px] font-black">새로운 만남이 가장 기대되는 시간</h2>
            <div className="space-y-5 text-fluid-safe text-[15px] font-extrabold leading-relaxed text-black">
              <p>
                미혼남녀가 가장 선호하는 소개팅 시간대는
                <br />
                주말 초저녁이었습니다.
              </p>
              <p>
                단순히 연인을 찾는 것을 넘어,
                <br />내 시간을 함께하고 싶은 사람을 만나는 곳.
              </p>
              <p>
                행사의 끝이 새로운 만남의 시작이 될 수 있도록,
              </p>
              <p>
                <span className="font-black italic">Time to Meet</span>
                <br />
                여러분의 새로운 만남이 시작될 시간입니다.
              </p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="px-1 text-[20px] font-black">핵심정보</h2>
            <div className="mt-4 rounded-[24px] bg-meet-blueSoft p-4 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
              <p className="font-black text-black">일시</p>
              <p>{event ? `${formatKoreanWeekday(event.date)} ${event.startTime}~${event.endTime}` : '행사 일정 미정'}</p>
              <p>※ 참가 인원과 현장 진행 상황에 따라 달라질 수 있습니다.</p>
              <p className="mt-5 font-black text-black">장소</p>
              <p>{event ? `${event.location} 내 프라이빗 카페` : '장소 미정'}</p>
              <p>※ 상세 장소는 참가 확정 후 안내됩니다.</p>
              <p className="mt-5 font-black text-black">모집 대상</p>
              <p>25~35세 미혼 남녀</p>
              <p className="mt-5 font-black text-black">모집 인원</p>
              <p>남성 {counts.male}/10 · 여성 {counts.female}/10</p>
              <p>※ 최소 6:6부터 진행됩니다.</p>
            </div>
          </section>

          <SwipeSection items={reasons} title="왜 타임투밋인가요?" />
          <SwipeSection items={steps} title="진행순서" />
          <SwipeSection items={reviews} title="후기" />

          <section className="mt-10">
            <h2 className="px-1 text-[20px] font-black">참가비 안내</h2>
            <div className="mt-4 rounded-[24px] bg-meet-blueSoft p-4 text-fluid-safe text-[15px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
              <p>남성 {formatWon(event?.malePrice ?? 50000)}</p>
              <p>여성 {formatWon(event?.femalePrice ?? 40000)}</p>
              <p className="mt-5">얼리버드 신청 시 5,000원 할인</p>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="px-1 text-[20px] font-black">콘텐츠 참여 혜택</h2>
            <div className="mt-4 rounded-[24px] bg-meet-blueSoft p-4 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
              <p>
                행사 후기 콘텐츠 제작(유튜브, 릴스, 블로그 등)에 참여하고 싶으시다면 타임투밋 공식 DM으로 문의해주세요.
              </p>
              <p className="mt-5">별도의 참여 혜택을 안내해드립니다.</p>
            </div>
          </section>

          {!isTabEventInfo ? (
            <div className="sticky bottom-4 mt-10">
              <PrimaryButton onClick={() => navigate('/login')}>내 프로필 만들기</PrimaryButton>
            </div>
          ) : null}
        </section>
      </div>
      <BottomTabs />
    </main>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date(2026, 7, 7);
  const eventDate = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((eventDate.getTime() - today.getTime()) / 86_400_000);
}

function formatWon(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatKoreanWeekday(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const date = new Date(year, month - 1, day);
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}
