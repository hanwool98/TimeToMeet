// "나를 맞혀봐" 키워드 추측 정답/오답 효과음 - tabletAlertAudio.ts와 동일한
// plain <audio> 싱글턴 패턴(무거운 사운드 라이브러리 추가 없이, 카페에서
// 여러 테이블이 동시에 써도 거슬리지 않도록 로컬의 아주 짧은 wav 파일만
// 재생한다). 이건 태블릿이 아니라 참가자 개인 휴대폰에서 재생된다.
const SOUND_PATHS = {
  correct: '/sounds/keyword-correct.wav',
  incorrect: '/sounds/keyword-incorrect.wav',
} as const;

type KeywordGuessSoundType = keyof typeof SOUND_PATHS;

const audioElements: Partial<Record<KeywordGuessSoundType, HTMLAudioElement>> = {};

function getAudio(type: KeywordGuessSoundType): HTMLAudioElement {
  let audio = audioElements[type];
  if (!audio) {
    audio = new Audio(SOUND_PATHS[type]);
    audio.preload = 'auto';
    audio.volume = 0.5;
    audioElements[type] = audio;
  }
  return audio;
}

// 실패해도 게임 자체를 막지 않는다(효과음은 부가 연출일 뿐 - 무음 기기,
// 자동재생 제한 브라우저 등에서도 정답/오답 표시 자체는 정상 동작해야 함).
export function playKeywordGuessSound(type: KeywordGuessSoundType) {
  try {
    const audio = getAudio(type);
    audio.currentTime = 0;
    audio.play().catch((playError: unknown) => {
      console.warn(`[keyword-guess] ${type} sound playback failed`, playError);
    });
  } catch (syncError) {
    console.warn(`[keyword-guess] ${type} sound could not be started`, syncError);
  }
}
