// Turns the college crest in image/rpsit-logo.webp into the site's logo files:
//
//   public/images/rpsit-logo-sm.webp  header and footer crest (120px tall, a few KB)
//   public/favicon-32.png             browser tab icon
//   public/apple-touch-icon.png       home-screen icon (180px, on the page colour)
//   public/images/rpsit-logo-pass.jpg crest on white for the PDF participant pass (JPEG: PDFs embed it
//                                     without decoding, which keeps pass generation fast)
//   image/rpsit-logo-cutout.png       full size, transparent; kept out of public/ so the
//                                     2 MB file is not deployed
//
//   node scripts/process-logo.mjs
//
// The source has a grey "transparency" checkerboard painted into it rather than real
// transparency. The crest is an oval with a gold rim, so the script finds the rim, fits
// an ellipse to its outer edge and keeps only what lies inside. Originals are never modified.
import sharp from 'sharp';

const SOURCE = 'image/rpsit-logo.webp';
const FULL = 'image/rpsit-logo-cutout.png';
const SMALL = 'public/images/rpsit-logo-sm.webp';
const SMALL_HEIGHT = 120;
const FAVICON = 'public/favicon-32.png';
const TOUCH_ICON = 'public/apple-touch-icon.png';
const PASS_LOGO = 'public/images/rpsit-logo-pass.jpg';
const PASS_LOGO_HEIGHT = 240;
const PAGE_COLOUR = { r: 5, g: 6, b: 26, alpha: 1 }; // --c-void
/** Pulls the mask inside the rim's anti-aliased edge so no grey fringe survives. */
const INSET = 1.5;

const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

const isGold = (x, y) => {
  const i = (y * width + x) * 3;
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  return r > 150 && g > 90 && r - b > 70 && r >= g;
};
const isRim = (x, y, step) => isGold(x, y) && isGold(x + step, y) && isGold(x + 2 * step, y);

// Outer edge of the rim: the first run of gold from the left and from the right, every other row.
const points = [];
for (let y = 0; y < height; y += 2) {
  let left = -1;
  for (let x = 0; x < width - 2; x++) if (isRim(x, y, 1)) { left = x; break; }
  let right = -1;
  for (let x = width - 1; x >= 2; x--) if (isRim(x, y, -1)) { right = x; break; }
  if (left >= 0 && right > left + 20) points.push([left, y], [right, y]);
}

/** Least-squares axis-aligned ellipse: A x² + B y² + C x + D y = 1. */
function fitEllipse(pts) {
  const m = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const v = [0, 0, 0, 0];
  for (const [x, y] of pts) {
    const f = [x * x, y * y, x, y];
    for (let i = 0; i < 4; i++) {
      v[i] += f[i];
      for (let j = 0; j < 4; j++) m[i][j] += f[i] * f[j];
    }
  }
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    [v[i], v[pivot]] = [v[pivot], v[i]];
    for (let k = i + 1; k < 4; k++) {
      const c = m[k][i] / m[i][i];
      for (let j = i; j < 4; j++) m[k][j] -= c * m[i][j];
      v[k] -= c * v[i];
    }
  }
  const s = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    let t = v[i];
    for (let j = i + 1; j < 4; j++) t -= m[i][j] * s[j];
    s[i] = t / m[i][i];
  }
  const [A, B, C, D] = s;
  const cx = -C / (2 * A);
  const cy = -D / (2 * B);
  const g = 1 + A * cx * cx + B * cy * cy;
  return { cx, cy, rx: Math.sqrt(g / A), ry: Math.sqrt(g / B) };
}

// Fit, drop stray gold pixels more than 6px off the curve, fit again.
let ellipse = fitEllipse(points);
const offCurve = ([x, y], e) =>
  Math.abs(Math.hypot((x - e.cx) / e.rx, (y - e.cy) / e.ry) - 1) * Math.min(e.rx, e.ry);
ellipse = fitEllipse(points.filter((point) => offCurve(point, ellipse) < 6));
const { cx, cy, rx, ry } = ellipse;

const maskSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx - INSET}" ry="${ry - INSET}" fill="#fff"/></svg>`,
);

// The crest is slightly egg-shaped, so the ellipse alone can leave a sliver of checkerboard
// above or below the rim. Clear each column from the top and from the bottom for as long as
// it is checkerboard grey; the crest's gold and whites stop it, so the crest is never cut.
const alpha = await sharp(maskSvg).resize(width, height).extractChannel('alpha').raw().toBuffer();
const isChecker = (x, y) => {
  const i = (y * width + x) * 3;
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  return Math.max(r, g, b) - Math.min(r, g, b) < 18 && r > 100 && r < 228;
};
for (let x = 0; x < width; x++) {
  for (let y = 0; y < height && isChecker(x, y); y++) alpha[y * width + x] = 0;
  for (let y = height - 1; y >= 0 && isChecker(x, y); y--) alpha[y * width + x] = 0;
}

const left = Math.max(0, Math.floor(cx - rx));
const top = Math.max(0, Math.floor(cy - ry));
const crest = await sharp(data, { raw: { width, height, channels: 3 } })
  .joinChannel(alpha, { raw: { width, height, channels: 1 } })
  .png()
  .toBuffer()
  .then((masked) =>
    sharp(masked)
      .extract({
        left,
        top,
        width: Math.min(width, Math.ceil(cx + rx)) - left,
        height: Math.min(height, Math.ceil(cy + ry)) - top,
      })
      .png()
      .toBuffer(),
  );

await sharp(crest).png({ compressionLevel: 9 }).toFile(FULL);
await sharp(crest)
  .resize({ height: SMALL_HEIGHT })
  .webp({ quality: 90, alphaQuality: 100, effort: 6 })
  .toFile(SMALL);

// Square icons: the tall crest centred, on transparency for the tab and on the page colour
// for home screens (iOS shows transparency as black).
await sharp(crest)
  .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(FAVICON);
await sharp(crest)
  .resize(150, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 15, bottom: 15, left: 15, right: 15, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .flatten({ background: PAGE_COLOUR })
  .png({ compressionLevel: 9 })
  .toFile(TOUCH_ICON);

await sharp(crest)
  .resize({ height: PASS_LOGO_HEIGHT })
  .flatten({ background: '#ffffff' })
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(PASS_LOGO);

const round = (n) => Math.round(n * 10) / 10;
console.log(
  `${SOURCE} ${width}x${height}: rim ellipse centre (${round(cx)}, ${round(cy)}), ` +
    `radii ${round(rx)} x ${round(ry)} -> ${SMALL}, ${FAVICON}, ${TOUCH_ICON}, ${PASS_LOGO}, ${FULL}`,
);
