const maxDimension = 1600;
const jpegQuality = 0.82;
const skipCompressionUnderBytes = 1.5 * 1024 * 1024;

/**
 * Downscales/re-encodes an image client-side before it gets base64-encoded
 * and sent to the submit-application Edge Function. Photos straight off a
 * phone camera or downloaded wallpapers can be tens of MB; with up to five
 * images in one submission the combined base64 payload could exceed the
 * request size the Edge Function/gateway will accept, which surfaces to the
 * user as an opaque "non-2xx status code" failure. Falls back to the
 * original file untouched on any failure — this must never block a
 * submission that would otherwise have gone through fine.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= skipCompressionUnderBytes) return file;

  try {
    const source = await loadImageSource(file);
    const { width, height } = getSourceDimensions(source);
    if (!width || !height) return file;

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));
    if (!blob || blob.size >= file.size) return file;

    const nextName = `${file.name.replace(/\.[^./\\]+$/, '')}.jpg`;
    return new File([blob], nextName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
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
      // Some formats (e.g. HEIC in browsers without native decode support)
      // aren't supported by createImageBitmap — fall back to <img>.
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
