/**
 * Server-side checks of a registration. The browser runs the same field rules, but the
 * server never relies on that: every request is checked again here.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import type { PaymentMethod } from '../src/lib/admin';
import {
  ACCEPTED_SCREENSHOT_TYPES,
  MAX_SCREENSHOT_BYTES,
  SUBMISSION_ID,
  UPLOAD_ID,
  buildRegistrationRecord,
  splitDepartment,
  teamNameProblem,
  tidy,
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
  /** The payment screenshot the browser uploaded to S3 just before (checked separately). */
  uploadId: string;
}

export type ValidationResult =
  | { ok: true; value: ValidRegistration }
  | { ok: false; error: string; fieldErrors?: RegistrationErrors };

const TEXT_FIELDS: RegistrationField[] = ['name', 'department', 'departmentOther', 'year', 'college', 'phone', 'email', 'events', 'transactionId'];

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

/**
 * Checks the uploaded payment screenshot by its bytes, never by what the browser claims:
 * a real JPEG, PNG or WebP of a sensible size. Returns the image, or what is wrong with it.
 */
export function checkScreenshot(bytes: Uint8Array): CheckedImage | string {
  if (bytes.length < 200) return 'The screenshot could not be read. Please upload it again.';
  if (bytes.length > MAX_SCREENSHOT_BYTES) return 'The image must be 5 MB or smaller.';
  const sniffed = sniffImage(bytes);
  if (!sniffed || !(ACCEPTED_SCREENSHOT_TYPES as readonly string[]).includes(sniffed.type)) {
    return 'The screenshot must be a PNG or JPG image.';
  }
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

  const uploadId = isObject(body.upload) ? str(body.upload.id, 80) : '';
  if (!UPLOAD_ID.test(uploadId)) fieldErrors.screenshot = 'Upload a screenshot of your payment.';

  if (Object.keys(fieldErrors).length) {
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
      uploadId,
    },
  };
}

// ---------------------------------------------------------------------------------------
// The event day: the registration desk and the event coordinators.

export type ReceivedPayment = { method: PaymentMethod; reference: string | null };

const NOT_PROOF =
  'Tick the box to confirm the money was received: in hand for cash, or seen credited in the receiving account for UPI. A QR scan, screenshot or transaction ID alone is not proof of payment.';

/**
 * Money taken at the venue (the gate pass at the desk, or an event fee): cash or UPI, with
 * the staff member's confirmation that it was actually received. A UPI reference may be noted
 * but is never accepted as the proof itself.
 */
export function readReceivedPayment(value: unknown): { ok: true; value: ReceivedPayment } | { ok: false; error: string } {
  if (!isObject(value)) return { ok: false, error: 'Choose how the money was paid: cash or UPI.' };
  const method = value.method;
  if (method !== 'CASH' && method !== 'UPI') return { ok: false, error: 'Choose how the money was paid: cash or UPI.' };
  if (value.confirmedReceived !== true) return { ok: false, error: NOT_PROOF };
  const reference = str(value.reference, 60).trim();
  if (method === 'CASH' && reference) return { ok: false, error: 'A cash payment has no transaction reference.' };
  if (reference && !/^[A-Za-z0-9]{6,35}$/.test(reference)) {
    return { ok: false, error: 'The UPI reference must be the 6–35 letters or digits shown in the payment app.' };
  }
  return { ok: true, value: { method, reference: reference || null } };
}

export interface ValidOnsiteRegistration {
  submissionId: string;
  record: RegistrationRecord;
  emailKey: string;
  phoneKey: string;
  payment: ReceivedPayment;
  /** The team name, when the participant comes as part of a team; null on their own. */
  teamName: string | null;
  /** The events chosen at the desk (catalog order); each event's ₹50 is paid at its venue. */
  eventIds: string[];
  /**
   * GPay paid by the student from their own phone: they sign in to Student login, pay and upload
   * the screenshot, and staff approve it with the transaction ID. Until then it waits (PENDING).
   */
  studentPays: boolean;
}

const ONSITE_FIELDS: RegistrationField[] = ['name', 'department', 'departmentOther', 'year', 'college', 'phone', 'email'];

/**
 * Checks a registration typed in at the desk: the same field rules as the website's form, the
 * events the participant chooses (none is fine: they can join one at its venue later), and the
 * ₹100 gate pass received. Event fees are paid at each venue, to its coordinator.
 */
export function validateOnsitePayload(
  body: unknown,
  fees: Fees,
): { ok: true; value: ValidOnsiteRegistration } | { ok: false; error: string; fieldErrors?: RegistrationErrors } {
  if (!isObject(body) || !isObject(body.participant)) return { ok: false, error: 'The registration could not be read. Please try again.' };
  const submissionId = str(body.submissionId, 80);
  if (!SUBMISSION_ID.test(submissionId)) return { ok: false, error: 'The registration could not be read. Please try again.' };

  const requested: unknown[] = Array.isArray(body.events) ? body.events : [];
  if (requested.some((id) => !eventCatalog.some((event) => event.id === id))) return { ok: false, error: 'Choose events from the list only.' };
  const eventIds = eventCatalog.filter((event) => requested.includes(event.id)).map((event) => event.id);
  const mode = body.participation ?? 'INDIVIDUAL';
  if (mode !== 'INDIVIDUAL' && mode !== 'TEAM') return { ok: false, error: 'Choose individual or team.' };
  const rawTeam = str(body.teamName, 80);
  const teamProblem = mode === 'TEAM' ? teamNameProblem(rawTeam) : undefined;
  if (teamProblem) return { ok: false, error: teamProblem };

  const participant = body.participant;
  const department = str(participant.department).trim();
  const input: Omit<RegistrationInput, 'screenshot'> = {
    name: str(participant.name),
    ...(department ? splitDepartment(department) : { department: '', departmentOther: '' }),
    college: str(participant.college),
    year: str(participant.year, 40),
    phone: str(participant.phone, 40),
    email: str(participant.email, 300),
    events: eventIds,
    transactionId: '',
  };

  const fieldErrors: RegistrationErrors = {};
  for (const field of ONSITE_FIELDS) {
    const message = validateField(field, { ...input, screenshot: null });
    if (message) fieldErrors[field] = message;
  }
  if (fieldErrors.departmentOther) {
    fieldErrors.department = fieldErrors.departmentOther;
    delete fieldErrors.departmentOther;
  }
  const studentPays = isObject(body.payment) && body.payment.method === 'UPI' && body.payment.studentPays === true;
  const payment: ReturnType<typeof readReceivedPayment> = studentPays ? { ok: true, value: { method: 'UPI', reference: null } } : readReceivedPayment(body.payment);
  if (!payment.ok) fieldErrors.transactionId = payment.error;
  if (Object.keys(fieldErrors).length || !payment.ok) return { ok: false, error: 'Please check the highlighted fields.', fieldErrors };

  const record = buildRegistrationRecord({ ...input, transactionId: payment.value.reference ?? '' }, eventCatalog, fees);
  return {
    ok: true,
    value: {
      submissionId,
      record,
      emailKey: record.participant.email,
      phoneKey: record.participant.phone,
      teamName: mode === 'TEAM' ? tidy(rawTeam) : null,
      eventIds,
      payment: payment.value,
      studentPays,
    },
  };
}
