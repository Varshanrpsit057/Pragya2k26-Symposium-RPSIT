/**
 * Small copies of payment screenshots for the dashboard. The original (often a 2–5 MB phone
 * screenshot) stays as it is, in S3 and in Google Drive; staff see a JPEG at most 720 px wide,
 * a tenth of the size, with a link to the original. Pure JavaScript: no native image library
 * to build for Lambda.
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { sniffImage } from './validate';

/** Wide enough to read a transaction ID on a phone screenshot. */
export const PREVIEW_WIDTH = 720;
export const PREVIEW_HEIGHT = 1600;
const QUALITY = 72;
/** Larger images are not decoded here (the original is shown instead). */
const MAX_PIXELS = 30_000_000;

/** `payments/X.png` → `previews/payments/X.jpg`. */
export const previewKey = (key: string) => `previews/${key.replace(/\.[a-z0-9]+$/i, '')}.jpg`;

interface Pixels {
  width: number;
  height: number;
  /** RGBA, four bytes a pixel. */
  data: Uint8Array;
}

function decode(bytes: Uint8Array): Pixels | null {
  const sniffed = sniffImage(bytes);
  if (!sniffed || sniffed.width * sniffed.height > MAX_PIXELS) return null;
  if (sniffed.type === 'image/jpeg') {
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1_000_000, maxMemoryUsageInMB: 384 });
    return { width: image.width, height: image.height, data: image.data };
  }
  if (sniffed.type === 'image/png') {
    const image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { width: image.width, height: image.height, data: image.data };
  }
  return null;
}

/** Smaller by averaging each box of pixels (keeps small text readable), on white where transparent. */
function shrink(source: Pixels, width: number, height: number): Pixels {
  const data = new Uint8Array(width * height * 4);
  const xScale = source.width / width;
  const yScale = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor(y * yScale);
    const bottom = Math.max(top + 1, Math.min(source.height, Math.floor((y + 1) * yScale)));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor(x * xScale);
      const right = Math.max(left + 1, Math.min(source.width, Math.floor((x + 1) * xScale)));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = top; sy < bottom; sy += 1) {
        let at = (sy * source.width + left) * 4;
        for (let sx = left; sx < right; sx += 1, at += 4) {
          const alpha = source.data[at + 3] / 255;
          r += source.data[at] * alpha + 255 * (1 - alpha);
          g += source.data[at + 1] * alpha + 255 * (1 - alpha);
          b += source.data[at + 2] * alpha + 255 * (1 - alpha);
        }
      }
      const count = (bottom - top) * (right - left);
      const out = (y * width + x) * 4;
      data[out] = r / count;
      data[out + 1] = g / count;
      data[out + 2] = b / count;
      data[out + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * The small JPEG copy of a PNG or JPEG screenshot, or null when there is no point (already
 * small) or it cannot be read; the original is shown then.
 */
export function makePreview(bytes: Uint8Array): Uint8Array | null {
  try {
    const source = decode(bytes);
    if (!source) return null;
    const scale = Math.min(1, PREVIEW_WIDTH / source.width, PREVIEW_HEIGHT / source.height);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const small = scale < 1 ? shrink(source, width, height) : shrink(source, source.width, source.height);
    const encoded = jpeg.encode({ width: small.width, height: small.height, data: small.data }, QUALITY).data;
    const result = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    return result.byteLength < bytes.byteLength ? result : null;
  } catch {
    return null;
  }
}
