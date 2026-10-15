/**
 * Website controls through the API: the web assist team switches each part of the portal off and
 * on, uploads the UPI QR code students pay with, and every switch is enforced by the server. The
 * students' payment step (QR code, a compulsory 12-digit UTR, each UTR accepted once) and "My
 * registration ID" by mobile number.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StudentView } from '../src/lib/fest';
import { STAFF_PASSWORD, TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

/** A 1×1 PNG, as the dashboard sends it. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let count = 0;
const form = (extra: Record<string, unknown> = {}) => {
  count += 1;
  return {
    submissionId: `portal-key-${String(count).padStart(16, '0')}`,
    participant: { name: 'Kavin S', phone: `97${String(50000000 + count).padStart(8, '0')}`, email: `kavin${count}@example.com`, college: 'Sona College of Technology', collegeCode: '2615', branch: 'B.E. CSE', year: '2nd Year', team: '' },
    dept: 'CSE',
    events: [],
    ...extra,
  };
};
const selfRegister = (h: Harness, body: unknown) => h.call('POST', '/api/fest/register', body, { ip: '10.5.0.1' });
const pay = (h: Harness, id: string, key: string, txn: string) => h.call('POST', '/api/fest/me/payment', { id, key, txn }, { ip: '10.5.0.2' });
const controls = (h: Harness, portal: Record<string, unknown>) => h.asOwner('POST', '/api/admin/portal', { portal });
const view = (response: { body: { registration: StudentView } }) => response.body.registration;

describe('the payment step after registering', () => {
  it('offers UPI with the QR code the web assist team uploads (replace or remove it any time)', async () => {
    const h = setup({ at: TIMES.eventDay });
    expect((await h.call('GET', '/api/fest/payment')).body).toMatchObject({ online: true, upiId: expect.stringContaining('@'), qr: null });

    // Only a PNG, JPEG or WebP whose bytes say so.
    expect((await h.asOwner('POST', '/api/admin/portal/qr', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).body.code).toBe('INVALID');
    expect((await h.asOwner('POST', '/api/admin/portal/qr', { image: 'data:image/png;base64,SGVsbG8gd29ybGQ=' })).body.code).toBe('INVALID');
    const uploaded = await h.asOwner('POST', '/api/admin/portal/qr', { image: PNG });
    expect(uploaded.body).toMatchObject({ portal: { qrAt: expect.any(String) }, qr: PNG });
    expect((await h.call('GET', '/api/fest/payment')).body.qr).toBe(PNG);

    // Removed: the page shows the UPI ID (and the "Open UPI app" button) without a picture.
    expect((await h.asOwner('POST', '/api/admin/portal/qr', { remove: true })).body).toMatchObject({ portal: { qrAt: null }, qr: null });
    expect((await h.call('GET', '/api/fest/payment')).body).toMatchObject({ online: true, qr: null });

    // A desk cannot change any of it.
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    expect((await h.call('POST', '/api/admin/portal/qr', { image: PNG }, { token: desk.token })).status).toBe(403);
    expect((await h.call('GET', '/api/admin/portal', undefined, { token: desk.token })).status).toBe(403);
  });

  it('needs the 12-digit UTR, and refuses a UTR already accepted for someone else', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = form();
    const b = form();
    await selfRegister(h, a);
    await selfRegister(h, b);
    expect((await pay(h, 'CSE-2001', a.submissionId, '12345')).body).toMatchObject({ code: 'INVALID', details: { txn: expect.any(String) } });
    expect(view(await pay(h, 'CSE-2001', a.submissionId, '6123 4567 8901'))).toMatchObject({ status: 'waiting', txnEnd: '8901' });

    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    expect((await h.call('POST', '/api/admin/fest/registrations/CSE-2001', { action: 'verify', txn: '612345678901', confirmed: true }, { token: desk.token })).status).toBe(200);
    // The same payment sent by another student: refused at once, never waiting for a desk.
    expect((await pay(h, 'CSE-2002', b.submissionId, '612345678901')).body).toMatchObject({ code: 'TXN_USED', details: { txn: expect.any(String) } });
  });

  it('accepts a UPI payment taken at a desk only once across the fest', async () => {
    const h = setup({ at: TIMES.eventDay });
    await selfRegister(h, form());
    await selfRegister(h, form({ dept: 'IT' }));
    const cse = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const it = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    const upi = { method: 'UPI', txn: '712345678901', confirmed: true };
    expect((await h.call('POST', '/api/admin/fest/registrations/CSE-2001', { action: 'checkin', payment: upi }, { token: cse.token })).status).toBe(200);
    const again = await h.call('POST', '/api/admin/fest/registrations/IT-2001', { action: 'checkin', payment: upi }, { token: it.token });
    expect(again.body).toMatchObject({ code: 'TXN_USED', details: { existingId: 'CSE-2001' } });
    // Cash is always fine.
    expect((await h.call('POST', '/api/admin/fest/registrations/IT-2001', { action: 'checkin', payment: { method: 'CASH', confirmed: true } }, { token: it.token })).status).toBe(200);
  });

  it('is refused while online payment is switched off (the page sends students to the desk)', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = form();
    await selfRegister(h, a);
    expect((await controls(h, { onlinePayment: false })).status).toBe(200);
    expect((await h.call('GET', '/api/fest/info')).body.onlinePayment).toBe(false);
    expect((await h.call('GET', '/api/fest/payment')).body).toMatchObject({ online: false, upiId: '', qr: null });
    expect((await pay(h, 'CSE-2001', a.submissionId, '612345678901')).body.code).toBe('SWITCHED_OFF');
  });
});

describe('“My registration ID” on another phone', () => {
  it('finds the registration by the mobile number alone (shown, never changed)', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = form();
    await selfRegister(h, a);
    // One department per student: the same number is refused under another department, and told where it is.
    const again = await selfRegister(h, { ...form({ dept: 'MECH' }), participant: a.participant });
    expect(again.body).toMatchObject({ code: 'DUPLICATE_PHONE', error: expect.stringContaining('already registered under CSE') });
    expect(again.body.details?.existingId).toBeUndefined();
    const find = (phone: string) => h.call('POST', '/api/fest/find', { phone }, { ip: '10.5.1.1' });
    // A number nobody registered with: told to check it, or contact the admin.
    expect((await find('9000000000')).body).toMatchObject({ code: 'NOT_FOUND', error: expect.stringContaining('contact the admin') });
    // No email needed (online registrations may have none).
    const found = await find(`+91 ${a.participant.phone}`);
    expect(found.status).toBe(200);
    expect(found.body.registrations.map((item: StudentView) => [item.id, item.canChange])).toEqual([['CSE-2001', false]]);
  });

  it('allows a few tries for each mobile number, and can be switched off', async () => {
    const h = setup({ at: TIMES.eventDay });
    const a = form();
    await selfRegister(h, a);
    for (let n = 0; n < 10; n += 1) await h.call('POST', '/api/fest/find', { phone: a.participant.phone }, { ip: `10.5.2.${n}` });
    expect((await h.call('POST', '/api/fest/find', { phone: a.participant.phone }, { ip: '10.5.3.1' })).status).toBe(429);

    const h2 = setup({ at: TIMES.eventDay });
    await selfRegister(h2, a);
    await h2.asOwner('POST', '/api/admin/portal', { portal: { studentLookup: false } });
    expect((await h2.call('GET', '/api/fest/info')).body.lookup).toBe(false);
    expect((await h2.call('POST', '/api/fest/find', { phone: a.participant.phone }, { ip: '10.5.3.2' })).body.code).toBe('SWITCHED_OFF');
    // The phone that registered still sees its own ID.
    expect((await h2.call('POST', '/api/fest/me', { id: 'CSE-2001', key: a.submissionId }, { ip: '10.5.3.2' })).status).toBe(200);
  });
});

describe('Website controls', () => {
  it('pauses registration on phones', async () => {
    const h = setup({ at: TIMES.eventDay });
    await controls(h, { selfRegistration: false });
    expect((await h.call('GET', '/api/fest/info')).body.selfRegistration).toBe(false);
    expect((await selfRegister(h, form())).body.code).toBe('SWITCHED_OFF');
    await controls(h, { selfRegistration: true });
    expect((await selfRegister(h, form())).status).toBe(200);
  });

  it('stops desk registration, event entry and results for everyone but the web assist team, and tells the dashboards', async () => {
    const h = setup({ at: TIMES.eventDay });
    await selfRegister(h, form());
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    await controls(h, { deskRegistration: false, eventEntry: false, results: false, downloads: false });

    const sync = await h.call('POST', '/api/admin/fest/sync', {}, { token: desk.token });
    expect(sync.body.switches).toEqual({ deskRegistration: false, eventEntry: false, results: false, downloads: false, onlinePayment: true });
    const walkIn = { submissionId: 'walk-in-000001', participant: { ...form().participant, phone: '9876500099' }, events: [] };
    expect((await h.call('POST', '/api/admin/fest/registrations', walkIn, { token: desk.token })).body.code).toBe('SWITCHED_OFF');
    expect((await h.call('POST', '/api/admin/fest/registrations/CSE-2001/events/cse-hackathon', { action: 'add' }, { token: coordinator.token })).body.code).toBe('SWITCHED_OFF');
    expect((await h.call('POST', '/api/admin/fest/events/cse-hackathon/results', { action: 'save', places: [] }, { token: coordinator.token })).body.code).toBe('SWITCHED_OFF');

    // The web assist team can still fix things.
    expect((await h.asOwner('POST', '/api/admin/fest/registrations', { ...walkIn, dept: 'CSE' })).status).toBe(200);
    expect((await h.asOwner('POST', '/api/admin/fest/registrations/CSE-2001/events/cse-hackathon', { action: 'add' })).status).toBe(200);
  });

  it('switches a role’s sign-in off: those accounts are signed out at once and cannot sign in again', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const admin = await h.staff('DEPT_ADMIN', [], 'cse-admin', { department: 'CSE' });
    await controls(h, { logins: { DESK: false } });
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk.token })).status).toBe(401);
    const again = await h.call('POST', '/api/admin/login', { username: 'cse-desk1', password: STAFF_PASSWORD }, { ip: '10.5.4.1' });
    expect(again.body).toMatchObject({ code: 'LOGIN_OFF', error: expect.stringContaining('registration desks') });
    // Other roles carry on.
    expect((await h.call('GET', '/api/admin/session', undefined, { token: admin.token })).status).toBe(200);
    await controls(h, { logins: { DESK: true } });
    expect((await h.call('POST', '/api/admin/login', { username: 'cse-desk1', password: STAFF_PASSWORD }, { ip: '10.5.4.1' })).status).toBe(200);
  });

  it('keeps every other setting when one is changed, and refuses a wrong UPI ID', async () => {
    const h = setup({ at: TIMES.eventDay });
    await controls(h, { downloads: false });
    const saved = await controls(h, { upiId: 'rpsit.fest@okaxis', upiPayee: 'RPSIT Fest Account' });
    expect(saved.body.portal).toMatchObject({ downloads: false, upiId: 'rpsit.fest@okaxis', upiPayee: 'RPSIT Fest Account', updatedBy: expect.any(String) });
    expect((await controls(h, { upiId: 'not a upi id' })).body.code).toBe('INVALID');
    expect((await h.asOwner('GET', '/api/admin/portal')).body.portal).toMatchObject({ downloads: false, upiId: 'rpsit.fest@okaxis' });
  });
});

describe('the backups every 10 minutes', () => {
  it('records a failed Google Sheet copy (nothing lost: the private copy is saved), and the next run writes it again', async () => {
    let googleDown = true;
    const saves: number[] = [];
    const h = setup({
      at: TIMES.eventDay,
      festSheet: {
        save: async (snapshot) => {
          if (googleDown) throw new Error('Google Sheets is not answering');
          saves.push(snapshot.registrations.length);
          return { written: true, registrations: snapshot.registrations.length, results: snapshot.results.length };
        },
      },
    });
    await selfRegister(h, form());
    expect(await h.service.fest.backup()).toMatchObject({ file: 'saved', sheet: 'failed', registrations: 1 });
    const failed = (await h.asOwner('GET', '/api/admin/portal')).body.backup;
    expect(failed).toMatchObject({ file: 'saved', sheet: 'failed', sheetError: expect.stringContaining('not answering'), lastSheetAt: null, lastFileAt: expect.any(String) });

    googleDown = false;
    await selfRegister(h, form());
    expect(await h.service.fest.backup()).toMatchObject({ sheet: 'written', registrations: 2 });
    expect(saves).toEqual([2]);
    expect((await h.asOwner('GET', '/api/admin/portal')).body.backup).toMatchObject({ sheet: 'written', sheetError: null, lastSheetAt: expect.any(String) });
  });
});
