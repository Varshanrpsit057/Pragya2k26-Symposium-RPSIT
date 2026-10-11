/**
 * 30 students at the same moment: four desks registering at once, students uploading their
 * GPay screenshots together, two staff approving the same payment at the same instant. Every
 * record must be kept, every ID unique, every payment recorded once: no lost or mixed-up data.
 */
import { describe, expect, it } from 'vitest';
import { STAFF_PASSWORD, TIMES, pngBytes, setup } from './testing';

const STUDENTS = 30;
const phoneOf = (n: number) => `98400${String(10000 + n).padStart(5, '0')}`;
/** Letters only, as names must be: Student A … Student Z, Student AA … */
const nameOf = (n: number) => `Student ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? 'A' : ''}`;

async function fourDesks() {
  const h = setup({ at: TIMES.eventDay });
  const tokens: string[] = [];
  for (let desk = 1; desk <= 4; desk += 1) {
    await h.staff('DESK', [], `desk${desk}`);
    tokens.push((await h.call('POST', '/api/admin/login', { username: `desk${desk}`, password: STAFF_PASSWORD, deskNumber: desk })).body.token as string);
  }
  return { h, tokens };
}

describe('30 students at the same moment', () => {
  it('registers 30 walk-ins from four desks at once: every one kept, with its own ID and desk, nothing mixed up', async () => {
    const { h, tokens } = await fourDesks();
    const results = await Promise.all(
      Array.from({ length: STUDENTS }, (_, n) =>
        h.onsite(tokens[n % 4], { name: nameOf(n), phone: phoneOf(n), email: `student${n}@example.com`, events: ['viz-craft'], payment: n % 2 ? { method: 'UPI', studentPays: true } : undefined }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(Array(STUDENTS).fill(200));
    const registrations = results.map((result) => result.body.registration);
    const ids = registrations.map((registration) => registration.registrationId);
    expect(new Set(ids).size).toBe(STUDENTS);
    expect([...ids].sort()).toEqual(Array.from({ length: STUDENTS }, (_, n) => `262${String(n + 1).padStart(3, '0')}`));
    // Each record is the student it was sent for, at the desk that sent it.
    registrations.forEach((registration, n) => {
      expect(registration.participant).toMatchObject({ name: nameOf(n), phone: phoneOf(n) });
      expect(registration.deskNumber).toBe((n % 4) + 1);
    });
    const report = (await h.asOwner('GET', '/api/admin/reports')).body.report;
    expect(report.desks.map((desk: { registrations: number }) => desk.registrations)).toEqual([8, 8, 7, 7]);
    // The same phone sent twice at once from two desks: one registration only.
    const twice = await Promise.all([h.onsite(tokens[0], { phone: '9999900000', email: 'a@example.com' }), h.onsite(tokens[1], { phone: '9999900000', email: 'b@example.com' })]);
    expect(twice.map((result) => result.status).sort()).toEqual([200, 409]);
    // Every one reaches the Google Sheet, once.
    await h.service.runScheduled();
    expect(h.sheets.rows.map((row) => row.id).filter((id) => ids.includes(String(id))).sort()).toEqual([...ids].sort());
  });

  it('takes 30 students’ screenshots at once and lets two desks approve the same payment at the same instant without a clash', async () => {
    const { h, tokens } = await fourDesks();
    const ids: string[] = [];
    for (let n = 0; n < STUDENTS; n += 1) {
      ids.push((await h.onsite(tokens[n % 4], { phone: phoneOf(n), email: `s${n}@example.com`, payment: { method: 'UPI', studentPays: true } })).body.registration.registrationId as string);
    }
    // All 30 upload together (as on the campus Wi-Fi: one network address).
    const uploads = await Promise.all(
      ids.map(async (id, n) => {
        const credentials = { registrationId: id, phone: phoneOf(n) };
        const ticket = await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 });
        h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
        return h.call('POST', '/api/student/proof', { ...credentials, uploadId: ticket.body.uploadId, kind: 'GATE_PASS', transactionId: `UTR${String(100000 + n)}` });
      }),
    );
    expect(uploads.map((result) => result.status)).toEqual(Array(STUDENTS).fill(200));
    for (const [n, id] of ids.entries()) {
      const record = (await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: tokens[0] })).body.registration;
      expect(record.proofs).toEqual([expect.objectContaining({ kind: 'GATE_PASS', transactionId: `UTR${String(100000 + n)}` })]);
    }

    // Every payment approved by two desks at the same instant (different IDs typed): approved once.
    const approvals = await Promise.all(
      ids.flatMap((id, n) => [
        h.call('POST', `/api/admin/registrations/${id}/approve`, { payment: { method: 'UPI', reference: `UTR${String(100000 + n)}` } }, { token: tokens[n % 4] }),
        h.call('POST', `/api/admin/registrations/${id}/approve`, { payment: { method: 'UPI', reference: `UTRX${String(100000 + n)}` } }, { token: tokens[(n + 1) % 4] }),
      ]),
    );
    expect(approvals.every((result) => result.status === 200)).toBe(true);
    for (const id of ids) {
      const record = (await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: tokens[0] })).body.registration;
      expect(record.status).toBe('APPROVED');
      expect(record.gatePass.status).toBe('VERIFIED');
    }
    // One gate pass each in the totals, and the losing transaction IDs were freed again.
    const report = (await h.asOwner('GET', '/api/admin/reports')).body.report;
    expect(report.gatePass.deskUpi).toEqual({ count: STUDENTS, amount: STUDENTS * 100 });
    const recorded = await Promise.all(ids.map(async (id) => (await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: tokens[0] })).body.registration.gatePass.reference as string));
    const freed = recorded.map((reference) => (reference.startsWith('UTRX') ? reference.replace('UTRX', 'UTR') : reference.replace('UTR', 'UTRX')));
    for (const reference of freed) expect(await h.store.findClaim('transaction', reference)).toBeNull();
    // And one pass per student.
    expect([...h.files.objects.keys()].filter((key) => key.startsWith('passes/')).length).toBe(STUDENTS);
  });
});
