const maxDimension = 1600;
const jpegQuality = 0.82;
const skipCompressionUnderBytes = 1.5 * 1024 * 1024;
const hardMaxBytesIfUncompressible = 10 * 1024 * 1024;
const compressionTimeoutMs = 8000;

/** Combined base64 payload budget across all files in one submission. */
export const maxTotalUploadBytes = 12 * 1024 * 1024;

/**
 * Downscales/re-encodes an image client-side before it gets base64-encoded
 * and sent to the submit-application Edge Function. Photos straight off a
 * phone camera, downloaded wallpapers, and especially iOS "full page"
 * screenshots (which stitch an entire scrollable page into one very tall
 * image) can be tens of MB; with up to five images in one submission the
 * combined base64 payload could exceed the request size the Edge
 * Function/gateway will accept, which surfaces to the user as an opaque
 * "non-2xx status code" failure.
 *
 * Decoding can itself fail for some inputs (HEIC without native decode
 * support on non-Safari browsers, or source images large enough to hit a
 * browser's internal canvas/decode limits — full-page screenshots being the
 * realistic case). When that happens we fall back to the original file
 * untouched UNLESS it's large enough that sending it as-is would almost
 * certainly fail anyway — in that case we fail fast with a clear, actionable
 * message instead of letting the user hit a mysterious server error after a
 * full network round-trip.
 *
 * `force` bypasses both the "skip small files" shortcut and the "only keep
 * the result if it's smaller" check, and falls back to a raw in-memory
 * re-wrap if canvas re-encoding isn't possible - the goal isn't file size at
 * that point, it's producing a File that's no longer backed by the original
 * OS file handle at all. This matters because on Android (content:// URIs
 * from the gallery/file picker, worst on embedded WebViews like KakaoTalk's
 * in-app browser), that underlying read permission can expire between when
 * a file is picked and when it's actually read - which for this app's long
 * profile form can be many form sections later, at final submit. Reading
 * the file immediately after it's picked (see ProfileFormPage's onFiles
 * handlers) avoids ever touching the original handle again.
 */
export async function compressImageIfNeeded(file: File, options?: { force?: boolean }): Promise<File> {
  const force = options?.force ?? false;

  if (!file.type.startsWith('image/')) {
    if (!force) return file;
    return rewrapAsInMemoryFile(file).catch((error) => {
      console.error('In-memory file rewrap failed', error);
      return file;
    });
  }
  if (!force && file.size <= skipCompressionUnderBytes) return file;

  try {
    // Decoding a source large enough to hit a browser's internal decode
    // limits (full-page screenshots being the realistic case) doesn't
    // always throw — on some engines it can simply hang. A timeout makes
    // that failure mode behave the same as any other compression failure
    // instead of stalling the whole submission indefinitely.
    const compressed = await withTimeout(compressImage(file, force), compressionTimeoutMs);
    if (compressed) return compressed;
  } catch (error) {
    console.error('Image compression failed', error);
  }

  if (file.size > hardMaxBytesIfUncompressible) {
    throw new Error(
      `사진 용량이 너무 커서 처리할 수 없습니다(${formatMegabytes(file.size)}). "전체 페이지" 캡처처럼 매우 긴 이미지 대신 일반 캡처나 사진을 사용해주세요.`,
    );
  }
  if (force) {
    try {
      return await rewrapAsInMemoryFile(file);
    } catch (error) {
      console.error('In-memory file rewrap failed', error);
    }
  }
  return file;
}

/** Reads a file's actual bytes into memory right now and wraps them in a
 * brand new File - the result has no ongoing dependency on whatever
 * (possibly time-limited) OS handle the original File referenced. */
async function rewrapAsInMemoryFile(file: File): Promise<File> {
  const buffer = await file.arrayBuffer();
  return new File([buffer], file.name, { type: file.type || 'application/octet-stream' });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('이미지 처리 시간이 초과되었습니다.')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function compressImage(file: File, force = false): Promise<File | null> {
  const source = await loadImageSource(file);
  const { width, height } = getSourceDimensions(source);
  if (!width || !height) return null;

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));
  if (!blob) return null;
  // force일 때는 용량 절감이 목적이 아니라 원본 OS 파일 참조에서 완전히
  // 분리된 새 File을 만드는 것 자체가 목적이라, 재인코딩 결과가 원본보다
  // 커도 그대로 쓴다.
  if (!force && blob.size >= file.size) return null;

  const nextName = `${file.name.replace(/\.[^./\\]+$/, '')}.jpg`;
  return new File([blob], nextName, { type: 'image/jpeg' });
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type ImageSource = ImageBitmap | HTMLImageElement;

function getSourceDimensions(source: ImageSource) {
  if (source instanceof HTMLImageElement) return { height: source.naturalHeight, width: source.naturalWidth };
  return { height: source.height, width: source.width };
}

async function loadImageSource(file: File): Promise<ImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some formats/sizes (e.g. HEIC without native decode support, or a
      // source large enough to hit an internal decode limit) aren't
      // supported by createImageBitmap in every browser — fall back to
      // <img>-based decoding, which some browsers handle more leniently.
    }
  }
  return loadHtmlImage(file);
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 불러올 수 없습니다.'));
    };
    image.src = url;
  });
}
