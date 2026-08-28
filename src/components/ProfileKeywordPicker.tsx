import { useEffect, useState } from 'react';
import { PROFILE_KEYWORD_CUSTOM_MAX_LENGTH, PROFILE_KEYWORD_OPTIONS, type ProfileKeywordOption } from '../constants/profileKeywords';

// HashtagPicker.tsx(상대 평가용 hashtag)와 상호작용 패턴은 같지만, 이건
// 완전히 다른 개념(본인을 표현하는 키워드)이라 별도 컴포넌트로 둔다.
// `selected`에는 고정 키워드는 key(예: likes_movies)로, 직접입력은
// "#"으로 시작하는 정규화된 문구로 저장된다 - 두 경우 모두 그냥 문자열
// 배열 교집합으로 다른 사람과의 공통 키워드를 판정할 수 있다.
//
// `options`는 관리자가 콘텐츠 관리에서 관리하는 활성 키워드 목록
// (get_active_profile_keywords)을 부모가 fetch해 내려준다 - 서버 조회가
// 실패했거나 아직 로딩 전이면 기존 코드 상수로 폴백해 화면이 완전히
// 비어보이지 않게 한다.
export default function ProfileKeywordPicker({
  onChange,
  options = PROFILE_KEYWORD_OPTIONS,
  selected,
}: {
  onChange: (next: string[]) => void;
  options?: ProfileKeywordOption[];
  selected: string[];
}) {
  const fixedKeySet = new Set<string>(options.map((option) => option.key));
  const customTag = selected.find((tag) => !fixedKeySet.has(tag));
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(customTag ? customTag.replace(/^#/, '') : '');

  useEffect(() => {
    setCustomDraft(customTag ? customTag.replace(/^#/, '') : '');
  }, [customTag]);

  const toggleFixed = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  };

  const commitCustomTag = () => {
    const trimmed = customDraft.trim().replace(/^#+/, '').slice(0, PROFILE_KEYWORD_CUSTOM_MAX_LENGTH);
    const withoutOldCustom = selected.filter((tag) => tag !== customTag);
    setCustomEditorOpen(false);
    if (!trimmed) {
      onChange(withoutOldCustom);
      return;
    }
    onChange([...withoutOldCustom, `#${trimmed}`]);
  };

  const removeCustomTag = () => {
    onChange(selected.filter((tag) => tag !== customTag));
    setCustomDraft('');
    setCustomEditorOpen(false);
  };

  const chipClassName = (isSelected: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] font-bold transition ${
      isSelected ? 'border-meet-pink bg-meet-pinkSoft text-meet-pink' : 'border-[#eee] bg-white text-[#777]'
    }`;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button className={chipClassName(selected.includes(option.key))} key={option.key} onClick={() => toggleFixed(option.key)} type="button">
            {option.label}
          </button>
        ))}
        {customTag && !customEditorOpen ? (
          <button className={chipClassName(true)} onClick={() => setCustomEditorOpen(true)} type="button">
            {customTag}
          </button>
        ) : !customEditorOpen ? (
          <button
            className="rounded-full border border-dashed border-[#ddd] bg-white px-3 py-1.5 text-[13px] font-bold text-[#999]"
            onClick={() => setCustomEditorOpen(true)}
            type="button"
          >
            + 직접 입력
          </button>
        ) : null}
      </div>

      {customEditorOpen ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#eee] bg-[#f9fafb] px-3 text-[13px] font-bold outline-none"
            maxLength={PROFILE_KEYWORD_CUSTOM_MAX_LENGTH}
            onChange={(event) => setCustomDraft(event.target.value)}
            placeholder="예: 요리를잘함"
            value={customDraft}
          />
          <button className="shrink-0 text-[13px] font-black text-meet-blue" onClick={commitCustomTag} type="button">
            확인
          </button>
          {customTag ? (
            <button className="shrink-0 text-[13px] font-bold text-[#aaa]" onClick={removeCustomTag} type="button">
              삭제
            </button>
          ) : (
            <button className="shrink-0 text-[13px] font-bold text-[#aaa]" onClick={() => setCustomEditorOpen(false)} type="button">
              취소
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
