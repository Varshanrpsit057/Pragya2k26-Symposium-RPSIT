/**
 * Looking after records: GPay payments made online verified by the desk or a coordinator,
 * correcting a student's details, deleting a record (admins only), help requests (Contact
 * admin) and the system status the web assistant team watches.
 */
import { describe, expect, it } from 'vitest';
import { ADMIN, TIMES, pngBytes, setup } from './testing';

const cash = { method: 'CASH', confirmedReceived: true };
const details = (overrides: Record<string, unknown> = {}) => ({
  name: 'Nila R',
  department: 'Computer Science and Engineering (CSE)',
  college: 'Sona College of Technology, Salem',
  year: '2nd Year',
  phone: '9840000001',
  email: 'walkin1@example.com',
  ...overrides,
});

describe('GPay payments made online', () => {
  it('can be verified by the desk or by a coordinator at the venue, not only by an admin', async () => {
    const h = setup({ at: TIMES.online });
    const first = (await h.submit()).body.registrationId as string;
    const second = (await h.submit()).body.registrationId as string;
    h.setTime(TIMES.eventDay);
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    expect((await h.call('GET', `/api/admin/registrations/${first}/screenshot`, undefined, { token: desk.token })).status).toBe(200);
    const byDesk = await h.call('POST', `/api/admin/registrations/${first}/approve`, {}, { token: desk.token });
    expect(byDesk.body.registration).toMatchObject({ status: 'APPROVED', reviewedBy: desk.username, pdfStatus: 'GENERATED', emailStatus: 'SENT' });
    const byCoordinator = await h.call('POST', `/api/admin/registrations/${second}/approve`, {}, { token: coordinator.token });
    expect(byCoordinator.body.registration).toMatchObject({ status: 'APPROVED', reviewedBy: coordinator.username });
    // Retrying failed steps and cancelling stay with admins (retries also with the web team).
    expect((await h.call('POST', `/api/admin/registrations/${first}/cancel`, { reason: 'x' }, { token: desk.token })).status).toBe(403);
  });
});

describe("correcting a student's details", () => {
  it('fixes a typo, makes a new pass with it, and can send the pass to a corrected email', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const support = await h.staff('SUPPORT');
    const id = (await h.onsite(desk.token, { phone: '9840000001', email: 'walkin1@example.com' })).body.registration.registrationId as string;
    const fix = (body: unknown, token = support.token) => h.call('POST', `/api/admin/registrations/${id}/details`, body, { token });
    expect(h.sendMail).toHaveBeenCalledTimes(1);

    const renamed = await fix(details({ name: '  Nila  Ramesh ', college: 'Kongu Engineering College, Perundurai' }));
    expect(renamed.status).toBe(200);
    expect(renamed.body.registration.participant).toMatchObject({ name: 'Nila Ramesh', college: 'Kongu Engineering College, Perundurai' });
    // A new pass with the corrected name; no second email unless asked for.
    expect(renamed.body.registration.pdfStatus).toBe('GENERATED');
    expect(h.sendMail).toHaveBeenCalledTimes(1);
    expect(h.sheets.rows.find((row) => row.id === id)?.name).toBe('Nila Ramesh');

    // A wrong email: corrected, the pass sent to the new one, and the old one free again.
    const moved = await fix(details({ name: 'Nila Ramesh', college: 'Kongu Engineering College, Perundurai', email: 'nila.r@example.com', resendEmail: true }), desk.token);
    expect(moved.body.registration).toMatchObject({ participant: { email: 'nila.r@example.com' }, emailStatus: 'SENT' });
    expect(h.sendMail).toHaveBeenCalledTimes(2);
    expect(await h.store.findClaim('email', 'nila.r@example.com')).toBe(id);
    expect(await h.store.findClaim('email', 'walkin1@example.com')).toBeNull();

    // Never an email or phone that belongs to someone else, and the same rules as the form.
    const other = (await h.onsite(desk.token, { email: 'taken@example.com', phone: '9840000002' })).body.registration.registrationId as string;
    const clash = await fix(details({ email: 'taken@example.com' }));
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: 'DUPLICATE_EMAIL', details: { registrationId: other } });
    expect(await h.store.findClaim('email', 'nila.r@example.com')).toBe(id);
    const phoneClash = await fix(details({ email: 'nila.r@example.com', phone: '9840000002' }));
    expect(phoneClash.body.code).toBe('DUPLICATE_PHONE');
    const invalid = await fix(details({ name: '', phone: '123' }));
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.fieldErrors)).toEqual(expect.arrayContaining(['name', 'phone']));
    // Coordinators cannot correct details.
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    expect((await fix(details(), coordinator.token)).status).toBe(403);
  });
});

describe('deleting a record', () => {
  it('takes it off every list (admins only), marks the Sheet row, frees the email and keeps who did it, and the data', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const id = (await h.onsite(desk.token, { email: 'test@example.com', phone: '9840011111' })).body.registration.registrationId as string;
    expect((await h.call('POST', `/api/admin/registrations/${id}/delete`, { reason: 'Test entry' }, { token: desk.token })).status).toBe(403);
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/delete`, {})).status).toBe(400);

    h.advance(60_000);
    const deleted = await h.asOwner('POST', `/api/admin/registrations/${id}/delete`, { reason: 'Test entry' });
    expect(deleted.body).toEqual({ success: true, deleted: id });
    expect(await h.store.getRegistration(id)).toBeNull();
    expect((await h.asOwner('GET', `/api/admin/registrations/${id}`)).status).toBe(404);
    // Nothing is lost: its files stay (private), and the whole record is kept in the log.
    expect(h.files.objects.has(`passes/${id}.pdf`)).toBe(true);
    expect(JSON.parse(h.store.audit[0].snapshot!).registrationId).toBe(id);
    expect(h.sheets.rows.find((row) => row.id === id)).toMatchObject({ status: 'DELETED', notes: 'Deleted by pragya-admin 2026-10-17 09:31:00: Test entry' });
    // The same student can be registered again.
    expect((await h.onsite(desk.token, { email: 'test@example.com', phone: '9840011111' })).status).toBe(200);
    // The system status keeps the deletion, with a name against it.
    const status = await h.asOwner('GET', '/api/admin/system');
    expect(status.body.deleted).toEqual([{ at: '2026-10-17T04:01:00.000Z', action: 'DELETED', registrationId: id, name: 'Nila R', by: ADMIN.username, reason: 'Test entry' }]);
  });

  it('is refused while an event fee is recorded or the student is a winner', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    const id = (await h.onsite(desk.token, { events: ['cognix'] })).body.registration.registrationId as string;
    await h.call('POST', `/api/admin/events/cognix/registrations/${id}/fee`, cash, { token: coordinator.token });
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/delete`, { reason: 'Duplicate' })).body.code).toBe('FEES_RECORDED');
    await h.call('POST', `/api/admin/events/cognix/registrations/${id}/attendance`, { present: true }, { token: coordinator.token });
    await h.call('POST', '/api/admin/events/cognix/winners', { first: [id] }, { token: coordinator.token });
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/delete`, { reason: 'Duplicate' })).body.code).toBe('IS_WINNER');
    expect(await h.store.getRegistration(id)).not.toBeNull();
  });
});

describe('Contact admin and the system status', () => {
  it('takes a help request from the sign-in page or the dashboard, for admins and the web team to resolve', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const support = await h.staff('SUPPORT');

    // Signed out (e.g. they cannot sign in): name and phone typed in.
    const signedOut = await h.call('POST', '/api/help', { category: 'SIGN_IN', message: 'My password does not work', name: 'Desk Four', contact: '9840000004' });
    expect(signedOut.status).toBe(200);
    h.advance(1000);
    // Signed in: named from the account, with where it happened and the student.
    await h.call('POST', '/api/help', { category: 'WRONG_DETAILS', message: 'Wrong college for 262001', registrationId: '262001', page: 'Registration desk', name: 'ignored' }, { token: desk.token });
    expect((await h.call('POST', '/api/help', { category: 'NOISE', message: 'x' })).status).toBe(400);
    expect((await h.call('POST', '/api/help', { category: 'OTHER', message: 'Hi', name: 'A' })).status).toBe(400);

    expect((await h.call('GET', '/api/admin/help', undefined, { token: desk.token })).status).toBe(403);
    const list = await h.call('GET', '/api/admin/help', undefined, { token: support.token });
    expect(list.body.requests).toEqual([
      expect.objectContaining({ category: 'WRONG_DETAILS', name: 'Staff 1', username: desk.username, registrationId: '262001', page: 'Registration desk', status: 'OPEN' }),
      expect.objectContaining({ category: 'SIGN_IN', name: 'Desk Four', contact: '9840000004', username: null, status: 'OPEN' }),
    ]);
    const id = list.body.requests[1].id as string;
    // The web team answers; the sender sees the answer under Contact admin.
    const answered = await h.call('POST', `/api/admin/help/${list.body.requests[0].id}`, { reply: 'Corrected to Sona College. Please check.' }, { token: support.token });
    expect(answered.body.request).toMatchObject({ status: 'OPEN', replies: [{ by: 'Staff 2', text: 'Corrected to Sona College. Please check.' }] });
    const mine = await h.call('GET', '/api/help/mine', undefined, { token: desk.token });
    expect(mine.body.requests).toEqual([expect.objectContaining({ registrationId: '262001', replies: [expect.objectContaining({ text: 'Corrected to Sona College. Please check.' })] })]);
    expect((await h.call('GET', '/api/help/mine')).status).toBe(401);
    expect((await h.call('POST', `/api/admin/help/${id}`, {}, { token: support.token })).status).toBe(400);
    const resolved = await h.call('POST', `/api/admin/help/${id}`, { status: 'RESOLVED', reply: 'Password reset' }, { token: support.token });
    expect(resolved.body.request).toMatchObject({ status: 'RESOLVED', resolvedBy: support.username, replies: [expect.objectContaining({ text: 'Password reset' })] });
    expect((await h.call('GET', '/api/admin/system', undefined, { token: support.token })).body.openHelp).toBe(1);
  });

  it('lists the registrations that need attention: failed passes, emails, Sheet copies and waiting payments', async () => {
    const h = setup({ at: TIMES.online });
    const waiting = (await h.submit()).body.registrationId as string;
    h.sendMail.mockRejectedValueOnce(new Error('Gmail refused'));
    const approved = (await h.submit()).body.registrationId as string;
    await h.asOwner('POST', `/api/admin/registrations/${approved}/approve`);
    h.setTime(TIMES.eventDay);
    const support = await h.staff('SUPPORT');
    const status = (await h.call('GET', '/api/admin/system', undefined, { token: support.token })).body;
    expect(status).toMatchObject({ phase: 'onsite', studentPortal: true, registrations: { total: 2, pending: 1, approved: 1 } });
    expect(status.counts).toMatchObject({ emailFailed: 1, paymentWaiting: 1 });
    expect(status.problems).toEqual([
      { registrationId: waiting, name: 'Varshan C', problems: [expect.stringMatching(/^GPay payment waiting for verification since/)] },
      { registrationId: approved, name: 'Varshan C', problems: [expect.stringMatching(/^Email failed: /)] },
    ]);
  });
});

describe('passes are not emailed for now', () => {
  it('makes the pass for the website and sends no email, even from the scheduled job', async () => {
    const h = setup({ at: TIMES.online, mail: { fromName: 'PRAGYA 2026', sender: null, replyTo: null, passByEmail: false } });
    const id = (await h.submit()).body.registrationId as string;
    const approved = await h.asOwner('POST', `/api/admin/registrations/${id}/approve`);
    expect(approved.body.registration).toMatchObject({ status: 'APPROVED', pdfStatus: 'GENERATED', emailStatus: 'NOT_SENT' });
    await h.service.runScheduled();
    expect(h.sendMail).not.toHaveBeenCalled();
    const session = await h.asOwner('GET', '/api/admin/session');
    expect(session.body.passByEmail).toBe(false);
  });
});

describe('payment screenshots from students', () => {
  it('lets a student upload the GPay screenshot of a desk or venue payment, for the staff to check', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
    const id = (await h.onsite(desk.token, { phone: '9840012345', events: ['viz-craft'], payment: { method: 'UPI', confirmedReceived: true } })).body.registration
      .registrationId as string;
    const credentials = { registrationId: id, phone: '9840012345' };

    const ticket = await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 });
    expect(ticket.status).toBe(200);
    h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
    const added = await h.call('POST', '/api/student/proof', { ...credentials, uploadId: ticket.body.uploadId, kind: 'GATE_PASS', transactionId: 'utr 1234 5678'.replace(/\s/g, '') });
    expect(added.status).toBe(200);
    expect(added.body.proofs).toEqual([{ kind: 'GATE_PASS', label: 'Gate pass ₹100', uploadedAt: '2026-10-17T04:00:00.000Z' }]);

    // The staff see it in the record and can open it; the upload itself is gone.
    const record = (await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: desk.token })).body.registration;
    expect(record.proofs).toEqual([expect.objectContaining({ kind: 'GATE_PASS', label: 'Gate pass ₹100', transactionId: 'UTR12345678' })]);
    const url = await h.call('GET', `/api/admin/registrations/${id}/proofs/${record.proofs[0].id}`, undefined, { token: coordinator.token });
    expect(url.body.url).toMatch(/proofs\/262001\/[a-f0-9-]+\.png\?X-Amz-Expires=300/);
    expect(h.files.objects.has(ticket.body.fields.key)).toBe(false);

    // Only for their own events, only images, and only with the right phone.
    const again = (await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 })).body;
    h.files.objects.set(again.fields.key, { bytes: pngBytes(), type: 'image/png' });
    expect((await h.call('POST', '/api/student/proof', { ...credentials, uploadId: again.uploadId, kind: 'cognix' })).body.code).toBe('INVALID');
    expect((await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'application/pdf', size: 2048 })).status).toBe(400);
    expect((await h.call('POST', '/api/student/upload', { registrationId: id, phone: '9840099999', contentType: 'image/png', size: 2048 })).status).toBe(404);
    h.files.objects.set(again.fields.key, { bytes: new Uint8Array(500), type: 'image/png' });
    expect((await h.call('POST', '/api/student/proof', { ...credentials, uploadId: again.uploadId, kind: 'viz-craft' })).status).toBe(400);
  });
});
