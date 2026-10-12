/**
 * Test harness for the API (used by the *.test.ts files only, never deployed): the Service
 * behind the real routes, with DynamoDB, S3 and the Google APIs replaced by in-memory
 * stand-ins that follow the same rules.
 */
import { expect, vi } from 'vitest';
import type { StaffRole } from '../src/lib/staff';
import { hashPassword } from './auth';
import type { StoredFile, UploadRequest } from './drive';
import { uploadKey, type FileStore } from './files';
import { GoogleApiError } from './google';
import { route, type HttpResponse } from './http';
import { MemoryStore } from './memoryStore';
import { passLogo } from './passLogo';
import { Service, type ServiceDeps } from './service';
import { RowNotFoundError, type SheetRow } from './sheets';

export const ADMIN = { username: 'pragya-admin', password: 'Correct-Horse-9-Battery' };
export const STAFF_PASSWORD = 'Event-Day-Staff-2026';
const passwordHash = await hashPassword(ADMIN.password);

/** Times on the schedule in src/content/site.ts (IST = UTC+5:30). */
export const TIMES = {
  /** 10 October, during online registration. */
  online: '2026-10-10T06:30:00Z',
  /** 16 October, 11:58:59 PM IST: the last online minute. */
  lastOnlineMinute: '2026-10-16T18:28:59Z',
  /** 16 October, 11:59 PM IST: online closed, the desk not yet open. */
  between: '2026-10-16T18:29:30Z',
  /** 17 October, 12:00 AM IST: the desk opens. */
  onsiteOpens: '2026-10-16T18:30:00Z',
  /** 17 October, 9:30 AM IST: the event day. */
  eventDay: '2026-10-17T04:00:00Z',
  /** 17 October, 11:58:59 AM IST: the last minute of on-site registration. */
  lastOnsiteMinute: '2026-10-17T06:28:59Z',
  /** 17 October, 11:59 AM IST: on-site registration closes (the events go on). */
  onsiteCloses: '2026-10-17T06:29:00Z',
  /** 17 October, 11:59:59 PM IST: the last second of the event day. */
  lastOnsiteSecond: '2026-10-17T18:29:59Z',
  /** 18 October, 12:00 AM IST: every registration closed. */
  closed: '2026-10-17T18:30:00Z',
} as const;

/** A small but well-formed PNG (300×600), padded to a realistic size. */
export function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(2048);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 44, 0, 0, 2, 88]);
  return bytes;
}

export class FakeFiles implements FileStore {
  readonly objects = new Map<string, { bytes: Uint8Array; type: string }>();
  readonly puts: string[] = [];
  failPuts: RegExp | null = null;

  async presignUpload(uploadId: string, contentType: string) {
    return { uploadId, url: 'https://bucket.s3.test/', fields: { key: uploadKey(uploadId), 'Content-Type': contentType } };
  }
  async readUpload(uploadId: string, maxBytes: number) {
    const found = this.objects.get(uploadKey(uploadId));
    return found && found.bytes.length <= maxBytes ? found.bytes : null;
  }
  async deleteUpload(uploadId: string) {
    this.objects.delete(uploadKey(uploadId));
  }
  async put(key: string, bytes: Uint8Array, type: string) {
    if (this.failPuts?.test(key)) throw new Error('S3 is unavailable');
    this.puts.push(key);
    this.objects.set(key, { bytes, type });
  }
  async get(key: string) {
    const found = this.objects.get(key);
    if (!found) throw new Error(`No such key ${key}`);
    return found.bytes;
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async signedUrl(key: string, { expiresInSeconds, downloadName }: { expiresInSeconds: number; downloadName?: string }) {
    if (!this.objects.has(key)) throw new Error(`No such key ${key}`);
    return `https://bucket.s3.test/${key}?X-Amz-Expires=${expiresInSeconds}${downloadName ? `&download=${downloadName}` : ''}`;
  }
}

export class FakeSheet {
  readonly rows: SheetRow[] = [];
  /** Reads of the whole ID column (Google allows only ~60 reads a minute). */
  idReads = 0;
  down = false;
  /** Google stores the row but the answer is lost. */
  loseNextAnswer = false;
  async ready() {
    if (this.down) throw new GoogleApiError('Sheets: read: timed out', 0, 'timeout', true, true);
  }
  async ids() {
    await this.ready();
    this.idReads += 1;
    return this.rows.map((row) => String(row.id));
  }
  async append(row: SheetRow) {
    await this.ready();
    this.rows.push({ ...row });
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new GoogleApiError('Sheets: add registrations: timed out', 0, 'timeout', true, true);
    }
  }
  async update(id: string, fields: SheetRow) {
    await this.ready();
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) throw new RowNotFoundError(`Row ${id} not found in the sheet`);
    Object.assign(row, fields);
  }
}

export class FakeDrive {
  readonly files: (StoredFile & { properties?: Record<string, string>; folderId?: string; bytes?: Uint8Array; revisions?: number })[] = [];
  /** Set to make every Drive call fail (Google down). */
  failing = false;
  private check() {
    if (this.failing) throw new Error('Google Drive is unavailable');
  }
  async upload({ name, properties, folderId, bytes }: UploadRequest) {
    this.check();
    const file = { id: `drive-${this.files.length + 1}`, name, properties, folderId, bytes, revisions: 1 };
    this.files.push(file);
    return { id: file.id, name };
  }
  async replace(fileId: string, { name, bytes }: { name: string; mimeType: string; bytes: Uint8Array }) {
    this.check();
    const file = this.files.find((item) => item.id === fileId);
    if (!file) throw new Error(`No such Drive file ${fileId}`);
    Object.assign(file, { name, bytes, revisions: (file.revisions ?? 1) + 1 });
    return { id: file.id, name };
  }
  /** The JSON in a file, e.g. a student's record. */
  json(fileId: string) {
    const file = this.files.find((item) => item.id === fileId);
    return file?.bytes ? JSON.parse(new TextDecoder().decode(file.bytes)) : null;
  }
  async findByProperties(properties: Record<string, string>) {
    this.check();
    const found = this.files.find((file) => Object.entries(properties).every(([key, value]) => file.properties?.[key] === value));
    return found ? { id: found.id, name: found.name } : null;
  }
  async ensureFolder() {
    return 'passes-folder';
  }
  async parentOf() {
    return 'root';
  }
  /** Ids of files moved to the trash. */
  readonly trashed: string[] = [];
  async trash(fileId: string) {
    this.check();
    this.trashed.push(fileId);
  }
}

export interface Participant {
  name?: string;
  email?: string;
  phone?: string;
  college?: string;
}

export function setup(overrides: Partial<ServiceDeps> & { at?: string } = {}) {
  const { at, ...deps } = overrides;
  const store = new MemoryStore();
  const files = new FakeFiles();
  const sheets = new FakeSheet();
  const drive = new FakeDrive();
  const sendMail = vi.fn(async (mime: string) => `gmail-${mime.length}`);
  let clock = Date.parse(at ?? TIMES.online);
  const service = new Service({
    store,
    files,
    sheets,
    drive,
    sendMail,
    logo: passLogo(),
    paymentFolderId: 'payments-folder',
    passFolderId: null,
    // Passes are not emailed for now (site.ts); the tests keep the email working for when they are.
    mail: { fromName: 'PRAGYA 2026', sender: 'pragya@example.com', replyTo: null, passByEmail: true },
    admin: { username: ADMIN.username, passwordHash },
    rateLimit: { max: 300, windowMs: 600_000 },
    now: () => clock,
    log: () => {},
    ...deps,
  });

  const call = async (method: string, path: string, body?: unknown, options: { token?: string; ip?: string } = {}) => {
    const response: HttpResponse = await route(
      {
        method,
        path,
        headers: {
          'content-type': 'application/json',
          ...(options.token && { authorization: `Bearer ${options.token}` }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        ip: options.ip ?? '203.0.113.7',
      },
      service,
      () => {},
    );
    return { status: response.status, headers: response.headers, body: JSON.parse(response.body) };
  };

  let counter = 0;
  /** What the browser does: get an upload, put the screenshot in S3, then register. */
  const submit = async (
    overrides: { email?: string; transactionId?: string; submissionId?: string; bytes?: Uint8Array | null; events?: unknown[]; phone?: string } = {},
  ) => {
    counter += 1;
    const ticket = await call('POST', '/api/uploads', { contentType: 'image/png', size: 2048 });
    if (ticket.status !== 200) return { ...ticket, key: '' };
    if (overrides.bytes !== null) {
      files.objects.set(ticket.body.fields.key, { bytes: overrides.bytes ?? pngBytes(), type: 'image/png' });
    }
    const submissionId = overrides.submissionId ?? `${String(counter).padStart(4, '0')}${'a'.repeat(28)}`;
    const response = await call('POST', '/api/register', {
      submissionId,
      participant: {
        name: 'Varshan C',
        department: 'Artificial Intelligence and Data Science (AI & DS)',
        college: 'R P Sarathy Institute of Technology',
        year: '3rd Year',
        phone: overrides.phone ?? '9344972274',
        email: overrides.email ?? `student${counter}@example.com`,
      },
      events: overrides.events ?? ['pro-pitch', 'code-flex'],
      transactionId: overrides.transactionId ?? `UTR${String(counter).padStart(9, '0')}`,
      upload: { id: ticket.body.uploadId },
    });
    return { ...response, key: submissionId };
  };

  const loginAs = async (username: string, password: string, ip?: string) => {
    const response = await call('POST', '/api/admin/login', { username, password }, { ip });
    expect(response.status).toBe(200);
    return response.body.token as string;
  };

  const login = () => loginAs(ADMIN.username, ADMIN.password);

  /** The owner admin's session, signed in once and again only when it has ended. */
  let ownerToken: string | null = null;
  const asOwner = async (method: string, path: string, body?: unknown) => {
    ownerToken ??= await login();
    let response = await call(method, path, body, { token: ownerToken });
    if (response.status === 401) {
      ownerToken = await login();
      response = await call(method, path, body, { token: ownerToken });
    }
    return response;
  };

  let staffCount = 0;
  /** A new staff account with this role (created by the owner admin), signed in; `extra` adds e.g. department and desk. */
  const staff = async (role: StaffRole, eventIds: string[] = [], username?: string, extra: Record<string, unknown> = {}) => {
    staffCount += 1;
    const name = username ?? `${role.toLowerCase().replace(/_/g, '-')}${staffCount}`;
    const created = await asOwner('POST', '/api/admin/staff', {
      username: name,
      displayName: `Staff ${staffCount}`,
      role,
      eventIds,
      password: STAFF_PASSWORD,
      ...extra,
    });
    expect(created.status).toBe(200);
    return { username: name, token: await loginAs(name, STAFF_PASSWORD) };
  };

  let deskCounter = 0;
  /**
   * What the desk laptop sends to register a participant on the event day: the participant
   * (individual, or a team with its name), the events they choose (none by default; each paid
   * at its venue) and the ₹100 gate pass.
   */
  const onsite = async (
    token: string,
    overrides: Participant & {
      events?: string[];
      payment?: unknown;
      submissionId?: string;
      teamName?: string;
      body?: Record<string, unknown>;
    } = {},
  ) => {
    deskCounter += 1;
    const submissionId = overrides.submissionId ?? `desk${String(deskCounter).padStart(4, '0')}${'b'.repeat(24)}`;
    const response = await call(
      'POST',
      '/api/admin/onsite',
      {
        submissionId,
        participant: {
          name: overrides.name ?? 'Nila R',
          department: 'Computer Science and Engineering (CSE)',
          college: overrides.college ?? 'Sona College of Technology, Salem',
          year: '2nd Year',
          phone: overrides.phone ?? `98${String(40000000 + deskCounter).padStart(8, '0')}`,
          email: overrides.email ?? `walkin${deskCounter}@example.com`,
        },
        participation: overrides.teamName ? 'TEAM' : 'INDIVIDUAL',
        ...(overrides.teamName && { teamName: overrides.teamName }),
        events: overrides.events ?? [],
        payment: overrides.payment ?? { method: 'CASH', confirmedReceived: true },
        ...overrides.body,
      },
      { token },
    );
    return { ...response, submissionId };
  };

  return {
    store,
    files,
    sheets,
    drive,
    sendMail,
    service,
    call,
    submit,
    login,
    loginAs,
    asOwner,
    staff,
    onsite,
    advance: (ms: number) => {
      clock += ms;
    },
    setTime: (iso: string) => {
      clock = Date.parse(iso);
    },
  };
}
