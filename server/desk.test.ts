import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Desk, RETRY_DELAYS_MS, type DeskDeps, type DeskStorage, type OutboxItem } from './desk';
import { GoogleApiError } from './google';
import { COLUMNS, type SheetRow, type StoredRow } from './sheets';

const logo = new Uint8Array(readFileSync(join(import.meta.dirname, '..', 'public', 'images', 'rpsit-logo-pass.jpg')));

/** A small but well-formed PNG header (20×20), padded to a realistic size. */
function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(400);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 20, 0, 0, 0, 20]);
  return bytes;
}
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(pngBytes()).toString('base64')}`;

let counter = 0;
function payload(overrides: { email?: string; transactionId?: string; submissionId?: string; events?: string[] } = {}) {
  counter += 1;
  return {
    submissionId: overrides.submissionId ?? `submission-${String(counter).padStart(12, '0')}`,
    participant: {
      name: 'Varshan C',
      department: 'Artificial Intelligence and Data Science (AI & DS)',
      college: 'R P Sarathy Institute of Technology',
      year: '3rd Year',
      phone: '9344972274',
      email: overrides.email ?? `student${counter}@example.com`,
    },
    events: overrides.events ?? ['pro-pitch', 'short-film'],
    transactionId: overrides.transactionId ?? `4123456${String(counter).padStart(5, '0')}`,
    screenshot: { name: 'gpay.png', type: 'image/png', data: PNG_DATA_URL },
  };
}

class MemoryStorage implements DeskStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.values.delete(key);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T]));
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
}

function setup(options: { existing?: Partial<StoredRow>[]; deps?: Partial<DeskDeps>; now?: () => number } = {}) {
  const rows: SheetRow[] = [];
  const updates: { id: string; fields: SheetRow }[] = [];
  let activeUploads = 0;
  let maxActiveUploads = 0;

  // Like the real sheet, every column is present (empty cells as '').
  const blank = Object.fromEntries(Object.keys(COLUMNS).map((key) => [key, ''])) as StoredRow;
  // Like the real sheet, reading it back returns every row written so far (as text).
  const asText = (row: SheetRow) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]));
  const sheets = {
    load: vi.fn(async () => [...(options.existing ?? []), ...rows.map(asText)].map((row) => ({ ...blank, ...row }) as StoredRow)),
    append: vi.fn(async (row: SheetRow) => {
      rows.push(row);
    }),
    update: vi.fn(async (id: string, fields: SheetRow) => {
      updates.push({ id, fields });
    }),
  };
  const drive = {
    upload: vi.fn(async ({ name }: { name: string }) => {
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeUploads -= 1;
      return { id: `file-${name}`, name };
    }),
    trash: vi.fn(async () => {}),
    ensureFolder: vi.fn(async () => 'pass-folder'),
    parentOf: vi.fn(async () => 'parent-folder'),
  };
  const sendMail = vi.fn(async () => 'gmail-message-id');
  const storage = new MemoryStorage();

  const desk = new Desk({
    sheets,
    drive,
    sendMail,
    storage,
    logo,
    paymentFolderId: 'payment-folder',
    passFolderId: null,
    mail: { fromName: 'PRAGYA 2026', sender: 'pragya@example.com', replyTo: null },
    workers: 3,
    rateLimit: { max: 1000, windowMs: 60_000 },
    closesAt: '2999-01-01T00:00:00',
    log: () => {},
    now: options.now,
    ...options.deps,
  });
  return { desk, sheets, drive, sendMail, storage, rows, updates, maxUploads: () => maxActiveUploads };
}

const post = (body: unknown, ip = '10.0.0.1') =>
  new Request('http://desk/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-ip': ip },
    body: JSON.stringify(body),
  });

describe('registration desk', () => {
  it('stores the screenshot in Drive and the row in Sheets before reporting success', async () => {
    const { desk, drive, rows, storage } = setup();

    const result = await desk.register(payload({ email: 'Varshan@Example.com' }));

    expect(result).toMatchObject({ success: true, registrationId: 'PRG26-0001', emailStatus: 'PENDING' });
    expect(drive.upload).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'PRG26-0001_payment.png', mimeType: 'image/png', folderId: 'payment-folder' }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'PRG26-0001',
      status: 'SUCCESS',
      email: 'varshan@example.com',
      technicalEvents: 'PRO-PITCH',
      nonTechnicalEvents: 'SHORT FILM',
      eventCount: 2,
      feePerEvent: 50,
      eventFee: 100,
      amountPaid: 100,
      paymentFileId: 'file-PRG26-0001_payment.png',
      paymentLink: 'https://drive.google.com/file/d/file-PRG26-0001_payment.png/view',
      passStatus: 'PENDING',
      emailStatus: 'PENDING',
    });
    expect(await storage.get('outbox:PRG26-0001')).toBeTruthy();
    expect(storage.alarm).not.toBeNull();
  });

  it('gives every registration its own ID, even when they arrive together, three at a time', async () => {
    const { desk, maxUploads } = setup();

    const results = await Promise.all(Array.from({ length: 12 }, () => desk.register(payload())));

    const ids = results.map((result) => result.registrationId).sort();
    expect(new Set(ids).size).toBe(12);
    expect(ids[0]).toBe('PRG26-0001');
    expect(ids[11]).toBe('PRG26-0012');
    expect(maxUploads()).toBeLessThanOrEqual(3);
  });

  it('carries on from the highest ID already in the sheet', async () => {
    const { desk } = setup({ existing: [{ id: 'PRG26-0041', status: 'SUCCESS', email: 'a@example.com', transactionId: 'AAA111', submissionId: 'x' }] });
    expect((await desk.register(payload())).registrationId).toBe('PRG26-0042');
  });

  it('answers a repeated form (same submission id) with the first result, storing it once', async () => {
    const { desk, drive, rows } = setup();
    const form = payload();

    const [first, second] = await Promise.all([desk.register(form), desk.register(form)]);
    const third = await desk.register(form);

    expect(first.registrationId).toBe('PRG26-0001');
    expect(second.registrationId).toBe('PRG26-0001');
    expect(third.registrationId).toBe('PRG26-0001');
    expect(drive.upload).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it('recognises the same person (same email and transaction ID) without registering them again', async () => {
    const { desk, rows } = setup();
    await desk.register(payload({ email: 'a@example.com', transactionId: 'UTR123456' }));

    const again = await desk.register(payload({ email: 'A@example.com', transactionId: 'utr123456' }));

    expect(again).toMatchObject({ registrationId: 'PRG26-0001', duplicate: true });
    expect(rows).toHaveLength(1);
  });

  it('refuses a transaction ID or an email that is already registered', async () => {
    const { desk } = setup();
    await desk.register(payload({ email: 'a@example.com', transactionId: 'UTR123456' }));

    await expect(desk.register(payload({ email: 'b@example.com', transactionId: 'UTR123456' }))).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_TRANSACTION',
    });
    await expect(desk.register(payload({ email: 'a@example.com', transactionId: 'UTR999999' }))).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_EMAIL',
    });
  });

  it('does not report success when the Drive upload fails, and lets the student try again', async () => {
    const { desk, drive, rows, storage } = setup();
    drive.upload.mockRejectedValueOnce(new Error('Drive is down'));
    const form = payload({ email: 'a@example.com' });

    await expect(desk.register(form)).rejects.toMatchObject({ status: 502, code: 'STORAGE_FAILED' });
    expect(rows.filter((row) => row.status === 'SUCCESS')).toHaveLength(0);
    expect(rows[0]).toMatchObject({ status: 'FAILED' });
    expect(await storage.list({ prefix: 'outbox:' })).toHaveProperty('size', 0);

    // The same form again works, with a new ID (the failed one is never reused).
    expect((await desk.register(form)).registrationId).toBe('PRG26-0002');
  });

  it('does not report success when the sheet write fails, and moves the screenshot to the trash', async () => {
    const { desk, sheets, drive, storage } = setup();
    sheets.append.mockRejectedValueOnce(new Error('Sheets is down'));

    await expect(desk.register(payload())).rejects.toMatchObject({ status: 502, code: 'STORAGE_FAILED' });
    expect(drive.trash).toHaveBeenCalledWith('file-PRG26-0001_payment.png');
    expect(await storage.list({ prefix: 'outbox:' })).toHaveProperty('size', 0);
  });

  it("keeps the screenshot when Google's answer to the sheet write was lost, since the row may be there", async () => {
    const { desk, sheets, drive } = setup();
    sheets.append.mockRejectedValueOnce(new GoogleApiError('Sheets: add registrations: timed out', 0, 'timeout', true, true));

    await expect(desk.register(payload())).rejects.toMatchObject({ status: 502, code: 'STORAGE_FAILED' });
    expect(drive.trash).not.toHaveBeenCalled();
  });

  it('rejects invalid details with the fields to fix', async () => {
    const { desk } = setup();
    const response = await desk.handle(post({ ...payload(), transactionId: 'x', participant: { ...payload().participant, email: 'nope' } }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { fieldErrors: Record<string, string> };
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['email', 'transactionId']);
  });

  it('refuses registrations after the closing time', async () => {
    const { desk } = setup({ deps: { closesAt: '2020-01-01T17:00:00' } });
    await expect(desk.register(payload())).rejects.toMatchObject({ status: 403, code: 'REGISTRATION_CLOSED' });
  });

  it('asks the browser to retry when the line is full, and limits requests per network', async () => {
    const busy = setup({ deps: { workers: 1, queueLimit: 1 } });
    const results = await Promise.allSettled([1, 2, 3].map(() => busy.desk.register(payload())));
    expect(results.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason)).toEqual([
      expect.objectContaining({ status: 503, code: 'BUSY' }),
    ]);

    const limited = setup({ deps: { rateLimit: { max: 2, windowMs: 60_000 } } });
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await limited.desk.handle(post(payload(), '1.2.3.4'))).status);
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe('keeping up with the sheet', () => {
  /** A clock the test moves by hand. */
  const clock = () => {
    let time = Date.parse('2026-10-07T10:00:00Z');
    return { now: () => time, advance: (ms: number) => (time += ms) };
  };

  it('lets a student register again once organisers delete their row from the sheet, without a restart', async () => {
    const time = clock();
    const { desk, sheets } = setup({
      now: time.now,
      existing: [{ id: 'PRG26-0001', status: 'SUCCESS', email: 'varshan@example.com', transactionId: '412300000001', submissionId: 'old-submission-000001' }],
    });
    await desk.warmUp();
    await expect(desk.register(payload({ email: 'varshan@example.com' }))).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });

    // The organiser clears the sheet by hand.
    sheets.load.mockResolvedValue([]);
    time.advance(15_000);
    const again = await desk.register(payload({ email: 'varshan@example.com', transactionId: '412300000001' }));

    expect(again.success).toBe(true);
    expect(again.duplicate).toBeUndefined();
    // Numbers follow the sheet: it is empty again, so numbering starts again.
    expect(again.registrationId).toBe('PRG26-0001');
  });

  it('numbers registrations from the highest ID in the sheet, also after rows are deleted', async () => {
    const time = clock();
    const row = (id: string, n: number) => ({ id, status: 'SUCCESS', email: `s${n}@example.com`, transactionId: `41230000000${n}` });
    const { desk, sheets } = setup({ now: time.now, existing: [row('PRG26-0001', 1), row('PRG26-0002', 2), row('PRG26-0005', 5)] });
    expect((await desk.register(payload())).registrationId).toBe('PRG26-0006');
    await desk.alarm(); // its pass and email go out

    // The organiser deletes PRG26-0005 and PRG26-0006 by hand.
    sheets.load.mockResolvedValue([row('PRG26-0001', 1), row('PRG26-0002', 2)].map((stored) => ({ ...Object.fromEntries(Object.keys(COLUMNS).map((key) => [key, ''])), ...stored }) as StoredRow));
    time.advance(11_000);
    expect((await desk.register(payload())).registrationId).toBe('PRG26-0003');
  });

  it('never repeats a number that is still being saved or still has its email to send', async () => {
    const time = clock();
    let release!: () => void;
    const { desk, drive, storage } = setup({ now: time.now });
    await desk.warmUp();
    drive.upload.mockImplementationOnce(async ({ name }) => {
      await new Promise<void>((resolve) => (release = resolve));
      return { id: `file-${name}`, name };
    });
    const saving = desk.register(payload());
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    // An email still waiting to go out for PRG26-0007, whose row is not in the sheet.
    await storage.put('outbox:PRG26-0007', { registrationId: 'PRG26-0007' });
    time.advance(11_000);
    expect((await desk.register(payload())).registrationId).toBe('PRG26-0008');

    release();
    expect((await saving).registrationId).toBe('PRG26-0001');
  });

  it('still refuses a registration that is in the sheet when checked again', async () => {
    const time = clock();
    const { desk, sheets } = setup({ now: time.now });
    await desk.register(payload({ email: 'nila@example.com' }));
    time.advance(15_000);

    await expect(desk.register(payload({ email: 'nila@example.com' }))).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    expect(sheets.load).toHaveBeenCalledTimes(2);
  });

  it('re-reads the sheet at most every 10 seconds, once for everyone registering together', async () => {
    const time = clock();
    const { desk, sheets } = setup({ now: time.now });
    await desk.warmUp();
    await desk.register(payload());
    expect(sheets.load).toHaveBeenCalledTimes(1);

    time.advance(11_000);
    const together = await Promise.all(Array.from({ length: 8 }, () => desk.register(payload())));
    expect(new Set(together.map((result) => result.registrationId)).size).toBe(8);
    expect(sheets.load).toHaveBeenCalledTimes(2);
  });

  it('does not forget a registration that is being saved while the sheet is re-read', async () => {
    const time = clock();
    let release!: () => void;
    const { desk, drive } = setup({ now: time.now });
    await desk.warmUp();
    drive.upload.mockImplementationOnce(async ({ name }) => {
      await new Promise<void>((resolve) => (release = resolve));
      return { id: `file-${name}`, name };
    });

    const first = desk.register(payload({ email: 'kavin@example.com' }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    time.advance(15_000);
    // The sheet does not show it yet, but it is being saved: refused, not registered twice.
    await expect(desk.register(payload({ email: 'kavin@example.com' }))).rejects.toMatchObject({ code: 'IN_PROGRESS' });

    release();
    expect((await first).success).toBe(true);
  });

  it('keeps turning duplicates away from memory when the sheet cannot be read', async () => {
    const time = clock();
    const { desk, sheets } = setup({ now: time.now });
    await desk.register(payload({ email: 'mithra@example.com' }));
    sheets.load.mockRejectedValue(new GoogleApiError('Sheets: read: timed out', 0, 'timeout', true, false));
    time.advance(15_000);

    await expect(desk.register(payload({ email: 'mithra@example.com' }))).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
  });
});

describe('start-up and health', () => {
  const health = async (desk: Desk) => (await desk.handle(new Request('http://desk/health'))).json();

  it('connects to the sheet at start-up, so the first student does not wait for it', async () => {
    const { desk, sheets } = setup({ existing: [{ id: 'PRG26-0003', status: 'SUCCESS', email: 'a@example.com', transactionId: 'T1' }] });
    expect(await health(desk)).toMatchObject({ status: 'starting' });

    expect(await desk.warmUp()).toEqual({ ok: true, registrations: 1 });
    expect(await health(desk)).toMatchObject({ status: 'ready' });
    await desk.register(payload());
    expect(sheets.load).toHaveBeenCalledTimes(1);
  });

  it('reports a sheet it cannot reach without crashing, and recovers once Google answers again', async () => {
    const { desk, sheets } = setup();
    sheets.load.mockRejectedValueOnce(new GoogleApiError('Google sign-in no longer works (invalid_grant)', 401, 'invalid_grant', false, false));

    expect(await desk.warmUp()).toEqual({ ok: false, error: expect.stringMatching(/invalid_grant/) });
    expect(await health(desk)).toMatchObject({ status: 'unavailable' });

    expect((await desk.register(payload())).success).toBe(true);
    expect(await health(desk)).toMatchObject({ status: 'ready' });
  });
});

describe('participant pass and confirmation email', () => {
  it('saves the pass to Drive, emails it, then marks both done in the sheet', async () => {
    const { desk, drive, sendMail, storage, updates } = setup();
    await desk.register(payload({ email: 'varshan@example.com' }));

    await desk.alarm();

    expect(drive.upload).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'PRAGYA-2026-Pass-PRG26-0001.pdf', mimeType: 'application/pdf', folderId: 'pass-folder' }),
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mime = (sendMail.mock.calls[0] as unknown as [string])[0];
    expect(mime).toContain('To: varshan@example.com');
    expect(mime).toContain('filename="PRAGYA-2026-Pass-PRG26-0001.pdf"');
    expect(updates.at(-1)).toMatchObject({
      id: 'PRG26-0001',
      fields: { passStatus: 'SAVED', emailStatus: 'SENT', emailAttempts: 1, passFileId: 'file-PRAGYA-2026-Pass-PRG26-0001.pdf' },
    });
    expect(await storage.get('outbox:PRG26-0001')).toBeUndefined();
  });

  it('emails the pass straight away, without waiting for Drive to save a copy', async () => {
    const { desk, drive, sendMail, updates } = setup();
    await desk.register(payload());
    let saveCopy = () => {};
    drive.upload.mockImplementationOnce(
      ({ name }) => new Promise((resolve) => (saveCopy = () => resolve({ id: `file-${name}`, name }))),
    );

    const delivering = desk.alarm();
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    saveCopy();
    await delivering;

    expect(updates.at(-1)?.fields).toMatchObject({ passStatus: 'SAVED', emailStatus: 'SENT' });
  });

  it('sends the emails of registrations that arrive together side by side, a few at a time', async () => {
    const { desk, sendMail, storage } = setup();
    for (let i = 0; i < 6; i += 1) await desk.register(payload());
    let sending = 0;
    let most = 0;
    sendMail.mockImplementation(async () => {
      sending += 1;
      most = Math.max(most, sending);
      await new Promise((resolve) => setTimeout(resolve, 5));
      sending -= 1;
      return 'gmail-message-id';
    });

    await desk.alarm();

    expect(sendMail).toHaveBeenCalledTimes(6);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(3);
    expect(await storage.list({ prefix: 'outbox:' })).toHaveProperty('size', 0);
  });

  it('keeps the registration successful when Gmail fails, and tries again later without a second registration', async () => {
    let now = Date.parse('2026-10-06T10:00:00Z');
    const { desk, sendMail, storage, updates, rows } = setup({ now: () => now });
    await desk.register(payload());
    sendMail.mockRejectedValueOnce(new Error('Gmail is down'));

    await desk.alarm();
    expect(updates.at(-1)?.fields).toMatchObject({ emailStatus: 'FAILED', passStatus: 'SAVED', emailAttempts: 1 });
    const waiting = await storage.get<OutboxItem>('outbox:PRG26-0001');
    expect(waiting?.nextAttemptAt).toBe(now + RETRY_DELAYS_MS[0]);

    now += RETRY_DELAYS_MS[0];
    await desk.alarm();
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)?.fields).toMatchObject({ emailStatus: 'SENT', emailAttempts: 2 });
    expect(await storage.get('outbox:PRG26-0001')).toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it('never sends a second email when only the sheet update failed', async () => {
    let now = Date.parse('2026-10-06T10:00:00Z');
    const { desk, sheets, sendMail, storage } = setup({ now: () => now });
    await desk.register(payload());
    sheets.update.mockRejectedValueOnce(new Error('Sheets is down'));

    await desk.alarm();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await storage.get('outbox:PRG26-0001')).toBeTruthy();

    now += 60_000;
    await desk.alarm();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await storage.get('outbox:PRG26-0001')).toBeUndefined();
  });

  it('puts registrations still waiting for their email back in the outbox after a restart', async () => {
    const { desk, sendMail } = setup({
      existing: [
        {
          id: 'PRG26-0007',
          registeredAt: '2026-10-06 15:30:00',
          status: 'SUCCESS',
          name: 'Varshan C',
          email: 'varshan@example.com',
          college: 'RPSIT',
          department: 'Civil Engineering',
          year: '2nd Year',
          phone: '9344972274',
          technicalEvents: 'COGNIX',
          nonTechnicalEvents: '',
          feePerEvent: '50',
          amountPaid: '100',
          transactionId: 'UTR777777',
          submissionId: 'abc',
          emailStatus: 'PENDING',
          passStatus: 'PENDING',
          emailAttempts: '0',
        },
      ],
    });

    await desk.alarm();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect((sendMail.mock.calls[0] as unknown as [string])[0]).toContain('To: varshan@example.com');
  });
});
