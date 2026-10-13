/**
 * The college-wide fest through the API: departments and events, department accounts, desks
 * with their ID blocks, live updates, the online import, event windows, results and
 * corrections, and clearing test data.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATALOG, type FestRegistration } from '../src/lib/fest';
import { STAFF_PASSWORD, TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

// Each test makes several staff accounts (passwords are hashed slowly on purpose): generous when every test runs at once.
vi.setConfig({ testTimeout: 30_000 });

const student = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `Student ${String.fromCharCode(65 + (n % 26))}`,
  phone: `9${String(800000000 + n).padStart(9, '0')}`,
  email: `s${n}@example.com`,
  college: 'Sona College of Technology',
  branch: 'B.E. CSE',
  year: '2nd Year',
  team: '',
  ...extra,
});

async function department(h: Harness, dept = 'CSE') {
  const lower = dept.toLowerCase();
  const desk = await h.staff('DESK', [], `${lower}-desk1`, { department: dept, deskNumber: 1 });
  const firstEvent = DEFAULT_CATALOG.events.find((event) => event.dept === dept)!.id;
  const coordinator = await h.staff('COORDINATOR', [dept === 'CSE' ? 'cse-hackathon' : firstEvent], `${lower}-hack1`, { department: dept });
  const admin = await h.staff('DEPT_ADMIN', [], `${lower}-admin`, { department: dept });
  const hod = await h.staff('HOD', [], `${lower}-hod`, { department: dept });
  return { desk, coordinator, admin, hod };
}

let submissions = 0;
async function register(h: Harness, token: string, id: string, events: string[], extra: Record<string, unknown> = {}) {
  submissions += 1;
  return h.call(
    'POST',
    '/api/admin/fest/registrations',
    {
      submissionId: `sub-${String(submissions).padStart(6, '0')}`,
      id,
      participant: student(submissions),
      events,
      payment: { method: 'CASH', confirmed: true },
      ...extra,
    },
    { token },
  );
}

describe('the fest catalog', () => {
  it('starts with the poster: eight departments and 44 events, each department with four desks', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { body } = await h.asOwner('GET', '/api/admin/fest/catalog');
    expect(body.catalog.departments.map((dept: { code: string }) => dept.code)).toEqual(['CSE', 'AIDS', 'IT', 'ECE', 'CYS', 'EEE', 'MECH', 'SH']);
    expect(body.catalog.events).toHaveLength(44);
    expect(body.catalog.departments.every((dept: { desks: number }) => dept.desks === 4)).toBe(true);
    expect(body.catalog.entryFee).toBe(100);
  });

  it('is edited by the web assist team only, from the revision they started from', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { hod } = await department(h);
    const catalog = { ...DEFAULT_CATALOG, events: DEFAULT_CATALOG.events.map((event) => (event.id === 'cse-hackathon' ? { ...event, venue: 'Delta Lab', time: '10:30 AM', teamMax: 3 } : event)) };
    expect((await h.call('POST', '/api/admin/fest/catalog', { catalog, baseRevision: 0 }, { token: hod.token })).status).toBe(403);
    const saved = await h.asOwner('POST', '/api/admin/fest/catalog', { catalog, baseRevision: 0 });
    expect(saved.body.catalog).toMatchObject({ revision: 1, updatedBy: 'pragya-admin' });
    expect(saved.body.catalog.events.find((event: { id: string }) => event.id === 'cse-hackathon')).toMatchObject({ venue: 'Delta Lab', teamMax: 3 });
    // Saved by someone else meanwhile.
    expect((await h.asOwner('POST', '/api/admin/fest/catalog', { catalog, baseRevision: 0 })).body.code).toBe('CATALOG_CHANGED');
    const broken = await h.asOwner('POST', '/api/admin/fest/catalog', { catalog: { ...catalog, events: [...catalog.events, { ...catalog.events[0] }] }, baseRevision: 1 });
    expect(broken.body.error).toMatch(/Two events use the id/);
  });
});

describe('department accounts', () => {
  it('belong to a department; desks are its desks 1–4; coordinators get its events', async () => {
    const h = setup({ at: TIMES.eventDay });
    const account = (body: Record<string, unknown>) => h.asOwner('POST', '/api/admin/staff', { displayName: 'Test Person', password: 'A-Strong-pass-2026', ...body });
    expect((await account({ username: 'hod-x', role: 'HOD' })).body.error).toMatch(/Choose the department/);
    expect((await account({ username: 'desk-x', role: 'DESK', department: 'IT', deskNumber: 5 })).body.error).toMatch(/1 to 4/);
    expect((await account({ username: 'coord-x', role: 'COORDINATOR', department: 'IT', eventIds: ['cse-hackathon'] })).body.error).toMatch(/IT events only/);
    const desk = await account({ username: 'it-desk3', role: 'DESK', department: 'IT', deskNumber: 3 });
    expect(desk.body.account).toMatchObject({ role: 'DESK', department: 'IT', deskNumber: 3 });
    const token = await h.loginAs('it-desk3', 'A-Strong-pass-2026');
    expect((await h.call('GET', '/api/admin/session', undefined, { token })).body).toMatchObject({ department: 'IT', deskNumber: 3 });
  });
});

describe('registering at a desk', () => {
  it('uses IDs from the desk phone’s block, never twice for one submission, one phone per department', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { desk } = await department(h);
    const block = await h.call('POST', '/api/admin/fest/blocks', {}, { token: desk.token });
    expect(block.body).toMatchObject({ dept: 'CSE', source: 'DESK', first: 1, last: 50 });
    expect((await h.call('POST', '/api/admin/fest/blocks', {}, { token: desk.token })).body).toMatchObject({ first: 51, last: 100 });

    const first = await register(h, desk.token, 'CSE-0001', ['cse-hackathon', 'cse-cyber-hunt']);
    expect(first.status).toBe(200);
    const made: FestRegistration = first.body.registration;
    expect(made).toMatchObject({ id: 'CSE-0001', dept: 'CSE', source: 'DESK', desk: 1, entry: { status: 'PAID', payment: { method: 'CASH', amount: 100, desk: 1 } } });
    expect(made.events.map((entry) => entry.eventId)).toEqual(['cse-hackathon', 'cse-cyber-hunt']);

    // The same submission again (the network dropped the answer): the same registration.
    const again = await h.call(
      'POST',
      '/api/admin/fest/registrations',
      { submissionId: made.sid, id: 'CSE-0002', participant: student(999), events: [], payment: { method: 'CASH', confirmed: true } },
      { token: desk.token },
    );
    expect(again.body).toMatchObject({ replayed: true, registration: { id: 'CSE-0001' } });

    // One phone, one registration in the department.
    const samePhone = await h.call(
      'POST',
      '/api/admin/fest/registrations',
      { submissionId: 'sub-samephone1', id: 'CSE-0003', participant: { ...student(1), phone: made.phone }, events: [], payment: { method: 'CASH', confirmed: true } },
      { token: desk.token },
    );
    expect(samePhone.status).toBe(409);
    expect(samePhone.body).toMatchObject({ code: 'DUPLICATE_PHONE', details: { existingId: 'CSE-0001' } });
    // An ID already used (two phones holding the same block by mistake).
    expect((await register(h, desk.token, 'CSE-0001', [])).body.code).toBe('ID_TAKEN');
  });

  it('keeps each department to its own IDs and events, checks the student and the payment', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { desk } = await department(h);
    expect((await register(h, desk.token, 'IT-0001', [])).body.code).toBe('INVALID_ID');
    expect((await register(h, desk.token, 'CSE-5001', [])).body.code).toBe('INVALID_ID');
    expect((await register(h, desk.token, 'CSE-0004', ['it-web-architects'])).body.error).toMatch(/not an event of CSE/);
    expect((await register(h, desk.token, 'CSE-0004', [], { dept: 'IT' })).status).toBe(403);
    expect((await register(h, desk.token, 'CSE-0004', [], { participant: { ...student(5), phone: '12345' } })).body.details).toMatchObject({ phone: expect.any(String) });
    expect((await register(h, desk.token, 'CSE-0004', [], { payment: { method: 'UPI', txn: '12', confirmed: true } })).body.error).toMatch(/transaction ID/);
    const upi = await register(h, desk.token, 'CSE-0004', [], { payment: { method: 'UPI', txn: '412345678901', confirmed: true } });
    expect(upi.body.registration.entry.payment).toMatchObject({ method: 'UPI', txn: '412345678901', amount: 100 });
  });

  it('stops at the closing time; the web assist team can reopen it', async () => {
    const h = setup({ at: TIMES.onsiteCloses });
    const { desk } = await department(h);
    const closed = await register(h, desk.token, 'CSE-0001', []);
    expect(closed.body).toMatchObject({ code: 'ONSITE_CLOSED', error: 'On-site registration closed at 17 October 2026 · 11:59 AM IST.' });
    await h.asOwner('POST', '/api/admin/registration-window', { action: 'onsite-until', onsiteClosesAt: '2026-10-17T14:00' });
    expect((await register(h, desk.token, 'CSE-0001', [])).status).toBe(200);
  });
});

describe('live data', () => {
  it('gives each department its own registrations, everyone’s to the overall coordinator, then only what changed', async () => {
    const h = setup({ at: TIMES.eventDay });
    const cse = await department(h, 'CSE');
    const it_ = await department(h, 'IT');
    await register(h, cse.desk.token, 'CSE-0001', []);
    await register(h, it_.desk.token, 'IT-0001', []);
    const overall = await h.staff('OVERALL');

    const hodView = await h.call('POST', '/api/admin/fest/sync', {}, { token: cse.hod.token });
    expect(hodView.body).toMatchObject({ full: true, departments: ['CSE', 'OPEN'] }); // OPEN: students who registered themselves
    expect(hodView.body.registrations.map((item: FestRegistration) => item.id)).toEqual(['CSE-0001']);
    expect((await h.call('POST', '/api/admin/fest/sync', { dept: 'IT' }, { token: cse.hod.token })).status).toBe(403);

    const all = await h.call('POST', '/api/admin/fest/sync', {}, { token: overall.token });
    expect(all.body.registrations.map((item: FestRegistration) => item.id).sort()).toEqual(['CSE-0001', 'IT-0001']);
    expect((await h.call('POST', '/api/admin/fest/sync', { dept: 'IT' }, { token: overall.token })).body.registrations).toHaveLength(1);

    // The next sync repeats the last 20 seconds (so a write in flight is never missed; the page keeps the newest copy)…
    h.advance(15_000);
    const next = await h.call('POST', '/api/admin/fest/sync', { since: all.body.cursor }, { token: overall.token });
    expect(next.body).toMatchObject({ full: false });
    expect(next.body.registrations).toHaveLength(2);
    // …and once the page has moved past them, only what changed since.
    h.advance(60_000);
    const settled = await h.call('POST', '/api/admin/fest/sync', { since: next.body.cursor }, { token: overall.token });
    const later = await h.call('POST', '/api/admin/fest/sync', { since: settled.body.cursor }, { token: overall.token });
    expect(later.body.registrations).toHaveLength(0);
    await register(h, cse.desk.token, 'CSE-0002', []);
    const delta = await h.call('POST', '/api/admin/fest/sync', { since: later.body.cursor }, { token: overall.token });
    expect(delta.body.registrations.map((item: FestRegistration) => item.id)).toEqual(['CSE-0002']);
    // Registration desks and coordinators see their department too.
    expect((await h.call('POST', '/api/admin/fest/sync', {}, { token: cse.coordinator.token })).body.registrations).toHaveLength(2);
  });
});

describe('online registrations', () => {
  const rows = [
    { row: 2, ...student(1), events: 'Hackathon; Snap with AI', ref: 'NF-1' },
    { row: 3, ...student(2), events: 'Future Minds (Ideathon)' },
    { row: 4, ...student(3), events: 'Underwater basket weaving' },
    { row: 5, ...student(1), events: 'Hackathon' },
  ];

  it('are checked first, then imported with CSE-5001… IDs, already paid', async () => {
    const h = setup({ at: TIMES.online });
    const { admin, desk } = await department(h);
    const preview = await h.call('POST', '/api/admin/fest/import', { rows, dryRun: true }, { token: admin.token });
    expect(preview.body.outcomes.map((item: { status: string }) => item.status)).toEqual(['ok', 'ok', 'error', 'duplicate']);
    expect(preview.body.outcomes[2].message).toMatch(/Not CSE events: Underwater basket weaving/);
    expect((await h.call('POST', '/api/admin/fest/import', { rows, dryRun: true }, { token: desk.token })).status).toBe(403);

    const imported = await h.call('POST', '/api/admin/fest/import', { rows, eventFeesPaid: true }, { token: admin.token });
    expect(imported.body.outcomes.filter((item: { status: string }) => item.status === 'created').map((item: { id: string }) => item.id)).toEqual(['CSE-5001', 'CSE-5002']);
    const sync = await h.call('POST', '/api/admin/fest/sync', {}, { token: admin.token });
    const first: FestRegistration = sync.body.registrations.find((item: FestRegistration) => item.id === 'CSE-5001');
    expect(first).toMatchObject({ source: 'ONLINE', ref: 'NF-1', entry: { status: 'PAID', payment: { method: 'ONLINE', amount: 100 } } });
    expect(first.events.map((entry) => [entry.eventId, entry.fee?.method])).toEqual([
      ['cse-hackathon', 'ONLINE'],
      ['cse-snap-with-ai', 'ONLINE'],
    ]);
    // The same file again: nothing new.
    const repeat = await h.call('POST', '/api/admin/fest/import', { rows: rows.slice(0, 2) }, { token: admin.token });
    expect(repeat.body.outcomes.map((item: { status: string; id: string }) => [item.status, item.id])).toEqual([
      ['duplicate', 'CSE-5001'],
      ['duplicate', 'CSE-5002'],
    ]);

    // On the day the desk checks them in.
    h.setTime(TIMES.eventDay);
    const deskToday = await h.loginAs(desk.username, STAFF_PASSWORD);
    const checked = await h.call('POST', '/api/admin/fest/registrations/CSE-5001', { action: 'checkin' }, { token: deskToday });
    expect(checked.body.registration.checkedIn).toMatchObject({ by: 'cse-desk1', desk: 1 });
  });
});

describe('the event window', () => {
  it('takes the fee, then attendance; only the event’s own coordinators; winners must be present; submitting locks the event', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { desk, coordinator } = await department(h);
    const other = await h.staff('COORDINATOR', ['cse-cyber-hunt'], 'cse-quiz1', { department: 'CSE' });
    await register(h, desk.token, 'CSE-0001', ['cse-hackathon']);
    await register(h, desk.token, 'CSE-0002', []);
    const act = (id: string, body: Record<string, unknown>, token = coordinator.token) => h.call('POST', `/api/admin/fest/registrations/${id}/events/cse-hackathon`, body, { token });

    expect((await act('CSE-0001', { action: 'present' })).body.code).toBe('FEE_DUE');
    expect((await act('CSE-0001', { action: 'fee', payment: { method: 'CASH', confirmed: true } }, other.token)).status).toBe(403);
    const fee = await act('CSE-0001', { action: 'fee', payment: { method: 'CASH', confirmed: true } });
    expect(fee.body.registration.events[0].fee).toMatchObject({ method: 'CASH', amount: 50, by: 'cse-hack1' });
    expect((await act('CSE-0001', { action: 'present' })).body.registration.events[0].present).toMatchObject({ by: 'cse-hack1' });

    // A student who came straight to the venue: added to the event there.
    expect((await act('CSE-0002', { action: 'fee', payment: { method: 'CASH', confirmed: true } })).body.code).toBe('NOT_IN_EVENT');
    expect((await act('CSE-0002', { action: 'add' })).body.registration.events.map((entry: { eventId: string }) => entry.eventId)).toEqual(['cse-hackathon']);

    const results = (body: Record<string, unknown>, token = coordinator.token) => h.call('POST', '/api/admin/fest/events/cse-hackathon/results', body, { token });
    expect((await results({ action: 'save', places: [{ place: 1, ids: ['CSE-0002'] }] })).body.error).toMatch(/not marked present/);
    const saved = await results({ action: 'save', places: [{ place: 1, ids: ['cse 1'], team: 'Byte Me' }] });
    expect(saved.body.result.places).toEqual([{ place: 1, ids: ['CSE-0001'], team: 'Byte Me' }]);
    expect((await results({ action: 'submit' })).body.result.submitted).toMatchObject({ by: 'cse-hack1' });
    // Locked: no more changes, until the overall coordinator reopens it.
    expect((await act('CSE-0002', { action: 'fee', payment: { method: 'CASH', confirmed: true } })).body.code).toBe('RESULTS_SUBMITTED');
    expect((await results({ action: 'reopen', reason: 'Wrong winner' })).status).toBe(403);
    const overall = await h.staff('OVERALL');
    const reopened = await results({ action: 'reopen', reason: 'Wrong winner' }, overall.token);
    expect(reopened.body.result.submitted).toBeUndefined();
    expect(reopened.body.result.reopened[0]).toMatchObject({ reason: 'Wrong winner' });
  });

  it('lets the overall coordinator cancel a fee recorded by mistake (not once present)', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { desk, coordinator } = await department(h);
    await register(h, desk.token, 'CSE-0001', ['cse-hackathon']);
    await h.call('POST', '/api/admin/fest/registrations/CSE-0001/events/cse-hackathon', { action: 'fee', payment: { method: 'UPI', txn: '998877665544', confirmed: true } }, { token: coordinator.token });
    const overall = await h.staff('OVERALL');
    const voided = await h.call('POST', '/api/admin/fest/registrations/CSE-0001/events/cse-hackathon', { action: 'void-fee', reason: 'Paid twice' }, { token: overall.token });
    expect(voided.body.registration.events[0].fee.voided).toMatchObject({ reason: 'Paid twice', by: overall.username });
    expect((await h.call('POST', '/api/admin/fest/registrations/CSE-0001/events/cse-hackathon', { action: 'void-fee', reason: 'x y z' }, { token: coordinator.token })).status).toBe(403);
  });
});

describe('corrections', () => {
  it('edits details (one phone per department still), cancels, deletes and restores', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { desk, admin } = await department(h);
    const a = (await register(h, desk.token, 'CSE-0001', [])).body.registration as FestRegistration;
    const b = (await register(h, desk.token, 'CSE-0002', [])).body.registration as FestRegistration;
    const act = (id: string, body: Record<string, unknown>, token = admin.token) => h.call('POST', `/api/admin/fest/registrations/${id}`, body, { token });

    expect((await act('CSE-0002', { action: 'edit', participant: { phone: a.phone } })).body).toMatchObject({ code: 'DUPLICATE_PHONE', details: { existingId: 'CSE-0001' } });
    expect((await act('CSE-0002', { action: 'edit', participant: { name: 'Kavin R' } })).body.registration.name).toBe('Kavin R');
    expect((await act('CSE-0002', { action: 'cancel', reason: 'Left early' }, desk.token)).status).toBe(403);
    expect((await act('CSE-0002', { action: 'cancel', reason: 'Left early' })).body.registration.cancelled).toMatchObject({ reason: 'Left early' });
    expect((await act('CSE-0002', { action: 'uncancel' })).body.registration.cancelled).toBeUndefined();

    // Deleting frees the phone; restoring takes it back.
    expect((await act('CSE-0002', { action: 'delete', reason: 'Test entry' })).status).toBe(403);
    expect((await h.asOwner('POST', '/api/admin/fest/registrations/CSE-0002', { action: 'delete', reason: 'Test entry' })).body.registration.deleted).toMatchObject({ reason: 'Test entry' });
    const reused = await h.call(
      'POST',
      '/api/admin/fest/registrations',
      { submissionId: 'sub-reuse-0001', id: 'CSE-0003', participant: { ...student(77), phone: b.phone }, events: [], payment: { method: 'CASH', confirmed: true } },
      { token: desk.token },
    );
    expect(reused.status).toBe(200);
    // Restoring: the phone now belongs to CSE-0003.
    expect((await h.asOwner('POST', '/api/admin/fest/registrations/CSE-0002', { action: 'restore' })).body).toMatchObject({ code: 'DUPLICATE_PHONE', details: { existingId: 'CSE-0003' } });
  });
});

describe('test data', () => {
  it('deletes only what was registered in a test session, and starts IDs again where nothing real is left', async () => {
    const h = setup({ at: TIMES.eventDay });
    const cse = await department(h, 'CSE');
    const it_ = await department(h, 'IT');
    await register(h, it_.desk.token, 'IT-0001', []);
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'start', label: 'Rehearsal' });
    await register(h, cse.desk.token, 'CSE-0001', []);
    await register(h, it_.desk.token, 'IT-0002', []);
    const cleared = await h.asOwner('POST', '/api/admin/fest/test-data/clear', {});
    expect(cleared.body).toMatchObject({ cleared: 2, remaining: 0 });
    expect(cleared.body.restarted).toContain('CSE');
    expect(cleared.body.restarted).not.toContain('IT');
    const left = await h.asOwner('POST', '/api/admin/fest/sync', {});
    expect(left.body.registrations.map((item: FestRegistration) => item.id)).toEqual(['IT-0001']);
    expect([...h.files.objects.keys()].some((key) => key.startsWith('backups/fest-test-data-'))).toBe(true);
    expect((await h.call('POST', '/api/admin/fest/blocks', {}, { token: cse.desk.token })).body.first).toBe(1);
  });

  it('deletes a batch per call (inside the API’s time limit), and only the last call restarts IDs and tells every phone to reload', async () => {
    const h = setup({ at: TIMES.eventDay });
    const cse = await department(h, 'CSE');
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'start', label: 'Load test' });
    for (const id of ['CSE-0001', 'CSE-0002', 'CSE-0003']) await register(h, cse.desk.token, id, []);
    const before = (await h.asOwner('POST', '/api/admin/fest/sync', {})).body.resetAt;

    const first = await h.asOwner('POST', '/api/admin/fest/test-data/clear', { limit: 2 });
    expect(first.body).toMatchObject({ cleared: 2, remaining: 1, restarted: [] });
    expect((await h.asOwner('POST', '/api/admin/fest/sync', {})).body.resetAt).toBe(before);

    const second = await h.asOwner('POST', '/api/admin/fest/test-data/clear', { limit: 2 });
    expect(second.body).toMatchObject({ cleared: 1, remaining: 0 });
    expect(second.body.restarted).toContain('CSE');
    h.setTime(new Date(Date.parse(TIMES.eventDay) + 60_000).toISOString());
    const after = (await h.asOwner('POST', '/api/admin/fest/sync', {})).body;
    expect(after.registrations).toEqual([]);
    expect(after.resetAt).toEqual(expect.any(String));
    expect(after.resetAt).not.toBe(before);
  });
});

describe('the backup', () => {
  it('writes every department’s registrations and results to one private file', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { desk } = await department(h);
    await register(h, desk.token, 'CSE-0001', ['cse-hackathon']);
    expect(await h.service.fest.backup()).toEqual({ registrations: 1, results: 0 });
    const saved = JSON.parse(new TextDecoder().decode(h.files.objects.get('backups/fest/all.json')!.bytes));
    expect(saved.registrations.map((item: FestRegistration) => item.id)).toEqual(['CSE-0001']);
    expect(saved.catalog.events).toHaveLength(44);
  });
});
