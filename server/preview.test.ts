/**
 * Small copies of payment screenshots: the dashboard shows a JPEG a fraction of the size; the
 * original stays in S3 and Google Drive and is one click away.
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PREVIEW_WIDTH, makePreview, previewKey } from './preview';
import { setup } from './testing';
import { sniffImage } from './validate';

/** A phone-sized screenshot: bands of colour with noise, like a busy UPI receipt. */
function phoneScreenshot(width = 1080, height = 2400, alpha = 255) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const noise = (x * 7919 + y * 104729) % 37;
      png.data[at] = (y / height) * 200 + noise;
      png.data[at + 1] = (x / width) * 180 + noise;
      png.data[at + 2] = ((x + y) % 64) * 3;
      png.data[at + 3] = alpha;
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

describe('a small copy of a screenshot', () => {
  it('turns a PNG phone screenshot into a JPEG 720 px wide, much smaller', () => {
    const original = phoneScreenshot();
    const preview = makePreview(original)!;
    expect(sniffImage(preview)).toMatchObject({ type: 'image/jpeg', width: PREVIEW_WIDTH, height: 1600 });
    expect(preview.byteLength).toBeLessThan(original.byteLength / 4);
  });

  it('shrinks JPEGs too, and puts see-through parts on white', () => {
    const photo = jpeg.encode({ width: 1500, height: 1000, data: new Uint8Array(1500 * 1000 * 4).map((_, index) => (index * 31) % 251) }, 95).data;
    expect(sniffImage(makePreview(new Uint8Array(photo))!)).toMatchObject({ width: 720, height: 480 });

    const clear = makePreview(phoneScreenshot(800, 800, 0))!;
    const { data } = jpeg.decode(clear, { useTArray: true });
    expect(Math.min(data[0], data[1], data[2])).toBeGreaterThan(245);
  });

  it('gives nothing when the bytes cannot be read, so the original is shown', () => {
    expect(makePreview(new Uint8Array(3000))).toBeNull();
    expect(previewKey('payments/261001.png')).toBe('previews/payments/261001.jpg');
  });
});

describe('the dashboard shows the small copy', () => {
  it('makes it the first time a screenshot is opened, keeps it, and links the original', async () => {
    const { submit, login, call, files } = setup();
    await submit({ bytes: phoneScreenshot() });
    const token = await login();

    const first = await call('GET', '/api/admin/registrations/261001/screenshot', undefined, { token });
    expect(first.body.url).toMatch(/previews\/payments\/261001\.jpg\?X-Amz-Expires=300/);
    expect(first.body.originalUrl).toMatch(/payments\/261001\.png\?X-Amz-Expires=300/);
    expect(files.objects.get('previews/payments/261001.jpg')?.type).toBe('image/jpeg');
    // The original is untouched.
    expect(sniffImage(files.objects.get('payments/261001.png')!.bytes)).toMatchObject({ type: 'image/png', width: 1080, height: 2400 });

    const puts = files.puts.length;
    const again = await call('GET', '/api/admin/registrations/261001/screenshot', undefined, { token });
    expect(again.body.url).toBe(first.body.url);
    expect(files.puts.length).toBe(puts);
  });

  it('shows the original when no small copy can be made', async () => {
    const { submit, login, call, files } = setup();
    await submit();
    const token = await login();
    files.failPuts = /^previews\//;
    const shown = await call('GET', '/api/admin/registrations/261001/screenshot', undefined, { token });
    expect(shown.status).toBe(200);
    expect(shown.body.url).toBe(shown.body.originalUrl);
  });
});
