/**
 * The whole registration workflow through the API routes, with DynamoDB, S3 and the Google
 * APIs replaced by in-memory stand-ins that follow the same rules (server/testing.ts).
 */
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from './auth';
import { GoogleApiError } from './google';
import { MemoryStore } from './memoryStore';
import { ADMIN, setup } from './testing';

describe('student submits', () => {
  it('stores the registration as PENDING, with its screenshot, and sends nothing yet', async () => {
    const { submit, store, files, sheets, drive, sendMail, call } = setup();
    const submitted = await submit();

    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ success: true, registrationId: '261001', status: 'PENDING' });
    const stored = await store.getRegistration('261001');
    expect(stored).toMatchObject({ status: 'PENDING', pdfStatus: 'NOT_STARTED', emailStatus: 'NOT_SENT' });
    // The private key is stored only as a hash.
    expect(JSON.stringify(stored)).not.toContain(submitted.key);

    expect(files.objects.has('payments/261001.png')).toBe(true);
    expect([...files.objects.keys()].some((key) => key.startsWith('passes/'))).toBe(false);
    expect([...files.objects.keys()].some((key) => key.startsWith('uploads/'))).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();

    // Mirrored to Google: the screenshot in Drive, one row in the sheet.
    expect(drive.files).toHaveLength(1);
    expect(sheets.rows).toHaveLength(1);
    expect(sheets.rows[0]).toMatchObject({ id: '261001', status: 'PENDING', passStatus: '', emailStatus: '' });
    expect(sheets.rows[0].paymentLink).toContain('drive-1');

    // The participant sees PENDING and cannot get a pass.
    const status = await call('POST', '/api/status', { registrationId: '261001', key: submitted.key });
    expect(status.body).toMatchObject({ status: 'PENDING', passAvailable: false });
    const pass = await call('POST', '/api/pass', { registrationId: '261001', key: submitted.key });
    expect(pass.status).toBe(403);
    expect(pass.body.code).toBe('PASS_NOT_AVAILABLE');
  });

  it('does not count a registration whose screenshot never reached S3 or is not an image', async () => {
    const { submit, store } = setup();

    const missing = await submit({ bytes: null });
    expect(missing.status).toBe(400);
    expect(missing.body.fieldErrors.screenshot).toMatch(/did not reach us/);

    const notAnImage = await submit({ bytes: new TextEncoder().encode('<html><script>alert(1)</script></html>'.padEnd(2048)) });
    expect(notAnImage.status).toBe(400);
    expect(notAnImage.body.fieldErrors.screenshot).toMatch(/PNG or JPG/);

    expect(await store.listRegistrations('PENDING')).toHaveLength(0);
  });

  it('answers a resent form with the first registration, and refuses a reused email or transaction ID', async () => {
    const { submit, store } = setup();
    const first = await submit({ email: 'nila@example.com', transactionId: 'UTR111111111' });
    const again = await submit({ email: 'nila@example.com', transactionId: 'UTR111111111', submissionId: first.key });
    expect(again.body.registrationId).toBe(first.body.registrationId);

    const sameTransaction = await submit({ email: 'other@example.com', transactionId: 'UTR111111111' });
    expect(sameTransaction.status).toBe(409);
    expect(sameTransaction.body.code).toBe('DUPLICATE_TRANSACTION');

    const sameEmail = await submit({ email: 'NILA@example.com', transactionId: 'UTR222222222' });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.code).toBe('DUPLICATE_EMAIL');

    expect(await store.listRegistrations('PENDING')).toHaveLength(1);
  });

  it('gives online registrations numeric IDs (10 + serial), continuing after the IDs already in the sheet', async () => {
    const { submit, sheets } = setup();
    // Rows from before numeric IDs keep their old form; the serial continues after them.
    sheets.rows.push({ id: 'PRG26-0001' }, { id: 'PRG26-0004' });
    expect((await submit()).body.registrationId).toBe('261005');
    expect((await submit()).body.registrationId).toBe('261006');
    // The sheet was read once, to start the counter; new rows are added without reading it.
    expect(sheets.idReads).toBe(1);
    expect(sheets.rows.map((row) => row.id)).toEqual(['PRG26-0001', 'PRG26-0004', '261005', '261006']);
  });
});

describe('admin sign-in', () => {
  it('protects every admin route with a server-side session', async () => {
    const { call, submit } = setup();
    await submit();

    expect((await call('GET', '/api/admin/registrations')).status).toBe(401);
    expect((await call('POST', '/api/admin/registrations/261001/approve', {})).status).toBe(401);
    expect((await call('GET', '/api/admin/registrations', undefined, { token: 'x'.repeat(43) })).status).toBe(401);

    const wrong = await call('POST', '/api/admin/login', { username: ADMIN.username, password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('Incorrect username or password.');
    const wrongUser = await call('POST', '/api/admin/login', { username: 'admin', password: ADMIN.password });
    expect(wrongUser.status).toBe(401);

    const ok = await call('POST', '/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
    expect(ok.status).toBe(200);
    const list = await call('GET', '/api/admin/registrations', undefined, { token: ok.body.token });
    expect(list.status).toBe(200);
    expect(list.body.registrations).toHaveLength(1);
    // The dashboard never sees the participant's private key or its hash.
    expect(JSON.stringify(list.body)).not.toMatch(/submissionHash|leaseId/);

    await call('POST', '/api/admin/logout', {}, { token: ok.body.token });
    expect((await call('GET', '/api/admin/registrations', undefined, { token: ok.body.token })).status).toBe(401);
  });

  it('slows down password guessing', async () => {
    const { call } = setup();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await call('POST', '/api/admin/login', { username: ADMIN.username, password: `guess-${attempt}` })).status).toBe(401);
    }
    const blocked = await call('POST', '/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('ends sessions when they expire or the admin password changes', async () => {
    const first = setup();
    const token = await first.login();
    first.advance(8 * 3_600_000 + 1);
    expect((await first.call('GET', '/api/admin/session', undefined, { token })).status).toBe(401);

    const store = new MemoryStore();
    const before = setup({ store });
    const oldToken = await before.login();
    const after = setup({ store, admin: { username: ADMIN.username, passwordHash: await hashPassword('A-new-Strong-pass-42') } });
    expect((await after.call('GET', '/api/admin/session', undefined, { token: oldToken })).status).toBe(401);
  });
});

describe('admin approves', () => {
  it('approves once: one pass and one confirmation email with the pass attached, however often it is clicked', async () => {
    const { submit, login, call, files, sendMail, sheets, drive } = setup();
    const submitted = await submit({ email: 'varshan@example.com' });
    const token = await login();

    const screenshot = await call('GET', '/api/admin/registrations/261001/screenshot', undefined, { token });
    expect(screenshot.body.url).toMatch(/payments\/261001\.png\?X-Amz-Expires=300/);

    const approved = await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect(approved.status).toBe(200);
    expect(approved.body.registration).toMatchObject({
      status: 'APPROVED',
      reviewedBy: ADMIN.username,
      pdfStatus: 'GENERATED',
      emailStatus: 'SENT',
      sheet: { synced: true },
    });

    // The pass: a real PDF, private in S3, attached to the one email.
    const pdf = files.objects.get('passes/261001.pdf')!.bytes;
    expect((await PDFDocument.load(pdf)).getTitle()).toBe('PRAGYA 2026 Participant Pass - 261001');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mime = sendMail.mock.calls[0][0];
    expect(mime).toContain('To: varshan@example.com');
    expect(mime).toContain('Content-Disposition: attachment; filename="PRAGYA-2026-Pass-261001.pdf"');
    expect(mime).toMatch(/Subject: Your PRAGYA 2026 registration is confirmed \(261001\)/);

    // Clicking again (or a retry) changes nothing.
    await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    await call('POST', '/api/admin/registrations/261001/retry', {}, { token });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(files.puts.filter((key) => key.startsWith('passes/'))).toHaveLength(1);
    expect(drive.files.filter((file) => file.properties?.kind === 'pass')).toHaveLength(1);
    expect(sheets.rows).toHaveLength(1);
    expect(sheets.rows[0]).toMatchObject({ status: 'APPROVED', passStatus: 'GENERATED', emailStatus: 'SENT', reviewedBy: ADMIN.username });

    // Now, and only now, the participant can download their own pass.
    const status = await call('POST', '/api/status', { registrationId: '261001', key: submitted.key });
    expect(status.body).toMatchObject({ status: 'APPROVED', passAvailable: true });
    const pass = await call('POST', '/api/pass', { registrationId: '261001', key: submitted.key });
    expect(pass.status).toBe(200);
    expect(pass.body.url).toMatch(/passes\/261001\.pdf\?X-Amz-Expires=60&download=PRAGYA-2026-Pass-261001\.pdf/);
  });

  it('sends a single email when two approvals arrive at the same moment', async () => {
    const { submit, login, call, sendMail } = setup();
    await submit();
    const token = await login();
    const results = await Promise.all([
      call('POST', '/api/admin/registrations/261001/approve', {}, { token }),
      call('POST', '/api/admin/registrations/261001/approve', {}, { token }),
      call('POST', '/api/admin/registrations/261001/approve', {}, { token }),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("never gives anyone else's pass, nor a pass for a guessed Registration ID", async () => {
    const { submit, login, call } = setup();
    const mine = await submit();
    const theirs = await submit();
    const token = await login();
    await call('POST', `/api/admin/registrations/${theirs.body.registrationId}/approve`, {}, { token });

    // My key with their ID, a made-up key, and no key at all all look the same: not found.
    for (const attempt of [
      { registrationId: theirs.body.registrationId, key: mine.key },
      { registrationId: theirs.body.registrationId, key: 'f'.repeat(32) },
      { registrationId: theirs.body.registrationId },
      { registrationId: '261099', key: mine.key },
    ]) {
      const pass = await call('POST', '/api/pass', attempt);
      expect(pass.status).toBe(404);
      expect(pass.body).not.toHaveProperty('url');
    }
    expect((await call('POST', '/api/pass', { registrationId: theirs.body.registrationId, key: theirs.key })).status).toBe(200);
  });
});

describe('admin rejects', () => {
  it('sends no pass and no email, keeps the pass locked, and cannot be approved afterwards', async () => {
    const { submit, login, call, sendMail, files, sheets, store } = setup();
    const submitted = await submit({ email: 'kavin@example.com', transactionId: 'UTR999999999' });
    const token = await login();

    const rejected = await call('POST', '/api/admin/registrations/261001/reject', { reason: 'Amount does not match' }, { token });
    expect(rejected.body.registration).toMatchObject({ status: 'REJECTED', rejectionReason: 'Amount does not match', pdfStatus: 'NOT_STARTED' });
    expect(sendMail).not.toHaveBeenCalled();
    expect([...files.objects.keys()].some((key) => key.startsWith('passes/'))).toBe(false);
    expect(sheets.rows[0]).toMatchObject({ status: 'REJECTED', notes: 'Rejected: Amount does not match' });

    const approve = await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect(approve.status).toBe(409);
    expect(sendMail).not.toHaveBeenCalled();

    const status = await call('POST', '/api/status', { registrationId: '261001', key: submitted.key });
    expect(status.body).toMatchObject({ status: 'REJECTED', passAvailable: false, reason: 'Amount does not match' });
    expect((await call('POST', '/api/pass', { registrationId: '261001', key: submitted.key })).status).toBe(403);

    // The student may register again with a new payment; the rejected transaction ID stays used.
    expect((await submit({ email: 'kavin@example.com', transactionId: 'UTR999999999' })).status).toBe(409);
    expect((await submit({ email: 'kavin@example.com', transactionId: 'UTR888888888' })).body.registrationId).toBe('261002');
    expect(await store.listRegistrations('PENDING')).toHaveLength(1);
  });

  it('cannot reject a registration that is already approved', async () => {
    const { submit, login, call } = setup();
    await submit();
    const token = await login();
    await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect((await call('POST', '/api/admin/registrations/261001/reject', {}, { token })).status).toBe(409);
  });
});

describe('failures', () => {
  it('keeps the registration APPROVED when the email fails, and retries it without a second pass', async () => {
    const sendMail = vi
      .fn<(mime: string) => Promise<string>>()
      .mockRejectedValueOnce(new GoogleApiError('Gmail: send: Invalid To header', 400, 'invalidArgument', false, false))
      .mockResolvedValue('gmail-message-1');
    const { submit, login, call, files, store } = setup({ sendMail });
    await submit();
    const token = await login();

    const approved = await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect(approved.body.registration).toMatchObject({ status: 'APPROVED', pdfStatus: 'GENERATED', emailStatus: 'FAILED' });
    expect(approved.body.registration.emailError).toMatch(/Invalid To header/);

    const retried = await call('POST', '/api/admin/registrations/261001/retry', {}, { token });
    expect(retried.body.registration).toMatchObject({ status: 'APPROVED', emailStatus: 'SENT', emailAttempts: 2 });
    expect((await store.getRegistration('261001'))?.emailMessageId).toBe('gmail-message-1');
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(files.puts.filter((key) => key.startsWith('passes/'))).toHaveLength(1);
  });

  it('does not resend an email Gmail may have sent, unless the admin confirms it', async () => {
    const sendMail = vi
      .fn<(mime: string) => Promise<string>>()
      .mockRejectedValueOnce(new GoogleApiError('Gmail: send: timed out', 0, 'timeout', true, true))
      .mockResolvedValue('gmail-message-2');
    const { submit, login, call, service } = setup({ sendMail });
    await submit();
    const token = await login();

    const approved = await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect(approved.body.registration.emailStatus).toBe('UNKNOWN');
    await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    await call('POST', '/api/admin/registrations/261001/retry', {}, { token });
    await service.runScheduled();
    expect(sendMail).toHaveBeenCalledTimes(1);

    const resent = await call('POST', '/api/admin/registrations/261001/retry', { resendEmail: true }, { token });
    expect(resent.body.registration.emailStatus).toBe('SENT');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('keeps the registration APPROVED when the pass cannot be made, and the scheduled job finishes it', async () => {
    const { submit, login, call, files, sendMail, service } = setup();
    await submit();
    const token = await login();
    files.failPuts = /^passes\//;

    const approved = await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect(approved.body.registration).toMatchObject({ status: 'APPROVED', pdfStatus: 'FAILED', emailStatus: 'NOT_SENT' });
    expect(sendMail).not.toHaveBeenCalled();

    files.failPuts = null;
    await service.runScheduled();
    const list = await call('GET', '/api/admin/registrations', undefined, { token });
    expect(list.body.registrations[0]).toMatchObject({ status: 'APPROVED', pdfStatus: 'GENERATED', emailStatus: 'SENT' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('never loses a registration while Google is down, and adds its row exactly once later', async () => {
    const { submit, login, call, sheets, service, store } = setup();
    // The scheduled job starts the ID counter soon after deploy, from the sheet.
    sheets.rows.push({ id: 'PRG26-0000' });
    await service.runScheduled();
    sheets.rows.length = 0;

    sheets.down = true;
    const submitted = await submit();
    expect(submitted.status).toBe(200);
    expect(submitted.body.registrationId).toBe('261001');
    expect(sheets.rows).toHaveLength(0);
    const token = await login();
    const listed = await call('GET', '/api/admin/registrations', undefined, { token });
    expect(listed.body.registrations[0].sheet).toMatchObject({ synced: false, error: expect.stringMatching(/timed out/) });

    sheets.down = false;
    sheets.loseNextAnswer = true; // the row is stored, but Google's answer is lost
    await service.runScheduled();
    await service.runScheduled();
    await service.runScheduled();
    expect(sheets.rows).toHaveLength(1);
    expect((await store.getRegistration('261001'))?.sheetRow).toBe(true);

    // An organiser deletes the row by mistake: the next change puts it back.
    sheets.rows.length = 0;
    await call('POST', '/api/admin/registrations/261001/approve', {}, { token });
    expect(sheets.rows).toHaveLength(1);
    expect(sheets.rows[0].status).toBe('APPROVED');
  });

  it('answers unexpected errors with a short message, never internal details', async () => {
    const { call, store } = setup();
    store.getRegistration = async () => {
      throw new Error('ProvisionedThroughputExceededException at arn:aws:dynamodb:secret-table');
    };
    const response = await call('POST', '/api/status', { registrationId: '261001', key: 'a'.repeat(32) });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toMatch(/arn:|dynamodb|Exception/);
  });
});
