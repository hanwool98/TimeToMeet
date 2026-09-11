import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import IntroContentSections from '../components/IntroContentSections';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import { verifyAppSession } from '../services/appAuth';
import { fetchPublicIntroContent, type IntroSection } from '../services/introContent';
import { fetchEventCoverUrls, getCachedTestEventPreviewToken } from '../services/supabaseApplications';

// 행사소개 페이지 - 두 경로가 이 화면 하나를 공유한다.
//   - /events/:eventId/info  ("apply" 모드) : 행사 신청 흐름 중 진입,
//     eventId가 있으므로 그 행사 정보를 기준으로 보여주고 CTA는 신청으로.
//   - /event-info            ("browse" 모드): 메인페이지 등에서 특정 신청
//     흐름 없이 진입, eventId가 없으므로 "가장 가까운 예정 행사" 정보를
//     보여주고 CTA는 캘린더 이동으로.
// 핵심정보(행사명/날짜/장소/가격/인원/모집상태/대표이미지)는 두 모드 모두
// events 데이터에서 그대로 가져온다 - 절대 하드코딩하지 않는다. 그 아래
// 텍스트/이미지 갤러리 콘텐츠는 관리자 "행사소개 관리"가 관리하는 공통
// 콘텐츠로, 행사와 무관하게 항상 동일하다.
function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
      <path d="M18 12L7 23L18 34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
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

export default function EventInfoPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const previewToken = getCachedTestEventPreviewToken(eventId);
  const { error, events, loading, reload } = useOperationalData({ eventId, previewToken });
  const [checkingSession, setCheckingSession] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [introSections, setIntroSections] = useState<IntroSection[] | null>(null);

  // eventId가 있으면(행사 신청 흐름 진입) 그 행사, 없으면(메인페이지 등에서
  // 특정 행사 없이 진입) 가장 가까운 예정 행사를 기본값으로 쓴다.
  const mode: 'apply' | 'browse' = eventId ? 'apply' : 'browse';
  const event = eventId
    ? events.find((item) => item.id === eventId)
    : events
      .filter((item) => getDaysUntilEvent(item.date) >= 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
  const counts = { male: event?.maleConfirmed ?? 0, female: event?.femaleConfirmed ?? 0 };
  const isEarlyBirdActive = Boolean(event?.earlyBirdDeadline && new Date(event.earlyBirdDeadline).getTime() > Date.now());
  const earlyBirdDiscountMale = isEarlyBirdActive ? event?.earlyBirdDiscountMale ?? 0 : 0;
  const earlyBirdDiscountFemale = isEarlyBirdActive ? event?.earlyBirdDiscountFemale ?? 0 : 0;
  const finalMalePrice = Math.max((event?.malePrice ?? 0) - earlyBirdDiscountMale, 0);
  const finalFemalePrice = Math.max((event?.femalePrice ?? 0) - earlyBirdDiscountFemale, 0);
  const hasActiveEarlyBirdDiscount = isEarlyBirdActive && (earlyBirdDiscountMale > 0 || earlyBirdDiscountFemale > 0);
  const isRecruiting = event ? event.currentParticipants < event.targetParticipants : false;

  useEffect(() => {
    if (!event) {
      setCoverUrl(null);
      return;
    }
    let active = true;
    void fetchEventCoverUrls([event.id]).then((covers) => {
      if (active) setCoverUrl(covers[event.id] ?? null);
    });
    return () => {
      active = false;
    };
  }, [event?.id]);

  // 공통 소개 콘텐츠는 행사와 무관하므로 한 번만 불러온다.
  useEffect(() => {
    let active = true;
    void fetchPublicIntroContent().then((sections) => {
      if (active) setIntroSections(sections);
    });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-3 with-bottom-tabs pt-12 text-black min-[380px]:px-4">
      <div className="mobile-container mx-auto">
        <section className="relative rounded-[24px] bg-white px-4 pb-7 pt-16 shadow-calendar min-[380px]:px-5">
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

          {event ? (
            <>
              {coverUrl ? (
                <div className="mt-6 overflow-hidden rounded-[16px]" style={{ aspectRatio: '4 / 3' }}>
                  <img alt="" aria-hidden="true" className="h-full w-full object-cover" src={coverUrl} />
                </div>
              ) : (
                <div className="mt-6 grid min-h-[156px] place-items-center bg-[#d9d9d9] px-4 py-7 text-center">
                  <div>
                    <p className="text-[18px] font-black text-black">행사 대표 이미지</p>
                    <p className="mt-7 text-[15px] font-extrabold italic text-white">image</p>
                  </div>
                </div>
              )}

              <h1 className="text-fluid-safe mt-5 px-1 text-[21px] font-black leading-tight">{event.title}</h1>

              <section className="mt-9">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-[20px] font-black">핵심정보</h2>
                  <span className={`text-[13px] font-black ${isRecruiting ? 'text-meet-pink' : 'text-[#9a9a9a]'}`}>
                    {isRecruiting ? '🔥 모집중' : '모집 마감'}
                  </span>
                </div>
                <div className="mt-4 rounded-[16px] bg-meet-blueSoft p-4 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
                  <p className="font-black text-black">일시</p>
                  <p>{formatKoreanWeekday(event.date)} {event.startTime}~{event.endTime}</p>
                  <p>※ 참가 인원과 현장 진행 상황에 따라 달라질 수 있습니다.</p>
                  <p className="mt-5 font-black text-black">장소</p>
                  <p>{event.location} 내 프라이빗 카페</p>
                  <p>※ 상세 장소는 참가 확정 후 안내됩니다.</p>
                  <p className="mt-5 font-black text-black">모집 대상</p>
                  <p>25~35세 미혼 남녀</p>
                  <p className="mt-5 font-black text-black">모집 인원</p>
                  <p>
                    남성 {counts.male}/{event.maleCapacity ?? 10} · 여성 {counts.female}/{event.femaleCapacity ?? 10}
                  </p>
                  {(event.maleCapacity ?? 10) >= 6 && (event.femaleCapacity ?? 10) >= 6 ? <p>※ 최소 6:6부터 진행됩니다.</p> : null}
                </div>
              </section>

              <section className="mt-10">
                <h2 className="px-1 text-[20px] font-black">참가비 안내</h2>
                <div className="mt-4 rounded-[16px] bg-meet-blueSoft p-4 text-fluid-safe text-[15px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
                  {hasActiveEarlyBirdDiscount ? (
                    <>
                      <p>
                        남성{' '}
                        {earlyBirdDiscountMale > 0 ? (
                          <>
                            <span className="text-[#aab0b8] line-through">{formatWon(event.malePrice)}</span> {formatWon(finalMalePrice)}
                          </>
                        ) : (
                          formatWon(finalMalePrice)
                        )}
                      </p>
                      <p>
                        여성{' '}
                        {earlyBirdDiscountFemale > 0 ? (
                          <>
                            <span className="text-[#aab0b8] line-through">{formatWon(event.femalePrice)}</span> {formatWon(finalFemalePrice)}
                          </>
                        ) : (
                          formatWon(finalFemalePrice)
                        )}
                      </p>
                      <p className="mt-5 text-meet-blue">얼리버드 할인 적용 중</p>
                    </>
                  ) : (
                    <>
                      <p>남성 {formatWon(event.malePrice)}</p>
                      <p>여성 {formatWon(event.femalePrice)}</p>
                    </>
                  )}
                </div>
              </section>
            </>
          ) : (
            <div className="mt-9 rounded-[16px] bg-meet-blueSoft p-6 text-center text-[14px] font-black text-[#666]">
              {mode === 'browse' ? '예정된 행사가 없습니다.' : '행사 정보를 찾을 수 없습니다.'}
            </div>
          )}

          {introSections ? <IntroContentSections sections={introSections} /> : null}

          <div className="sticky bottom-4 mt-10">
            {mode === 'apply' ? (
              <PrimaryButton
                disabled={!eventId || checkingSession}
                onClick={async () => {
                  if (!eventId || checkingSession) return;
                  const returnTo = `/events/${eventId}/apply/profile`;
                  setCheckingSession(true);
                  try {
                    const hasValidSession = await verifyAppSession();
                    if (hasValidSession) {
                      navigate(returnTo);
                      return;
                    }
                    navigate(`/guest-phone?entry=tab&returnTo=${encodeURIComponent(returnTo)}`);
                  } finally {
                    setCheckingSession(false);
                  }
                }}
              >
                내 프로필 만들기
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => navigate('/calendar')}>캘린더로 이동하기</PrimaryButton>
            )}
          </div>
        </section>
      </div>
      <BottomTabs />
    </main>
  );
}

function getDaysUntilEvent(dateValue: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
