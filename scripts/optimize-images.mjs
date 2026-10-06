// Converts the event posters in image/ into small WebP files in src/assets/events/,
// one per event id, all cropped to the same 3:4 portrait shape.
//
//   npm run images
//
// To change a poster: put the new file in image/, point its event id at it below,
// run the command, and the site picks it up on the next build. Originals are never modified.
//
// It also turns the Dev Crew photos in dev_crew/ into square portraits in src/assets/crew/,
// for the profile cards. Name each photo after the person (MohanPrabu.png, Varshan.png,
// Barath.jpeg); it is matched to the member in src/content/crew.ts whose id starts with that
// name. Photos keep their own background; they are only framed so every face sits alike.
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'image');
const outputDir = path.join(root, 'src', 'assets', 'events');

/** Event id → source file in image/. */
const POSTERS = {
  'pro-pitch': 'ChatGPT Image Oct 5, 2026, 08_03_13 PM.png',
  'viz-craft': 'Screenshot 2026-10-05 200642.png',
  'paper-presentation': 'Screenshot 2026-10-05 200651.png',
  'code-flex': 'Screenshot 2026-10-05 200656.png',
  cognix: 'Screenshot 2026-10-05 200701.png',
  'visual-logo-design': 'Screenshot 2026-10-05 200705.png',
  'short-film': 'Screenshot 2026-10-05 200710.png',
  'eagle-eye-challenge': 'Screenshot 2026-10-05 200714.png',
  'brand-it': 'Screenshot 2026-10-05 200718.png',
  'e-sports': 'Screenshot 2026-10-05 200723.png',
};

/** Screenshots carry a few pixels of border and rounded corners; trim them off. */
const EDGE_TRIM = 4;
const MAX_WIDTH = 600;
const ASPECT = 3 / 4; // width / height

await mkdir(outputDir, { recursive: true });

for (const [id, file] of Object.entries(POSTERS)) {
  const source = path.join(sourceDir, file);
  const { width = 0, height = 0 } = await sharp(source).metadata();

  const trimmed = {
    left: EDGE_TRIM,
    top: EDGE_TRIM,
    width: width - EDGE_TRIM * 2,
    height: height - EDGE_TRIM * 2,
  };

  // Never upscale: the output is as large as the source allows, capped at MAX_WIDTH.
  const outWidth = Math.min(MAX_WIDTH, trimmed.width, Math.round(trimmed.height * ASPECT));
  const outHeight = Math.round(outWidth / ASPECT);
  const target = path.join(outputDir, `${id}.webp`);

  await sharp(source)
    .extract(trimmed)
    .resize(outWidth, outHeight, { fit: 'cover', position: 'centre' })
    .webp({ quality: 82, effort: 6 })
    .toFile(target);

  const [before, after] = await Promise.all([stat(source), stat(target)]);
  console.log(
    `${id.padEnd(20)} ${width}x${height} -> ${outWidth}x${outHeight}  ` +
      `${Math.round(before.size / 1024)} KB -> ${Math.round(after.size / 1024)} KB`,
  );
}

// Dev Crew portraits: the photo as taken, background included, framed as a square that starts
// just above the head, so every face sits at the same height on its card.
const crewSourceDir = path.join(root, 'dev_crew');
const crewOutputDir = path.join(root, 'src', 'assets', 'crew');
const PORTRAIT_SIZE = 600; // the photo window is about 300px wide, so this covers 2x screens
const HEAD_ROOM = 0.1; // fraction of the frame above the top of the head

const crewIds = [
  ...(await readFile(path.join(root, 'src', 'content', 'crew.ts'), 'utf8')).matchAll(/id: '([^']+)'/g),
].map((match) => match[1]);
const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

const photos = (await readdir(crewSourceDir).catch(() => [])).filter((file) => /\.(jpe?g|png|webp)$/i.test(file));
if (photos.length > 0) await mkdir(crewOutputDir, { recursive: true });

for (const file of photos) {
  const key = squash(path.parse(file).name);
  const id = crewIds.find((candidate) => squash(candidate).startsWith(key) || key.startsWith(squash(candidate)));
  if (!id) {
    console.warn(`dev_crew/${file}: no crew member in src/content/crew.ts matches this name, skipped`);
    continue;
  }
  const source = path.join(crewSourceDir, file);
  const target = path.join(crewOutputDir, `${id}.webp`);

  const { width, height, headTop, backdrop } = await findHead(source);

  // A centred square from just above the head. If the head is too close to the top of the
  // photo, the photo's own background colour is added above it.
  const frame = Math.min(width, height);
  const start = Math.round(headTop - HEAD_ROOM * frame);
  const padTop = Math.max(0, -start);
  const top = Math.max(0, Math.min(start, height + padTop - frame));
  const background = { r: backdrop[0], g: backdrop[1], b: backdrop[2], alpha: 1 };

  // Two passes: sharp would otherwise extract before extending, whatever the call order.
  const padded = await sharp(source).rotate().removeAlpha().extend({ top: padTop, background }).png().toBuffer();
  await sharp(padded)
    .extract({ left: Math.round((width - frame) / 2), top, width: frame, height: frame })
    .resize(PORTRAIT_SIZE, PORTRAIT_SIZE)
    .webp({ quality: 82, effort: 6 })
    .toFile(target);

  const [before, after] = await Promise.all([stat(source), stat(target)]);
  console.log(
    `dev_crew/${file} -> crew/${id}.webp  ` +
      `${Math.round(before.size / 1024)} KB -> ${Math.round(after.size / 1024)} KB`,
  );
}

/**
 * Finds the top of the head on a plain background: grows the background from the top and
 * side edges through pixels that change only gradually and stay close to its colour; the
 * first row with a solid run of anything else is the top of the head. Nothing is modified.
 */
async function findHead(file) {
  const { data, info } = await sharp(file).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const colour = (pixel) => [data[pixel * 3], data[pixel * 3 + 1], data[pixel * 3 + 2]];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Background reference: the median colour of the top rows.
  const sample = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < width; x += 4) sample.push(colour(y * width + x));
  const backdrop = [0, 1, 2].map((c) => sample.map((s) => s[c]).sort((a, b) => a - b)[sample.length >> 1]);

  const background = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const seed = (pixel) => {
    if (background[pixel] || distance(colour(pixel), backdrop) > 40) return;
    background[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x++) seed(x);
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const here = colour(pixel);
    const x = pixel % width;
    for (const next of [
      x > 0 ? pixel - 1 : -1,
      x < width - 1 ? pixel + 1 : -1,
      pixel >= width ? pixel - width : -1,
      pixel < width * (height - 1) ? pixel + width : -1,
    ]) {
      if (next < 0 || background[next]) continue;
      const there = colour(next);
      if (distance(there, here) < 12 && distance(there, backdrop) < 70) {
        background[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  let headTop = 0;
  for (let y = 0; y < height; y++) {
    let solid = 0;
    for (let x = 0; x < width; x++) if (!background[y * width + x]) solid++;
    if (solid > width * 0.04) {
      headTop = y;
      break;
    }
  }
  return { width, height, headTop, backdrop };
}
