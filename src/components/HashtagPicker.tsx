import { useEffect, useState } from 'react';
import { CUSTOM_HASHTAG_MAX_LENGTH, FIXED_RATING_HASHTAGS } from '../constants/ratingHashtags';

const fixedTagSet = new Set<string>(FIXED_RATING_HASHTAGS);

// `selected` is the flat list actually submitted to the server - both the
// fixed chips and the (at most one) custom tag live in the same array; this
// component just figures out which selected entry is the custom one by
// checking it against the fixed set.
export default function HashtagPicker({ selected, onChange }: { onChange: (next: string[]) => void; selected: string[] }) {
  const customTag = selected.find((tag) => !fixedTagSet.has(tag));
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState(customTag ? customTag.replace(/^#/, '') : '');

  useEffect(() => {
    setCustomDraft(customTag ? customTag.replace(/^#/, '') : '');
  }, [customTag]);

  const toggleFixed = (tag: string) => {
    onChange(selected.includes(tag) ? selected.filter((item) => item !== tag) : [...selected, tag]);
  };

  const commitCustomTag = () => {
    const trimmed = customDraft.trim().replace(/^#+/, '').slice(0, CUSTOM_HASHTAG_MAX_LENGTH);
    const withoutOldCustom = selected.filter((tag) => tag !== customTag);
    setCustomEditorOpen(false);
    if (!trimmed) {
      onChange(withoutOldCustom);
      return;
    }
    const formatted = `#${trimmed}`;
    if (fixedTagSet.has(formatted)) {
      // Same wording as a fixed tag - just select that one instead of
      // storing a duplicate custom entry.
      onChange(withoutOldCustom.includes(formatted) ? withoutOldCustom : [...withoutOldCustom, formatted]);
      return;
    }
    onChange([...withoutOldCustom, formatted]);
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
        {FIXED_RATING_HASHTAGS.map((tag) => (
          <button className={chipClassName(selected.includes(tag))} key={tag} onClick={() => toggleFixed(tag)} type="button">
            {tag}
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
            maxLength={CUSTOM_HASHTAG_MAX_LENGTH}
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
