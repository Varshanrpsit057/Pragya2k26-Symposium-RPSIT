/**
 * Server-side checks of a registration. The browser runs the same field rules, but the
 * server never relies on that: every request is checked again here.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import {
  ACCEPTED_SCREENSHOT_TYPES,
  MAX_SCREENSHOT_BYTES,
  SUBMISSION_ID,
  buildRegistrationRecord,
  splitDepartment,
  validateField,
  type Fees,
  type RegistrationErrors,
  type RegistrationField,
  type RegistrationInput,
  type RegistrationRecord,
} from '../src/lib/registration';

export type ImageType = (typeof ACCEPTED_SCREENSHOT_TYPES)[number];

export interface CheckedImage {
  bytes: Uint8Array;
  type: ImageType;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

export interface ValidRegistration {
  submissionId: string;
  record: RegistrationRecord;
  /** Selected event ids, in the site's order. */
  eventIds: string[];
  /** For duplicate checks: lower-case email, upper-case transaction ID. */
  emailKey: string;
  transactionKey: string;
  image: CheckedImage;
}

export type ValidationResult =
  | { ok: true; value: ValidRegistration }
  | { ok: false; error: string; fieldErrors?: RegistrationErrors };

const TEXT_FIELDS: RegistrationField[] = ['name', 'department', 'departmentOther', 'year', 'college', 'phone', 'email', 'events', 'transactionId'];
const SCREENSHOT_EXTENSIONS = /\.(jpe?g|jfif|png|webp)$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A short string, or '' when missing or the wrong type. Long input is cut before any checks. */
const str = (value: unknown, max = 400) => (typeof value === 'string' ? value.slice(0, max) : '');

/** Reads the image's real format and size from its first bytes; null if it is not a JPEG, PNG or WebP. */
export function sniffImage(bytes: Uint8Array): Omit<CheckedImage, 'bytes'> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

  // PNG: signature, then the IHDR chunk with width and height.
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && ascii(12, 4) === 'IHDR') {
    return { type: 'image/png', extension: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk the segments to the frame header (SOFn) that holds the size.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    for (let guard = 0; offset + 9 < bytes.length && guard < 500; guard += 1) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        return { type: 'image/jpeg', extension: 'jpg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  }

  // WebP: RIFF container with a VP8, VP8L or VP8X chunk.
  if (bytes.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return { type: 'image/webp', extension: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { type: 'image/webp', extension: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { type: 'image/webp', extension: 'webp', width, height };
    }
  }
  return null;
}

function decodeBase64(base64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function checkScreenshot(value: unknown): CheckedImage | string {
  if (!isObject(value)) return 'Upload a screenshot of your payment.';
  const name = str(value.name, 200);
  const declared = str(value.type, 60);
  const data = typeof value.data === 'string' ? value.data : '';

  const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(data.slice(0, 64));
  if (!match) return 'Upload a screenshot of your payment.';
  if (name && /\.[a-z0-9]{1,8}$/i.test(name) && !SCREENSHOT_EXTENSIONS.test(name)) {
    return 'The screenshot must be a PNG or JPG image.';
  }
  // base64 is 4/3 of the size: refuse oversized uploads before decoding them.
  const base64 = data.slice(match[0].length);
  if (base64.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4) return 'The image must be 5 MB or smaller.';

  const bytes = decodeBase64(base64);
  if (!bytes || bytes.length < 200) return 'The screenshot could not be read. Please upload it again.';
  if (bytes.length > MAX_SCREENSHOT_BYTES) return 'The image must be 5 MB or smaller.';

  const sniffed = sniffImage(bytes);
  if (!sniffed) return 'The screenshot must be a PNG or JPG image.';
  // The declared type must agree with what the file really is.
  const claimed = [declared, match[1]].map((type) => type.toLowerCase().replace('image/jpg', 'image/jpeg'));
  if (claimed.some((type) => type && type !== sniffed.type)) return 'The screenshot must be a PNG or JPG image.';
  if (sniffed.width < 16 || sniffed.height < 16 || sniffed.width > 20_000 || sniffed.height > 20_000) {
    return 'The screenshot could not be read. Please upload it again.';
  }
  return { bytes, ...sniffed };
}

/** Checks the request body; returns the registration ready to store, or what is wrong with it. */
export function validatePayload(body: unknown, fees: Fees): ValidationResult {
  if (!isObject(body) || !isObject(body.participant)) {
    return { ok: false, error: 'The registration could not be read. Please refresh the page and try again.' };
  }
  const submissionId = str(body.submissionId, 80);
  if (!SUBMISSION_ID.test(submissionId)) {
    return { ok: false, error: 'The registration could not be read. Please refresh the page and try again.' };
  }

  const participant = body.participant;
  const rawEvents = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  const knownIds = new Set(eventCatalog.map((event) => event.id));
  const requested = new Set(rawEvents.filter((id): id is string => typeof id === 'string'));

  const department = str(participant.department).trim();
  const input: Omit<RegistrationInput, 'screenshot'> = {
    name: str(participant.name),
    ...(department ? splitDepartment(department) : { department: '', departmentOther: '' }),
    college: str(participant.college),
    year: str(participant.year, 40),
    phone: str(participant.phone, 40),
    email: str(participant.email, 300),
    events: eventCatalog.filter((event) => requested.has(event.id)).map((event) => event.id),
    transactionId: str(body.transactionId, 60),
  };

  const fieldErrors: RegistrationErrors = {};
  for (const field of TEXT_FIELDS) {
    const message = validateField(field, { ...input, screenshot: null });
    if (message) fieldErrors[field] = message;
  }
  if ([...requested].some((id) => !knownIds.has(id))) fieldErrors.events = 'Please choose events from the list.';
  // A department typed for "Other" is reported against the department field the server received.
  if (fieldErrors.departmentOther) {
    fieldErrors.department = fieldErrors.departmentOther;
    delete fieldErrors.departmentOther;
  }

  const image = checkScreenshot(body.screenshot);
  if (typeof image === 'string') fieldErrors.screenshot = image;

  if (Object.keys(fieldErrors).length || typeof image === 'string') {
    return { ok: false, error: 'Please check the highlighted fields.', fieldErrors };
  }

  const record = buildRegistrationRecord(input, eventCatalog, fees);
  return {
    ok: true,
    value: {
      submissionId,
      record,
      eventIds: input.events,
      emailKey: record.participant.email,
      transactionKey: record.payment.transactionId.toUpperCase(),
      image,
    },
  };
}
