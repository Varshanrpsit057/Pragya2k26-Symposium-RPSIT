/**
 * The registration desk: every registration passes through this one place (a single
 * Cloudflare Durable Object), so Registration IDs are handed out one at a time and two
 * people can never receive the same one.
 *
 *   validate → reserve (duplicates, idempotency) → queue (3 at a time)
 *     → Drive: payment screenshot → Sheets: the registration row (batched)
 *     → SUCCESS only when both are confirmed by Google
 *     → outbox: participant pass (PDF → Drive) and confirmation email (Gmail),
 *       sent in the background with retries, never holding up the participant
 */
import { eventCatalog } from '../src/content/eventCatalog';
import { site } from '../src/content/site';
import { formatIst, parseEventStart } from '../src/lib/countdown';
import { buildPassPdf, passData, passFileName } from '../src/lib/pass';
import {
  isRegistrationClosed,
  type Fees,
  type RegistrationErrors,
  type RegistrationRecord,
  type RegistrationSuccess,
} from '../src/lib/registration';
import { driveLink, type DriveStore, type StoredFile } from './drive';
import { confirmationEmail } from './emailTemplate';
import { buildMime } from './gmail';
import { GoogleApiError, describeError } from './google';
import { RowNotFoundError, type SheetRow, type SheetsStore, type StoredRow } from './sheets';
import { validatePayload, type ValidRegistration } from './validate';

/** The part of Durable Object storage the desk uses: a counter and the outbox. */
export interface DeskStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface DeskDeps {
  sheets: Pick<SheetsStore, 'load' | 'append' | 'update'>;
  drive: Pick<DriveStore, 'upload' | 'trash' | 'ensureFolder' | 'parentOf'>;
  sendMail: (mime: string) => Promise<string>;
  storage: DeskStorage;
  /** The RPSIT crest (JPEG) for the participant pass. */
  logo: Uint8Array;
  paymentFolderId: string;
  passFolderId: string | null;
  mail: { fromName: string; sender: string | null; replyTo: string | null };
  workers: number;
  rateLimit: { max: number; windowMs: number };
  fees?: Fees;
  closesAt?: string | null;
  /** Registrations allowed to wait in line, and their total screenshot size. */
  queueLimit?: number;
  queueBytes?: number;
  now?: () => number;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

type DeliveryStatus = 'PENDING' | 'SAVED' | 'SENT' | 'FAILED';

/** A registration whose pass and email are still to go out. Removed once the sheet shows both done. */
export interface OutboxItem {
  registrationId: string;
  registeredAt: string;
  record: RegistrationRecord;
  eventIds: string[];
  pass: { status: Extract<DeliveryStatus, 'PENDING' | 'SAVED' | 'FAILED'>; fileId?: string; fileName?: string };
  email: { status: Extract<DeliveryStatus, 'PENDING' | 'SENT' | 'FAILED'>; sentAt?: string; attempts: number };
  /** Delivery rounds so far. */
  attempts: number;
  nextAttemptAt: number;
  note?: string;
}

interface Entry {
  emailKey: string;
  transactionKey: string;
  submissionId: string;
  status: 'processing' | 'success';
  registrationId?: string;
  registeredAt?: string;
  pending?: Promise<RegistrationSuccess>;
  /** When Google confirmed the row (this server's clock). */
  confirmedAt?: number;
}

export class DeskError extends Error {
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

export const ID_PREFIX = 'PRG26-';
/** Waits between delivery rounds: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h; then it gives up. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000];
const MAX_ROUNDS = RETRY_DELAYS_MS.length + 1;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PASS_FOLDER_NAME = 'Participant Passes';
/**
 * Organisers edit the sheet by hand, so before a registration the server re-reads it when its
 * copy is older than this. Everyone registering within these seconds shares one read.
 */
const FRESH_FOR_MS = 10_000;

export const formatRegistrationId = (number: number) => `${ID_PREFIX}${String(number).padStart(4, '0')}`;

/** 'PRG26-0042' → 42; NaN for anything else. */
const idNumber = (id: string) => (id.startsWith(ID_PREFIX) ? Number.parseInt(id.slice(ID_PREFIX.length), 10) : Number.NaN);

/** Runs `task` for every item, at most `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** '2026-10-06 19:35:12' in IST, for the sheet. */
export function istStamp(ms: number): string {
  return new Date(ms + 5.5 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

/** The reverse of istStamp, as ISO 8601. */
function istStampToIso(stamp: string): string {
  const ms = Date.parse(`${stamp.replace(' ', 'T')}+05:30`);
  return Number.isNaN(ms) ? new Date(0).toISOString() : new Date(ms).toISOString();
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export class Desk {
  private loaded = false;
  private loading: Promise<void> | null = null;
  /** Why the sheet could not be loaded last time; null once it is (or before trying). */
  private loadError: string | null = null;
  /** When the duplicate checks were last rebuilt from the sheet. */
  private syncedAt = 0;
  private syncing: Promise<void> | null = null;
  /** Registration numbers handed out here → when their row was written (null: still being saved). */
  private readonly issued = new Map<number, number | null>();
  private nextNumber = 1;
  private readonly byEmail = new Map<string, Entry>();
  private readonly byTransaction = new Map<string, Entry>();
  private readonly bySubmission = new Map<string, Entry>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private queuedBytes = 0;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private passFolder: Promise<string> | null = null;
  private delivering: Promise<void> | null = null;

  private readonly fees: Fees;
  private readonly closesAt: string | null;
  private readonly queueLimit: number;
  private readonly queueBytes: number;
  private readonly now: () => number;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;

  constructor(private readonly deps: DeskDeps) {
    this.fees = deps.fees ?? { gatePass: site.registration.gatePassFee, perEvent: site.registration.eventFee };
    this.closesAt = deps.closesAt === undefined ? site.registration.closesAt : deps.closesAt;
    this.queueLimit = deps.queueLimit ?? 200;
    // Durable Objects have 128 MB of memory; queued screenshots stay well below that.
    this.queueBytes = deps.queueBytes ?? 48 * 1024 * 1024;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((message, details) => console.log(JSON.stringify({ message, ...details })));
  }

  // -------------------------------------------------------------------------------------
  // HTTP

  async handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      const status = this.loaded ? 'ready' : this.loadError ? 'unavailable' : 'starting';
      return json(200, { status, active: this.active, waiting: this.waiting.length });
    }
    if (pathname !== '/register' || request.method !== 'POST') {
      return json(404, { success: false, error: 'Not found.' });
    }

    try {
      this.limitRate(request.headers.get('x-client-ip') || 'unknown');
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        throw new DeskError(413, 'TOO_LARGE', 'The upload is too large. Please use a screenshot of 5 MB or less.');
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new DeskError(400, 'INVALID', 'The registration could not be read. Please refresh the page and try again.');
      }
      return json(200, await this.register(body));
    } catch (error) {
      if (error instanceof DeskError) {
        return json(
          error.status,
          { success: false, error: error.message, code: error.code, ...(error.fieldErrors && { fieldErrors: error.fieldErrors }) },
          error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {},
        );
      }
      this.log('Unexpected registration error', { error: describeError(error) });
      return json(500, {
        success: false,
        code: 'INTERNAL',
        error: 'Something went wrong on our side and your registration was not completed. Please try again in a minute.',
      });
    }
  }

  private limitRate(ip: string) {
    const now = this.now();
    if (this.hits.size > 5_000) for (const [key, hit] of this.hits) if (hit.resetAt <= now) this.hits.delete(key);
    let hit = this.hits.get(ip);
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + this.deps.rateLimit.windowMs };
      this.hits.set(ip, hit);
    }
    hit.count += 1;
    if (hit.count > this.deps.rateLimit.max) {
      throw new DeskError(
        429,
        'RATE_LIMITED',
        'Too many registration attempts from your network. Please wait a few minutes and try again.',
        undefined,
        Math.ceil((hit.resetAt - now) / 1000),
      );
    }
  }

  // -------------------------------------------------------------------------------------
  // Start-up: the sheet is the source of truth

  private async ensureLoaded() {
    if (this.loaded) return;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    try {
      await this.loading;
      this.loadError = null;
    } catch (error) {
      this.loadError = describeError(error);
      this.log('Could not load the registration sheet', { error: this.loadError });
      throw new DeskError(503, 'NOT_READY', 'Registration is temporarily unavailable. Please try again in a minute.', undefined, 30);
    }
  }

  /**
   * Connects to the sheet straight away (on server start), so the first student does not
   * wait for it and a broken Google sign-in shows up in the log at once. Never throws:
   * on failure, the next registration simply tries again.
   */
  async warmUp(): Promise<{ ok: true; registrations: number } | { ok: false; error: string }> {
    try {
      await this.ensureLoaded();
      return { ok: true, registrations: this.byEmail.size };
    } catch {
      return { ok: false, error: this.loadError ?? 'Unknown error' };
    }
  }

  private async load() {
    const rows = await this.indexSheet();
    await this.restoreOutbox(rows);
    this.loaded = true;
  }

  /**
   * Rebuilds the duplicate checks and the next Registration ID from the sheet, which is the
   * source of truth: a row an organiser deletes frees that email, transaction ID and number;
   * a row typed in by hand counts.
   */
  private async indexSheet(): Promise<StoredRow[]> {
    const startedAt = this.now();
    const rows = await this.deps.sheets.load();
    // What the sheet cannot show yet: registrations being saved, or confirmed after this read began.
    const recent = [...new Set([...this.byEmail.values(), ...this.byTransaction.values(), ...this.bySubmission.values()])].filter(
      (entry) => entry.status === 'processing' || (entry.confirmedAt ?? -1) >= startedAt,
    );
    this.byEmail.clear();
    this.byTransaction.clear();
    this.bySubmission.clear();

    let highest = 0;
    for (const row of rows) {
      const number = idNumber(row.id);
      if (Number.isFinite(number)) highest = Math.max(highest, number);
      if (row.status !== 'SUCCESS') continue;
      this.index({
        emailKey: row.email.toLowerCase(),
        transactionKey: row.transactionId.toUpperCase(),
        submissionId: row.submissionId,
        status: 'success',
        registrationId: row.id,
        registeredAt: istStampToIso(row.registeredAt),
      });
    }
    for (const entry of recent) this.index(entry);

    // Numbers the sheet cannot show yet are never handed out twice: rows still being saved
    // (or written after this read began), and registrations whose email is still to go out.
    for (const [number, writtenAt] of this.issued) {
      if (writtenAt === null || writtenAt >= startedAt) highest = Math.max(highest, number);
      else this.issued.delete(number);
    }
    for (const key of (await this.deps.storage.list<OutboxItem>({ prefix: 'outbox:' })).keys()) {
      const number = idNumber(key.slice('outbox:'.length));
      if (Number.isFinite(number)) highest = Math.max(highest, number);
    }
    this.nextNumber = highest + 1;
    this.syncedAt = this.now();
    return rows;
  }

  /** Re-reads the sheet (one read at a time, shared by everyone waiting for it). */
  private resync(): Promise<void> {
    this.syncing ??= this.indexSheet()
      .then(() => undefined)
      .finally(() => {
        this.syncing = null;
      });
    return this.syncing;
  }

  /** Rows still waiting for their pass or email (e.g. after a redeploy) go back in the outbox. */
  private async restoreOutbox(rows: StoredRow[]) {
    const outbox = await this.deps.storage.list<OutboxItem>({ prefix: 'outbox:' });
    let restored = 0;
    const waiting = ['PENDING', 'FAILED'];
    for (const row of rows) {
      if (row.status !== 'SUCCESS' || outbox.has(`outbox:${row.id}`)) continue;
      // Only rows this server marked as waiting; never rows typed in by hand.
      if (!waiting.includes(row.emailStatus) && !waiting.includes(row.passStatus)) continue;
      const emailDone = row.emailStatus === 'SENT';
      const passDone = row.passStatus === 'SAVED';
      const attempts = Number.parseInt(row.emailAttempts, 10) || 0;
      if ((emailDone && passDone) || attempts >= MAX_ROUNDS) continue;
      const item = this.outboxFromRow(row, emailDone, passDone, attempts);
      if (!item) continue;
      await this.deps.storage.put(`outbox:${row.id}`, item);
      restored += 1;
    }
    if (restored || outbox.size) await this.scheduleDelivery(this.now());
  }

  private outboxFromRow(row: StoredRow, emailDone: boolean, passDone: boolean, attempts: number): OutboxItem | null {
    const names = [row.technicalEvents, row.nonTechnicalEvents].flatMap((list) => list.split(',').map((name) => name.trim()));
    const eventIds = eventCatalog.filter((event) => names.includes(event.name)).map((event) => event.id);
    if (!row.email || eventIds.length === 0) return null;
    const feePerEvent = Number(row.feePerEvent) || this.fees.perEvent;
    return {
      registrationId: row.id,
      registeredAt: istStampToIso(row.registeredAt),
      eventIds,
      record: {
        participant: {
          name: row.name,
          department: row.department,
          college: row.college,
          year: row.year,
          phone: row.phone,
          email: row.email,
        },
        technicalEvents: eventCatalog.filter((e) => eventIds.includes(e.id) && e.category === 'technical').map((e) => e.name),
        nonTechnicalEvents: eventCatalog.filter((e) => eventIds.includes(e.id) && e.category === 'non-technical').map((e) => e.name),
        payment: { gatePassAmount: Number(row.amountPaid) || this.fees.gatePass, transactionId: row.transactionId },
        eventRegistration: { eventCount: eventIds.length, feePerEvent, totalEventFee: eventIds.length * feePerEvent },
      },
      pass: passDone ? { status: 'SAVED', fileId: row.passFileId, fileName: row.passFileName } : { status: 'PENDING' },
      email: emailDone ? { status: 'SENT', attempts } : { status: 'PENDING', attempts },
      attempts,
      nextAttemptAt: this.now(),
    };
  }

  private index(entry: Entry) {
    this.byEmail.set(entry.emailKey, entry);
    this.byTransaction.set(entry.transactionKey, entry);
    if (entry.submissionId) this.bySubmission.set(entry.submissionId, entry);
  }

  private unindex(entry: Entry) {
    if (this.byEmail.get(entry.emailKey) === entry) this.byEmail.delete(entry.emailKey);
    if (this.byTransaction.get(entry.transactionKey) === entry) this.byTransaction.delete(entry.transactionKey);
    if (this.bySubmission.get(entry.submissionId) === entry) this.bySubmission.delete(entry.submissionId);
  }

  // -------------------------------------------------------------------------------------
  // Registration

  async register(body: unknown): Promise<RegistrationSuccess> {
    await this.ensureLoaded();

    if (isRegistrationClosed(this.closesAt, this.now())) {
      const end = this.closesAt ? parseEventStart(this.closesAt) : null;
      throw new DeskError(
        403,
        'REGISTRATION_CLOSED',
        `Online registration for ${site.name} ${site.year} closed${end ? ` on ${formatIst(end)}` : ''}.`,
      );
    }

    const checked = validatePayload(body, this.fees);
    if (!checked.ok) throw new DeskError(400, 'INVALID', checked.error, checked.fieldErrors);
    const registration = checked.value;

    // The sheet decides who is registered and which number comes next, and organisers edit
    // it by hand: catch up with it first. If Google cannot be reached, what is known counts.
    if (this.now() - this.syncedAt > FRESH_FOR_MS) {
      await this.resync().catch((error: unknown) => this.log('Could not re-read the registration sheet', { error: describeError(error) }));
    }

    // The same form sent again (a retry after a timeout): the first result, never a second registration.
    const replay = this.bySubmission.get(registration.submissionId);
    if (replay) {
      if (replay.pending) return replay.pending;
      return this.successOf(replay, false);
    }

    const sameEmail = this.byEmail.get(registration.emailKey);
    const sameTransaction = this.byTransaction.get(registration.transactionKey);
    if (sameEmail && sameEmail === sameTransaction && sameEmail.status === 'success') {
      return this.successOf(sameEmail, true);
    }
    if (sameEmail?.status === 'processing' || sameTransaction?.status === 'processing') {
      throw new DeskError(
        409,
        'IN_PROGRESS',
        'A registration with these details is being saved right now. Please wait a minute, then check your email.',
      );
    }
    if (sameTransaction) {
      const message = 'This transaction ID has already been used for a registration. Each participant needs their own gate pass payment.';
      throw new DeskError(409, 'DUPLICATE_TRANSACTION', message, { transactionId: message });
    }
    if (sameEmail) {
      const message = `This email address is already registered for ${site.name} ${site.year}. Check your inbox for the confirmation email, or contact the organisers.`;
      throw new DeskError(409, 'DUPLICATE_EMAIL', message, { email: message });
    }

    const entry: Entry = {
      emailKey: registration.emailKey,
      transactionKey: registration.transactionKey,
      submissionId: registration.submissionId,
      status: 'processing',
    };
    this.index(entry);
    entry.pending = this.inQueue(registration.image.bytes.length, () => this.store(registration, entry)).then(
      (result) => {
        entry.pending = undefined;
        return result;
      },
      (error: unknown) => {
        this.unindex(entry);
        throw error;
      },
    );
    return entry.pending;
  }

  private successOf(entry: Entry, duplicate: boolean): RegistrationSuccess {
    return {
      success: true,
      registrationId: entry.registrationId!,
      registeredAt: entry.registeredAt!,
      emailStatus: 'PENDING',
      ...(duplicate && { duplicate: true }),
    };
  }

  /** Runs `task` when one of the workers is free; refuses new work when the line is full. */
  private async inQueue<T>(bytes: number, task: () => Promise<T>): Promise<T> {
    if (this.waiting.length >= this.queueLimit || this.queuedBytes + bytes > this.queueBytes) {
      throw new DeskError(503, 'BUSY', "We're receiving a lot of registrations right now. Please try again in a minute.", undefined, 10);
    }
    this.queuedBytes += bytes;
    try {
      if (this.active < this.deps.workers) this.active += 1;
      else await new Promise<void>((resolve) => this.waiting.push(resolve));
      try {
        return await task();
      } finally {
        // Hand the slot straight to the next in line, so no more than `workers` ever run.
        const next = this.waiting.shift();
        if (next) next();
        else this.active -= 1;
      }
    } finally {
      this.queuedBytes -= bytes;
    }
  }

  private row(
    registration: ValidRegistration,
    registrationId: string,
    registeredAt: number,
    outcome: { status: 'SUCCESS' | 'FAILED'; file?: StoredFile; note?: string },
  ): SheetRow {
    const { participant, technicalEvents, nonTechnicalEvents, payment, eventRegistration } = registration.record;
    const success = outcome.status === 'SUCCESS';
    return {
      id: registrationId,
      registeredAt: istStamp(registeredAt),
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
      paymentFileId: outcome.file?.id ?? '',
      paymentFileName: outcome.file?.name ?? '',
      paymentLink: outcome.file ? driveLink(outcome.file.id) : '',
      status: outcome.status,
      passStatus: success ? 'PENDING' : '',
      emailStatus: success ? 'PENDING' : '',
      emailAttempts: success ? 0 : '',
      submissionId: registration.submissionId,
      notes: outcome.note ?? '',
    };
  }

  /** Drive, then Sheets; the registration counts only when Google has confirmed both. */
  private async store(registration: ValidRegistration, entry: Entry): Promise<RegistrationSuccess> {
    // One at a time, in memory: no two registrations share an ID. The number counts as taken
    // until its row is in the sheet, where the next read of the sheet sees it.
    const number = this.nextNumber;
    this.nextNumber += 1;
    this.issued.set(number, null);
    const written = () => this.issued.set(number, this.now());
    const registrationId = formatRegistrationId(number);
    const registeredAt = this.now();

    let file: StoredFile;
    try {
      file = await this.deps.drive.upload({
        name: `${registrationId}_payment.${registration.image.extension}`,
        mimeType: registration.image.type,
        bytes: registration.image.bytes,
        folderId: this.deps.paymentFolderId,
        properties: { registrationId },
      });
    } catch (error) {
      this.log('Payment screenshot upload failed', { registrationId, error: describeError(error) });
      // Kept in the sheet as FAILED for the organisers; the participant is asked to try again.
      this.deps.sheets
        .append(this.row(registration, registrationId, registeredAt, { status: 'FAILED', note: `Screenshot upload failed: ${describeError(error)}` }))
        .catch(() => undefined)
        .finally(written);
      throw new DeskError(
        502,
        'STORAGE_FAILED',
        "We couldn't save your payment screenshot right now, so your registration was not completed. Please try again in a few minutes.",
      );
    }

    try {
      await this.deps.sheets.append(this.row(registration, registrationId, registeredAt, { status: 'SUCCESS', file }));
      written();
    } catch (error) {
      written();
      this.log('Saving the registration row failed', { registrationId, error: describeError(error) });
      if (error instanceof GoogleApiError && error.ambiguous) {
        // Google's answer was lost, so the row may well be in the sheet: keep its screenshot.
        // If the row is there, the next start-up sends its pass and email (it says PENDING).
        this.log('Registration row may have been saved; screenshot kept for the organisers', { registrationId, fileId: file.id });
      } else {
        // Without its row the screenshot belongs to no one: move it to the Drive trash.
        await this.deps.drive.trash(file.id).catch((trashError: unknown) =>
          this.log('Could not remove an unused screenshot', { registrationId, fileId: file.id, error: describeError(trashError) }),
        );
      }
      throw new DeskError(
        502,
        'STORAGE_FAILED',
        "We couldn't save your registration right now, so it was not completed. Please try again in a few minutes.",
      );
    }

    entry.status = 'success';
    entry.registrationId = registrationId;
    entry.registeredAt = new Date(registeredAt).toISOString();
    entry.confirmedAt = this.now();
    this.log('Registration stored', { registrationId });

    // The pass and the email follow in the background; the participant is not kept waiting.
    try {
      await this.deps.storage.put<OutboxItem>(`outbox:${registrationId}`, {
        registrationId,
        registeredAt: entry.registeredAt,
        record: registration.record,
        eventIds: registration.eventIds,
        pass: { status: 'PENDING' },
        email: { status: 'PENDING', attempts: 0 },
        attempts: 0,
        nextAttemptAt: registeredAt,
      });
      await this.scheduleDelivery(this.now());
    } catch (error) {
      // The row says PENDING, so the next start-up puts it back in the outbox.
      this.log('Could not queue the confirmation email', { registrationId, error: describeError(error) });
    }

    return this.successOf(entry, false);
  }

  // -------------------------------------------------------------------------------------
  // Outbox: participant pass and confirmation email

  private async scheduleDelivery(at: number) {
    const current = await this.deps.storage.getAlarm();
    if (current === null || current > at) await this.deps.storage.setAlarm(at);
  }

  /** Runs on the Durable Object alarm: delivers what is due, then sets the next alarm. */
  async alarm(): Promise<void> {
    this.delivering ??= this.deliverDue().finally(() => {
      this.delivering = null;
    });
    return this.delivering;
  }

  private async deliverDue() {
    try {
      await this.ensureLoaded();
    } catch {
      await this.deps.storage.setAlarm(this.now() + 60_000);
      return;
    }
    const outbox = await this.deps.storage.list<OutboxItem>({ prefix: 'outbox:' });
    const due = [...outbox.values()]
      .filter((item) => item.nextAttemptAt <= this.now())
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      // A handful per alarm keeps each run short, so a new registration's email is not
      // stuck behind a long run; the next alarm continues straight away.
      .slice(0, this.deps.workers * 2);

    // Side by side, as many at once as registrations are stored, so in a busy minute the
    // last student does not wait for everyone else's email.
    await eachLimited(due, this.deps.workers, async (item) => {
      try {
        await this.deliver(item);
      } catch (error) {
        this.log('Delivery round failed', { registrationId: item.registrationId, error: describeError(error) });
        await this.deps.storage.put<OutboxItem>(`outbox:${item.registrationId}`, { ...item, nextAttemptAt: this.now() + 60_000 });
      }
    });

    const remaining = [...(await this.deps.storage.list<OutboxItem>({ prefix: 'outbox:' })).values()];
    if (remaining.length) {
      const next = Math.min(...remaining.map((item) => item.nextAttemptAt));
      await this.deps.storage.setAlarm(Math.max(next, this.now() + 1_000));
    }
  }

  private async passFolderId(): Promise<string> {
    if (this.deps.passFolderId) return this.deps.passFolderId;
    this.passFolder ??= (async () => {
      const saved = await this.deps.storage.get<string>('passFolderId');
      if (saved) return saved;
      // "Participant Passes", next to the payment screenshots folder.
      const parent = await this.deps.drive.parentOf(this.deps.paymentFolderId);
      const id = await this.deps.drive.ensureFolder(PASS_FOLDER_NAME, parent);
      await this.deps.storage.put('passFolderId', id);
      return id;
    })().catch((error: unknown) => {
      this.passFolder = null;
      throw error;
    });
    return this.passFolder;
  }

  private async deliver(item: OutboxItem) {
    const key = `outbox:${item.registrationId}`;
    const notes: string[] = [];
    const pass = passData(item);
    const fileName = passFileName(item.registrationId);

    let pdf: Uint8Array | null = null;
    try {
      pdf = await buildPassPdf(pass, this.deps.logo);
    } catch (error) {
      notes.push(`Pass PDF could not be made: ${describeError(error)}`);
    }

    let passNote = '';
    const savePass = async () => {
      if (!pdf || item.pass.status === 'SAVED') return;
      try {
        const file = await this.deps.drive.upload({
          name: fileName,
          mimeType: 'application/pdf',
          bytes: pdf,
          folderId: await this.passFolderId(),
          properties: { registrationId: item.registrationId },
        });
        item.pass = { status: 'SAVED', fileId: file.id, fileName: file.name };
      } catch (error) {
        item.pass = { status: 'FAILED' };
        passNote = `Pass not saved to Drive: ${describeError(error)}`;
      }
    };

    let emailNote = '';
    const sendEmail = async () => {
      if (item.email.status === 'SENT') return;
      item.email.attempts += 1;
      try {
        const message = confirmationEmail(pass);
        await this.deps.sendMail(
          buildMime({
            fromName: this.deps.mail.fromName,
            fromAddress: this.deps.mail.sender,
            replyTo: this.deps.mail.replyTo,
            to: item.record.participant.email,
            ...message,
            attachments: pdf ? [{ filename: fileName, mimeType: 'application/pdf', bytes: pdf }] : [],
          }),
        );
        item.email = { status: 'SENT', sentAt: istStamp(this.now()), attempts: item.email.attempts };
      } catch (error) {
        item.email.status = 'FAILED';
        emailNote = `Email not sent: ${describeError(error)}`;
      }
    };

    // The email goes out as soon as the pass is made; its copy is saved to Drive alongside.
    await Promise.all([sendEmail(), savePass()]);
    notes.push(...[passNote, emailNote].filter(Boolean));

    const done = item.pass.status === 'SAVED' && item.email.status === 'SENT';
    item.attempts += 1;
    const givingUp = !done && item.attempts >= MAX_ROUNDS;
    if (!done && !givingUp) {
      const delay = RETRY_DELAYS_MS[Math.min(item.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      item.nextAttemptAt = this.now() + delay;
      notes.push(`Retrying at ${istStamp(item.nextAttemptAt)} IST`);
    }
    if (givingUp) notes.push('No more automatic retries; please follow up by hand.');
    item.note = notes.join(' · ');

    // The outbox item is removed only once the sheet shows the result, so a lost sheet
    // update can never lead to a second email.
    try {
      await this.deps.sheets.update(item.registrationId, {
        passStatus: item.pass.status === 'PENDING' && givingUp ? 'FAILED' : item.pass.status,
        passFileId: item.pass.fileId ?? '',
        passFileName: item.pass.fileName ?? '',
        passLink: item.pass.fileId ? driveLink(item.pass.fileId) : '',
        emailStatus: item.email.status,
        emailSentAt: item.email.sentAt ?? '',
        emailAttempts: item.email.attempts,
        notes: item.note,
      });
    } catch (error) {
      if (error instanceof RowNotFoundError) {
        this.log('Registration row was removed from the sheet; stopping its deliveries', { registrationId: item.registrationId });
        await this.deps.storage.delete(key);
        return;
      }
      this.log('Could not update the sheet after delivery', { registrationId: item.registrationId, error: describeError(error) });
      item.nextAttemptAt = Math.min(item.nextAttemptAt, this.now() + 60_000);
      if (done || givingUp) item.nextAttemptAt = this.now() + 60_000;
      await this.deps.storage.put(key, item);
      return;
    }

    if (done || givingUp) await this.deps.storage.delete(key);
    else await this.deps.storage.put(key, item);
    this.log('Delivery round', {
      registrationId: item.registrationId,
      pass: item.pass.status,
      email: item.email.status,
      attempts: item.attempts,
    });
  }
}
