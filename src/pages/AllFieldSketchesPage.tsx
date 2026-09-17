import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';
import LogoMark from '../components/LogoMark';
import ParticipantPhoto from '../components/ParticipantPhoto';
import PhotoLightbox from '../components/PhotoLightbox';
import { fetchPublicHomeContents, type PublicHomeContent } from '../services/supabaseApplications';

// 메인페이지 "현장 스케치 › 더보기" 진입 화면. AllReviewsPage와 동일한
// 헤더/레이아웃 관례를 따르고, 홈 캐러셀과 완전히 같은 fetchPublicHomeContents
// 호출로 같은 sort_order 데이터를 가져와 표시한다(홈/더보기 데이터 소스
// 일원화 - 관리자가 사진을 추가/삭제하면 두 화면 모두 다음 조회 때
// 그대로 반영됨). 카드 자체는 기존 현장 스케치 썸네일(4:3, crop 유지)을
// 그대로 쓰고 그리드로만 배치한다.
export default function AllFieldSketchesPage() {
  const navigate = useNavigate();
  const [sketches, setSketches] = useState<PublicHomeContent[] | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicHomeContents('field_sketch').then((rows) => {
      if (active) setSketches(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 py-10 with-bottom-tabs text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <header className="flex items-center justify-between">
          <button aria-label="뒤로 가기" className="grid h-11 w-11 place-items-center text-black" onClick={() => navigate(-1)} type="button">
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
          </button>
          <LogoMark className="h-14 w-14 rounded-full" />
        </header>

        <h1 className="mt-6 text-[24px] font-black leading-tight">현장 스케치 📸</h1>

        <div className="mt-6">
          {!sketches ? null : sketches.length === 0 ? (
            <p className="py-14 text-center text-[14px] font-bold text-[#9a9a9a]">아직 등록된 현장 스케치가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {sketches.map((sketch, index) => (
                <button
                  aria-label={sketch.caption || '현장 스케치 사진 확대'}
                  className="relative block w-full overflow-hidden rounded-[12px] shadow-card active:scale-[0.98]"
                  key={sketch.id}
                  onClick={() => setOpenIndex(index)}
                  type="button"
                >
                  <ParticipantPhoto
                    className="w-full bg-[#f1f3f5]"
                    crop={sketch.cropPosition}
                    loading="lazy"
                    photoUrl={sketch.imageUrl}
                    style={{ aspectRatio: '4 / 3' }}
                  />
                  {sketch.caption ? (
                    <p className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-black text-white">
                      {sketch.caption}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {sketches && openIndex != null ? (
        <PhotoLightbox
          images={sketches.map((sketch) => ({ id: sketch.id, url: sketch.imageUrl ?? '', caption: sketch.caption }))}
          onClose={() => setOpenIndex(null)}
          startIndex={openIndex}
        />
      ) : null}
      <BottomTabs />
    </main>
  );
}
