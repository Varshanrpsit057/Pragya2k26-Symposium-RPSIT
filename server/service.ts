/**
 * The PRAGYA 2026 registration workflow.
 *
 *   student submits → screenshot checked in S3 → stored in DynamoDB as PENDING
 *     → copied to Google Drive and the Google Sheet (retried until it succeeds)
 *   admin approves → APPROVED → participant pass (PDF, private S3) → confirmation email
 *     with the pass attached (Gmail) → copy of the pass in Drive → sheet updated
 *   admin rejects  → REJECTED; no pass, no confirmation email
 *   admin cancels an approved registration → CANCELLED; its pass stops working, it leaves
 *     the event lists and the totals, and its email may register again
 *
 * On the event day (src/lib/schedule.ts decides when, from the clock):
 *
 *   desk registers a participant → gate pass received (cash/UPI) → 262NNN, APPROVED
 *     → the same pass, email, Drive and sheet steps as an approval
 *   coordinators verify each ₹50 event fee, mark attendance, enter winners and submit
 *     results for certificates (server/events.ts)
 *
 * Every step records its own status (pdfStatus, emailStatus, sheet sync), so a failure later
 * on never undoes an earlier step and can be retried without doing anything twice. Staff
 * sign in with their own accounts; what each role may do is checked on every request
 * (server/roles.ts, src/lib/staff.ts).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { eventCatalog } from '../src/content/eventCatalog';
import { site } from '../src/content/site';
import { formatIst, parseEventStart } from '../src/lib/countdown';
import {
  ACCEPTED_SCREENSHOT_TYPES,
  MAX_SCREENSHOT_BYTES,
  REGISTRATION_ID,
  SUBMISSION_ID,
  formatOnlineId,
  formatOnsiteId,
  normalisePhone,
  normaliseRegistrationId,
  onlineSerial,
  resolvedDepartment,
  splitDepartment,
  tidy,
  validateField,
  type Fees,
  type RegistrationField,
  type RegistrationInput,
  type RegistrationSuccess,
  type StatusResult,
  type UploadTicket,
} from '../src/lib/registration';
import { PLACES, type AdminRegistration } from '../src/lib/admin';
import type { AuditEntry, SystemProblem, SystemStatus } from '../src/lib/help';
import { proofLabel } from '../src/lib/student';
import { eventDayStarted, registrationPhase, scheduleOf, type RegistrationPhase, type RegistrationSchedule } from '../src/lib/schedule';
import { LOGIN_LABELS, LOGIN_ROLES, type LoginRole } from '../src/lib/portal';
import { DELETE_ALL_STAFF, MAX_DESK_NUMBER, readDeskNumber, ROLE_PERMISSIONS, type SessionInfo, type SignedInView, type SignInFailure, type StaffRole } from '../src/lib/staff';
import { SESSION_HOURS, bearerToken, hashPassword, newSessionToken, sameText, sha256, verifyPassword } from './auth';
import { driveLink, type DriveStore, type StoredFile } from './drive';
import { confirmationEmail } from './emailTemplate';
import { ApiError } from './errors';
import { EventDesk } from './events';
import type { FileStore } from './files';
import { makePreview, previewKey } from './preview';
import { buildMime } from './gmail';
import { GoogleApiError, describeError } from './google';
import {
  currentEventIds,
  eventName,
  eventStatusViews,
  gatePassView,
  paymentRecords,
  isFeePaid,
  isPresent,
  hasPass,
  participationOf,
  recordWithEvents,
  sourceOf,
  unpaidEventFees,
} from './participation';
import { buildPassPdf, passData, passFileName } from './pass';
import { buildReport } from './reports';
import { requirePermission, type Actor } from './roles';
import { RowNotFoundError, type SheetRow, type SheetsStore } from './sheets';
import { StaffAccounts, staffCredential } from './staffAccounts';
import { FestService, isStudentKey } from './fest';
import type { FestSheetBackup } from './festSheet';
import { MemoryFestStore, type FestStore } from './festStore';
import { HelpDesk } from './helpDesk';
import { StudentPortal } from './studentPortal';
import { claimsOf, type AdminSession, type Registration, type StaffAccount, type RegistrationChanges, type RegistrationStatus, type Store } from './store';
import { checkScreenshot, validateOnsitePayload, validatePayload } from './validate';
import { RECORD_FOLDER_NAME, recordFileName, studentRecord, type Deletion } from './studentRecord';
import { TestTools } from './testTools';
import type { DeletedView } from '../src/lib/testTools';

export { ApiError } from './errors';

/** Links to a screenshot: its small copy to show, and the original. */
export interface ScreenshotLinks {
  success: true;
  url: string;
  originalUrl: string;
}

/** An admin signed the account out after this session began. */
const signedOutSince = (account: StaffAccount, session: AdminSession) => Boolean(account.signedOutAt) && session.createdAt <= Date.parse(account.signedOutAt!);

export interface ServiceDeps {
  store: Store;
  /** The fest's registrations (DynamoDB on AWS; in memory for tests and the local mock). */
  fest?: FestStore;
  /** The fest's backup in the Google Sheet, by the schedule (on AWS only). */
  festSheet?: Pick<FestSheetBackup, 'save'>;
  files: FileStore;
  sheets: Pick<SheetsStore, 'ready' | 'ids' | 'append' | 'update'>;
  drive: Pick<DriveStore, 'upload' | 'replace' | 'findByProperties' | 'ensureFolder' | 'parentOf' | 'trash'>;
  sendMail: (mime: string) => Promise<string>;
  /** The RPSIT crest (JPEG) for the participant pass. */
  logo: Uint8Array;
  paymentFolderId: string;
  passFolderId: string | null;
  /** passByEmail: email the pass on approval (defaults to site.registration.passByEmail). */
  mail: { fromName: string; sender: string | null; replyTo: string | null; passByEmail?: boolean };
  /** The owner's admin account (Amplify secrets); staff accounts live in the Control table. */
  admin: { username: string; passwordHash: string };
  rateLimit: { max: number; windowMs: number };
  fees?: Fees;
  /** When online and on-site registration are open; defaults to src/content/site.ts. */
  schedule?: RegistrationSchedule;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

/** Online 261NNN and on-site 262NNN (src/lib/registration.ts), each with its own counter. */
export const formatRegistrationId = formatOnlineId;
export { formatOnsiteId };

const STATUSES: readonly RegistrationStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
/** How long one request may hold an approval while it makes the pass and sends the email. */
const LEASE_MS = 60_000;
/** Automatic email retries (by the scheduled job) after Gmail refused clearly. */
const MAX_AUTO_EMAIL_ATTEMPTS = 5;
const MAX_AUTO_SYNC_ATTEMPTS = 50;
/**
 * Sign-in attempts: 10 per account name per network address, and 1,000 per address in all,
 * every 15 minutes. On the fest day about 300 phones sign in, and mobile networks put many of
 * them behind one address, so one person's typos never lock the others out, while guessing
 * any one account stays slow.
 */
const LOGIN_LIMIT = { max: 10, windowMs: 15 * 60_000 };
const LOGIN_ADDRESS_LIMIT = { max: 1000, windowMs: 15 * 60_000 };
const LOOKUP_LIMIT = { max: 120, windowMs: 10 * 60_000 };
/** The refused sign-ins kept for Accounts (newest first). */
const SIGN_IN_FAILURES = 'staff-sign-in-failures';
const MAX_SIGN_IN_FAILURES = 40;

/**
 * The password as typed, or (when that does not match) without spaces at its ends: a password copied
 * from a page often brings a space with it. Passwords never start or end with one (they are trimmed
 * when they are set), so this never lets a different password in.
 */
async function matchesPassword(password: string, hash: string) {
  if (await verifyPassword(password, hash)) return true;
  const trimmed = password.trim();
  return trimmed !== password && trimmed.length > 0 && verifyPassword(trimmed, hash);
}
/**
 * Students on their own phones (fest registration and their page). Many phones on one mobile
 * network can share an address, so the limits per address are generous.
 */
const SELF_REGISTER_LIMIT = { max: 600, windowMs: 10 * 60_000 };
const STUDENT_LIMIT = { max: 3000, windowMs: 10 * 60_000 };
const STUDENT_BUSY = 'Too many requests from your network. Please wait a few minutes and try again.';
/** Looking a registration up by ID and mobile number (no private key): few per ID, so IDs cannot be tried one by one. */
const STUDENT_ID_LIMIT = { max: 10, windowMs: 10 * 60_000 };
/** Registration IDs tried when an on-site number is already taken (a counter reset). */
const MAX_ID_ATTEMPTS = 5;
/** Google syncs run together by the scheduled job, so the sheet writes go in batches. */
const SYNC_BATCH = 20;
const PASS_FOLDER_NAME = 'Participant Passes';
const encoder = new TextEncoder();
const NOT_FOUND_MESSAGE = 'No registration matches these details. Please use the status link from your registration.';

/** '2026-10-06 19:35:12' in IST, for the sheet. */
export function istStamp(ms: number): string {
  return new Date(ms + 5.5 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

const istOf = (iso: string | undefined) => (iso ? istStamp(Date.parse(iso)) : '');

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A short string field of a request body ('' when missing or not a string). */
const field = (body: unknown, name: string, max = 200) => {
  const value = isObject(body) ? body[name] : undefined;
  return typeof value === 'string' ? value.slice(0, max) : '';
};

/** A reason typed by an admin: one line in the sheet (control characters become spaces). */
const reasonOf = (body: unknown) => field(body, 'reason', 300).replace(/\p{Cc}+/gu, ' ').trim();

const cancelledError = () => new ApiError(409, 'ALREADY_CANCELLED', 'This registration was cancelled.');

/** The record kept with a deletion (null when unreadable). */
function snapshotOf(entry: AuditEntry): Registration | null {
  try {
    return entry.snapshot ? (JSON.parse(entry.snapshot) as Registration) : null;
  } catch {
    return null;
  }
}

const GATE_PASS_LABEL = { ONLINE_UPI: 'Online UPI', CASH: 'Cash at desk', UPI: 'UPI at desk' } as const;

export class Service {
  private readonly fees: Fees;
  /** Passes are emailed on approval (off for now: students download them from the website). */
  readonly passByEmail: boolean;
  /** The schedule in force: the real one, or a test timeline (changed in place by `testing`). */
  readonly schedule: RegistrationSchedule;
  private readonly now: () => number;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;
  private passFolder: Promise<string> | null = null;
  private recordFolder: Promise<string> | null = null;
  private dummyHash: Promise<string> | null = null;
  /** Staff accounts (create, change, list). */
  readonly staff: StaffAccounts;
  /** Event fees, attendance, winners and results. */
  readonly events: EventDesk;
  /** The student page on the event day (switched on and off by admins). */
  readonly students: StudentPortal;
  /** Help requests sent with Contact admin. */
  readonly help: HelpDesk;
  /** Test sessions: the timeline, the TEST marks and deleting test data. */
  readonly testing: TestTools;
  /** The college-wide fest: departments, desks, events, live data. */
  readonly fest: FestService;

  constructor(private readonly deps: ServiceDeps) {
    this.fees = deps.fees ?? { gatePass: site.registration.gatePassFee, perEvent: site.registration.eventFee };
    this.passByEmail = deps.mail.passByEmail ?? site.registration.passByEmail;
    const standard = { ...(deps.schedule ?? scheduleOf(site.registration)) };
    this.schedule = { ...standard };
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((message, details) => console.log(JSON.stringify({ message, ...details })));
    this.staff = new StaffAccounts({ store: deps.store, ownerUsername: deps.admin.username, now: this.now, log: this.log, catalog: () => this.fest.catalog() });
    this.events = new EventDesk({
      store: deps.store,
      fees: this.fees,
      schedule: this.schedule,
      now: this.now,
      log: this.log,
      mutate: (registrationId, change) => this.mutate(registrationId, change),
      required: (registrationId) => this.required(registrationId),
    });
    this.students = new StudentPortal({
      store: deps.store,
      files: deps.files,
      fees: this.fees,
      now: this.now,
      log: this.log,
      mutate: (registrationId, change) => this.mutate(registrationId, change),
    });
    this.testing = new TestTools({
      store: deps.store,
      files: deps.files,
      drive: deps.drive,
      sheets: deps.sheets,
      now: this.now,
      log: this.log,
      standard,
      schedule: this.schedule,
      sheetRow: (registration) => this.sheetRow(registration),
    });
    this.help = new HelpDesk({ store: deps.store, now: this.now, log: this.log, testing: async () => (await this.testing.activeSession()) !== null });
    this.fest = new FestService({
      store: deps.fest ?? new MemoryFestStore(),
      settings: deps.store,
      files: deps.files,
      ...(deps.festSheet && { sheet: deps.festSheet }),
      schedule: this.schedule,
      testMark: () => this.testing.markNow(),
      now: this.now,
      log: this.log,
    });
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  /** Brings the timeline and the test session up to date (every request; cached for seconds). */
  async syncSettings() {
    await this.testing.sync();
  }

  private phase(): RegistrationPhase {
    return registrationPhase(this.schedule, this.now());
  }

  private async limit(key: string, { max, windowMs }: { max: number; windowMs: number }, message: string) {
    const now = this.now();
    const count = await this.deps.store.hit(key, windowMs, now);
    if (count > max) {
      throw new ApiError(429, 'RATE_LIMITED', message, undefined, Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)));
    }
  }

  /** Online registration only while the schedule says 'online'; the API decides, not the page. */
  private ensureOpen() {
    const phase = this.phase();
    if (phase === 'online') return;
    const end = this.schedule.onlineClosesAt ? parseEventStart(this.schedule.onlineClosesAt) : null;
    const closed = `Online registration for ${site.name} ${site.year} closed${end ? ` on ${formatIst(end)}` : ''}.`;
    if (phase === 'closed') {
      throw new ApiError(403, 'REGISTRATION_CLOSED', `Registration for ${site.name} ${site.year} has closed.`);
    }
    throw new ApiError(403, 'REGISTRATION_CLOSED', `${closed} Please register on-site at ${site.registration.onsite.desk} on ${site.dates ?? 'the event day'}.`);
  }

  // -------------------------------------------------------------------------------------
  // Students

  /** Step 1: a private, short-lived S3 upload for the payment screenshot. */
  async createUpload(body: unknown, ip: string): Promise<{ success: true } & UploadTicket> {
    await this.limit(`register:${ip}`, this.deps.rateLimit, 'Too many registration attempts from your network. Please wait a few minutes and try again.');
    this.ensureOpen();
    const contentType = field(body, 'contentType', 60).toLowerCase();
    const size = isObject(body) ? Number(body.size) : Number.NaN;
    if (!(ACCEPTED_SCREENSHOT_TYPES as readonly string[]).includes(contentType)) {
      const message = 'The screenshot must be a PNG or JPG image.';
      throw new ApiError(400, 'INVALID', message, { screenshot: message });
    }
    if (!Number.isInteger(size) || size < 1 || size > MAX_SCREENSHOT_BYTES) {
      const message = 'The image must be 5 MB or smaller.';
      throw new ApiError(400, 'INVALID', message, { screenshot: message });
    }
    const ticket = await this.deps.files.presignUpload(randomUUID(), contentType, MAX_SCREENSHOT_BYTES);
    return { success: true, ...ticket };
  }

  /** Step 2: the registration. Stored as PENDING; only an admin can approve it. */
  async register(body: unknown, ip: string): Promise<RegistrationSuccess> {
    await this.limit(`register:${ip}`, this.deps.rateLimit, 'Too many registration attempts from your network. Please wait a few minutes and try again.');
    this.ensureOpen();

    const checked = validatePayload(body, this.fees);
    if (!checked.ok) throw new ApiError(400, 'INVALID', checked.error, checked.fieldErrors);
    const form = checked.value;
    const submissionHash = sha256(form.submissionId);
    const { store, files } = this.deps;

    // The same form sent again (a retry after a timeout): the first result, never a second registration.
    const replay = await this.existing(await store.findClaim('submission', submissionHash));
    if (replay) return this.submitted(replay);

    const [emailHolder, transactionHolder] = await Promise.all([
      store.findClaim('email', form.emailKey),
      store.findClaim('transaction', form.transactionKey),
    ]);
    if (emailHolder && emailHolder === transactionHolder) {
      const same = await this.existing(emailHolder);
      if (same) return { ...this.submitted(same), duplicate: true };
    }
    if (transactionHolder) throw this.duplicate('transaction');
    if (emailHolder) throw this.duplicate('email');

    // The screenshot must really be there, and really be an image, before anything is stored.
    const bytes = await files.readUpload(form.uploadId, MAX_SCREENSHOT_BYTES);
    if (!bytes) {
      const message = 'Your payment screenshot did not reach us. Please choose it again and resubmit.';
      throw new ApiError(400, 'UPLOAD_MISSING', message, { screenshot: message });
    }
    const image = checkScreenshot(bytes);
    if (typeof image === 'string') throw new ApiError(400, 'INVALID', image, { screenshot: image });

    let number: number;
    try {
      number = await store.nextRegistrationNumber(() => this.highestSheetNumber());
    } catch (error) {
      this.log('Could not take a registration number', { error: describeError(error) });
      throw new ApiError(503, 'NOT_READY', 'Registration is temporarily unavailable. Please try again in a minute.', undefined, 30);
    }
    const registrationId = formatRegistrationId(number);
    const screenshotKey = `payments/${registrationId}.${image.extension}`;
    await files.put(screenshotKey, bytes, image.type);

    const registration: Registration = {
      registrationId,
      source: 'ONLINE',
      status: 'PENDING',
      submittedAt: this.iso(),
      submissionHash,
      record: form.record,
      eventIds: form.eventIds,
      emailKey: form.emailKey,
      transactionKey: form.transactionKey,
      screenshot: { key: screenshotKey, contentType: image.type, size: bytes.length, width: image.width, height: image.height },
      pdfStatus: 'NOT_STARTED',
      emailStatus: 'NOT_SENT',
      emailAttempts: 0,
      sheetRow: false,
      version: 1,
      sheetVersion: 0,
      syncAttempts: 0,
      ...(await this.testing.markNow()),
    };
    const created = await store.createRegistration(registration).catch(async (error: unknown) => {
      // Not stored: the screenshot copy belongs to no one (the upload itself stays for a retry).
      await files.delete(screenshotKey).catch(() => undefined);
      throw error;
    });
    if (!created.ok) {
      await files.delete(screenshotKey).catch(() => undefined);
      // Someone else got there first (a parallel retry of this form, or the same details).
      if (created.conflicts.includes('submission')) {
        const first = await this.existing(await store.findClaim('submission', submissionHash));
        if (first) return this.submitted(first);
      }
      if (created.conflicts.includes('transaction')) throw this.duplicate('transaction');
      if (created.conflicts.includes('email')) throw this.duplicate('email');
      throw new ApiError(503, 'BUSY', "We're receiving a lot of registrations right now. Please try again in a minute.", undefined, 5);
    }
    this.log('Registration stored', { registrationId });
    await files.deleteUpload(form.uploadId).catch(() => undefined);

    // Google Drive and the sheet: tried now, retried by the scheduled job if Google is down.
    await this.syncToGoogle(registrationId, { justCreated: true });
    return this.submitted(registration);
  }

  private submitted(registration: Registration): RegistrationSuccess {
    return {
      success: true,
      registrationId: registration.registrationId,
      status: registration.status,
      registeredAt: registration.submittedAt,
    };
  }

  private async existing(registrationId: string | null) {
    return registrationId ? this.deps.store.getRegistration(registrationId) : null;
  }

  private duplicate(kind: 'email' | 'transaction') {
    if (kind === 'transaction') {
      const message = 'This transaction ID has already been used for a registration. Each participant needs their own gate pass payment.';
      return new ApiError(409, 'DUPLICATE_TRANSACTION', message, { transactionId: message });
    }
    const message = `This email address is already registered for ${site.name} ${site.year}. Use your status link to check your registration, or contact the organisers.`;
    return new ApiError(409, 'DUPLICATE_EMAIL', message, { email: message });
  }

  /** The highest online serial already in the sheet (new or earlier IDs), so the counter never reuses one. */
  private async highestSheetNumber(): Promise<number> {
    const numbers = (await this.deps.sheets.ids()).map(onlineSerial).filter(Number.isFinite);
    return numbers.length ? Math.max(...numbers) : 0;
  }

  /**
   * A participant's own registration, found by its ID and their private key (the form's
   * submission id). Anything else, including a guessed ID, gets the same "not found".
   */
  private async ownRegistration(body: unknown, ip: string): Promise<Registration> {
    await this.limit(`lookup:${ip}`, LOOKUP_LIMIT, 'Too many requests. Please wait a few minutes and try again.');
    const registrationId = field(body, 'registrationId', 20).toUpperCase();
    const key = field(body, 'key', 80);
    if (!REGISTRATION_ID.test(registrationId) || !SUBMISSION_ID.test(key)) throw new ApiError(404, 'NOT_FOUND', NOT_FOUND_MESSAGE);
    const registration = await this.deps.store.getRegistration(registrationId);
    if (!registration || !sameText(sha256(key), registration.submissionHash)) throw new ApiError(404, 'NOT_FOUND', NOT_FOUND_MESSAGE);
    return registration;
  }

  /** The fest's student page: register, see their registration, change events, send the right transaction ID. */
  async festStudent(action: 'register' | 'view' | 'find' | 'events' | 'payment', body: unknown, ip: string) {
    if (action === 'register') {
      await this.limit(`self:${ip}`, SELF_REGISTER_LIMIT, STUDENT_BUSY);
      return this.fest.selfRegister(body);
    }
    await this.limit(`student:${ip}`, STUDENT_LIMIT, STUDENT_BUSY);
    if (action === 'find') {
      // By mobile number and email: a few tries for each number, and the address's lookup limit.
      const rawPhone = typeof body === 'object' && body !== null ? String((body as { phone?: unknown }).phone ?? '') : '';
      await this.limit(`student-lookup:${ip}`, LOOKUP_LIMIT, STUDENT_BUSY);
      await this.limit(`student-phone:${sha256(rawPhone.replace(/\D/g, '').slice(-10)).slice(0, 24)}`, STUDENT_ID_LIMIT, 'Too many tries for this mobile number. Please wait 10 minutes, or ask at a registration desk.');
      return this.fest.findOwn(body);
    }
    // Keyed only with a well-formed private key (the same rule as the lookup in fest.ts).
    const keyed = typeof body === 'object' && body !== null && isStudentKey((body as { key?: unknown }).key);
    if (!keyed) {
      const rawId = typeof body === 'object' && body !== null ? String((body as { id?: unknown }).id ?? '') : '';
      await this.limit(`student-lookup:${ip}`, LOOKUP_LIMIT, STUDENT_BUSY);
      await this.limit(`student-id:${sha256(rawId.replace(/\s/g, '').toUpperCase()).slice(0, 24)}`, STUDENT_ID_LIMIT, 'Too many tries for this ID. Please wait 10 minutes, or ask at a registration desk.');
    }
    if (action === 'view') return this.fest.studentView(body);
    if (action === 'events') return this.fest.studentEvents();
    return this.fest.studentPayment(body);
  }

  async status(body: unknown, ip: string): Promise<StatusResult> {
    const registration = await this.ownRegistration(body, ip);
    return {
      success: true,
      registrationId: registration.registrationId,
      status: registration.status,
      registeredAt: registration.submittedAt,
      passAvailable: hasPass(registration) && registration.status === 'APPROVED' && registration.pdfStatus === 'GENERATED',
      ...(registration.status === 'REJECTED' && registration.rejectionReason && { reason: registration.rejectionReason }),
      ...(registration.status === 'CANCELLED' && registration.cancellationReason && { reason: registration.cancellationReason }),
    };
  }

  /** A one-minute download link for the participant's own pass, only once it is approved. */
  async pass(body: unknown, ip: string): Promise<{ success: true; url: string }> {
    const registration = await this.ownRegistration(body, ip);
    if (registration.status === 'CANCELLED') {
      throw new ApiError(403, 'PASS_NOT_AVAILABLE', 'Your registration was cancelled, so your participant pass is no longer valid.');
    }
    if (registration.status !== 'APPROVED') {
      throw new ApiError(403, 'PASS_NOT_AVAILABLE', 'Your participant pass is available only after the organisers approve your registration.');
    }
    if (registration.pdfStatus !== 'GENERATED' || !registration.pdfKey) {
      throw new ApiError(409, 'PASS_NOT_READY', 'Your participant pass is being prepared. Please try again in a few minutes.');
    }
    const url = await this.deps.files.signedUrl(registration.pdfKey, {
      expiresInSeconds: 60,
      downloadName: passFileName(registration.registrationId),
    });
    return { success: true, url };
  }

  // -------------------------------------------------------------------------------------
  // Staff sign-in: the owner's admin account (Amplify secrets) or a staff account

  async login(body: unknown, ip: string): Promise<{ success: true; token: string; username: string; expiresAt: string }> {
    const username = field(body, 'username', 100).trim();
    const password = field(body, 'password', 200);
    const message = 'Too many sign-in attempts. Please wait 15 minutes and try again.';
    await this.limit(`login-address:${ip}`, LOGIN_ADDRESS_LIMIT, message);
    await this.limit(`login:${ip}:${sha256(username.toLowerCase()).slice(0, 24)}`, LOGIN_LIMIT, message);

    let session: AdminSession | null = null;
    // Why a sign-in was refused, kept for the web assist team (Accounts → Recent failed sign-ins).
    let failure: SignInFailure['reason'] = 'no such account';
    if (sameText(username, this.deps.admin.username)) {
      if (await matchesPassword(password, this.deps.admin.passwordHash)) {
        session = { username: this.deps.admin.username, kind: 'owner', credential: this.credential(), createdAt: 0, expiresAt: 0 };
      } else failure = 'wrong password';
    } else {
      // An unknown or inactive account takes as long to refuse as a wrong password.
      const account = await this.deps.store.getStaff(username.toLowerCase());
      const usable = account?.active ? account : null;
      const matches = await matchesPassword(password, usable?.passwordHash ?? (await this.dummyPasswordHash()));
      if (usable && matches && (await this.loginOff(usable.role))) {
        await this.noteSignInFailure(usable.username, 'sign-in switched off', ip);
        throw new ApiError(403, 'LOGIN_OFF', `Sign-in for ${LOGIN_LABELS[usable.role as LoginRole].toLowerCase()} is switched off by the web assist team.`);
      }
      if (usable && matches) {
        const desk = usable.role === 'DESK' ? (usable.deskNumber ?? readDeskNumber(isObject(body) ? body.deskNumber : undefined)) : null;
        session = { username: usable.username, kind: 'staff', credential: staffCredential(usable), createdAt: 0, expiresAt: 0, ...(desk && { deskNumber: desk }) };
      } else if (account) failure = account.active ? 'wrong password' : 'account deactivated';
    }
    if (!session) {
      this.log('Admin sign-in failed', { ip, reason: failure });
      await this.noteSignInFailure(username.toLowerCase(), failure, ip);
      throw new ApiError(401, 'INVALID_LOGIN', 'Incorrect username or password.');
    }
    if (session.kind === 'staff') await this.deps.store.noteStaffSignIn(session.username, new Date(this.now()).toISOString()).catch(() => undefined);
    const token = newSessionToken();
    const now = this.now();
    const expiresAt = now + SESSION_HOURS * 3_600_000;
    await this.deps.store.putSession(sha256(token), { ...session, createdAt: now, expiresAt });
    this.log('Admin signed in', { ip, username: session.username, kind: session.kind, ...(session.deskNumber && { desk: session.deskNumber }) });
    return { success: true, token, username: session.username, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Whether Website controls has switched this role's sign-in off. */
  private async loginOff(role: StaffRole) {
    if (!(LOGIN_ROLES as readonly string[]).includes(role)) return false;
    return !(await this.fest.portal()).logins[role as LoginRole];
  }

  private dummyPasswordHash() {
    this.dummyHash ??= hashPassword(randomBytes(18).toString('base64url'));
    return this.dummyHash;
  }

  /** Keeps the last few refused sign-ins (who was tried, why, when) for Accounts; never the password. */
  private async noteSignInFailure(username: string, reason: SignInFailure['reason'], ip: string) {
    try {
      const raw = await this.deps.store.getSetting(SIGN_IN_FAILURES);
      const list = raw ? (JSON.parse(raw) as SignInFailure[]) : [];
      const entry: SignInFailure = { username: username.slice(0, 40), reason, at: new Date(this.now()).toISOString() };
      await this.deps.store.putSetting(SIGN_IN_FAILURES, JSON.stringify([entry, ...list].slice(0, MAX_SIGN_IN_FAILURES)));
    } catch (error) {
      this.log('Could not keep the failed sign-in', { ip, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async signInFailures(): Promise<SignInFailure[]> {
    try {
      const raw = await this.deps.store.getSetting(SIGN_IN_FAILURES);
      return raw ? (JSON.parse(raw) as SignInFailure[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * "Check a password" (Accounts): whether this password is the account's, without signing in or
   * making a session. Says why it would be refused, so a failing login can be told apart from a typo.
   */
  async checkStaffPassword(actor: Actor, rawUsername: string, body: unknown) {
    const username = rawUsername.trim().toLowerCase();
    await this.limit(`password-check:${actor.username}`, LOGIN_LIMIT, 'Too many checks. Please wait 15 minutes and try again.');
    const password = field(body, 'password', 200);
    const account = await this.deps.store.getStaff(username);
    if (!account) return { success: true as const, username, exists: false, active: false, matches: false, signInOff: false };
    const matches = await matchesPassword(password, account.passwordHash);
    this.log('Staff password checked', { username, matches, by: actor.username });
    return { success: true as const, username, exists: true, active: account.active, matches, signInOff: await this.loginOff(account.role) };
  }

  /**
   * The owner only: deletes every staff account (the owner's own sign-in, from the Amplify secrets, is
   * never one of them), so each login can be made again by hand. Their sessions end at once.
   */
  async deleteAllStaff(actor: Actor, body: unknown) {
    if (actor.kind !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Only the main admin (the owner’s sign-in) can delete every account.');
    if (field(body, 'confirm', 40).trim() !== DELETE_ALL_STAFF) throw new ApiError(400, 'INVALID', `Type ${DELETE_ALL_STAFF} to confirm.`);
    const deleted: string[] = [];
    for (const account of await this.deps.store.listStaff()) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = attempt === 0 ? account : await this.deps.store.getStaff(account.username);
        if (!current) break;
        if (await this.deps.store.deleteStaff(current.username, current.revision)) {
          deleted.push(current.username);
          break;
        }
      }
    }
    this.log('Every staff account deleted', { count: deleted.length, by: actor.username });
    return { success: true as const, deleted: deleted.length };
  }

  /** Changes whenever the owner's username or password changes. */
  private credential() {
    return sha256(`${this.deps.admin.username}\n${this.deps.admin.passwordHash}`);
  }

  /**
   * The signed-in staff member for an Authorization header; throws 401 for anything else.
   * A staff account is read again on every request, so a new role, new events or a
   * deactivation apply at once, and a new password signs the account out.
   */
  async authenticate(authorization: string | undefined): Promise<Actor> {
    const token = bearerToken(authorization);
    const session = token ? await this.deps.store.getSession(sha256(token)) : null;
    const signIn = new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
    if (!session || session.expiresAt <= this.now()) throw signIn;
    if (session.kind === 'staff') {
      const account = await this.deps.store.getStaff(session.username);
      if (!account || !account.active || !sameText(session.credential, staffCredential(account)) || signedOutSince(account, session)) throw signIn;
      // The web assist team switched this role's sign-in off: signed out at once.
      if (await this.loginOff(account.role)) throw new ApiError(401, 'LOGIN_OFF', `Sign-in for ${LOGIN_LABELS[account.role as LoginRole].toLowerCase()} is switched off by the web assist team.`);
      return {
        username: account.username,
        displayName: account.displayName,
        role: account.role,
        eventIds: account.role === 'COORDINATOR' ? account.eventIds : [],
        kind: 'staff',
        expiresAt: session.expiresAt,
        deskNumber: account.role === 'DESK' ? (account.deskNumber ?? session.deskNumber ?? null) : null,
        department: account.department ?? null,
      };
    }
    // A new admin username or password signs everyone out.
    if (!sameText(session.credential, this.credential())) throw signIn;
    return { username: this.deps.admin.username, displayName: 'Administrator', role: 'ADMIN', eventIds: [], kind: 'owner', expiresAt: session.expiresAt, deskNumber: null, department: null };
  }

  /** A desk account says which registration desk it is at (or moves to another one). */
  async setDeskNumber(authorization: string | undefined, body: unknown) {
    const actor = await this.authenticate(authorization);
    if (actor.role !== 'DESK') throw new ApiError(400, 'INVALID', 'Only registration desk accounts have a desk number.');
    const desk = readDeskNumber(isObject(body) ? body.deskNumber : undefined);
    if (!desk) throw new ApiError(400, 'INVALID', `Choose your desk number (1–${MAX_DESK_NUMBER}).`);
    const tokenHash = sha256(bearerToken(authorization) ?? '');
    const session = await this.deps.store.getSession(tokenHash);
    if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
    await this.deps.store.putSession(tokenHash, { ...session, deskNumber: desk });
    this.log('Desk number chosen', { username: actor.username, desk });
    return this.sessionInfo({ ...actor, deskNumber: desk });
  }

  /** Who is signed in right now (admins): name, role, desk and since when. Never tokens. */
  async signedIn(): Promise<{ success: true; sessions: SignedInView[] }> {
    const now = this.now();
    const [sessions, staff] = await Promise.all([this.deps.store.listSessions(), this.deps.store.listStaff()]);
    const accounts = new Map(staff.map((account) => [account.username, account]));
    const list = sessions
      .filter((session) => session.expiresAt > now)
      .flatMap((session): SignedInView[] => {
        if (session.kind !== 'staff') {
          return [{ username: session.username, displayName: 'Administrator', role: 'ADMIN', kind: 'owner', department: null, deskNumber: null, since: new Date(session.createdAt).toISOString(), until: new Date(session.expiresAt).toISOString() }];
        }
        const account = accounts.get(session.username);
        // A new password (or a sign-out, or a deactivation) has ended this session already.
        if (!account?.active || signedOutSince(account, session) || !sameText(session.credential, staffCredential(account))) return [];
        return [
          {
            username: account.username,
            displayName: account.displayName,
            role: account.role,
            kind: 'staff',
            department: account.department ?? null,
            deskNumber: account.role === 'DESK' ? (account.deskNumber ?? session.deskNumber ?? null) : null,
            since: new Date(session.createdAt).toISOString(),
            until: new Date(session.expiresAt).toISOString(),
          },
        ];
      })
      .sort((a, b) => (a.deskNumber ?? 99) - (b.deskNumber ?? 99) || a.username.localeCompare(b.username) || b.since.localeCompare(a.since));
    return { success: true, sessions: list };
  }

  async logout(authorization: string | undefined): Promise<{ success: true }> {
    const token = bearerToken(authorization);
    if (token) await this.deps.store.deleteSession(sha256(token));
    return { success: true };
  }

  /** Who is signed in, their permissions, and the registration phase by the server's clock. */
  sessionInfo(actor: Actor): { success: true } & SessionInfo {
    const now = this.now();
    return {
      success: true,
      username: actor.username,
      displayName: actor.displayName,
      role: actor.role,
      kind: actor.kind,
      eventIds: actor.eventIds,
      department: actor.department,
      permissions: [...(ROLE_PERMISSIONS[actor.role] ?? [])],
      expiresAt: new Date(actor.expiresAt).toISOString(),
      serverTime: new Date(now).toISOString(),
      phase: registrationPhase(this.schedule, now),
      eventDayStarted: eventDayStarted(this.schedule, now),
      schedule: { ...this.schedule },
      testing: this.testing.status(),
      fees: this.fees,
      passByEmail: this.passByEmail,
      deskNumber: actor.deskNumber,
    };
  }

  // -------------------------------------------------------------------------------------
  // Admin dashboard

  async adminList(): Promise<{ success: true; registrations: AdminRegistration[] }> {
    const lists = await Promise.all(STATUSES.map((status) => this.deps.store.listRegistrations(status)));
    const registrations = lists
      .flat()
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map((registration) => this.adminView(registration));
    return { success: true, registrations };
  }

  private async required(registrationId: string): Promise<Registration> {
    const id = registrationId.toUpperCase();
    const registration = REGISTRATION_ID.test(id) ? await this.deps.store.getRegistration(id) : null;
    if (!registration) throw new ApiError(404, 'NOT_FOUND', 'Registration not found.');
    return registration;
  }

  async view(registrationId: string) {
    return { success: true as const, registration: this.adminView(await this.required(registrationId)) };
  }

  /**
   * Five-minute links to a screenshot: `url` to its small copy (made the first time staff open
   * it, then kept next to it) and `originalUrl` to the file as uploaded (also in Google Drive).
   * When no small copy can be made, `url` is the original too.
   */
  private async screenshotLinks(key: string): Promise<ScreenshotLinks> {
    const { files } = this.deps;
    const originalUrl = await files.signedUrl(key, { expiresInSeconds: 300 });
    const small = previewKey(key);
    try {
      if (!(await files.exists(small))) {
        const preview = makePreview(await files.get(key));
        if (!preview) return { success: true, url: originalUrl, originalUrl };
        await files.put(small, preview, 'image/jpeg');
      }
      return { success: true, url: await files.signedUrl(small, { expiresInSeconds: 300 }), originalUrl };
    } catch (error) {
      console.warn('Screenshot preview not made; showing the original.', error instanceof Error ? error.message : error);
      return { success: true, url: originalUrl, originalUrl };
    }
  }

  /** Links to a GPay screenshot the student uploaded from the student page (see screenshotLinks). */
  async proofUrl(registrationId: string, proofId: string, actor?: Actor): Promise<ScreenshotLinks> {
    const proof = (await this.required(registrationId)).proofs?.find((item) => item.id === proofId);
    if (!proof) throw new ApiError(404, 'NOT_FOUND', 'There is no such screenshot.');
    if (actor?.role === 'COORDINATOR' && proof.kind !== 'GATE_PASS' && !actor.eventIds.includes(proof.kind)) {
      throw new ApiError(403, 'EVENT_NOT_ASSIGNED', 'This screenshot is for an event that is not assigned to your account.');
    }
    return this.screenshotLinks(proof.key);
  }

  /** Links to the payment screenshot, for checking the payment (see screenshotLinks). */
  async adminScreenshot(registrationId: string): Promise<ScreenshotLinks> {
    const registration = await this.required(registrationId);
    if (!registration.screenshot) throw new ApiError(404, 'NO_SCREENSHOT', 'This registration was made at the desk, so it has no payment screenshot.');
    return this.screenshotLinks(registration.screenshot.key);
  }

  async adminPass(registrationId: string): Promise<{ success: true; url: string }> {
    const registration = await this.required(registrationId);
    if (registration.status === 'CANCELLED') throw new ApiError(409, 'CANCELLED', 'This registration was cancelled, so its pass is no longer valid.');
    if (registration.pdfStatus !== 'GENERATED' || !registration.pdfKey) {
      throw new ApiError(409, 'PASS_NOT_READY', 'There is no participant pass for this registration yet.');
    }
    const url = await this.deps.files.signedUrl(registration.pdfKey, {
      expiresInSeconds: 300,
      downloadName: passFileName(registration.registrationId),
    });
    return { success: true, url };
  }

  /**
   * PENDING → APPROVED, then the pass and the confirmation email. Approving again (a double
   * click, a retry) never makes a second pass or email: it only finishes a step that failed.
   * A desk registration the student paid by GPay from their phone needs the transaction ID
   * from their screenshot (or `payment.method` CASH when they paid cash in the end).
   */
  async approve(registrationId: string, admin: Pick<Actor, 'username'> & { deskNumber?: number | null }, body?: unknown) {
    const registration = await this.required(registrationId);
    const id = registration.registrationId;
    if (registration.status === 'REJECTED') {
      throw new ApiError(409, 'ALREADY_REJECTED', 'This registration was rejected, so it cannot be approved.');
    }
    if (registration.status === 'CANCELLED') throw cancelledError();
    if (registration.status === 'PENDING') {
      const desk = sourceOf(registration) === 'ONSITE' && !registration.gatePass ? await this.deskGatePass(registration, admin, body) : null;
      const approved = await this.deps.store.updateRegistration(
        id,
        { status: 'APPROVED', approvedAt: this.iso(), reviewedBy: admin.username, ...desk?.changes },
        { expect: { status: 'PENDING' } },
      );
      if (approved) this.log('Registration approved', { registrationId: id, by: admin.username, ...(desk && { method: desk.changes.gatePass.method }) });
      else {
        if (desk?.transactionKey) await this.deps.store.releaseClaim('transaction', desk.transactionKey, id);
        if ((await this.required(id)).status === 'REJECTED') {
          throw new ApiError(409, 'ALREADY_REJECTED', 'This registration was rejected, so it cannot be approved.');
        }
      }
    }
    await this.completeApproval(id);
    await this.syncToGoogle(id);
    return this.view(id);
  }

  /**
   * The ₹100 a desk student paid by GPay from their own phone, as the staff member approving it
   * recorded it: the transaction ID from the screenshot (claimed, so one payment is never
   * recorded twice), or cash when the student paid cash in the end.
   */
  private async deskGatePass(registration: Registration, admin: Pick<Actor, 'username'> & { deskNumber?: number | null }, body: unknown) {
    const payment = isObject(body) && isObject(body.payment) ? body.payment : {};
    const method: 'CASH' | 'UPI' = payment.method === 'CASH' ? 'CASH' : 'UPI';
    const reference = method === 'UPI' && typeof payment.reference === 'string' ? payment.reference.replace(/\s+/g, '').toUpperCase() : '';
    if (method === 'UPI' && !/^[A-Z0-9]{6,35}$/.test(reference)) {
      throw new ApiError(400, 'TRANSACTION_REQUIRED', 'Type the transaction ID (UPI reference / UTR) from the screenshot: 6–35 letters or digits.');
    }
    const id = registration.registrationId;
    if (reference && !(await this.deps.store.claim('transaction', reference, id))) {
      throw this.deskDuplicate('transaction', (await this.deps.store.findClaim('transaction', reference)) ?? 'another registration');
    }
    // The screenshot it was approved from: the student's latest.
    const proof = method === 'UPI' ? [...(registration.proofs ?? [])].reverse().find((item) => item.kind === 'GATE_PASS') : undefined;
    const gatePass = {
      method,
      amount: registration.record.payment.gatePassAmount,
      ...(reference && { reference }),
      ...(proof && { proofId: proof.id }),
      receivedBy: admin.username,
      receivedAt: this.iso(),
      ...(admin.deskNumber && { desk: admin.deskNumber }),
    };
    return {
      transactionKey: reference,
      changes: {
        gatePass,
        ...(reference && { transactionKey: reference, record: { ...registration.record, payment: { ...registration.record.payment, transactionId: reference } } }),
      },
    };
  }

  /** PENDING → REJECTED: no pass and no confirmation email, ever. */
  async reject(registrationId: string, admin: Pick<Actor, 'username'>, body: unknown) {
    const reason = reasonOf(body);
    const registration = await this.required(registrationId);
    const id = registration.registrationId;
    if (registration.status === 'APPROVED') {
      throw new ApiError(409, 'ALREADY_APPROVED', 'This registration is already approved, so it cannot be rejected.');
    }
    if (registration.status === 'CANCELLED') throw cancelledError();
    if (registration.status === 'PENDING') {
      const rejected = await this.deps.store.updateRegistration(
        id,
        { status: 'REJECTED', rejectedAt: this.iso(), reviewedBy: admin.username, rejectionReason: reason || null },
        { expect: { status: 'PENDING' } },
      );
      if (rejected) {
        this.log('Registration rejected', { registrationId: id, by: admin.username });
        // The student may register again with the same email (e.g. with a correct payment);
        // the rejected transaction ID stays used. A desk student may also use their phone again.
        await this.deps.store.releaseClaim('email', registration.emailKey, id);
        if (registration.phoneKey) await this.deps.store.releaseClaim('phone', registration.phoneKey, id);
      } else if ((await this.required(id)).status === 'APPROVED') {
        throw new ApiError(409, 'ALREADY_APPROVED', 'This registration is already approved, so it cannot be rejected.');
      }
    }
    await this.syncToGoogle(id);
    return this.view(id);
  }

  /**
   * APPROVED → CANCELLED (admins), with a reason: a duplicate, wrong details at the desk, or
   * a participant who withdrew. The pass stops working, the participant leaves every event
   * list and the totals, and their email and phone may register again (a transaction ID
   * stays used). Refused while an event fee is recorded (void it first, and refund it) or
   * while they are among an event's winners. Cancelling again changes nothing.
   */
  async cancel(registrationId: string, admin: Pick<Actor, 'username'>, body: unknown) {
    const reason = reasonOf(body);
    if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Give the reason for cancelling (the student sees it).');
    const registration = await this.required(registrationId);
    const id = registration.registrationId;
    if (registration.status === 'CANCELLED') return this.view(id);
    if (registration.status === 'PENDING') {
      throw new ApiError(409, 'NOT_APPROVED', 'This registration is not approved yet: reject it instead.');
    }
    if (registration.status === 'REJECTED') {
      throw new ApiError(409, 'ALREADY_REJECTED', 'This registration was rejected, so there is nothing to cancel.');
    }
    await this.ensureNotWinner(id);

    // Holding the lease means no pass or email is on its way while the status changes.
    const now = this.now();
    const leaseId = await this.deps.store.acquireLease(id, now + LEASE_MS, now);
    if (!leaseId) throw new ApiError(409, 'BUSY', 'The pass or email of this registration is being sent right now. Try again in a minute.');
    try {
      await this.mutate(id, (current) => {
        if (current.status === 'CANCELLED') return null;
        if (current.status !== 'APPROVED') throw new ApiError(409, 'NOT_APPROVED', 'This registration is no longer approved.');
        const paid = currentEventIds(current).filter((eventId) => isFeePaid(current, eventId));
        if (paid.length) {
          throw new ApiError(
            409,
            'FEES_RECORDED',
            `${id} has the ${paid.map(eventName).join(', ')} fee recorded. Void it first (and refund the participant), then cancel.`,
          );
        }
        return { status: 'CANCELLED', cancelledAt: this.iso(), cancelledBy: admin.username, cancellationReason: reason };
      });
    } finally {
      await this.deps.store.releaseLease(id, leaseId).catch(() => undefined);
    }
    this.log('Registration cancelled', { registrationId: id, by: admin.username });
    await this.deps.store.releaseClaim('email', registration.emailKey, id);
    if (registration.phoneKey) await this.deps.store.releaseClaim('phone', registration.phoneKey, id);
    await this.syncToGoogle(id);
    return this.view(id);
  }

  /** Refuses to remove someone who is among an event's winners (draft or submitted). */
  private async ensureNotWinner(id: string) {
    const results = await Promise.all(eventCatalog.map((event) => this.events.loadResult(event.id)));
    const won = results.find((result) =>
      PLACES.some((place) => result.winners[place].includes(id) || result.submission?.winners[place].some((winner) => winner.registrationId === id)),
    );
    if (won) {
      throw new ApiError(409, 'IS_WINNER', `${id} is among the winners of ${eventName(won.eventId)}. Remove them from the winners first.`);
    }
  }

  /**
   * Deletes a student's record for good (admins only), with a reason: a test entry, spam, or
   * a duplicate nobody needs to see again. Its Sheet row is marked DELETED (the sheet is only a
   * copy), its email, phone and transaction ID may register again, its files go, and an
   * audit entry keeps who deleted what and why. Refused while an event fee is recorded or
   * the student is among the winners, as for a cancellation.
   */
  async deleteRegistration(registrationId: string, admin: Pick<Actor, 'username'>, body: unknown) {
    const reason = reasonOf(body);
    if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Give the reason for deleting this record.');
    const id = (await this.required(registrationId)).registrationId;
    await this.ensureNotWinner(id);
    const now = this.now();
    const leaseId = await this.deps.store.acquireLease(id, now + LEASE_MS, now);
    if (!leaseId) throw new ApiError(409, 'BUSY', 'The pass or email of this registration is being sent right now. Try again in a minute.');
    const registration = await this.required(id);
    let deleted = false;
    try {
      const paid = currentEventIds(registration).filter((eventId) => isFeePaid(registration, eventId));
      if (paid.length) {
        throw new ApiError(409, 'FEES_RECORDED', `${id} has the ${paid.map(eventName).join(', ')} fee recorded. Void it first (and refund the participant), then delete.`);
      }
      deleted = await this.deps.store.deleteRegistration(id, registration.version);
      if (!deleted) throw new ApiError(409, 'BUSY', 'This registration was changed by someone else at the same moment. Please try again.');
    } finally {
      if (!deleted) await this.deps.store.releaseLease(id, leaseId).catch(() => undefined);
    }
    const { store } = this.deps;
    for (const [kind, key] of claimsOf(registration)) await store.releaseClaim(kind, key, id).catch(() => undefined);
    // Nothing is lost: the whole record is kept in the log, its files stay (private, in S3 and
    // Drive), and its Drive record file and sheet row stay, marked deleted.
    const deletion = { at: this.iso(), by: admin.username, reason };
    await store.addAuditEntry({ at: deletion.at, action: 'DELETED', registrationId: id, name: registration.record.participant.name, by: admin.username, reason, snapshot: JSON.stringify(registration) });
    this.log('Registration deleted', { registrationId: id, by: admin.username });
    await this.saveStudentRecord(id, { registration, deletion });
    // The sheet keeps the row, marked, so nobody wonders where it went.
    try {
      await this.deps.sheets.ready();
      await this.deps.sheets.update(id, { ...this.sheetRow(registration), status: 'DELETED', notes: `Deleted by ${admin.username} ${istStamp(this.now())}: ${reason}` });
    } catch (error) {
      if (!(error instanceof RowNotFoundError)) this.log('Could not mark the deleted row in the sheet', { registrationId: id, error: describeError(error) });
    }
    return { success: true as const, deleted: id };
  }

  /** The latest deletion or restore of each record, newest first. */
  private async lastDeletions() {
    const latest = new Map<string, AuditEntry>();
    for (const entry of await this.deps.store.listAuditEntries()) {
      if ((entry.action === 'DELETED' || entry.action === 'RESTORED') && !latest.has(entry.registrationId)) latest.set(entry.registrationId, entry);
    }
    return latest;
  }

  /** Deleted students (web assistant team and admins): every record deleted and not restored. */
  async listDeleted(): Promise<{ success: true; deleted: DeletedView[] }> {
    const deleted: DeletedView[] = [];
    for (const entry of (await this.lastDeletions()).values()) {
      if (entry.action !== 'DELETED' || (await this.deps.store.getRegistration(entry.registrationId))) continue;
      const snapshot = snapshotOf(entry);
      const participant = snapshot?.record.participant;
      deleted.push({
        registrationId: entry.registrationId,
        name: entry.name,
        phone: participant?.phone ?? '',
        email: participant?.email ?? '',
        college: participant?.college ?? '',
        source: snapshot ? sourceOf(snapshot) : 'ONLINE',
        status: snapshot?.status ?? '',
        deletedAt: entry.at,
        deletedBy: entry.by,
        reason: entry.reason,
      });
    }
    return { success: true, deleted };
  }

  /**
   * Brings a deleted record back, as it was (its files were kept). Refused when its phone,
   * email or payment reference has since been used by another registration.
   */
  async restoreDeleted(actor: Actor, registrationId: string) {
    const id = normaliseRegistrationId(registrationId);
    const entry = (await this.lastDeletions()).get(id);
    const snapshot = entry?.action === 'DELETED' ? snapshotOf(entry) : null;
    if (!entry || !snapshot) throw new ApiError(404, 'NOT_FOUND', `${id} is not in the Deleted list.`);
    if (await this.deps.store.getRegistration(id)) throw new ApiError(409, 'EXISTS', `${id} is already back in the list.`);
    const { leaseUntil: _until, leaseId: _lease, ...kept } = snapshot;
    void _until;
    void _lease;
    // A new version, so the Google Sheet row and the Drive record are written again.
    const registration: Registration = { ...kept, version: snapshot.version + 1, syncAttempts: 0, recordAttempts: 0 };
    const created = await this.deps.store.createRegistration(registration);
    if (!created.ok) {
      if (!created.conflicts.length) throw new ApiError(409, 'EXISTS', `The ID ${id} is now used by another registration.`);
      const kind = created.conflicts[0];
      const key = kind === 'email' ? snapshot.emailKey : kind === 'phone' ? snapshot.phoneKey : kind === 'transaction' ? snapshot.transactionKey : snapshot.submissionHash;
      const holder = key ? await this.deps.store.findClaim(kind, key) : null;
      const what = { email: 'email', phone: 'phone number', transaction: 'payment reference', submission: 'form' }[kind];
      throw new ApiError(409, 'CONFLICT', `${id} cannot come back: its ${what} is now used by ${holder ?? 'another registration'}. Change or delete that one first.`);
    }
    await this.deps.store.addAuditEntry({ at: this.iso(), action: 'RESTORED', registrationId: id, name: registration.record.participant.name, by: actor.username, reason: 'Restored from the Deleted list' });
    this.log('Registration restored', { registrationId: id, by: actor.username });
    await this.saveStudentRecord(id).catch(() => false);
    return { success: true as const, registration: this.adminView(registration) };
  }

  /**
   * Corrects a student's details (desk, web assistant team, admins): name, department, year,
   * college, phone and email, with the same rules as the form. A new email or phone is
   * claimed first, so it can never belong to two registrations. An approved student gets a
   * new pass with the corrected details, and the email again when `resendEmail` is set.
   */
  async editDetails(actor: Actor, registrationId: string, body: unknown) {
    const registration = await this.required(registrationId);
    const id = registration.registrationId;
    const value = (name: string, max = 200) => field(body, name, max);
    const input: RegistrationInput = {
      name: value('name'),
      ...splitDepartment(value('department').trim()),
      college: value('college'),
      year: value('year', 40),
      phone: value('phone', 40),
      email: value('email', 300),
      events: [],
      transactionId: '',
      screenshot: null,
    };
    const checked: RegistrationField[] = ['name', 'department', 'departmentOther', 'year', 'college', 'phone', 'email'];
    const fieldErrors = Object.fromEntries(checked.flatMap((name) => { const message = validateField(name, input); return message ? [[name, message]] : []; }));
    if (Object.keys(fieldErrors).length) throw new ApiError(400, 'INVALID', 'Please check the highlighted fields.', fieldErrors);
    const participant = {
      name: tidy(input.name),
      department: resolvedDepartment(input),
      college: tidy(input.college),
      year: input.year,
      phone: normalisePhone(input.phone),
      email: input.email.trim().toLowerCase(),
    };
    const before = registration.record.participant;
    const changed = (Object.keys(participant) as (keyof typeof participant)[]).filter((key) => participant[key] !== before[key]);
    const resendEmail = isObject(body) && body.resendEmail === true;
    if (!changed.length && !resendEmail) return this.view(id);

    // Claim a new email (and the phone, for a desk registration that holds one) before using it.
    const swaps: ['email' | 'phone', string, string][] = [];
    if (participant.email !== registration.emailKey) swaps.push(['email', registration.emailKey, participant.email]);
    if (registration.phoneKey && participant.phone !== registration.phoneKey) swaps.push(['phone', registration.phoneKey, participant.phone]);
    const taken: ['email' | 'phone', string][] = [];
    try {
      for (const [kind, , next] of swaps) {
        if (!(await this.deps.store.claim(kind, next, id))) throw this.deskDuplicate(kind, (await this.deps.store.findClaim(kind, next)) ?? 'another registration');
        taken.push([kind, next]);
      }
      await this.mutate(id, (current) => {
        const approved = current.status === 'APPROVED';
        return {
          record: { ...current.record, participant },
          emailKey: participant.email,
          ...(current.phoneKey && { phoneKey: participant.phone }),
          // The pass shows the details: an approved student gets a new one (and its Drive copy).
          ...(approved && changed.length && { pdfStatus: 'NOT_STARTED' as const, pdfError: null, passDriveFileId: null, passDriveFileName: null }),
          ...(approved && resendEmail && { emailStatus: 'NOT_SENT' as const, emailError: null }),
        };
      });
    } catch (error) {
      for (const [kind, key] of taken) await this.deps.store.releaseClaim(kind, key, id).catch(() => undefined);
      throw error;
    }
    for (const [kind, old] of swaps) await this.deps.store.releaseClaim(kind, old, id).catch(() => undefined);
    this.log('Registration details corrected', { registrationId: id, fields: changed, resendEmail, by: actor.username });
    await this.completeApproval(id);
    await this.syncToGoogle(id);
    return this.view(id);
  }

  /**
   * What the web assistant team watches: registrations by status, and every one with a pass,
   * email or Sheet copy that failed or is waiting, or a payment waiting for verification.
   */
  async systemStatus(): Promise<{ success: true } & SystemStatus> {
    const lists = await Promise.all(STATUSES.map((status) => this.deps.store.listRegistrations(status)));
    const all = lists.flat();
    const now = this.now();
    const counts = { passFailed: 0, emailFailed: 0, emailUnconfirmed: 0, sheetWaiting: 0, sheetFailed: 0, paymentWaiting: 0 };
    const problems: SystemProblem[] = [];
    for (const registration of all) {
      const found: string[] = [];
      if (registration.pdfStatus === 'FAILED' && hasPass(registration)) {
        counts.passFailed += 1;
        found.push(`Pass failed: ${registration.pdfError ?? 'unknown error'}`);
      }
      if (registration.emailStatus === 'FAILED') {
        counts.emailFailed += 1;
        found.push(`Email failed: ${registration.emailError ?? 'unknown error'}`);
      }
      if (registration.emailStatus === 'UNKNOWN') {
        counts.emailUnconfirmed += 1;
        found.push('Email not confirmed by Gmail: check the Sent folder before resending');
      }
      if (registration.syncError) {
        counts.sheetFailed += 1;
        found.push(`Google Sheet copy failing: ${registration.syncError}`);
      } else if (!registration.sheetRow || registration.sheetVersion < registration.version) {
        counts.sheetWaiting += 1;
      }
      if (registration.recordError) found.push(`Google Drive record copy failing: ${registration.recordError}`);
      if (registration.status === 'PENDING') {
        counts.paymentWaiting += 1;
        if (now - Date.parse(registration.submittedAt) > 6 * 3_600_000) found.push(`GPay payment waiting for verification since ${formatIst(Date.parse(registration.submittedAt))}`);
      }
      if (found.length) problems.push({ registrationId: registration.registrationId, name: registration.record.participant.name, problems: found });
    }
    const count = (status: RegistrationStatus) => all.filter((registration) => registration.status === status).length;
    const [help, audit, portal] = await Promise.all([this.deps.store.listHelpRequests(), this.deps.store.listAuditEntries(), this.students.state()]);
    return {
      success: true,
      serverTime: new Date(now).toISOString(),
      phase: registrationPhase(this.schedule, now),
      studentPortal: portal.enabled,
      registrations: {
        total: all.length,
        online: all.filter((registration) => sourceOf(registration) === 'ONLINE').length,
        onsite: all.filter((registration) => sourceOf(registration) === 'ONSITE').length,
        pending: count('PENDING'),
        approved: count('APPROVED'),
        rejected: count('REJECTED'),
        cancelled: count('CANCELLED'),
      },
      counts,
      problems: problems.sort((a, b) => a.registrationId.localeCompare(b.registrationId)).slice(0, 100),
      openHelp: help.filter((request) => request.status === 'OPEN').length,
      deleted: audit
        .filter((entry) => entry.action === 'DELETED')
        .slice(0, 20)
        .map(({ snapshot: _snapshot, ...entry }) => {
          void _snapshot;
          return entry;
        }),
    };
  }

  /**
   * Finishes what failed for an approved registration (pass, email, Drive, sheet). An email
   * whose delivery is UNKNOWN is resent only when the admin confirms it (resendEmail).
   */
  async retry(registrationId: string, admin: Pick<Actor, 'username'>, body: unknown) {
    const registration = await this.required(registrationId);
    const id = registration.registrationId;
    if (registration.status === 'APPROVED') {
      if (isObject(body) && body.resendEmail === true && registration.emailStatus === 'UNKNOWN') {
        await this.deps.store.updateRegistration(
          id,
          { emailStatus: 'FAILED', emailError: `Resend confirmed by ${admin.username}` },
          { expect: { emailStatus: 'UNKNOWN' } },
        );
      }
      await this.completeApproval(id);
    }
    await this.saveStudentRecord(id);
    await this.syncToGoogle(id);
    return this.view(id);
  }

  private async update(registrationId: string, changes: RegistrationChanges, options?: Parameters<Store['updateRegistration']>[2]) {
    return this.deps.store.updateRegistration(registrationId, changes, options);
  }

  /**
   * Reads a registration, works out a change from it and stores the change only if nobody
   * changed the registration in between (its version); otherwise reads it again. `change`
   * returns null when there is nothing to do, or throws to refuse.
   */
  private async mutate(registrationId: string, change: (current: Registration) => RegistrationChanges | null): Promise<Registration> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.required(registrationId);
      const changes = change(current);
      if (!changes) return current;
      const updated = await this.update(current.registrationId, changes, { expect: { version: current.version } });
      if (updated) return updated;
    }
    throw new ApiError(409, 'BUSY', 'This registration was changed by someone else at the same moment. Please try again.');
  }

  // -------------------------------------------------------------------------------------
  // The registration desk (event day)

  /**
   * Registers a participant at the desk: details, events and the ₹100 gate pass. Gets its own
   * 262NNN ID. Received in cash (or UPI the desk saw credited) it is APPROVED at once, so the
   * pass, email and sheet follow as for an approval. Paid by GPay from the student's own phone
   * (studentPays) it waits as PENDING: the student signs in to Student login, pays and uploads
   * the screenshot, and staff approve it with the transaction ID (approve). Sending the same
   * form again returns the first result; the same email or phone, or a UPI reference already
   * used, is refused with the registration that holds it.
   */
  async registerOnsite(actor: Actor, body: unknown) {
    // The desk registers on any day until on-site registration closes (11:59 AM on the event day).
    requirePermission(actor, 'registrations.onsite');
    if (this.phase() === 'closed') {
      const closes = this.schedule.onsiteClosesAt ? parseEventStart(this.schedule.onsiteClosesAt) : null;
      throw new ApiError(403, 'ONSITE_CLOSED', `On-site registration closed${closes ? ` at ${formatIst(closes)}` : ''}.`);
    }
    const checked = validateOnsitePayload(body, this.fees);
    if (!checked.ok) throw new ApiError(400, 'INVALID', checked.error, checked.fieldErrors);
    const form = checked.value;
    const submissionHash = sha256(form.submissionId);
    const { store } = this.deps;

    const replay = await this.existing(await store.findClaim('submission', submissionHash));
    if (replay) return { success: true as const, replayed: true, registration: this.adminView(replay) };

    const holder = async (kind: 'email' | 'transaction' | 'phone', key: string) => (key ? store.findClaim(kind, key) : null);
    const transactionKey = form.payment.reference?.toUpperCase() ?? '';
    const [emailHolder, transactionHolder, phoneHolder] = await Promise.all([
      holder('email', form.emailKey),
      holder('transaction', transactionKey),
      holder('phone', form.phoneKey),
    ]);
    if (emailHolder) throw this.deskDuplicate('email', emailHolder);
    if (transactionHolder) throw this.deskDuplicate('transaction', transactionHolder);
    // One phone number, one registration: the student signs in with it.
    const samePhone =
      phoneHolder ??
      (await Promise.all([store.listRegistrations('PENDING'), store.listRegistrations('APPROVED')]))
        .flat()
        .find((registration) => registration.record.participant.phone === form.phoneKey)?.registrationId;
    if (samePhone) throw this.deskDuplicate('phone', samePhone);

    // The chosen events: none whose results are submitted, and a team event takes the gate
    // team only while it has room. Each event's ₹50 is paid at its venue.
    const chosen = eventCatalog.filter((event) => form.eventIds.includes(event.id));
    for (const event of chosen) {
      if ((await this.events.loadResult(event.id)).status === 'SUBMITTED') {
        throw new ApiError(409, 'RESULTS_FINALIZED', `The results of ${event.name} are already submitted, so nobody new can join it.`);
      }
      if (form.teamName && event.teams) await this.events.ensureTeamRoom(event, form.teamName, '');
    }

    const now = this.iso();
    const base: Omit<Registration, 'registrationId'> = {
      source: 'ONSITE',
      status: form.studentPays ? 'PENDING' : 'APPROVED',
      submittedAt: now,
      ...(!form.studentPays && { approvedAt: now, reviewedBy: actor.username }),
      createdBy: actor.username,
      ...(actor.deskNumber && { deskNumber: actor.deskNumber }),
      submissionHash,
      record: form.record,
      eventIds: chosen.map((event) => event.id),
      emailKey: form.emailKey,
      transactionKey,
      phoneKey: form.phoneKey,
      ...(form.teamName && { teamName: form.teamName }),
      ...(!form.studentPays && {
        gatePass: {
          method: form.payment.method,
          amount: this.fees.gatePass,
          ...(form.payment.reference && { reference: form.payment.reference }),
          receivedBy: actor.username,
          receivedAt: now,
          ...(actor.deskNumber && { desk: actor.deskNumber }),
        },
      }),
      participation: Object.fromEntries(
        chosen.map((event) => [event.id, { addedBy: actor.username, addedAt: now, ...(form.teamName && event.teams && { team: form.teamName }) }]),
      ),
      pdfStatus: 'NOT_STARTED',
      emailStatus: 'NOT_SENT',
      emailAttempts: 0,
      sheetRow: false,
      version: 1,
      sheetVersion: 0,
      syncAttempts: 0,
      ...(await this.testing.markNow()),
    };

    let registration: Registration | null = null;
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && !registration; attempt += 1) {
      let number: number;
      try {
        // Its own counter, started at 0: it never needs Google, and online IDs are untouched.
        number = await store.nextRegistrationNumber(async () => 0, 'onsite');
      } catch (error) {
        this.log('Could not take an on-site registration number', { error: describeError(error) });
        throw new ApiError(503, 'NOT_READY', 'Could not take a Registration ID. Please try again.', undefined, 5);
      }
      const candidate: Registration = { ...base, registrationId: formatOnsiteId(number) };
      const created = await store.createRegistration(candidate);
      if (created.ok) {
        registration = candidate;
        break;
      }
      if (created.conflicts.includes('submission')) {
        const first = await this.existing(await store.findClaim('submission', submissionHash));
        if (first) return { success: true as const, replayed: true, registration: this.adminView(first) };
      }
      for (const kind of ['email', 'transaction', 'phone'] as const) {
        if (created.conflicts.includes(kind)) {
          const key = kind === 'email' ? form.emailKey : kind === 'transaction' ? transactionKey : form.phoneKey;
          throw this.deskDuplicate(kind, (await store.findClaim(kind, key)) ?? 'another registration');
        }
      }
      // No claim conflicts: the ID itself was taken (the counter fell behind). Take the next one.
      this.log('On-site Registration ID already taken; taking the next', { registrationId: candidate.registrationId });
    }
    if (!registration) throw new ApiError(503, 'BUSY', 'Could not take a free Registration ID. Please try again.', undefined, 5);

    this.log('On-site registration stored', {
      registrationId: registration.registrationId,
      by: actor.username,
      method: form.studentPays ? 'UPI by the student (waiting)' : form.payment.method,
    });
    if (!form.studentPays) await this.completeApproval(registration.registrationId);
    await this.syncToGoogle(registration.registrationId, { justCreated: true });
    return { ...(await this.view(registration.registrationId)), replayed: false };
  }

  private deskDuplicate(kind: 'email' | 'transaction' | 'phone', registrationId: string) {
    const messages = {
      email: `This email address is already registered (${registrationId}). Open that registration instead of making a new one.`,
      transaction: `This UPI reference was already used for ${registrationId}. Each payment can be recorded once.`,
      phone: `This phone number is already registered (${registrationId}). Open that registration instead: each student needs their own phone number to sign in.`,
    };
    const fieldName = kind === 'transaction' ? 'transactionId' : kind;
    const code = { email: 'DUPLICATE_EMAIL', transaction: 'DUPLICATE_TRANSACTION', phone: 'DUPLICATE_PHONE' }[kind];
    return new ApiError(409, code, messages[kind], { [fieldName]: messages[kind] }, undefined, { registrationId });
  }

  /**
   * Adds or removes events on a registration (desk or admin). An event whose fee is recorded
   * or whose attendance is marked cannot be removed; an online registration keeps at least one
   * event. A team event added for someone who came as a team takes the gate team.
   */
  async changeEvents(actor: Actor, registrationId: string, body: unknown) {
    // The desk changes events on any day, like it registers.
    requirePermission(actor, 'registrations.events');
    const list = (name: 'add' | 'remove') => (isObject(body) && Array.isArray(body[name]) ? body[name].filter((id): id is string => typeof id === 'string') : []);
    const add = list('add');
    const remove = list('remove');
    const known = new Set(currentEventIds({ eventIds: [...add, ...remove] }));
    if ([...add, ...remove].some((id) => !known.has(id))) throw new ApiError(400, 'INVALID', 'Choose events from the list only.');
    if (!add.length && !remove.length) throw new ApiError(400, 'INVALID', 'Choose the events to add or remove.');
    const finalized = await Promise.all(remove.map(async (eventId) => ((await this.events.loadResult(eventId)).status === 'SUBMITTED' ? eventId : null)));
    const locked = finalized.find(Boolean);
    if (locked) throw new ApiError(409, 'RESULTS_FINALIZED', `The results of ${eventName(locked)} are submitted, so it cannot be removed.`);
    // A team event added for someone who came as a team takes the gate team, while it has room.
    const stored = await this.required(registrationId);
    const gateTeam = stored.teamName;
    const teamEvents = gateTeam ? eventCatalog.filter((event) => event.teams && add.includes(event.id) && !currentEventIds(stored).includes(event.id)) : [];
    for (const event of teamEvents) await this.events.ensureTeamRoom(event, gateTeam!, stored.registrationId);

    const updated = await this.mutate(registrationId, (current) => {
      if (current.status === 'REJECTED') throw new ApiError(409, 'REJECTED', 'This registration was rejected.');
      if (current.status === 'CANCELLED') throw cancelledError();
      for (const eventId of remove) {
        if (isFeePaid(current, eventId) || isPresent(current, eventId)) {
          throw new ApiError(409, 'EVENT_IN_USE', `${eventName(eventId)} has a fee or attendance recorded, so it cannot be removed.`);
        }
      }
      const before = currentEventIds(current);
      const eventIds = currentEventIds({ eventIds: [...before.filter((id) => !remove.includes(id)), ...add] });
      // Online registrations keep at least one event; a desk registration may have none.
      if (!eventIds.length && sourceOf(current) === 'ONLINE') throw new ApiError(400, 'INVALID', 'Keep at least one event.');
      if (eventIds.join() === before.join()) return null;
      const participation = { ...current.participation };
      for (const eventId of remove) delete participation[eventId];
      for (const eventId of add.filter((id) => !before.includes(id))) {
        const team = current.teamName && teamEvents.some((event) => event.id === eventId) ? { team: current.teamName } : {};
        participation[eventId] = { ...participationOf(current, eventId), addedBy: actor.username, addedAt: this.iso(), ...team };
      }
      return { eventIds, record: recordWithEvents(current.record, eventIds, this.fees), participation };
    });
    this.log('Registration events changed', { registrationId: updated.registrationId, add, remove, by: actor.username });
    return { success: true as const, registration: this.adminView(updated) };
  }

  async report(actor: Actor) {
    requirePermission(actor, 'reports.view');
    const lists = await Promise.all(STATUSES.map((status) => this.deps.store.listRegistrations(status)));
    const results = await Promise.all(eventCatalog.map((event) => this.events.loadResult(event.id)));
    return { success: true as const, report: buildReport(lists.flat(), results, this.now()) };
  }

  /**
   * The pass and the email for an approved registration, each done at most once. One
   * request at a time holds the registration's lease; another one simply leaves it to it.
   */
  private async completeApproval(registrationId: string) {
    const { store, files } = this.deps;
    const now = this.now();
    const leaseId = await store.acquireLease(registrationId, now + LEASE_MS, now);
    if (!leaseId) return;
    try {
      let registration = await store.getRegistration(registrationId);
      // Desk registrations have no pass (nor its email or Drive copy): the Registration ID is enough.
      if (!registration || registration.status !== 'APPROVED' || !hasPass(registration)) return;
      const pass = () =>
        passData({
          registrationId,
          registeredAt: registration!.submittedAt,
          record: registration!.record,
          eventIds: registration!.eventIds,
          gatePass: registration!.gatePass,
        });

      // 1. The participant pass, stored privately in S3.
      let pdf: Uint8Array | null = null;
      if (registration.pdfStatus !== 'GENERATED' || !registration.pdfKey) {
        try {
          pdf = await buildPassPdf(pass(), this.deps.logo);
          const pdfKey = `passes/${registrationId}.pdf`;
          await files.put(pdfKey, pdf, 'application/pdf');
          registration = (await this.update(registrationId, { pdfStatus: 'GENERATED', pdfKey, pdfGeneratedAt: this.iso(), pdfError: null })) ?? registration;
          this.log('Participant pass generated', { registrationId });
        } catch (error) {
          await this.update(registrationId, { pdfStatus: 'FAILED', pdfError: describeError(error) });
          this.log('Participant pass could not be generated', { registrationId, error: describeError(error) });
          // No confirmation email without its pass; the retry makes both.
          return;
        }
      }

      // 2. The confirmation email with the pass attached (only while passes are emailed).
      if (this.passByEmail && registration.emailStatus === 'SENDING') {
        // An earlier attempt stopped while sending (this request holds the lease, so nobody
        // else is sending): the email may have gone out, so it is not sent again by itself.
        registration =
          (await this.update(
            registrationId,
            { emailStatus: 'UNKNOWN', emailError: 'The last attempt stopped while sending. Check the Sent folder before resending.' },
            { expect: { emailStatus: 'SENDING' } },
          )) ?? registration;
      }
      if (this.passByEmail && (registration.emailStatus === 'NOT_SENT' || registration.emailStatus === 'FAILED')) {
        const sending = await this.update(
          registrationId,
          { emailStatus: 'SENDING', emailAttempts: registration.emailAttempts + 1 },
          { expect: { emailStatus: registration.emailStatus }, bump: false },
        );
        if (sending) {
          try {
            pdf ??= await files.get(registration.pdfKey!);
            const message = confirmationEmail(pass());
            const messageId = await this.deps.sendMail(
              buildMime({
                fromName: this.deps.mail.fromName,
                fromAddress: this.deps.mail.sender,
                replyTo: this.deps.mail.replyTo,
                to: registration.record.participant.email,
                ...message,
                attachments: [{ filename: passFileName(registrationId), mimeType: 'application/pdf', bytes: pdf }],
              }),
            );
            await this.update(registrationId, { emailStatus: 'SENT', emailSentAt: this.iso(), emailMessageId: messageId, emailError: null });
            this.log('Confirmation email sent', { registrationId });
          } catch (error) {
            const unclear = error instanceof GoogleApiError && error.ambiguous;
            await this.update(registrationId, { emailStatus: unclear ? 'UNKNOWN' : 'FAILED', emailError: describeError(error) });
            this.log('Confirmation email not sent', { registrationId, unclear, error: describeError(error) });
          }
        }
      }

      // 3. A copy of the pass in Google Drive (for the organisers; best effort, retried later).
      registration = await store.getRegistration(registrationId);
      if (registration?.pdfStatus === 'GENERATED' && registration.pdfKey && !registration.passDriveFileId) {
        try {
          const labels = { registrationId, kind: 'pass' };
          let file: StoredFile | null = await this.deps.drive.findByProperties(labels);
          if (!file) {
            pdf ??= await files.get(registration.pdfKey);
            file = await this.deps.drive.upload({
              name: passFileName(registrationId),
              mimeType: 'application/pdf',
              bytes: pdf,
              folderId: await this.passFolderId(),
              properties: labels,
            });
          }
          await this.update(registrationId, { passDriveFileId: file.id, passDriveFileName: file.name });
        } catch (error) {
          this.log('Pass not saved to Google Drive yet', { registrationId, error: describeError(error) });
        }
      }
    } finally {
      await store.releaseLease(registrationId, leaseId).catch(() => undefined);
    }
  }

  private async passFolderId(): Promise<string> {
    if (this.deps.passFolderId) return this.deps.passFolderId;
    this.passFolder ??= (async () => {
      const saved = await this.deps.store.getSetting('passFolderId');
      if (saved) return saved;
      // "Participant Passes", next to the payment screenshots folder.
      const parent = await this.deps.drive.parentOf(this.deps.paymentFolderId);
      const id = await this.deps.drive.ensureFolder(PASS_FOLDER_NAME, parent);
      await this.deps.store.putSetting('passFolderId', id);
      return id;
    })().catch((error: unknown) => {
      this.passFolder = null;
      throw error;
    });
    return this.passFolder;
  }

  // -------------------------------------------------------------------------------------
  // Google Drive and Sheets mirror

  private sheetRow(registration: Registration): SheetRow {
    const { participant, payment } = registration.record;
    const label = (value: string, hidden: string) => (value === hidden ? '' : value);
    const eventIds = currentEventIds(registration);
    const gatePass = gatePassView(registration);
    const methodLabel = (method: string | undefined) => (method === 'CASH' ? 'Cash' : 'UPI');
    return {
      id: registration.registrationId,
      registeredAt: istOf(registration.submittedAt),
      source: sourceOf(registration) === 'ONSITE' ? 'On-site' : 'Online',
      name: participant.name,
      college: participant.college,
      department: participant.department,
      year: participant.year,
      email: participant.email,
      phone: participant.phone,
      technicalEvents: eventIds.map(eventName).join(', '),
      eventCount: eventIds.length,
      feePerEvent: this.fees.perEvent,
      eventFee: eventIds.length * this.fees.perEvent,
      amountPaid: payment.gatePassAmount,
      transactionId: payment.transactionId,
      gatePassPayment: `${GATE_PASS_LABEL[gatePass.method]} · ${gatePass.status === 'AWAITING_VERIFICATION' ? 'awaiting verification' : gatePass.status.toLowerCase()}`,
      eventFeesPaid: eventIds
        .filter((eventId) => isFeePaid(registration, eventId))
        .map((eventId) => `${eventName(eventId)} (${methodLabel(participationOf(registration, eventId).fee?.method)})`)
        .join(', '),
      attendedEvents: eventIds.filter((eventId) => isPresent(registration, eventId)).map(eventName).join(', '),
      ...this.evidenceColumns(registration),
      teams: [
        registration.teamName && `Gate: ${registration.teamName}`,
        ...eventIds.filter((eventId) => participationOf(registration, eventId).team).map((eventId) => `${eventName(eventId)}: ${participationOf(registration, eventId).team}`),
      ]
        .filter(Boolean)
        .join(' · '),
      paymentFileId: registration.paymentDriveFileId ?? '',
      paymentFileName: registration.paymentDriveFileName ?? '',
      paymentLink: registration.paymentDriveFileId ? driveLink(registration.paymentDriveFileId) : '',
      status: registration.status,
      reviewedAt: istOf(registration.approvedAt ?? registration.rejectedAt),
      reviewedBy: registration.reviewedBy ?? '',
      passStatus: label(registration.pdfStatus, 'NOT_STARTED'),
      passFileId: registration.passDriveFileId ?? '',
      passFileName: registration.passDriveFileName ?? '',
      passLink: registration.passDriveFileId ? driveLink(registration.passDriveFileId) : '',
      emailStatus: label(registration.emailStatus, 'NOT_SENT'),
      emailSentAt: istOf(registration.emailSentAt),
      emailAttempts: registration.emailAttempts || '',
      notes: [
        registration.rejectionReason && `Rejected: ${registration.rejectionReason}`,
        registration.cancelledAt && `Cancelled by ${registration.cancelledBy ?? ''} ${istOf(registration.cancelledAt)}: ${registration.cancellationReason ?? ''}`,
        registration.record.nonTechnicalEvents?.length && `Discontinued events: ${registration.record.nonTechnicalEvents.join(', ')}`,
        registration.pdfError && `Pass: ${registration.pdfError}`,
        registration.emailError && `Email: ${registration.emailError}`,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }

  /** The sheet's columns for the payment evidence, attendance and the Drive copies. */
  private evidenceColumns(registration: Registration): SheetRow {
    const [gate, ...events] = paymentRecords(registration, this.fees);
    const fee = (record: (typeof events)[number]) =>
      record.status === 'PAID'
        ? [
            record.method === 'CASH' ? 'cash' : 'UPI',
            record.approvedTransactionId && `txn ${record.approvedTransactionId}`,
            record.studentTransactionId && `(student typed ${record.studentTransactionId})`,
            record.approvedBy && `by ${record.approvedBy} ${istOf(record.approvedAt ?? undefined)}`,
          ]
            .filter(Boolean)
            .join(' ')
        : record.status === 'WAITING'
          ? `screenshot waiting${record.studentTransactionId ? ` (student typed ${record.studentTransactionId})` : ''}`
          : record.status.toLowerCase();
    return {
      gatePassStudentTxn: gate.studentTransactionId ?? '',
      gatePassStaffTxn: gate.approvedTransactionId ?? '',
      gatePassApprovedBy: gate.approvedBy ? `${gate.approvedBy} ${istOf(gate.approvedAt ?? undefined)}` : '',
      eventFeeDetails: events.map((record) => `${eventName(record.kind)}: ${fee(record)}`).join(' · '),
      attendanceDetails: currentEventIds(registration)
        .flatMap((eventId) => {
          const attendance = participationOf(registration, eventId).attendance;
          return attendance?.present ? [`${eventName(eventId)}: present (${attendance.markedBy}, ${istOf(attendance.markedAt)})`] : [];
        })
        .join(' · '),
      screenshotLinks: (registration.proofs ?? [])
        .filter((proof) => proof.driveFileId)
        .map((proof) => `${proofLabel(proof.kind, eventName)}: ${driveLink(proof.driveFileId!)}`)
        .join(' · '),
      recordLink: registration.recordFileId ? driveLink(registration.recordFileId) : '',
    };
  }

  /** "Student Records" in Drive, next to the payment screenshots: one JSON file per student. */
  private async recordFolderId(): Promise<string> {
    this.recordFolder ??= (async () => {
      const saved = await this.deps.store.getSetting('recordFolderId');
      if (saved) return saved;
      const parent = await this.deps.drive.parentOf(this.deps.paymentFolderId);
      const id = await this.deps.drive.ensureFolder(RECORD_FOLDER_NAME, parent);
      await this.deps.store.putSetting('recordFolderId', id);
      return id;
    })().catch((error: unknown) => {
      this.recordFolder = null;
      throw error;
    });
    return this.recordFolder;
  }

  /**
   * Keeps the student's copy in Google Drive complete: copies the screenshots they uploaded
   * from Student login, then writes their record file (created once, replaced after every
   * change; Drive keeps the earlier versions). Never throws: a failure is noted and retried
   * by the scheduled job. `deleted` writes the last record of a registration just deleted.
   * Returns true when the file was just created (the sheet row then gets its link).
   */
  async saveStudentRecord(registrationId: string, deleted?: { registration: Registration; deletion: Deletion }): Promise<boolean> {
    const { store, files, drive } = this.deps;
    let registration = deleted?.registration ?? (await store.getRegistration(registrationId));
    if (!registration) return false;
    try {
      // 1. The screenshots uploaded from Student login (S3 → Drive).
      const missing = deleted ? [] : (registration.proofs ?? []).filter((proof) => !proof.driveFileId);
      if (missing.length) {
        const copied = new Map<string, string>();
        for (const proof of missing) {
          const labels = { registrationId, kind: 'proof', proofId: proof.id };
          const file =
            (await drive.findByProperties(labels)) ??
            (await drive.upload({
              name: `${registrationId}_${proof.kind}_${proof.id}.${proof.key.split('.').pop()}`,
              mimeType: proof.contentType,
              bytes: await files.get(proof.key),
              folderId: this.deps.paymentFolderId,
              properties: labels,
            }));
          copied.set(proof.id, file.id);
        }
        const latest = (await store.getRegistration(registrationId)) ?? registration;
        const proofs = (latest.proofs ?? []).map((proof) => (copied.has(proof.id) ? { ...proof, driveFileId: copied.get(proof.id) } : proof));
        registration = (await store.updateRegistration(registrationId, { proofs }, { expect: { version: latest.version }, bump: false })) ?? latest;
      }

      // 2. The record file.
      const current = registration;
      const name = recordFileName(current);
      const bytes = encoder.encode(JSON.stringify(studentRecord(current, this.fees, this.iso(), deleted?.deletion ?? null), null, 2));
      const create = async () =>
        (await drive.upload({ name, mimeType: 'application/json', bytes, folderId: await this.recordFolderId(), properties: { registrationId, kind: 'record' } })).id;
      let fileId = current.recordFileId ?? (await drive.findByProperties({ registrationId, kind: 'record' }))?.id;
      let created = false;
      if (fileId) {
        try {
          await drive.replace(fileId, { name, mimeType: 'application/json', bytes });
        } catch (error) {
          // An organiser deleted the file: write it again.
          if (!(error instanceof GoogleApiError && error.status === 404)) throw error;
          fileId = await create();
          created = true;
        }
      } else {
        fileId = await create();
        created = true;
      }
      if (!deleted) await this.update(registrationId, { recordFileId: fileId, recordVersion: current.version, recordError: null, recordAttempts: 0 }, { bump: false });
      return created;
    } catch (error) {
      this.log('Student record not saved to Google Drive yet; will retry', { registrationId, error: describeError(error) });
      if (!deleted) {
        await this.update(registrationId, { recordError: describeError(error), recordAttempts: (registration.recordAttempts ?? 0) + 1 }, { bump: false }).catch(() => undefined);
      }
      return false;
    }
  }

  /**
   * Copies the payment screenshot to Drive and writes the registration's row (added once,
   * found by its ID afterwards). Never throws: a failure is recorded and retried later.
   *
   * `justCreated`: the first try right after the registration was stored, when the row cannot
   * be in the sheet yet, so the sheet is not read first (Google allows ~60 reads a minute, and
   * a registration rush should not spend them). Every later try looks before adding.
   */
  async syncToGoogle(registrationId: string, { justCreated = false }: { justCreated?: boolean } = {}): Promise<void> {
    const { store, files, drive, sheets } = this.deps;
    let registration: Registration | null = null;
    try {
      registration = await store.getRegistration(registrationId);
      if (!registration) return;

      // On-site registrations have no screenshot to copy.
      const { screenshot } = registration;
      if (screenshot && !registration.paymentDriveFileId) {
        const labels = { registrationId, kind: 'payment' };
        const file =
          (await drive.findByProperties(labels)) ??
          (await drive.upload({
            name: `${registrationId}_payment.${screenshot.key.split('.').pop()}`,
            mimeType: screenshot.contentType,
            bytes: await files.get(screenshot.key),
            folderId: this.deps.paymentFolderId,
            properties: labels,
          }));
        registration =
          (await this.update(registrationId, { paymentDriveFileId: file.id, paymentDriveFileName: file.name }, { bump: false })) ?? registration;
      }

      const row = this.sheetRow(registration);
      await sheets.ready();
      if (!registration.sheetRow && (justCreated || !(await sheets.ids()).includes(registrationId))) {
        await sheets.append(row);
      } else {
        try {
          await sheets.update(registrationId, row);
        } catch (error) {
          // An organiser deleted the row: put it back, it is still a registration.
          if (!(error instanceof RowNotFoundError)) throw error;
          await sheets.append(row);
        }
      }
      await this.update(registrationId, { sheetRow: true, sheetVersion: registration.version, syncError: null }, { bump: false });
    } catch (error) {
      this.log('Google Drive / Sheets sync failed; will retry', { registrationId, error: describeError(error) });
      await this.update(
        registrationId,
        { syncError: describeError(error), syncAttempts: (registration?.syncAttempts ?? 0) + 1 },
        { bump: false },
      ).catch(() => undefined);
    }
  }

  /**
   * The scheduled job (every few minutes): retries the Google mirror, and the pass and
   * email of approved registrations, for whatever failed before. Stops before `budgetMs`.
   * Event-day changes (fees, attendance, desk edits) reach the sheet this way, in batches.
   */
  async runScheduled(budgetMs = 20_000): Promise<{ synced: number; completed: number; recorded: number }> {
    const deadline = this.now() + budgetMs;
    // Right after the first deploy: start the ID counter while Google is reachable, so the
    // first student's registration never depends on reading the sheet.
    await this.deps.store
      .ensureCounter(() => this.highestSheetNumber())
      .catch((error: unknown) => this.log('Could not start the registration counter yet', { error: describeError(error) }));
    const lists = await Promise.all(STATUSES.map((status) => this.deps.store.listRegistrations(status)));
    const registrations = lists.flat().sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    let completed = 0;
    const toSync: string[] = [];
    const toRecord: string[] = [];
    for (const registration of registrations) {
      if (this.now() > deadline) break;
      const now = this.now();
      const leaseFree = registration.leaseUntil === undefined || registration.leaseUntil < now;
      const needsCompletion =
        registration.status === 'APPROVED' &&
        hasPass(registration) &&
        leaseFree &&
        (registration.pdfStatus !== 'GENERATED' ||
          (this.passByEmail &&
            (registration.emailStatus === 'SENDING' ||
              ((registration.emailStatus === 'FAILED' || registration.emailStatus === 'NOT_SENT') && registration.emailAttempts < MAX_AUTO_EMAIL_ATTEMPTS))) ||
          !registration.passDriveFileId);
      if (needsCompletion) {
        await this.completeApproval(registration.registrationId);
        completed += 1;
      }
      const latest = needsCompletion ? await this.deps.store.getRegistration(registration.registrationId) : registration;
      if (
        latest &&
        (latest.recordAttempts ?? 0) < MAX_AUTO_SYNC_ATTEMPTS &&
        ((latest.recordVersion ?? 0) < latest.version || !latest.recordFileId || (latest.proofs ?? []).some((proof) => !proof.driveFileId))
      ) {
        toRecord.push(latest.registrationId);
      }
      if (
        latest &&
        latest.syncAttempts < MAX_AUTO_SYNC_ATTEMPTS &&
        (!latest.sheetRow || latest.sheetVersion < latest.version || (latest.screenshot && !latest.paymentDriveFileId))
      ) {
        toSync.push(latest.registrationId);
      }
    }
    // Each student's record file in Drive (and their Student-login screenshots); a new file
    // puts its link in the sheet row.
    let recorded = 0;
    for (const registrationId of toRecord) {
      if (this.now() > deadline) break;
      if ((await this.saveStudentRecord(registrationId)) && !toSync.includes(registrationId)) toSync.push(registrationId);
      recorded += 1;
    }
    // Several at a time, so the sheet store writes their rows together.
    let synced = 0;
    for (let start = 0; start < toSync.length && this.now() <= deadline; start += SYNC_BATCH) {
      const batch = toSync.slice(start, start + SYNC_BATCH);
      await Promise.all(batch.map((registrationId) => this.syncToGoogle(registrationId)));
      synced += batch.length;
    }
    if (synced || completed || recorded) this.log('Scheduled retries', { synced, completed, recorded });
    return { synced, completed, recorded };
  }

  // -------------------------------------------------------------------------------------

  adminView(registration: Registration): AdminRegistration {
    const { record } = registration;
    const eventIds = currentEventIds(registration);
    return {
      registrationId: registration.registrationId,
      source: sourceOf(registration),
      status: registration.status,
      submittedAt: registration.submittedAt,
      approvedAt: registration.approvedAt ?? null,
      rejectedAt: registration.rejectedAt ?? null,
      reviewedBy: registration.reviewedBy ?? null,
      rejectionReason: registration.rejectionReason ?? null,
      cancelled: registration.cancelledAt
        ? { at: registration.cancelledAt, by: registration.cancelledBy ?? '', reason: registration.cancellationReason ?? '' }
        : null,
      createdBy: registration.createdBy ?? null,
      deskNumber: registration.deskNumber ?? null,
      teamName: registration.teamName ?? null,
      participant: record.participant,
      technicalEvents: eventIds.map(eventName),
      discontinuedEvents: record.nonTechnicalEvents ?? [],
      eventCount: eventIds.length,
      feePerEvent: this.fees.perEvent,
      payableAtVenue: unpaidEventFees(registration, this.fees),
      payment: { amount: record.payment.gatePassAmount, transactionId: record.payment.transactionId },
      gatePass: gatePassView(registration),
      events: eventStatusViews(registration, this.fees),
      payments: paymentRecords(registration, this.fees),
      proofs: (registration.proofs ?? []).map((proof) => ({
        id: proof.id,
        kind: proof.kind,
        label: proofLabel(proof.kind, eventName),
        transactionId: proof.transactionId,
        uploadedAt: proof.uploadedAt,
      })),
      screenshot: registration.screenshot
        ? {
            contentType: registration.screenshot.contentType,
            size: registration.screenshot.size,
            width: registration.screenshot.width,
            height: registration.screenshot.height,
          }
        : null,
      pdfStatus: registration.pdfStatus,
      pdfGeneratedAt: registration.pdfGeneratedAt ?? null,
      pdfError: registration.pdfError ?? null,
      emailStatus: registration.emailStatus,
      emailSentAt: registration.emailSentAt ?? null,
      emailError: registration.emailError ?? null,
      emailAttempts: registration.emailAttempts,
      driveLinks: {
        payment: registration.paymentDriveFileId ? driveLink(registration.paymentDriveFileId) : null,
        pass: registration.passDriveFileId ? driveLink(registration.passDriveFileId) : null,
      },
      sheet: { synced: registration.sheetRow && registration.sheetVersion >= registration.version, error: registration.syncError ?? null },
      processing: registration.leaseUntil !== undefined && registration.leaseUntil >= this.now(),
    };
  }
}
