import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import IntroContentSections from '../components/IntroContentSections';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import { verifyAppSession } from '../services/appAuth';
import { fetchPublicIntroContent, type IntroDefaultInfo, type IntroSection } from '../services/introContent';
import { fetchEventCoverUrls, getCachedTestEventPreviewToken } from '../services/supabaseApplications';

// 행사소개 페이지 - 두 경로가 이 화면 하나를 공유한다.
//   - /events/:eventId/info  ("apply" 모드) : 행사 신청 흐름 중 진입,
//     eventId가 있으므로 그 행사의 실제 데이터를 보여주고 CTA는 신청으로.
//   - /event-info            ("browse" 모드): 메인페이지 등에서 특정 신청
//     흐름 없이 진입 - eventId가 없고, 예정 행사 유무와 무관하게 관리자
//     "행사소개 관리 > 기본 행사 정보"에서 설정한 기본값을 항상 보여주고
//     CTA는 캘린더 이동으로 (실제 행사로 자동 대체하지 않는다).
// apply 모드의 핵심정보(행사명/날짜/장소/가격/인원/모집상태/대표이미지)는
// events 데이터에서 그대로 가져온다 - 절대 하드코딩하지 않는다. 그 아래
// 텍스트/이미지 갤러리 콘텐츠는 관리자 "행사소개 관리"가 관리하는 공통
// 콘텐츠로, 두 모드 모두 항상 동일하다.
// 관리자가 행사별 대표 이미지를 등록하지 않았거나 기본값에 대표 이미지가
// 없을 때 쓰는 공용 목업 - 빈 회색 박스 대신 홈 "다가오는 행사" 카드와
// 같은 현장 사진을 보여준다.
const eventCoverPlaceholder = '/assets/home/event-cover-placeholder.jpg';

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
  const [defaultInfo, setDefaultInfo] = useState<IntroDefaultInfo | null>(null);
  const [introLoaded, setIntroLoaded] = useState(false);

  // eventId가 있으면(행사 신청 흐름 진입) 그 행사의 실제 데이터를 쓰고,
  // 없으면(메인페이지 등에서 특정 행사 없이 진입) 예정 행사 유무와 무관하게
  // 항상 관리자가 설정한 기본값을 쓴다 - 예정 행사가 있다고 자동으로
  // 대체하지 않는다.
  const mode: 'apply' | 'browse' = eventId ? 'apply' : 'browse';
  const event = eventId ? events.find((item) => item.id === eventId) : undefined;
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

  // 공통 소개 콘텐츠(+기본 행사 정보)는 행사와 무관하므로 한 번만 불러온다.
  // fetchPublicIntroContent는 실패해도 내부적으로 빈 payload를 resolve하므로
  // introLoaded는 "성공 여부"가 아니라 "1차 응답을 받았는지"만 나타낸다 -
  // 이 값이 true가 되기 전까지는 아래에서 "예정된 행사가 없습니다" 같은
  // 진짜 빈 상태 문구를 절대 그리지 않는다(로딩 중 ≠ 데이터 없음).
  useEffect(() => {
    let active = true;
    void fetchPublicIntroContent().then((payload) => {
      if (!active) return;
      setIntroSections(payload.sections);
      setDefaultInfo(payload.defaultInfo);
      setIntroLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const hasDefaultInfo = Boolean(defaultInfo && (defaultInfo.title || defaultInfo.location || defaultInfo.dateLabel));

  if (loading || !introLoaded) return <DataLoadingState />;
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
              <div className="mt-6 overflow-hidden rounded-[16px]" style={{ aspectRatio: '4 / 3' }}>
                <img
                  alt=""
                  aria-hidden="true"
                  className={`h-full w-full object-cover ${coverUrl ? 'object-center' : 'object-[center_30%]'}`}
                  src={coverUrl ?? eventCoverPlaceholder}
                />
              </div>

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
                  <p>만 24~33세 미혼 남녀</p>
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
                  {defaultInfo?.discountNote ? (
                    <p className="mt-5 whitespace-pre-line text-meet-blue">{defaultInfo.discountNote}</p>
                  ) : null}
                </div>
              </section>
            </>
          ) : hasDefaultInfo && defaultInfo ? (
            <>
              <div className="mt-6 overflow-hidden rounded-[16px]" style={{ aspectRatio: '4 / 3' }}>
                <img
                  alt=""
                  aria-hidden="true"
                  className={`h-full w-full object-cover ${defaultInfo.coverUrl ? 'object-center' : 'object-[center_30%]'}`}
                  src={defaultInfo.coverUrl ?? eventCoverPlaceholder}
                />
              </div>

              <h1 className="text-fluid-safe mt-5 px-1 text-[21px] font-black leading-tight">
                {defaultInfo.title || '타임투밋 로테이션소개팅'}
              </h1>

              <section className="mt-9">
                <h2 className="px-1 text-[20px] font-black">핵심정보</h2>
                <div className="mt-4 rounded-[16px] bg-meet-blueSoft p-4 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
                  <p className="font-black text-black">일시</p>
                  <p>
                    {defaultInfo.dateLabel ?? '일정 안내 예정'}
                    {defaultInfo.startTime ? ` ${defaultInfo.startTime.slice(0, 5)}` : ''}
                  </p>
                  <p>※ 참가 인원과 현장 진행 상황에 따라 달라질 수 있습니다.</p>
                  <p className="mt-5 font-black text-black">장소</p>
                  <p>{defaultInfo.location ? `${defaultInfo.location} 내 프라이빗 카페` : '장소 안내 예정'}</p>
                  <p>※ 상세 장소는 참가 확정 후 안내됩니다.</p>
                  <p className="mt-5 font-black text-black">모집 대상</p>
                  <p>만 24~33세 미혼 남녀</p>
                  {defaultInfo.maleCapacity != null || defaultInfo.femaleCapacity != null ? (
                    <>
                      <p className="mt-5 font-black text-black">모집 인원</p>
                      <p>
                        남성 {defaultInfo.maleCapacity ?? '-'}명 · 여성 {defaultInfo.femaleCapacity ?? '-'}명
                      </p>
                      {(defaultInfo.maleCapacity ?? 0) >= 6 && (defaultInfo.femaleCapacity ?? 0) >= 6 ? (
                        <p>※ 최소 6:6부터 진행됩니다.</p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </section>

              {defaultInfo.malePrice != null || defaultInfo.femalePrice != null ? (
                <section className="mt-10">
                  <h2 className="px-1 text-[20px] font-black">참가비 안내</h2>
                  <div className="mt-4 rounded-[16px] bg-meet-blueSoft p-4 text-fluid-safe text-[15px] font-extrabold leading-relaxed text-[#555] min-[380px]:p-5">
                    <p>남성 {formatWon(defaultInfo.malePrice ?? 0)}</p>
                    <p>여성 {formatWon(defaultInfo.femalePrice ?? 0)}</p>
                    {defaultInfo.discountNote ? (
                      <p className="mt-5 whitespace-pre-line text-meet-blue">{defaultInfo.discountNote}</p>
                    ) : null}
                  </div>
                </section>
              ) : null}
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

function formatWon(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatKoreanWeekday(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const date = new Date(year, month - 1, day);
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}
