import HomeCarousel from './HomeCarousel';
import type { IntroImage, IntroSection } from '../services/introContent';

// 타임투밋 공통 행사소개 콘텐츠 렌더러. 참가자 화면(EventInfoPage)과 관리자
// 편집 화면의 "미리보기"가 완전히 같은 결과를 보도록 컴포넌트를 공유한다 -
// 미리보기에서 다르게 보이면 미리보기의 의미가 없기 때문. 이미지 갤러리는
// 홈 대시보드와 동일한 HomeCarousel(스크롤 스냅 + 하단 인디케이터)을
// 그대로 재사용한다.
export default function IntroContentSections({ sections }: { sections: IntroSection[] }) {
  const visibleSections = sections.filter((section) => section.isVisible);
  if (visibleSections.length === 0) return null;

  return (
    <>
      {visibleSections.map((section) => {
        if (section.sectionType === 'gallery') {
          if (section.images.length === 0) return null;
          return <GallerySection key={section.id} section={section} />;
        }

        if (!section.title && !section.content) return null;
        return <TextSection key={section.id} section={section} />;
      })}
    </>
  );
}

function TextSection({ section }: { section: IntroSection }) {
  return (
    <section className="mt-10 px-1">
      {section.title ? <h2 className="text-[20px] font-black">{section.title}</h2> : null}
      {section.content ? (
        <p
          className={`text-fluid-safe whitespace-pre-line text-[15px] font-bold leading-relaxed text-[#444] ${
            section.title ? 'mt-4' : ''
          }`}
        >
          {section.content}
        </p>
      ) : null}
    </section>
  );
}

function GallerySection({ section }: { section: IntroSection }) {
  return (
    <section className="mt-10">
      {section.title ? <h2 className="mb-4 px-1 text-[20px] font-black">{section.title}</h2> : null}
      <HomeCarousel
        ariaLabel={section.title ?? '행사 소개 이미지'}
        dotStyle="windowed"
        getKey={(image: IntroImage) => image.id}
        items={section.images}
        renderItem={(image: IntroImage) => (
          <div className="relative overflow-hidden rounded-[16px] bg-[#f1f3f5]" style={{ aspectRatio: '4 / 3' }}>
            {image.imageUrl ? (
              <img alt={image.caption || ''} className="absolute inset-0 h-full w-full object-cover" src={image.imageUrl} />
            ) : null}
            {image.caption ? (
              <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-8 text-[13px] font-bold text-white">
                {image.caption}
              </p>
            ) : null}
          </div>
        )}
        slideClassName="w-full"
      />
    </section>
  );
}
