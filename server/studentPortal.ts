/**
 * The student page: a participant signs in with their Registration ID and the phone number
 * they registered with, to download their pass (passes are not emailed for now), see their
 * events and upload the GPay screenshots of payments made at the desk or a venue.
 *
 * It must never slow the staff down, so:
 *   - admins pause it from the dashboard (Control table setting) when the desks need the
 *     network, e.g. during the morning rush, and turn it on again later; it is on otherwise;
 *   - it answers at most OVERALL_LIMIT sign-ins a minute for everyone together, and the page
 *     is a few kilobytes with no images (src/student/);
 *   - each Registration ID allows a few sign-ins at a time, so a phone number cannot be guessed.
 */
import { randomUUID } from 'node:crypto';
import { eventCatalog } from '../src/content/eventCatalog';
import { ACCEPTED_SCREENSHOT_TYPES, MAX_SCREENSHOT_BYTES, REGISTRATION_ID, normalisePhone, normaliseRegistrationId, type Fees, type UploadTicket } from '../src/lib/registration';
import { credentialsProblem, proofLabel, type StudentPortalState, type StudentView } from '../src/lib/student';
import { sameText } from './auth';
import { ApiError } from './errors';
import type { FileStore } from './files';
import { currentEventIds, isFeePaid, isPresent, participationOf, sourceOf } from './participation';
import { passFileName } from './pass';
import type { Actor } from './roles';
import type { Registration, RegistrationChanges, Store } from './store';
import { checkScreenshot } from './validate';

export interface StudentPortalDeps {
  store: Store;
  files: Pick<FileStore, 'signedUrl' | 'presignUpload' | 'readUpload' | 'deleteUpload' | 'put'>;
  fees: Fees;
  now: () => number;
  log: (message: string, details?: Record<string, unknown>) => void;
  /** Reads, checks and changes a registration safely against concurrent changes. */
  mutate: (registrationId: string, change: (current: Registration) => RegistrationChanges | null) => Promise<Registration>;
}

const SETTING = 'studentPortal';
/** How long one Lambda instance trusts the switch it read: a change applies within this. */
const SETTING_CACHE_MS = 10_000;
/** Everyone together: the student page never takes more than this from the API. */
const OVERALL_LIMIT = { max: 300, windowMs: 60_000 };
/** Per network address: high, because the whole campus shares one address on the college Wi-Fi. */
const ADDRESS_LIMIT = { max: 3000, windowMs: 10 * 60_000 };
/**
 * Per Registration ID: enough to sign in, pay, wait for the desk (the page checks every 30 s for
 * up to 10 minutes) and download, still far too few to guess a phone number.
 */
const ID_LIMIT = { max: 40, windowMs: 15 * 60_000 };
/** Payment screenshots one student may keep. */
const MAX_PROOFS = 10;

const PAUSED =
  'Student login is paused for a few minutes so the registration desks stay fast. Please try again soon, or ask at the help desk. At each venue, just tell the coordinator your Registration ID.';
const NOT_FOUND = 'No registration matches this Registration ID and phone number.';

interface StoredSetting {
  enabled: boolean;
  by: string;
  at: string;
}

/** The stored switch; nothing stored (or unreadable) means on. */
function parseSetting(raw: string | null): StoredSetting | null {
  try {
    return raw ? (JSON.parse(raw) as StoredSetting) : null;
  } catch {
    return null;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (body: unknown, name: string) => (isObject(body) && typeof body[name] === 'string' ? (body[name] as string).slice(0, 40) : '');
const eventName = (id: string) => eventCatalog.find((event) => event.id === id)?.name ?? id;

export class StudentPortal {
  private cached: { setting: StoredSetting | null; until: number } | null = null;

  constructor(private readonly deps: StudentPortalDeps) {}

  private async setting(): Promise<StoredSetting | null> {
    const now = this.deps.now();
    if (this.cached && this.cached.until > now) return this.cached.setting;
    const setting = parseSetting(await this.deps.store.getSetting(SETTING));
    this.cached = { setting, until: now + SETTING_CACHE_MS };
    return setting;
  }

  /** On unless an admin paused it. */
  private async enabled() {
    return (await this.setting())?.enabled !== false;
  }

  /** For the student page: is it on? */
  async state(): Promise<{ success: true } & StudentPortalState> {
    return { success: true, enabled: await this.enabled() };
  }

  /** For the admin dashboard: on or off, and who changed it when. */
  async adminState(): Promise<{ success: true } & StudentPortalState> {
    const setting = await this.setting();
    return { success: true, enabled: setting?.enabled !== false, changedBy: setting?.by ?? null, changedAt: setting?.at ?? null };
  }

  async set(actor: Actor, body: unknown): Promise<{ success: true } & StudentPortalState> {
    if (!isObject(body) || typeof body.enabled !== 'boolean') throw new ApiError(400, 'INVALID', 'Say whether student login is on or off.');
    const setting: StoredSetting = { enabled: body.enabled, by: actor.username, at: new Date(this.deps.now()).toISOString() };
    await this.deps.store.putSetting(SETTING, JSON.stringify(setting));
    this.cached = { setting, until: this.deps.now() + SETTING_CACHE_MS };
    this.deps.log(body.enabled ? 'Student login turned on' : 'Student login paused', { by: actor.username });
    return this.adminState();
  }

  private async limit(key: string, { max, windowMs }: { max: number; windowMs: number }, message: string) {
    const now = this.deps.now();
    if ((await this.deps.store.hit(key, windowMs, now)) > max) {
      throw new ApiError(429, 'RATE_LIMITED', message, undefined, Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)));
    }
  }

  /** The participant these credentials belong to; the same "no match" for every wrong answer. */
  private async signIn(body: unknown, ip: string): Promise<Registration> {
    if (!(await this.enabled())) throw new ApiError(503, 'STUDENT_LOGIN_PAUSED', PAUSED, undefined, 120);
    await this.limit('student-all', OVERALL_LIMIT, 'Many students are signing in right now. Please try again in a minute.');
    await this.limit(`student-ip:${ip}`, ADDRESS_LIMIT, 'Too many sign-ins from your network. Please try again in a few minutes.');
    const credentials = { registrationId: normaliseRegistrationId(text(body, 'registrationId')), phone: text(body, 'phone') };
    const problem = credentialsProblem(credentials);
    if (problem) throw new ApiError(400, 'INVALID', problem);
    const { registrationId } = credentials;
    await this.limit(`student-id:${registrationId}`, ID_LIMIT, 'Too many sign-ins for this Registration ID. Please wait 15 minutes and try again.');
    const registration = REGISTRATION_ID.test(registrationId) ? await this.deps.store.getRegistration(registrationId) : null;
    if (!registration || !sameText(normalisePhone(credentials.phone), registration.record.participant.phone)) {
      throw new ApiError(404, 'NOT_FOUND', NOT_FOUND);
    }
    return registration;
  }

  async view(body: unknown, ip: string): Promise<{ success: true } & StudentView> {
    const registration = await this.signIn(body, ip);
    const { participant } = registration.record;
    const reason =
      registration.status === 'REJECTED' ? registration.rejectionReason : registration.status === 'CANCELLED' ? registration.cancellationReason : null;
    return {
      success: true,
      registrationId: registration.registrationId,
      name: participant.name,
      college: participant.college,
      status: registration.status,
      source: sourceOf(registration),
      teamName: registration.teamName ?? null,
      events: currentEventIds(registration).map((eventId) => ({
        eventId,
        name: eventCatalog.find((event) => event.id === eventId)?.name ?? eventId,
        team: participationOf(registration, eventId).team ?? null,
        feePaid: isFeePaid(registration, eventId),
        present: isPresent(registration, eventId),
      })),
      feePerEvent: this.deps.fees.perEvent,
      details: { department: participant.department, year: participant.year, phone: participant.phone, email: participant.email },
      payAtLogin:
        sourceOf(registration) === 'ONSITE' && registration.status === 'PENDING'
          ? { amount: registration.record.payment.gatePassAmount, screenshotSent: (registration.proofs ?? []).some((proof) => proof.kind === 'GATE_PASS') }
          : null,
      passAvailable: registration.status === 'APPROVED' && registration.pdfStatus === 'GENERATED' && Boolean(registration.pdfKey),
      reason: reason ?? null,
      proofs: (registration.proofs ?? []).map((proof) => ({ kind: proof.kind, label: proofLabel(proof.kind, eventName), uploadedAt: proof.uploadedAt })),
    };
  }

  /** Step 1 of uploading a GPay screenshot: a private, short-lived upload to S3. */
  async uploadTicket(body: unknown, ip: string): Promise<{ success: true } & UploadTicket> {
    await this.signIn(body, ip);
    const contentType = isObject(body) && typeof body.contentType === 'string' ? body.contentType.toLowerCase() : '';
    const size = isObject(body) ? Number(body.size) : Number.NaN;
    if (!(ACCEPTED_SCREENSHOT_TYPES as readonly string[]).includes(contentType)) throw new ApiError(400, 'INVALID', 'The screenshot must be a PNG or JPG image.');
    if (!Number.isInteger(size) || size < 1 || size > MAX_SCREENSHOT_BYTES) throw new ApiError(400, 'INVALID', 'The image must be 5 MB or smaller.');
    return { success: true, ...(await this.deps.files.presignUpload(randomUUID(), contentType, MAX_SCREENSHOT_BYTES)) };
  }

  /**
   * Step 2: the uploaded screenshot becomes the student's proof of a payment made at the desk
   * (the gate pass) or at a venue (an event fee), with the transaction ID if they give it.
   * Staff see it in the student's record, to check the time and the transaction.
   */
  async addProof(body: unknown, ip: string): Promise<{ success: true } & StudentView> {
    const registration = await this.signIn(body, ip);
    const kind = isObject(body) && typeof body.kind === 'string' ? body.kind : '';
    if (kind !== 'GATE_PASS' && !currentEventIds(registration).includes(kind)) throw new ApiError(400, 'INVALID', 'Choose what the payment was for: the gate pass or one of your events.');
    if (kind !== 'GATE_PASS' && isFeePaid(registration, kind)) throw new ApiError(409, 'ALREADY_PAID', `Your ${eventName(kind)} fee is already paid.`);
    const transactionId = text(body, 'transactionId').trim().toUpperCase();
    if (transactionId && !/^[A-Z0-9]{6,35}$/.test(transactionId)) throw new ApiError(400, 'INVALID', 'The transaction ID must be the 6–35 letters or digits shown in GPay.');
    const uploadId = isObject(body) && typeof body.uploadId === 'string' ? body.uploadId : '';
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new ApiError(400, 'INVALID', 'Choose the screenshot again.');
    if ((registration.proofs ?? []).length >= MAX_PROOFS) throw new ApiError(409, 'TOO_MANY', 'You have uploaded enough screenshots. Ask at the help desk if one is wrong.');
    const bytes = await this.deps.files.readUpload(uploadId, MAX_SCREENSHOT_BYTES);
    if (!bytes) throw new ApiError(400, 'UPLOAD_MISSING', 'Your screenshot did not reach us. Please choose it again.');
    const image = checkScreenshot(bytes);
    if (typeof image === 'string') throw new ApiError(400, 'INVALID', image);
    const id = randomUUID().slice(0, 12);
    const key = `proofs/${registration.registrationId}/${id}.${image.extension}`;
    await this.deps.files.put(key, bytes, image.type);
    await this.deps.files.deleteUpload(uploadId).catch(() => undefined);
    const proof = { id, kind, key, contentType: image.type, size: bytes.length, transactionId: transactionId || null, uploadedAt: new Date(this.deps.now()).toISOString() };
    await this.deps.mutate(registration.registrationId, (current) => ({ proofs: [...(current.proofs ?? []), proof].slice(-MAX_PROOFS) }));
    this.deps.log('Payment screenshot uploaded', { registrationId: registration.registrationId, kind });
    return this.view({ registrationId: registration.registrationId, phone: registration.record.participant.phone }, ip);
  }

  /** A one-minute link to the participant's own pass, once approved. */
  async pass(body: unknown, ip: string): Promise<{ success: true; url: string }> {
    const registration = await this.signIn(body, ip);
    if (registration.status !== 'APPROVED') {
      throw new ApiError(403, 'PASS_NOT_AVAILABLE', 'Your pass is available only for an approved registration. Please go to the registration desk.');
    }
    if (registration.pdfStatus !== 'GENERATED' || !registration.pdfKey) {
      throw new ApiError(409, 'PASS_NOT_READY', 'Your pass is being prepared. Please try again in a few minutes.');
    }
    const url = await this.deps.files.signedUrl(registration.pdfKey, { expiresInSeconds: 60, downloadName: passFileName(registration.registrationId) });
    return { success: true, url };
  }
}
