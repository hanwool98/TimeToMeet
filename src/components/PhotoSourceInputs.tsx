import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ChangeEvent } from 'react';

export interface PhotoSourceInputsHandle {
  openCamera: () => void;
  openGallery: () => void;
}

// 촬영/앨범 <input type=file> 한 쌍을 감싼 공용 컴포넌트 - capture=
// "environment"가 있으면 모바일 브라우저가 곧장 후면 카메라 앱을 열고,
// 없는 쪽은 갤러리/파일 선택기를 연다. 순수 <input type=file>이라 네이티브
// WebView 래퍼(WebChromeClient.onShowFileChooser 등)가 전혀 필요 없다.
//
// 신청서 작성 화면(ProfileFormPage)과 행사 전용 프로필 카드 화면
// (EventModePage)이 이 파일 하나를 공유한다 - 두 화면의 주변 UI(사진
// 미리보기 타일 vs 원형 아바타 + 기존 사진 그리드)는 서로 다르므로 그
// 부분은 각자 유지하고, 실제 파일 선택 로직만 여기서 한 번만 구현한다.
const PhotoSourceInputs = forwardRef<PhotoSourceInputsHandle, { multiple?: boolean; onFiles: (files: File[]) => void }>(
  ({ multiple = false, onFiles }, ref) => {
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      openCamera: () => cameraInputRef.current?.click(),
      openGallery: () => galleryInputRef.current?.click(),
    }));

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      onFiles(Array.from(files ?? []));
      event.target.value = '';
    };

    return (
      <>
        <input
          accept="image/*"
          aria-hidden="true"
          capture="environment"
          onChange={handleChange}
          ref={cameraInputRef}
          style={{ display: 'none' }}
          tabIndex={-1}
          type="file"
        />
        <input
          accept="image/*"
          aria-hidden="true"
          multiple={multiple}
          onChange={handleChange}
          ref={galleryInputRef}
          style={{ display: 'none' }}
          tabIndex={-1}
          type="file"
        />
      </>
    );
  },
);
PhotoSourceInputs.displayName = 'PhotoSourceInputs';
export default PhotoSourceInputs;
