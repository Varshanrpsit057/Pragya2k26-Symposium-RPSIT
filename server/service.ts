/**
 * The PRAGYA 2026 registration workflow.
 *
 *   student submits → screenshot checked in S3 → stored in DynamoDB as PENDING
 *     → copied to Google Drive and the Google Sheet (retried until it succeeds)
 *   admin approves → APPROVED → participant pass (PDF, private S3) → confirmation email
 *     with the pass attached (Gmail) → copy of the pass in Drive → sheet updated
 *   admin rejects  → REJECTED; no pass, no confirmation email
 *
 * Every step records its own status (pdfStatus, emailStatus, sheet sync), so a failure later
 * on never undoes an earlier step and can be retried without doing anything twice.
 */
import { randomUUID } from 'node:crypto';
import { site } from '../src/content/site';
import { formatIst, parseEventStart } from '../src/lib/countdown';
import {
  ACCEPTED_SCREENSHOT_TYPES,
  MAX_SCREENSHOT_BYTES,
  REGISTRATION_ID,
  SUBMISSION_ID,
  isRegistrationClosed,
  type Fees,
  type RegistrationErrors,
  type RegistrationSuccess,
  type StatusResult,
  type UploadTicket,
} from '../src/lib/registration';
import type { AdminRegistration } from '../src/lib/admin';
import { SESSION_HOURS, bearerToken, newSessionToken, sameText, sha256, verifyPassword } from './auth';
import { driveLink, type DriveStore, type StoredFile } from './drive';
import { confirmationEmail } from './emailTemplate';
import type { FileStore } from './files';
import { buildMime } from './gmail';
import { GoogleApiError, describeError } from './google';
import { buildPassPdf, passData, passFileName } from './pass';
import { RowNotFoundError, type SheetRow, type SheetsStore } from './sheets';
import type { AdminSession, Registration, RegistrationChanges, RegistrationStatus, Store } from './store';
import { checkScreenshot, validatePayload } from './validate';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: RegistrationErrors,
    /** Seconds the browser should wait before trying again. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export interface ServiceDeps {
  store: Store;
  files: FileStore;
  sheets: Pick<SheetsStore, 'ready' | 'ids' | 'append' | 'update'>;
  drive: Pick<DriveStore, 'upload' | 'findByProperties' | 'ensureFolder' | 'parentOf'>;
  sendMail: (mime: string) => Promise<string>;
  /** The RPSIT crest (JPEG) for the participant pass. */
  logo: Uint8Array;
  paymentFolderId: string;
  passFolderId: string | null;
  mail: { fromName: string; sender: string | null; replyTo: string | null };
  admin: { username: string; passwordHash: string };
  rateLimit: { max: number; windowMs: number };
  fees?: Fees;
  closesAt?: string | null;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

export const ID_PREFIX = 'PRG26-';
export const formatRegistrationId = (number: number) => `${ID_PREFIX}${String(number).padStart(4, '0')}`;
/** 'PRG26-0042' → 42; NaN for anything else. */
const idNumber = (id: string) => (id.startsWith(ID_PREFIX) ? Number.parseInt(id.slice(ID_PREFIX.length), 10) : Number.NaN);

const STATUSES: readonly RegistrationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
/** How long one request may hold an approval while it makes the pass and sends the email. */
const LEASE_MS = 60_000;
/** Automatic email retries (by the scheduled job) after Gmail refused clearly. */
const MAX_AUTO_EMAIL_ATTEMPTS = 5;
const MAX_AUTO_SYNC_ATTEMPTS = 50;
const LOGIN_LIMIT = { max: 10, windowMs: 15 * 60_000 };
const LOOKUP_LIMIT = { max: 120, windowMs: 10 * 60_000 };
const PASS_FOLDER_NAME = 'Participant Passes';
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

export class Service {
  private readonly fees: Fees;
  private readonly closesAt: string | null;
  private readonly now: () => number;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;
  private passFolder: Promise<string> | null = null;

  constructor(private readonly deps: ServiceDeps) {
    this.fees = deps.fees ?? { gatePass: site.registration.gatePassFee, perEvent: site.registration.eventFee };
    this.closesAt = deps.closesAt === undefined ? site.registration.closesAt : deps.closesAt;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((message, details) => console.log(JSON.stringify({ message, ...details })));
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  private async limit(key: string, { max, windowMs }: { max: number; windowMs: number }, message: string) {
    const now = this.now();
    const count = await this.deps.store.hit(key, windowMs, now);
    if (count > max) {
      throw new ApiError(429, 'RATE_LIMITED', message, undefined, Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)));
    }
  }

  private ensureOpen() {
    if (!isRegistrationClosed(this.closesAt, this.now())) return;
    const end = this.closesAt ? parseEventStart(this.closesAt) : null;
    throw new ApiError(403, 'REGISTRATION_CLOSED', `Online registration for ${site.name} ${site.year} closed${end ? ` on ${formatIst(end)}` : ''}.`);
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

  /** The highest Registration ID already in the sheet, so the counter never reuses one. */
  private async highestSheetNumber(): Promise<number> {
    const numbers = (await this.deps.sheets.ids()).map(idNumber).filter(Number.isFinite);
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

  async status(body: unknown, ip: string): Promise<StatusResult> {
    const registration = await this.ownRegistration(body, ip);
    return {
      success: true,
      registrationId: registration.registrationId,
      status: registration.status,
      registeredAt: registration.submittedAt,
      passAvailable: registration.status === 'APPROVED' && registration.pdfStatus === 'GENERATED',
      ...(registration.status === 'REJECTED' && registration.rejectionReason && { reason: registration.rejectionReason }),
    };
  }

  /** A one-minute download link for the participant's own pass, only once it is approved. */
  async pass(body: unknown, ip: string): Promise<{ success: true; url: string }> {
    const registration = await this.ownRegistration(body, ip);
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
  // Admin sign-in

  async login(body: unknown, ip: string): Promise<{ success: true; token: string; username: string; expiresAt: string }> {
    await this.limit(`login:${ip}`, LOGIN_LIMIT, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
    const username = field(body, 'username', 100).trim();
    const password = field(body, 'password', 200);
    // Both checks always run, so a wrong username takes as long as a wrong password.
    const [userMatches, passwordMatches] = [
      sameText(username, this.deps.admin.username),
      await verifyPassword(password, this.deps.admin.passwordHash),
    ];
    if (!userMatches || !passwordMatches) {
      this.log('Admin sign-in failed', { ip });
      throw new ApiError(401, 'INVALID_LOGIN', 'Incorrect username or password.');
    }
    const token = newSessionToken();
    const now = this.now();
    const expiresAt = now + SESSION_HOURS * 3_600_000;
    await this.deps.store.putSession(sha256(token), {
      username: this.deps.admin.username,
      credential: this.credential(),
      createdAt: now,
      expiresAt,
    });
    this.log('Admin signed in', { ip });
    return { success: true, token, username: this.deps.admin.username, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Changes whenever the admin username or password changes. */
  private credential() {
    return sha256(`${this.deps.admin.username}\n${this.deps.admin.passwordHash}`);
  }

  /** The signed-in admin for an Authorization header; throws 401 for anything else. */
  async authenticate(authorization: string | undefined): Promise<AdminSession> {
    const token = bearerToken(authorization);
    const session = token ? await this.deps.store.getSession(sha256(token)) : null;
    // A new admin username or password signs everyone out.
    if (!session || session.expiresAt <= this.now() || !sameText(session.credential, this.credential())) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.');
    }
    return session;
  }

  async logout(authorization: string | undefined): Promise<{ success: true }> {
    const token = bearerToken(authorization);
    if (token) await this.deps.store.deleteSession(sha256(token));
    return { success: true };
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
    const registration = REGISTRATION_ID.test(registrationId) ? await this.deps.store.getRegistration(registrationId) : null;
    if (!registration) throw new ApiError(404, 'NOT_FOUND', 'Registration not found.');
    return registration;
  }

  private async view(registrationId: string) {
    return { success: true as const, registration: this.adminView(await this.required(registrationId)) };
  }

  /** A five-minute link to the payment screenshot, for checking the payment. */
  async adminScreenshot(registrationId: string): Promise<{ success: true; url: string }> {
    const registration = await this.required(registrationId);
    return { success: true, url: await this.deps.files.signedUrl(registration.screenshot.key, { expiresInSeconds: 300 }) };
  }

  async adminPass(registrationId: string): Promise<{ success: true; url: string }> {
    const registration = await this.required(registrationId);
    if (registration.pdfStatus !== 'GENERATED' || !registration.pdfKey) {
      throw new ApiError(409, 'PASS_NOT_READY', 'There is no participant pass for this registration yet.');
    }
    const url = await this.deps.files.signedUrl(registration.pdfKey, {
      expiresInSeconds: 300,
      downloadName: passFileName(registrationId),
    });
    return { success: true, url };
  }

  /**
   * PENDING → APPROVED, then the pass and the confirmation email. Approving again (a double
   * click, a retry) never makes a second pass or email: it only finishes a step that failed.
   */
  async approve(registrationId: string, admin: AdminSession) {
    const registration = await this.required(registrationId);
    if (registration.status === 'REJECTED') {
      throw new ApiError(409, 'ALREADY_REJECTED', 'This registration was rejected, so it cannot be approved.');
    }
    if (registration.status === 'PENDING') {
      const approved = await this.deps.store.updateRegistration(
        registrationId,
        { status: 'APPROVED', approvedAt: this.iso(), reviewedBy: admin.username },
        { expect: { status: 'PENDING' } },
      );
      if (approved) this.log('Registration approved', { registrationId, by: admin.username });
      else if ((await this.required(registrationId)).status === 'REJECTED') {
        throw new ApiError(409, 'ALREADY_REJECTED', 'This registration was rejected, so it cannot be approved.');
      }
    }
    await this.completeApproval(registrationId);
    await this.syncToGoogle(registrationId);
    return this.view(registrationId);
  }

  /** PENDING → REJECTED: no pass and no confirmation email, ever. */
  async reject(registrationId: string, admin: AdminSession, body: unknown) {
    // Control characters (line breaks included) become spaces: the reason is one line in the sheet.
    const reason = field(body, 'reason', 300).replace(/\p{Cc}+/gu, ' ').trim();
    const registration = await this.required(registrationId);
    if (registration.status === 'APPROVED') {
      throw new ApiError(409, 'ALREADY_APPROVED', 'This registration is already approved, so it cannot be rejected.');
    }
    if (registration.status === 'PENDING') {
      const rejected = await this.deps.store.updateRegistration(
        registrationId,
        { status: 'REJECTED', rejectedAt: this.iso(), reviewedBy: admin.username, rejectionReason: reason || null },
        { expect: { status: 'PENDING' } },
      );
      if (rejected) {
        this.log('Registration rejected', { registrationId, by: admin.username });
        // The student may register again with the same email (e.g. with a correct payment);
        // the rejected transaction ID stays used.
        await this.deps.store.releaseClaim('email', registration.emailKey, registrationId);
      } else if ((await this.required(registrationId)).status === 'APPROVED') {
        throw new ApiError(409, 'ALREADY_APPROVED', 'This registration is already approved, so it cannot be rejected.');
      }
    }
    await this.syncToGoogle(registrationId);
    return this.view(registrationId);
  }

  /**
   * Finishes what failed for an approved registration (pass, email, Drive, sheet). An email
   * whose delivery is UNKNOWN is resent only when the admin confirms it (resendEmail).
   */
  async retry(registrationId: string, admin: AdminSession, body: unknown) {
    const registration = await this.required(registrationId);
    if (registration.status === 'APPROVED') {
      if (isObject(body) && body.resendEmail === true && registration.emailStatus === 'UNKNOWN') {
        await this.deps.store.updateRegistration(
          registrationId,
          { emailStatus: 'FAILED', emailError: `Resend confirmed by ${admin.username}` },
          { expect: { emailStatus: 'UNKNOWN' } },
        );
      }
      await this.completeApproval(registrationId);
    }
    await this.syncToGoogle(registrationId);
    return this.view(registrationId);
  }

  private async update(registrationId: string, changes: RegistrationChanges, options?: Parameters<Store['updateRegistration']>[2]) {
    return this.deps.store.updateRegistration(registrationId, changes, options);
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
      if (!registration || registration.status !== 'APPROVED') return;
      const pass = () =>
        passData({
          registrationId,
          registeredAt: registration!.submittedAt,
          record: registration!.record,
          eventIds: registration!.eventIds,
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

      // 2. The confirmation email with the pass attached.
      if (registration.emailStatus === 'SENDING') {
        // An earlier attempt stopped while sending (this request holds the lease, so nobody
        // else is sending): the email may have gone out, so it is not sent again by itself.
        registration =
          (await this.update(
            registrationId,
            { emailStatus: 'UNKNOWN', emailError: 'The last attempt stopped while sending. Check the Sent folder before resending.' },
            { expect: { emailStatus: 'SENDING' } },
          )) ?? registration;
      }
      if (registration.emailStatus === 'NOT_SENT' || registration.emailStatus === 'FAILED') {
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
    const { participant, technicalEvents, nonTechnicalEvents, payment, eventRegistration } = registration.record;
    const label = (value: string, hidden: string) => (value === hidden ? '' : value);
    return {
      id: registration.registrationId,
      registeredAt: istOf(registration.submittedAt),
      name: participant.name,
      college: participant.college,
      department: participant.department,
      year: participant.year,
      email: participant.email,
      phone: participant.phone,
      technicalEvents: technicalEvents.join(', '),
      nonTechnicalEvents: nonTechnicalEvents.join(', '),
      eventCount: eventRegistration.eventCount,
      feePerEvent: eventRegistration.feePerEvent,
      eventFee: eventRegistration.totalEventFee,
      amountPaid: payment.gatePassAmount,
      transactionId: payment.transactionId,
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
        registration.pdfError && `Pass: ${registration.pdfError}`,
        registration.emailError && `Email: ${registration.emailError}`,
      ]
        .filter(Boolean)
        .join(' · '),
    };
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

      if (!registration.paymentDriveFileId) {
        const labels = { registrationId, kind: 'payment' };
        const file =
          (await drive.findByProperties(labels)) ??
          (await drive.upload({
            name: `${registrationId}_payment.${registration.screenshot.key.split('.').pop()}`,
            mimeType: registration.screenshot.contentType,
            bytes: await files.get(registration.screenshot.key),
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
   */
  async runScheduled(budgetMs = 20_000): Promise<{ synced: number; completed: number }> {
    const deadline = this.now() + budgetMs;
    // Right after the first deploy: start the ID counter while Google is reachable, so the
    // first student's registration never depends on reading the sheet.
    await this.deps.store
      .ensureCounter(() => this.highestSheetNumber())
      .catch((error: unknown) => this.log('Could not start the registration counter yet', { error: describeError(error) }));
    const lists = await Promise.all(STATUSES.map((status) => this.deps.store.listRegistrations(status)));
    const registrations = lists.flat().sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    let synced = 0;
    let completed = 0;
    for (const registration of registrations) {
      if (this.now() > deadline) break;
      const now = this.now();
      const leaseFree = registration.leaseUntil === undefined || registration.leaseUntil < now;
      const needsCompletion =
        registration.status === 'APPROVED' &&
        leaseFree &&
        (registration.pdfStatus !== 'GENERATED' ||
          registration.emailStatus === 'SENDING' ||
          ((registration.emailStatus === 'FAILED' || registration.emailStatus === 'NOT_SENT') &&
            registration.emailAttempts < MAX_AUTO_EMAIL_ATTEMPTS) ||
          !registration.passDriveFileId);
      if (needsCompletion) {
        await this.completeApproval(registration.registrationId);
        completed += 1;
      }
      const latest = needsCompletion ? await this.deps.store.getRegistration(registration.registrationId) : registration;
      if (
        latest &&
        latest.syncAttempts < MAX_AUTO_SYNC_ATTEMPTS &&
        (!latest.sheetRow || latest.sheetVersion < latest.version || !latest.paymentDriveFileId)
      ) {
        await this.syncToGoogle(latest.registrationId);
        synced += 1;
      }
    }
    if (synced || completed) this.log('Scheduled retries', { synced, completed });
    return { synced, completed };
  }

  // -------------------------------------------------------------------------------------

  adminView(registration: Registration): AdminRegistration {
    const { record } = registration;
    return {
      registrationId: registration.registrationId,
      status: registration.status,
      submittedAt: registration.submittedAt,
      approvedAt: registration.approvedAt ?? null,
      rejectedAt: registration.rejectedAt ?? null,
      reviewedBy: registration.reviewedBy ?? null,
      rejectionReason: registration.rejectionReason ?? null,
      participant: record.participant,
      technicalEvents: record.technicalEvents,
      nonTechnicalEvents: record.nonTechnicalEvents,
      eventCount: record.eventRegistration.eventCount,
      feePerEvent: record.eventRegistration.feePerEvent,
      payableAtVenue: record.eventRegistration.totalEventFee,
      payment: { amount: record.payment.gatePassAmount, transactionId: record.payment.transactionId },
      screenshot: {
        contentType: registration.screenshot.contentType,
        size: registration.screenshot.size,
        width: registration.screenshot.width,
        height: registration.screenshot.height,
      },
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
