// Client-side downscale for extraction images. The photo is re-encoded to a
// JPEG data URL and sent inline in the extract request — it never touches
// object storage (deliberate: no retention of school-comms photos). The canvas
// re-encode also converts anything the browser can decode (incl. HEIC on
// Safari) into JPEG, which is what the API schema accepts.

const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.8;
const DATA_URL_PREFIX = "data:image/jpeg;base64,";

export type DownscaledImage = {
  dataUrl: string;
  /** Decoded size of the JPEG payload, for display ("~340 KB"). */
  bytes: number;
};

export class UnsupportedImageError extends Error {
  constructor() {
    super("UNSUPPORTED_IMAGE");
    this.name = "UnsupportedImageError";
  }
}

type DecodedSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

async function decode(file: File): Promise<DecodedSource> {
  // Preferred path: explicit EXIF orientation handling.
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  } catch {
    // Fall through to <img> decode (browsers orient via CSS image-orientation
    // by default). Covers formats createImageBitmap rejects but <img> decodes.
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new UnsupportedImageError();
  }
}

export async function downscaleImageToDataUrl(file: File): Promise<DownscaledImage> {
  const decoded = await decode(file);
  try {
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UnsupportedImageError();
    // JPEG has no alpha channel: transparent PNG/WebP areas would render black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (!dataUrl.startsWith(DATA_URL_PREFIX)) throw new UnsupportedImageError();
    return {
      dataUrl,
      bytes: Math.floor(((dataUrl.length - DATA_URL_PREFIX.length) * 3) / 4),
    };
  } finally {
    decoded.cleanup();
  }
}
