/**
 * The desk's money: the entry fee collected (cash or UPI) or the UTR the student sent verified; a
 * UTR counts once across the fest; a clash shows everyone with the UTR, and either desk corrects
 * the wrong one, kept in that student's UTR log.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FestRegistration, StudentView } from '../src/lib/fest';
import { TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

const UTR = '712345678901';
const student = (n: number, dept: string) => ({
  submissionId: `utr-owner-key-00000000${String(n).padStart(2, '0')}`,
  dept,
  participant: { name: `Student ${'ABCDEFGHIJ'[n]}`, phone: `97880000${String(n).padStart(2, '0')}`, college: 'Sona College of Technology, Salem', collegeCode: '2615', branch: 'B.E. CSE', year: '2nd Year', email: `u${n}@example.com` },
  events: [],
});
/** A student registers on their phone (and, with `utr`, pays by UPI and sends it). */
async function onPhone(h: Harness, n: number, dept: string, utr = '') {
  const body = student(n, dept);
  const registered = await h.call('POST', '/api/fest/register', body, { ip: '10.7.0.1' });
  expect(registered.status).toBe(200);
  if (utr) expect((await h.call('POST', '/api/fest/me/payment', { id: registered.body.registration.id, key: body.submissionId, txn: utr }, { ip: '10.7.0.1' })).status).toBe(200);
  return { id: registered.body.registration.id as string, key: body.submissionId };
}
const act = (h: Harness, token: string, id: string, body: Record<string, unknown>) => h.call('POST', `/api/admin/fest/registrations/${id}`, body, { token });
const cash = { method: 'CASH', confirmed: true };
const upi = (txn: string) => ({ method: 'UPI', txn, confirmed: true });

describe('the entry fee at the desk', () => {
  it('collects cash or UPI from anyone whose fee is due, once; a UTR counts once across the fest', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await onPhone(h, 0, 'CSE');
    const b = await onPhone(h, 1, 'CSE');
    const c = await onPhone(h, 2, 'IT');
    const cse = await h.staff('DESK', [], 'cse-desk2', { department: 'CSE', deskNumber: 2 });
    const it = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });

    const paid = await act(h, cse.token, a.id, { action: 'collect', payment: cash });
    expect(paid.body).toMatchObject({ changed: true, registration: { entry: { status: 'PAID', payment: { method: 'CASH', amount: 100, by: 'cse-desk2', desk: 2 } }, checkedIn: { by: 'cse-desk2', desk: 2 } } });
    // Collected twice (a double tap, a retry): nothing changes.
    expect((await act(h, cse.token, a.id, { action: 'collect', payment: upi(UTR) })).body).toMatchObject({ changed: false, registration: { entry: { payment: { method: 'CASH' } } } });
    // Only the department's own desk, and the payment must be ticked as received.
    expect((await act(h, it.token, a.id, { action: 'collect', payment: cash })).status).toBe(403);
    expect((await act(h, cse.token, b.id, { action: 'collect', payment: { method: 'CASH' } })).body.code).toBe('INVALID');

    expect((await act(h, cse.token, b.id, { action: 'collect', payment: upi(UTR) })).body.registration.entry.payment).toMatchObject({ method: 'UPI', txn: UTR });
    // The same request again (the answer was lost): the UTR stays b's.
    expect((await act(h, cse.token, b.id, { action: 'collect', payment: upi(UTR) })).body.changed).toBe(false);
    const used = await act(h, it.token, c.id, { action: 'collect', payment: upi(UTR) });
    expect(used.body).toMatchObject({ code: 'TXN_USED', details: { existingId: b.id } });

    // What the student sees on their page.
    const view = (await h.call('POST', '/api/fest/me', { id: b.id, key: b.key }, { ip: '10.7.0.2' })).body.registration as StudentView;
    expect(view).toMatchObject({ status: 'verified', paid: { amount: 100, method: 'UPI', desk: 2 } });
  });

  it('verifies the UTR the student sent; a typo is corrected only when ticked, and logged', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await onPhone(h, 0, 'CSE', UTR);
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const typed = '712345678910';
    expect((await act(h, desk.token, a.id, { action: 'verify', txn: typed, confirmed: true })).body).toMatchObject({ code: 'TXN_MISMATCH', error: expect.stringContaining('8901') });
    expect((await act(h, desk.token, a.id, { action: 'verify', txn: typed, correct: true })).body.code).toBe('INVALID');
    const verified = (await act(h, desk.token, a.id, { action: 'verify', txn: typed, correct: true, confirmed: true })).body.registration as FestRegistration;
    expect(verified.entry).toMatchObject({ status: 'PAID', payment: { method: 'UPI', txn: typed, by: 'cse-desk1', desk: 1 }, claim: { txn: UTR } });
    expect(verified.utrLog).toEqual([expect.objectContaining({ from: UTR, to: typed, by: 'cse-desk1' })]);
    expect(verified.checkedIn).toMatchObject({ by: 'cse-desk1' });
    // A student who sent a UTR may still pay cash at the desk instead (the UTR they sent stays on record).
    const b = await onPhone(h, 1, 'CSE', '712345678955');
    expect((await act(h, desk.token, b.id, { action: 'collect', payment: cash })).body.registration.entry).toMatchObject({ status: 'PAID', payment: { method: 'CASH' }, claim: { txn: '712345678955' } });
    // Verifying needs a UTR the student sent.
    const c = await onPhone(h, 2, 'CSE');
    expect((await act(h, desk.token, c.id, { action: 'verify', txn: UTR, confirmed: true })).body.code).toBe('NO_CLAIM');
  });

  it('shows everyone with a clashing UTR, in every department, and either desk corrects the wrong one', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await onPhone(h, 0, 'CSE', UTR);
    const itStudent = await onPhone(h, 1, 'IT');
    const itDesk = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    const cseDesk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const eceDesk = await h.staff('DESK', [], 'ece-desk1', { department: 'ECE', deskNumber: 1 });
    // The IT desk took the CSE student's payment for an IT student by mistake.
    expect((await act(h, itDesk.token, itStudent.id, { action: 'collect', payment: upi(UTR) })).status).toBe(200);

    const refused = await act(h, cseDesk.token, a.id, { action: 'verify', txn: UTR, confirmed: true });
    expect(refused.body).toMatchObject({ code: 'TXN_USED', details: { existingId: itStudent.id } });
    const lookup = await h.call('POST', '/api/admin/fest/utr', { txn: '7123 4567 8901' }, { token: cseDesk.token });
    expect(lookup.body.holders.map((item: { id: string; state: string; dept: string }) => [item.id, item.state, item.dept])).toEqual([
      [itStudent.id, 'accepted', 'IT'],
      [a.id, 'sent', 'CSE'],
    ]);
    expect(lookup.body.holders[0]).toMatchObject({ name: 'Student B', phone: '9788000001', college: 'Sona College of Technology, Salem', by: 'it-desk1' });

    // A department not in the clash may not touch it; the CSE desk may correct the IT student's UTR.
    const right = '712345678999';
    expect((await act(h, eceDesk.token, itStudent.id, { action: 'utr', txn: right, reason: 'Not ours' })).body.code).toBe('OTHER_DEPARTMENT');
    expect((await act(h, cseDesk.token, itStudent.id, { action: 'utr', txn: right })).body.code).toBe('INVALID');
    const changed = (await act(h, cseDesk.token, itStudent.id, { action: 'utr', txn: right, reason: 'Their payment screen shows 8999' })).body.registration as FestRegistration;
    expect(changed.entry.payment).toMatchObject({ method: 'UPI', txn: right, by: 'it-desk1' });
    expect(changed.utrLog).toEqual([expect.objectContaining({ from: UTR, to: right, reason: 'Their payment screen shows 8999', by: 'cse-desk1' })]);

    // The UTR is free again: the CSE student is verified with it.
    expect((await act(h, cseDesk.token, a.id, { action: 'verify', txn: UTR, confirmed: true })).body.registration.entry).toMatchObject({ status: 'PAID', payment: { txn: UTR } });
    expect((await h.call('POST', '/api/admin/fest/utr', { txn: UTR }, { token: itDesk.token })).body.holders.map((item: { id: string }) => item.id)).toEqual([a.id]);
    // The IT student's new UTR counts once too.
    const other = await onPhone(h, 2, 'IT');
    expect((await act(h, itDesk.token, other.id, { action: 'collect', payment: upi(right) })).body).toMatchObject({ code: 'TXN_USED', details: { existingId: itStudent.id } });
  });

  it('corrects a UTR the student sent before it is verified (a "not found" mark goes), refusing one already accepted', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await onPhone(h, 0, 'CSE', UTR);
    const b = await onPhone(h, 1, 'CSE');
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await act(h, desk.token, a.id, { action: 'reject', reason: 'Not received' });
    await act(h, desk.token, b.id, { action: 'collect', payment: upi('712345678902') });
    expect((await act(h, desk.token, a.id, { action: 'utr', txn: '712345678902', reason: 'Typed wrong' })).body).toMatchObject({ code: 'TXN_USED', details: { existingId: b.id } });
    const fixed = (await act(h, desk.token, a.id, { action: 'utr', txn: '712345678903', reason: 'Typed wrong' })).body.registration as FestRegistration;
    expect(fixed.entry).toEqual({ status: 'DUE', claim: expect.objectContaining({ txn: '712345678903' }) });
    expect(fixed.utrLog?.[0]).toMatchObject({ from: UTR, to: '712345678903' });
  });

  it('gives a cancelled registration’s UTR back; restoring it takes the UTR again only if nobody has it', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await onPhone(h, 0, 'CSE');
    const b = await onPhone(h, 1, 'CSE');
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const admin = await h.staff('DEPT_ADMIN', [], 'cse-admin', { department: 'CSE' });
    await act(h, desk.token, a.id, { action: 'collect', payment: upi(UTR) });
    expect((await act(h, admin.token, a.id, { action: 'cancel', reason: 'Wrong department' })).status).toBe(200);
    expect((await act(h, desk.token, b.id, { action: 'collect', payment: upi(UTR) })).body.registration.entry.payment.txn).toBe(UTR);
    expect((await act(h, admin.token, a.id, { action: 'uncancel' })).body).toMatchObject({ code: 'TXN_USED', details: { existingId: b.id } });
  });

  it('is for the desks: event coordinators cannot look up or change UTRs; a UTR must look like one', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await onPhone(h, 0, 'CSE', UTR);
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    expect((await h.call('POST', '/api/admin/fest/utr', { txn: '12' }, { token: desk.token })).body.code).toBe('INVALID');
    expect((await h.call('POST', '/api/admin/fest/utr', { txn: UTR }, { token: coordinator.token })).status).toBe(403);
    expect((await act(h, coordinator.token, a.id, { action: 'utr', txn: '712345678999', reason: 'Typed wrong' })).status).toBe(403);
    expect((await act(h, desk.token, a.id, { action: 'utr', txn: '12', reason: 'Typed wrong' })).body.code).toBe('INVALID');
    // The old "give it to them" is gone.
    expect((await h.call('POST', '/api/admin/fest/utr/assign', { txn: UTR, to: a.id, confirmed: true }, { token: desk.token })).status).toBe(404);
  });
});
