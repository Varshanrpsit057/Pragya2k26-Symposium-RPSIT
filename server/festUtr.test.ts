/**
 * "Who does this UTR belong to?": a desk looks a UTR up across every department (the student it
 * was accepted for and everyone who sent it), then gives it to the student it really belongs to.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StudentView } from '../src/lib/fest';
import { TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

const UTR = '712345678901';
const student = (n: number, dept: string) => ({
  submissionId: `utr-owner-key-00000000${n}`,
  dept,
  participant: { name: `Student ${'ABCDE'[n]}`, phone: `97880000${String(n).padStart(2, '0')}`, college: 'Sona College of Technology, Salem', branch: 'B.E. CSE', year: '2nd Year', email: `u${n}@example.com` },
  events: [],
});
async function selfWithUtr(h: Harness, n: number, dept: string) {
  const body = student(n, dept);
  const registered = await h.call('POST', '/api/fest/register', body, { ip: '10.7.0.1' });
  await h.call('POST', '/api/fest/me/payment', { id: registered.body.registration.id, key: body.submissionId, txn: UTR }, { ip: '10.7.0.1' });
  return { id: registered.body.registration.id as string, key: body.submissionId };
}

describe('who does a UTR belong to', () => {
  it('lists everyone with the UTR in every department, and gives it to the student it belongs to', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = await selfWithUtr(h, 0, 'CSE');
    const b = await selfWithUtr(h, 1, 'CSE');
    // An IT desk took the same UTR for an IT student (wrongly: it was the CSE student's payment).
    await h.call('POST', '/api/fest/register', student(2, 'IT'), { ip: '10.7.0.1' });
    const itDesk = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    expect((await h.call('POST', '/api/admin/fest/registrations/IT-2001', { action: 'checkin', payment: { method: 'UPI', txn: UTR, confirmed: true } }, { token: itDesk.token })).status).toBe(200);

    const cseDesk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const lookup = await h.call('POST', '/api/admin/fest/utr', { txn: '7123 4567 8901' }, { token: cseDesk.token });
    expect(lookup.body.holders.map((item: { id: string; state: string; dept: string }) => [item.id, item.state, item.dept])).toEqual([
      ['IT-2001', 'accepted', 'IT'],
      [a.id, 'sent', 'CSE'],
      [b.id, 'sent', 'CSE'],
    ]);
    expect(lookup.body.holders[0]).toMatchObject({ name: 'Student C', college: 'Sona College of Technology, Salem', by: 'it-desk1' });

    // Needs the tick, and only the department's own students (another department's desk may not).
    expect((await h.call('POST', '/api/admin/fest/utr/assign', { txn: UTR, to: b.id }, { token: cseDesk.token })).body.code).toBe('INVALID');
    expect((await h.call('POST', '/api/admin/fest/utr/assign', { txn: UTR, to: b.id, confirmed: true }, { token: itDesk.token })).body.code).toBe('OTHER_DEPARTMENT');

    const given = await h.call('POST', '/api/admin/fest/utr/assign', { txn: UTR, to: b.id, confirmed: true }, { token: cseDesk.token });
    expect(given.body).toMatchObject({ registration: { id: b.id, entry: { status: 'PAID', payment: { method: 'UPI', txn: UTR, by: 'cse-desk1' } } }, movedFrom: 'IT-2001', notFound: [a.id] });

    // Everyone sees what happened: the IT student is back to not paid, the other CSE student is told whose UTR it is.
    const owner = await h.asOwner('POST', '/api/admin/fest/sync', {});
    const it = owner.body.registrations.find((item: { id: string }) => item.id === 'IT-2001');
    expect(it.entry).toMatchObject({ status: 'DUE', rejected: { reason: `UTR ending 8901 belongs to ${b.id}` } });
    const view = (await h.call('POST', '/api/fest/me', { id: a.id, key: a.key }, { ip: '10.7.0.2' })).body.registration as StudentView;
    expect(view).toMatchObject({ status: 'rejected', reason: `UTR ending 8901 belongs to ${b.id}` });
    // The UTR is now that student's: it cannot be accepted for anyone else.
    expect((await h.call('POST', '/api/admin/fest/registrations/IT-2001', { action: 'entry', payment: { method: 'UPI', txn: UTR, confirmed: true } }, { token: itDesk.token })).body).toMatchObject({ code: 'TXN_USED', details: { existingId: b.id } });
    expect((await h.call('POST', '/api/admin/fest/utr', { txn: UTR }, { token: itDesk.token })).body.holders.find((item: { state: string }) => item.state === 'accepted').id).toBe(b.id);
  });

  it('refuses a student who has already paid another way, and is not for event coordinators', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.call('POST', '/api/fest/register', student(0, 'CSE'), { ip: '10.7.0.1' });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await h.call('POST', '/api/admin/fest/registrations/CSE-2001', { action: 'checkin', payment: { method: 'CASH', confirmed: true } }, { token: desk.token });
    expect((await h.call('POST', '/api/admin/fest/utr/assign', { txn: UTR, to: 'CSE-2001', confirmed: true }, { token: desk.token })).body).toMatchObject({ code: 'ALREADY_PAID', error: expect.stringContaining('cash') });
    expect((await h.call('POST', '/api/admin/fest/utr', { txn: '12' }, { token: desk.token })).body.code).toBe('INVALID');
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    expect((await h.call('POST', '/api/admin/fest/utr', { txn: UTR }, { token: coordinator.token })).status).toBe(403);
  });
});
