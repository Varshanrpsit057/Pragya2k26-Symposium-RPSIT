/**
 * Students registering themselves on their phones (no sign-in): IDs from 20001, events in any
 * department, the entry fee's UPI transaction ID checked by any department's desk.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FestRegistration, StudentView } from '../src/lib/fest';
import { TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

let count = 0;
const form = (extra: Record<string, unknown> = {}) => {
  count += 1;
  return {
    submissionId: `self-key-${String(count).padStart(16, '0')}`,
    participant: { name: 'Divya R', phone: `98${String(40000000 + count).padStart(8, '0')}`, email: '', college: 'Sona College of Technology', branch: 'B.E. ECE', year: '3rd Year', team: '' },
    events: ['cse-hackathon', 'it-web-architects'],
    txn: '412345678901',
    ...extra,
  };
};
const selfRegister = (h: Harness, body: unknown, ip = '10.1.1.1') => h.call('POST', '/api/fest/register', body, { ip });
const me = (h: Harness, id: string, phone: string) => h.call('POST', '/api/fest/me', { id, phone }, { ip: '10.1.1.2' });
const view = (response: { body: { registration: StudentView } }) => response.body.registration;

describe('a student registering on their phone', () => {
  it('gets the next ID from 20001 at once, with events from any department, waiting for a desk to check the payment', async () => {
    const h = setup({ at: TIMES.eventDay });
    const info = await h.call('GET', '/api/fest/info');
    expect(info.body).toMatchObject({ open: true, entryFee: 100, upiId: expect.stringContaining('@') });
    expect(info.body.events).toHaveLength(44);

    const first = await selfRegister(h, form());
    expect(first.status).toBe(200);
    expect(view(first)).toMatchObject({ id: '20001', status: 'waiting', txnEnd: '8901', canChange: true, entryFee: 100, phoneEnd: expect.any(String) });
    expect(JSON.stringify(first.body)).not.toContain('412345678901'); // the page never shows the whole transaction ID
    expect(view(first).events.map((item) => item.eventId)).toEqual(['cse-hackathon', 'it-web-architects']);
    expect(view(await selfRegister(h, form({ txn: '412345678902' })))).toMatchObject({ id: '20002' });

    // A retry of the same submission (a dropped connection) returns the same registration.
    const again = form();
    await selfRegister(h, again);
    expect((await selfRegister(h, again)).body).toMatchObject({ replayed: true, registration: { id: '20003' } });
  });

  it('is told plainly when something is missing, the number is already registered, or registration is closed', async () => {
    const h = setup({ at: TIMES.eventDay });
    expect((await selfRegister(h, form({ txn: '' }))).body).toMatchObject({ code: 'INVALID', details: { txn: expect.any(String) } });
    const body = form();
    await selfRegister(h, body);
    const twice = await selfRegister(h, { ...form(), participant: body.participant });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('DUPLICATE_PHONE');
    expect(twice.body.error).not.toMatch(/2000\d/); // never tells a stranger someone's ID

    h.setTime(TIMES.closed);
    expect((await selfRegister(h, form())).body.code).toBe('ONSITE_CLOSED');
    expect((await h.call('GET', '/api/fest/info')).body.open).toBe(false);
  });

  it('changes their events only from the phone that registered (its private key); the ID and mobile number only show', async () => {
    const h = setup({ at: TIMES.eventDay });
    const body = form();
    await selfRegister(h, body);
    expect(view(await me(h, '20001', body.participant.phone))).toMatchObject({ id: '20001', name: 'Divya R', canChange: false });
    expect((await me(h, '20001', '9999999999')).status).toBe(404);
    expect((await me(h, ' 20001 ', `+91 ${body.participant.phone}`)).status).toBe(200);

    // With only the ID and mobile number: no changes.
    const refused = await h.call('POST', '/api/fest/me/events', { id: '20001', phone: body.participant.phone, add: ['mech-aqua-rocket'] }, { ip: '10.1.1.2' });
    expect(refused.body.code).toBe('KEY_NEEDED');
    expect((await h.call('POST', '/api/fest/me', { id: '20001', key: 'self-key-0000000000009999' }, { ip: '10.1.1.2' })).status).toBe(404);

    // From the phone that registered: adds an event of a third department, and drops one.
    const changed = await h.call('POST', '/api/fest/me/events', { id: '20001', key: body.submissionId, add: ['mech-aqua-rocket'], remove: ['cse-hackathon'] }, { ip: '10.1.1.2' });
    expect(view(changed)).toMatchObject({ canChange: true });
    expect(view(changed).events.map((item) => item.eventId)).toEqual(['it-web-architects', 'mech-aqua-rocket']);
  });

  it('cannot be found by trying IDs one by one with a known mobile number', async () => {
    const h = setup({ at: TIMES.eventDay });
    const body = form();
    await selfRegister(h, body);
    for (let n = 0; n < 10; n += 1) expect((await h.call('POST', '/api/fest/me', { id: '20001', phone: '9999999999' }, { ip: `10.2.0.${n}` })).status).toBe(404);
    // The 11th try for that ID within 10 minutes is refused, whatever the address and even with the right number.
    const blocked = await h.call('POST', '/api/fest/me', { id: '20001', phone: body.participant.phone }, { ip: '10.2.1.1' });
    expect(blocked.status).toBe(429);
    // The phone that registered (its key) is not affected.
    expect((await h.call('POST', '/api/fest/me', { id: '20001', key: body.submissionId }, { ip: '10.2.1.1' })).status).toBe(200);
  });
});

describe('any department’s desk', () => {
  it('finds self-registered students, checks the transaction ID by hand and verifies them; an ID is accepted once', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = form();
    const b = form({ txn: a.txn });
    await selfRegister(h, a);
    await selfRegister(h, b);
    const itDesk = await h.staff('DESK', [], 'it-desk2', { department: 'IT', deskNumber: 2 });
    const mechDesk = await h.staff('DESK', [], 'mech-desk1', { department: 'MECH', deskNumber: 1 });

    const seen = (await h.call('POST', '/api/admin/fest/sync', {}, { token: mechDesk.token })).body.registrations as FestRegistration[];
    expect(seen.map((item) => item.id).sort()).toEqual(['20001', '20002']);
    expect(seen[0]).toMatchObject({ source: 'SELF', dept: 'OPEN', entry: { status: 'DUE', claim: { txn: a.txn, amount: 100 } } });

    expect((await h.call('POST', '/api/admin/fest/registrations/20001', { action: 'verify' }, { token: itDesk.token })).body.code).toBe('INVALID');
    const verified = await h.call('POST', '/api/admin/fest/registrations/20001', { action: 'verify', confirmed: true }, { token: itDesk.token });
    expect(verified.body.registration).toMatchObject({ entry: { status: 'PAID', payment: { method: 'UPI', amount: 100, txn: a.txn, desk: 2, by: 'it-desk2' } }, checkedIn: { by: 'it-desk2' } });
    expect(view(await me(h, '20001', a.participant.phone)).status).toBe('verified');

    // The second student typed the same transaction ID: refused, naming who has it.
    const used = await h.call('POST', '/api/admin/fest/registrations/20002', { action: 'verify', confirmed: true }, { token: mechDesk.token });
    expect(used.body).toMatchObject({ code: 'TXN_USED', details: { existingId: '20001' } });
  });

  it('marks a payment not received; the student sends the right transaction ID and the desk verifies that one', async () => {
    const h = setup({ at: TIMES.eventDay });
    const body = form();
    await selfRegister(h, body);
    const desk = await h.staff('DESK', [], 'cse-desk3', { department: 'CSE', deskNumber: 3 });
    expect((await h.call('POST', '/api/admin/fest/registrations/20001', { action: 'reject', reason: 'x' }, { token: desk.token })).body.code).toBe('INVALID');
    await h.call('POST', '/api/admin/fest/registrations/20001', { action: 'reject', reason: 'Not received' }, { token: desk.token });
    expect(view(await me(h, '20001', body.participant.phone))).toMatchObject({ status: 'rejected', reason: 'Not received' });

    const resent = await h.call('POST', '/api/fest/me/payment', { id: '20001', key: body.submissionId, txn: '512345678901' }, { ip: '10.1.1.2' });
    expect(view(resent)).toMatchObject({ status: 'waiting', txnEnd: '8901', reason: '' });
    const verified = await h.call('POST', '/api/admin/fest/registrations/20001', { action: 'verify', confirmed: true }, { token: desk.token });
    expect(verified.body.registration.entry).toMatchObject({ status: 'PAID', payment: { txn: '512345678901' } });
  });
});

describe('another department’s event', () => {
  it('takes a self-registered student only once verified, then the fee, attendance and the winners', async () => {
    const h = setup({ at: TIMES.eventDay });
    const body = form();
    await selfRegister(h, body);
    const coordinator = await h.staff('COORDINATOR', ['it-web-architects'], 'it-web-1', { department: 'IT' });
    const desk = await h.staff('DESK', [], 'eee-desk1', { department: 'EEE', deskNumber: 1 });
    const event = (action: string, extra: Record<string, unknown> = {}) =>
      h.call('POST', '/api/admin/fest/registrations/20001/events/it-web-architects', { action, ...extra }, { token: coordinator.token });

    expect((await h.call('POST', '/api/admin/fest/sync', {}, { token: coordinator.token })).body.registrations.map((item: FestRegistration) => item.id)).toEqual(['20001']);
    expect((await event('fee', { payment: { method: 'CASH', confirmed: true } })).status).toBe(200);
    expect((await event('present')).body.code).toBe('ENTRY_DUE');
    await h.call('POST', '/api/admin/fest/registrations/20001', { action: 'verify', confirmed: true }, { token: desk.token });
    expect((await event('present')).status).toBe(200);

    const results = await h.call('POST', '/api/admin/fest/events/it-web-architects/results', { action: 'submit', places: [{ place: 1, ids: ['20001'] }] }, { token: coordinator.token });
    expect(results.body.result).toMatchObject({ places: [{ place: 1, ids: ['20001'] }], submitted: { by: 'it-web-1' } });
  });
});

describe('test data', () => {
  it('deletes self-registrations made in a test session and starts their IDs again at 20001', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'start', label: 'Rehearsal' });
    await selfRegister(h, form());
    await selfRegister(h, form({ txn: '412345678903' }));
    expect((await h.asOwner('POST', '/api/admin/fest/test-data/clear', {})).body).toMatchObject({ cleared: 2, remaining: 0, restarted: expect.arrayContaining(['OPEN']) });
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'stop' });
    expect(view(await selfRegister(h, form({ txn: '412345678904' }))).id).toBe('20001');
  });
});
