/**
 * The event day through the API routes: the registration schedule, the desk's on-site
 * registrations, staff roles, event fees, attendance, winners and results, and reports.
 * Same in-memory stand-ins as service.test.ts (server/testing.ts).
 */
import { describe, expect, it } from 'vitest';
import { site } from '../src/content/site';
import { isEventDay, registrationPhase, scheduleOf } from '../src/lib/schedule';
import { readConfig } from './config';
import { ADMIN, STAFF_PASSWORD, TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

/** An online registration, approved by the owner admin. */
async function approvedOnline(h: Harness, overrides: Parameters<Harness['submit']>[0] = {}) {
  const submitted = await h.submit(overrides);
  expect(submitted.status).toBe(200);
  const approved = await h.asOwner('POST', `/api/admin/registrations/${submitted.body.registrationId}/approve`, {});
  expect(approved.status).toBe(200);
  return submitted.body.registrationId as string;
}

const cash = { method: 'CASH', confirmedReceived: true };

// ---------------------------------------------------------------------------------------

describe('registration schedule (Asia/Kolkata)', () => {
  const schedule = scheduleOf(site.registration);

  it('switches online → on-site → closed at the IST boundaries, from the clock alone', () => {
    expect(schedule).toEqual({
      onlineClosesAt: '2026-10-16T23:59:00',
      onsiteOpensAt: '2026-10-17T00:00:00',
      onsiteClosesAt: '2026-10-17T11:59:00',
    });
    const phase = (iso: string) => registrationPhase(schedule, Date.parse(iso));
    expect(phase(TIMES.online)).toBe('online');
    expect(phase(TIMES.lastOnlineMinute)).toBe('online');
    expect(phase(TIMES.between)).toBe('between');
    expect(phase(TIMES.onsiteOpens)).toBe('onsite');
    expect(phase(TIMES.eventDay)).toBe('onsite');
    expect(phase(TIMES.lastOnsiteMinute)).toBe('onsite');
    // On-site registration closes at 11:59 AM; the event day goes on.
    expect(phase(TIMES.onsiteCloses)).toBe('closed');
    expect(isEventDay(schedule, Date.parse(TIMES.onsiteCloses))).toBe(true);
    expect(isEventDay(schedule, Date.parse(TIMES.lastOnsiteSecond))).toBe(true);
    expect(isEventDay(schedule, Date.parse(TIMES.closed))).toBe(false);
    expect(isEventDay(schedule, Date.parse(TIMES.between))).toBe(false);
    expect(phase(TIMES.closed)).toBe('closed');
    expect(phase('2026-11-01T00:00:00Z')).toBe('closed');
  });

  it('takes online registrations until 11:59 PM IST on 16 October, then refuses them on the server', async () => {
    const h = setup({ at: TIMES.lastOnlineMinute });
    expect((await h.submit()).status).toBe(200);

    for (const at of [TIMES.between, TIMES.eventDay]) {
      h.setTime(at);
      const upload = await h.call('POST', '/api/uploads', { contentType: 'image/png', size: 2048 });
      expect(upload.status).toBe(403);
      expect(upload.body.code).toBe('REGISTRATION_CLOSED');
      expect(upload.body.error).toMatch(/register on-site/i);
      const register = await h.call('POST', '/api/register', {});
      expect(register.status).toBe(403);
    }
    h.setTime(TIMES.closed);
    const closed = await h.call('POST', '/api/register', {});
    expect(closed.body).toMatchObject({ code: 'REGISTRATION_CLOSED', error: expect.stringMatching(/has closed/) });
    expect(await h.store.listRegistrations('PENDING')).toHaveLength(1);
  });

  it('lets the desk register on any day until on-site registration closes at 11:59 AM on the event day', async () => {
    const h = setup({ at: TIMES.online });
    const desk = await h.staff('DESK');
    for (const at of [TIMES.online, TIMES.between, TIMES.onsiteOpens, TIMES.lastOnsiteMinute]) {
      h.setTime(at);
      const token = await h.loginAs(desk.username, STAFF_PASSWORD);
      expect((await h.onsite(token)).status, at).toBe(200);
    }
    for (const at of [TIMES.onsiteCloses, TIMES.closed]) {
      h.setTime(at);
      const refused = await h.onsite(await h.loginAs(desk.username, STAFF_PASSWORD));
      expect(refused.status, at).toBe(403);
      expect(refused.body).toMatchObject({ code: 'ONSITE_CLOSED', error: 'On-site registration closed at 17 October 2026 · 11:59 AM IST.' });
    }
  });

  it('tells the dashboard the phase by the server clock', async () => {
    const h = setup({ at: TIMES.eventDay });
    const session = await h.asOwner('GET', '/api/admin/session');
    expect(session.body).toMatchObject({ role: 'ADMIN', phase: 'onsite', eventDayStarted: true, fees: { gatePass: 100, perEvent: 50 } });
    expect(session.body.permissions).toContain('staff.manage');
  });

  it('accepts schedule overrides only for a rehearsal, and refuses unreadable ones', () => {
    const base = {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'token',
      GOOGLE_SHEET_ID: 'sheet',
      GOOGLE_DRIVE_PAYMENT_FOLDER_ID: 'folder',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: 'hash',
      REGISTRATIONS_TABLE: 'r',
      CONTROL_TABLE: 'c',
      FEST_TABLE: 'f',
      FILES_BUCKET: 'b',
    };
    expect(readConfig(base).config?.schedule).toEqual(scheduleOf(site.registration));
    const rehearsal = readConfig({
      ...base,
      SCHEDULE_ONLINE_CLOSES_AT: '2026-10-11T18:00:00',
      SCHEDULE_ONSITE_OPENS_AT: '2026-10-12T09:00:00',
      SCHEDULE_ONSITE_CLOSES_AT: '2026-10-12T18:00:00',
    });
    expect(rehearsal.config?.schedule.onsiteOpensAt).toBe('2026-10-12T09:00:00');
    expect(readConfig({ ...base, SCHEDULE_ONSITE_OPENS_AT: 'tomorrow' })).toMatchObject({ config: null, missing: [expect.stringMatching(/^SCHEDULE_/)] });
    expect(readConfig({ ...base, SCHEDULE_ONSITE_CLOSES_AT: '2026-10-16T10:00:00' }).config).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------

describe('on-site registration at the desk', () => {
  it('gives on-site registrations 262 + serial IDs from their own counter, approved at once with a sheet row (no pass, no email)', async () => {
    const h = setup({ at: TIMES.online });
    const online = await h.submit();
    expect(online.body.registrationId).toBe('261001');

    h.setTime(TIMES.eventDay);
    const desk = await h.staff('DESK');
    const first = await h.onsite(desk.token, { events: ['cognix', 'code-flex'], email: 'nila@example.com' });
    expect(first.status).toBe(200);
    expect(first.body.registration).toMatchObject({
      registrationId: '262001',
      source: 'ONSITE',
      status: 'APPROVED',
      createdBy: desk.username,
      gatePass: { status: 'VERIFIED', method: 'CASH', amount: 100, verifiedBy: desk.username, verifiedAt: '2026-10-17T04:00:00.000Z' },
      technicalEvents: ['CODE FLEX', 'COGNIX'],
      payableAtVenue: 100,
      pdfStatus: 'NOT_STARTED',
      screenshot: null,
    });
    expect(first.body.registration.events.map((event: { fee: { status: string } }) => event.fee.status)).toEqual(['UNPAID', 'UNPAID']);
    // No pass for a desk registration, so no pass email either (the online one got its own).
    await h.service.runScheduled();
    expect(h.sendMail.mock.calls.some(([mime]) => String(mime).includes('To: nila@example.com'))).toBe(false);
    expect(h.files.objects.has('passes/262001.pdf')).toBe(false);
    expect(h.sheets.rows.find((row) => row.id === '262001')).toMatchObject({ source: 'On-site', status: 'APPROVED', gatePassPayment: 'Cash at desk · verified' });

    // The online counter is untouched: on-site IDs never take its numbers.
    expect(h.store.counters.get('registration')).toBe(1);
    expect((await h.onsite(desk.token)).body.registration.registrationId).toBe('262002');
  });

  it('hands out unique IDs to four desks registering at the same moment', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desks = await Promise.all([1, 2, 3, 4].map(() => h.staff('DESK')));
    const results = await Promise.all(Array.from({ length: 24 }, (_, index) => h.onsite(desks[index % 4].token)));
    expect(results.map((result) => result.status)).toEqual(Array(24).fill(200));
    const ids = results.map((result) => result.body.registration.registrationId as string);
    expect(new Set(ids).size).toBe(24);
    expect([...ids].sort()).toEqual(Array.from({ length: 24 }, (_, index) => `262${String(index + 1).padStart(3, '0')}`));
    expect(await h.store.listRegistrations('APPROVED')).toHaveLength(24);
  });

  it('never reuses an ID even if the counter is lost', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    await h.onsite(desk.token);
    await h.onsite(desk.token);
    h.store.counters.delete('onsite');
    const next = await h.onsite(desk.token);
    expect(next.status).toBe(200);
    expect(next.body.registration.registrationId).toBe('262003');
  });

  it('answers a resent form with the first registration (one record)', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const [a, b] = await Promise.all([h.onsite(desk.token, { submissionId: 'retry'.padEnd(32, 'x') }), h.onsite(desk.token, { submissionId: 'retry'.padEnd(32, 'x') })]);
    expect(a.body.registration.registrationId).toBe(b.body.registration.registrationId);
    expect(await h.store.listRegistrations('APPROVED')).toHaveLength(1);
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it('refuses an email, phone or UPI reference that is already registered, naming the registration', async () => {
    const h = setup({ at: TIMES.online });
    const onlineId = (await h.submit({ email: 'kavin@example.com', phone: '9876543210' })).body.registrationId;
    h.setTime(TIMES.eventDay);
    const desk = await h.staff('DESK');

    const email = await h.onsite(desk.token, { email: 'KAVIN@example.com' });
    expect(email.status).toBe(409);
    expect(email.body).toMatchObject({ code: 'DUPLICATE_EMAIL', details: { registrationId: onlineId } });

    const phone = await h.onsite(desk.token, { phone: '+91 98765 43210' });
    expect(phone.status).toBe(409);
    expect(phone.body).toMatchObject({ code: 'DUPLICATE_PHONE', details: { registrationId: onlineId } });
    // One phone number, one registration: the student signs in with it.
    expect(phone.body.error).toMatch(/each student needs their own phone number/);
    // (The old override is ignored.)
    expect((await h.onsite(desk.token, { phone: '9876543210', body: { allowSharedPhone: true } })).status).toBe(409);

    const upi = { method: 'UPI', reference: 'UPIREF123456', confirmedReceived: true };
    expect((await h.onsite(desk.token, { payment: upi })).status).toBe(200);
    const reused = await h.onsite(desk.token, { payment: upi });
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('DUPLICATE_TRANSACTION');
  });

  it('lets only one of two desks register the same phone number at the same moment', async () => {
    const h = setup({ at: TIMES.eventDay });
    const [a, b] = await Promise.all([h.staff('DESK'), h.staff('DESK')]);
    const results = await Promise.all([h.onsite(a.token, { phone: '9000000001' }), h.onsite(b.token, { phone: '9000000001' })]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await h.store.listRegistrations('APPROVED')).toHaveLength(1);
  });

  it('records money only when the desk confirms it was received; a reference alone is not proof', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    for (const payment of [
      { method: 'UPI', reference: 'UPIREF123456' },
      { method: 'UPI', reference: 'UPIREF123456', confirmedReceived: 'yes' },
      { method: 'CASH' },
      { method: 'CASH', reference: 'UPIREF123456', confirmedReceived: true },
      { method: 'CHEQUE', confirmedReceived: true },
    ]) {
      const refused = await h.onsite(desk.token, { payment });
      expect(refused.status).toBe(400);
    }
    expect((await h.onsite(desk.token, { payment: { method: 'UPI', reference: 'UPIREF123456' } })).body.fieldErrors.transactionId).toMatch(/not proof of payment/);
    expect(await h.store.listRegistrations('APPROVED')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------

describe('technical events only', () => {
  it('lists exactly the five technical events', async () => {
    const h = setup({ at: TIMES.eventDay });
    const events = await h.asOwner('GET', '/api/admin/events');
    expect(events.body.events.map((event: { name: string }) => event.name)).toEqual(['PRO-PITCH', 'VIZ CRAFT', 'PAPER PRESENTATION', 'CODE FLEX', 'COGNIX']);
  });

  it('refuses discontinued non-technical events everywhere', async () => {
    const h = setup({ at: TIMES.online });
    const online = await h.submit({ events: ['pro-pitch', 'short-film'] });
    expect(online.status).toBe(400);
    expect(online.body.fieldErrors.events).toBe('Please choose events from the list.');

    h.setTime(TIMES.eventDay);
    const desk = await h.staff('DESK');
    // The desk offers the five technical events only.
    const withEvents = await h.onsite(desk.token, { events: ['code-flex', 'e-sports'] });
    expect(withEvents.status).toBe(400);
    expect(withEvents.body.error).toBe('Choose events from the list only.');
    const id = (await h.onsite(desk.token)).body.registration.registrationId;
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/events`, { add: ['brand-it'] })).status).toBe(400);
    expect((await h.asOwner('POST', `/api/admin/events/brand-it/registrations/${id}/enroll`, {})).status).toBe(404);
    expect((await h.asOwner('GET', '/api/admin/events/short-film')).status).toBe(404);
    expect((await h.asOwner('POST', `/api/admin/events/e-sports/registrations/${id}/fee`, cash)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------

describe('staff roles (checked on the server)', () => {
  it('allows each role exactly its own routes', async () => {
    const h = setup({ at: TIMES.online });
    const id = await approvedOnline(h, { events: ['code-flex'] });
    const pending = (await h.submit()).body.registrationId;
    const doomed = (await h.submit()).body.registrationId;
    h.setTime(TIMES.eventDay);
    const tokens = {
      ADMIN: (await h.staff('ADMIN')).token,
      DESK: (await h.staff('DESK')).token,
      COORDINATOR: (await h.staff('COORDINATOR', ['code-flex'])).token,
      CERTIFICATE: (await h.staff('CERTIFICATE')).token,
      SUPPORT: (await h.staff('SUPPORT')).token,
    };
    const routes: [string, string, unknown, string[]][] = [
      ['GET', '/api/admin/registrations', undefined, ['ADMIN', 'DESK', 'SUPPORT']],
      ['GET', `/api/admin/registrations/${id}`, undefined, ['ADMIN', 'DESK', 'SUPPORT']],
      // A GPay payment made online can be verified by an admin, the desk or a coordinator.
      ['GET', `/api/admin/registrations/${pending}/screenshot`, undefined, ['ADMIN', 'DESK', 'COORDINATOR']],
      // Passes are the students' own (Student login).
      ['GET', `/api/admin/registrations/${id}/pass`, undefined, ['ADMIN']],
      ['POST', `/api/admin/registrations/${pending}/reject`, { reason: 'test' }, ['ADMIN', 'DESK', 'COORDINATOR']],
      ['POST', `/api/admin/registrations/${id}/retry`, {}, ['ADMIN', 'SUPPORT']],
      ['POST', `/api/admin/registrations/${id}/details`, {}, ['ADMIN', 'DESK', 'SUPPORT']],
      ['POST', `/api/admin/registrations/${id}/events`, { add: ['cognix'] }, ['ADMIN', 'DESK']],
      // Only admins cancel; admins and the web assistant team delete (to the Deleted list).
      ['POST', `/api/admin/registrations/${pending}/cancel`, { reason: 'test' }, ['ADMIN']],
      ['POST', `/api/admin/registrations/${doomed}/delete`, { reason: 'test entry' }, ['ADMIN', 'SUPPORT']],
      ['GET', '/api/admin/deleted', undefined, ['ADMIN', 'SUPPORT']],
      // Test sessions: admins only.
      ['GET', '/api/admin/testing', undefined, ['ADMIN']],
      ['POST', '/api/admin/testing/session', { action: 'stop' }, ['ADMIN']],
      ['GET', `/api/admin/lookup/${id}`, undefined, ['ADMIN', 'COORDINATOR']],
      ['GET', '/api/admin/events', undefined, ['ADMIN', 'COORDINATOR', 'CERTIFICATE']],
      ['GET', '/api/admin/events/code-flex', undefined, ['ADMIN', 'COORDINATOR', 'CERTIFICATE']],
      ['POST', '/api/admin/events/code-flex/reopen', { reason: 'test' }, ['ADMIN']],
      ['GET', '/api/admin/staff', undefined, ['ADMIN']],
      ['GET', '/api/admin/reports', undefined, ['ADMIN']],
      ['GET', '/api/admin/student-portal', undefined, ['ADMIN', 'SUPPORT']],
      ['GET', '/api/admin/help', undefined, ['ADMIN', 'SUPPORT']],
      ['GET', '/api/admin/system', undefined, ['ADMIN', 'SUPPORT']],
    ];
    for (const [method, path, body, allowed] of routes) {
      for (const [role, token] of Object.entries(tokens)) {
        const response = await h.call(method, path, body, { token });
        if (allowed.includes(role)) expect(response.status, `${role} ${method} ${path}`).not.toBe(403);
        else expect(response.status, `${role} ${method} ${path}`).toBe(403);
      }
      expect((await h.call(method, path, body)).status, `signed out ${method} ${path}`).toBe(401);
    }

    // Writing routes, each with a fresh participant so one role's success does not affect the next.
    const onsiteAllowed = ['ADMIN', 'DESK'];
    const feeAllowed = ['ADMIN', 'COORDINATOR'];
    for (const [role, token] of Object.entries(tokens)) {
      const desk = await h.onsite(token);
      expect(desk.status, `${role} on-site`).toBe(onsiteAllowed.includes(role) ? 200 : 403);
      const participant = (await h.onsite(tokens.DESK, { events: ['code-flex'] })).body.registration.registrationId;
      const fee = await h.call('POST', `/api/admin/events/code-flex/registrations/${participant}/fee`, cash, { token });
      expect(fee.status, `${role} fee`).toBe(feeAllowed.includes(role) ? 200 : 403);
      const approve = await h.call('POST', `/api/admin/registrations/${participant}/approve`, {}, { token });
      expect(approve.status, `${role} approve`).toBe(['ADMIN', 'DESK', 'COORDINATOR'].includes(role) ? 200 : 403);
    }
  });

  it('applies role changes, deactivation and password changes to signed-in staff at once', async () => {
    const h = setup({ at: TIMES.eventDay });
    const coordinator = await h.staff('COORDINATOR', ['cognix'], 'kabil');
    const participant = (await h.onsite((await h.staff('DESK')).token, { events: ['cognix'] })).body.registration.registrationId;
    const fee = (token: string) => h.call('POST', `/api/admin/events/cognix/registrations/${participant}/fee`, cash, { token });

    expect((await h.asOwner('POST', '/api/admin/staff/kabil', { role: 'CERTIFICATE' })).status).toBe(200);
    expect((await fee(coordinator.token)).status).toBe(403);
    expect((await h.asOwner('POST', '/api/admin/staff/kabil', { role: 'COORDINATOR', eventIds: ['cognix'] })).status).toBe(200);
    expect((await fee(coordinator.token)).status).toBe(200);

    expect((await h.asOwner('POST', '/api/admin/staff/kabil', { active: false })).status).toBe(200);
    expect((await h.call('GET', '/api/admin/session', undefined, { token: coordinator.token })).status).toBe(401);
    expect((await h.call('POST', '/api/admin/login', { username: 'kabil', password: STAFF_PASSWORD })).status).toBe(401);

    expect((await h.asOwner('POST', '/api/admin/staff/kabil', { active: true })).status).toBe(200);
    const token = await h.loginAs('kabil', STAFF_PASSWORD);
    expect((await h.asOwner('POST', '/api/admin/staff/kabil', { password: 'A-brand-new-Pass-77' })).status).toBe(200);
    expect((await h.call('GET', '/api/admin/session', undefined, { token })).status).toBe(401);
    expect((await h.loginAs('kabil', 'A-brand-new-Pass-77')).length).toBeGreaterThan(40);
  });

  it('keeps staff accounts sound: unique names, strong passwords, events for coordinators, no self-demotion', async () => {
    const h = setup({ at: TIMES.eventDay });
    const create = (body: Record<string, unknown>) =>
      h.asOwner('POST', '/api/admin/staff', { displayName: 'Priya M', role: 'DESK', password: STAFF_PASSWORD, ...body });
    expect((await create({ username: 'desk1' })).status).toBe(200);
    expect((await create({ username: 'DESK1' })).body.code).toBe('USERNAME_TAKEN');
    expect((await create({ username: ADMIN.username })).body.code).toBe('USERNAME_TAKEN');
    expect((await create({ username: 'desk2', password: 'short' })).body.code).toBe('WEAK_PASSWORD');
    expect((await create({ username: 'coord', role: 'COORDINATOR', eventIds: [] })).status).toBe(400);
    expect((await create({ username: 'coord', role: 'COORDINATOR', eventIds: ['short-film'] })).status).toBe(400);
    expect((await create({ username: 'boss', role: 'SUPERUSER' })).status).toBe(400);

    const list = await h.asOwner('GET', '/api/admin/staff');
    expect(list.body.staff).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|scrypt/);

    const admin = await h.staff('ADMIN', [], 'second-admin');
    const demote = await h.call('POST', '/api/admin/staff/second-admin', { role: 'DESK' }, { token: admin.token });
    expect(demote.status).toBe(400);
  });

  it('does not lock other staff out when one mistypes their password on the shared college network', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.staff('DESK', [], 'desk-a');
    await h.staff('DESK', [], 'desk-b');
    // desk-a signed in once when the account was made; nine wrong passwords use up the ten tries.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect((await h.call('POST', '/api/admin/login', { username: 'desk-a', password: `wrong-${attempt}` })).status).toBe(401);
    }
    expect((await h.call('POST', '/api/admin/login', { username: 'desk-a', password: STAFF_PASSWORD })).status).toBe(429);
    expect((await h.call('POST', '/api/admin/login', { username: 'desk-b', password: STAFF_PASSWORD })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------

describe('event restrictions for coordinators', () => {
  it('shows and changes only the assigned events', async () => {
    const h = setup({ at: TIMES.eventDay });
    const coordinator = await h.staff('COORDINATOR', ['code-flex']);
    const participant = (await h.onsite((await h.staff('DESK')).token, { events: ['code-flex', 'cognix'] })).body.registration.registrationId;
    const as = (method: string, path: string, body?: unknown) => h.call(method, path, body, { token: coordinator.token });

    expect((await as('GET', '/api/admin/events')).body.events.map((event: { eventId: string }) => event.eventId)).toEqual(['code-flex']);
    expect((await as('GET', '/api/admin/events/cognix')).body.code).toBe('EVENT_NOT_ASSIGNED');
    for (const action of ['fee', 'attendance', 'enroll']) {
      const response = await as('POST', `/api/admin/events/cognix/registrations/${participant}/${action}`, { ...cash, present: true });
      expect(response.status, action).toBe(403);
    }
    expect((await as('POST', '/api/admin/events/cognix/winners', { first: [participant] })).status).toBe(403);
    expect((await as('POST', '/api/admin/events/cognix/submit', {})).status).toBe(403);

    const lookup = await as('GET', `/api/admin/lookup/${participant.toLowerCase()}`);
    expect(lookup.body.events.map((event: { eventId: string }) => event.eventId)).toEqual(['code-flex']);
    expect(JSON.stringify(lookup.body)).not.toMatch(/@example\.com/i);
    expect(lookup.body.payment).toEqual({ amount: 100, transactionId: null, hasScreenshot: false, proofId: null });

    const roster = await as('GET', '/api/admin/events/code-flex');
    expect(roster.body.participants[0]).toHaveProperty('phone');
    expect(roster.body.participants[0]).not.toHaveProperty('email');
  });
});

// ---------------------------------------------------------------------------------------

describe('event fees and attendance', () => {
  it('marks attendance only after the gate pass, the event registration and the ₹50 fee are all verified', async () => {
    const h = setup({ at: TIMES.online });
    const approved = await approvedOnline(h, { events: ['pro-pitch'] });
    const pending = (await h.submit({ events: ['code-flex'] })).body.registrationId;
    const coordinator = await h.staff('COORDINATOR', ['code-flex', 'pro-pitch']);
    const as = (path: string, body: unknown) => h.call('POST', `/api/admin/events/${path}`, body, { token: coordinator.token });

    // Not before the event day.
    expect((await as(`code-flex/registrations/${approved}/fee`, cash)).body.code).toBe('EVENT_NOT_STARTED');
    h.setTime(TIMES.eventDay);
    coordinator.token = await h.loginAs(coordinator.username, STAFF_PASSWORD);

    // The gate pass must be verified first.
    expect((await as(`code-flex/registrations/${pending}/fee`, cash)).body.code).toBe('GATE_PASS_NOT_VERIFIED');
    expect((await as(`code-flex/registrations/${pending}/attendance`, { present: true })).body.code).toBe('GATE_PASS_NOT_VERIFIED');

    // Registered for the event, or added to it on the spot.
    expect((await as(`code-flex/registrations/${approved}/fee`, cash)).body.code).toBe('NOT_ENROLLED');
    const added = await as(`code-flex/registrations/${approved}/enroll`, {});
    expect(added.body.participant).toMatchObject({ addedBy: coordinator.username, fee: { status: 'UNPAID' } });

    // The fee, confirmed as received, before attendance.
    expect((await as(`code-flex/registrations/${approved}/attendance`, { present: true })).body.code).toBe('EVENT_FEE_UNPAID');
    const unconfirmed = await as(`code-flex/registrations/${approved}/fee`, { method: 'UPI', reference: 'UPI99887766' });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body).toMatchObject({ code: 'PAYMENT_NOT_CONFIRMED', error: expect.stringMatching(/not proof of payment/) });
    const paid = await as(`code-flex/registrations/${approved}/fee`, { method: 'UPI', reference: 'UPI99887766', confirmedReceived: true });
    expect(paid.body.participant.fee).toMatchObject({
      status: 'PAID',
      method: 'UPI',
      amount: 50,
      reference: 'UPI99887766',
      verifiedBy: coordinator.username,
      verifiedAt: '2026-10-17T04:00:00.000Z',
    });
    expect((await as(`code-flex/registrations/${approved}/fee`, cash)).body.code).toBe('ALREADY_PAID');

    h.advance(60_000);
    const present = await as(`code-flex/registrations/${approved}/attendance`, { present: true });
    expect(present.body.participant.attendance).toEqual({ present: true, markedBy: coordinator.username, markedAt: '2026-10-17T04:01:00.000Z' });

    // Registration, gate pass and each event fee stay separate.
    const view = (await h.asOwner('GET', `/api/admin/registrations/${approved}`)).body.registration;
    expect(view.status).toBe('APPROVED');
    expect(view.gatePass).toMatchObject({ status: 'VERIFIED', method: 'ONLINE_UPI' });
    expect(view.events).toEqual([
      expect.objectContaining({ eventId: 'pro-pitch', fee: expect.objectContaining({ status: 'UNPAID' }), attendance: null }),
      expect.objectContaining({ eventId: 'code-flex', fee: expect.objectContaining({ status: 'PAID' }), attendance: expect.objectContaining({ present: true }) }),
    ]);
    expect(view.payableAtVenue).toBe(50);
  });

  it('keeps both fees when two coordinators record them on one registration at the same moment', async () => {
    const h = setup({ at: TIMES.eventDay });
    const id = (await h.onsite((await h.staff('DESK')).token, { events: ['code-flex', 'cognix'] })).body.registration.registrationId;
    const [a, b] = [await h.staff('COORDINATOR', ['code-flex']), await h.staff('COORDINATOR', ['cognix'])];
    const results = await Promise.all([
      h.call('POST', `/api/admin/events/code-flex/registrations/${id}/fee`, cash, { token: a.token }),
      h.call('POST', `/api/admin/events/cognix/registrations/${id}/fee`, cash, { token: b.token }),
      h.call('POST', `/api/admin/events/code-flex/registrations/${id}/fee`, cash, { token: a.token }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 200, 409]);
    const stored = await h.store.getRegistration(id);
    expect(stored?.participation?.['code-flex']?.fee?.verifiedBy).toBe(a.username);
    expect(stored?.participation?.cognix?.fee?.verifiedBy).toBe(b.username);
  });

  it('lets only an admin void a fee, with a reason, once attendance is taken back', async () => {
    const h = setup({ at: TIMES.eventDay });
    const id = (await h.onsite((await h.staff('DESK')).token, { events: ['viz-craft'] })).body.registration.registrationId;
    const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
    const as = (path: string, body: unknown) => h.call('POST', `/api/admin/events/viz-craft/registrations/${id}/${path}`, body, { token: coordinator.token });
    await as('fee', cash);
    await as('attendance', { present: true });

    expect((await as('void-fee', { reason: 'wrong person' })).status).toBe(403);
    expect((await h.asOwner('POST', `/api/admin/events/viz-craft/registrations/${id}/void-fee`, {})).status).toBe(400);
    expect((await h.asOwner('POST', `/api/admin/events/viz-craft/registrations/${id}/void-fee`, { reason: 'wrong person' })).body.code).toBe('MARKED_PRESENT');
    expect((await as('attendance', { present: false })).body.participant.attendance).toMatchObject({ present: false });
    const voided = await h.asOwner('POST', `/api/admin/events/viz-craft/registrations/${id}/void-fee`, { reason: 'wrong person' });
    expect(voided.body.participant.fee).toMatchObject({ status: 'UNPAID', voided: { by: ADMIN.username, reason: 'wrong person' } });
    expect((await h.store.getRegistration(id))?.participation?.['viz-craft']?.feeHistory).toHaveLength(1);
  });

  it('copies fees and attendance to the Google Sheet with the scheduled job', async () => {
    const h = setup({ at: TIMES.eventDay });
    const id = (await h.onsite((await h.staff('DESK')).token, { events: ['cognix'] })).body.registration.registrationId;
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    await h.call('POST', `/api/admin/events/cognix/registrations/${id}/fee`, cash, { token: coordinator.token });
    await h.call('POST', `/api/admin/events/cognix/registrations/${id}/attendance`, { present: true }, { token: coordinator.token });
    expect(h.sheets.rows.find((row) => row.id === id)?.attendedEvents).toBe('');

    await h.service.runScheduled();
    expect(h.sheets.rows.find((row) => row.id === id)).toMatchObject({ eventFeesPaid: 'COGNIX (Cash)', attendedEvents: 'COGNIX' });
  });
});

// ---------------------------------------------------------------------------------------

describe('winners, results and certificates', () => {
  async function eventWithParticipants(h: Harness, count: number) {
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['paper-presentation']);
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push((await h.onsite(desk.token, { events: ['paper-presentation'], name: `Student ${String.fromCharCode(65 + index)}` })).body.registration.registrationId);
    }
    const as = (method: string, path: string, body?: unknown) => h.call(method, `/api/admin/events/paper-presentation${path}`, body, { token: coordinator.token });
    return { desk, coordinator, ids, as };
  }

  it('accepts as winners only verified participants marked present, in place order', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { ids, as } = await eventWithParticipants(h, 3);
    await as('POST', `/registrations/${ids[0]}/fee`, cash);
    await as('POST', `/registrations/${ids[0]}/attendance`, { present: true });

    expect((await as('POST', '/winners', { first: [ids[1]] })).body).toMatchObject({ code: 'WINNER_NOT_ELIGIBLE', error: expect.stringMatching(/not marked present/) });
    expect((await as('POST', '/winners', { first: [ids[0]], second: [ids[0]] })).status).toBe(400);
    expect((await as('POST', '/winners', { first: [], second: [ids[0]] })).status).toBe(400);
    expect((await as('POST', '/winners', { first: ['NOT-AN-ID'] })).status).toBe(400);
    expect((await as('POST', '/submit', {})).body.code).toBe('NO_WINNERS');

    const saved = await as('POST', '/winners', { first: [ids[0].toLowerCase()] });
    expect(saved.body.result).toMatchObject({ status: 'DRAFT', winners: { first: [ids[0]], second: [], third: [] } });
    // A winner's attendance cannot be taken back.
    expect((await as('POST', `/registrations/${ids[0]}/attendance`, { present: false })).body.code).toBe('IS_WINNER');
  });

  it('submits participant, attendance and winner lists, locks the event, and needs an admin to reopen it', async () => {
    const h = setup({ at: TIMES.eventDay });
    const { coordinator, ids, as } = await eventWithParticipants(h, 4);
    for (const id of ids.slice(0, 3)) {
      await as('POST', `/registrations/${id}/fee`, cash);
      await as('POST', `/registrations/${id}/attendance`, { present: true });
    }
    await as('POST', `/registrations/${ids[3]}/fee`, cash);
    await as('POST', '/winners', { first: [ids[0], ids[1]], second: [ids[2]] });
    h.advance(3_600_000);
    const submitted = await as('POST', '/submit', {});
    expect(submitted.status).toBe(200);
    const { submission } = submitted.body.result;
    expect(submitted.body.result.status).toBe('SUBMITTED');
    expect(submission).toMatchObject({ number: 1, submittedBy: coordinator.username, submittedAt: '2026-10-17T05:00:00.000Z' });
    expect(submission.participants).toHaveLength(4);
    expect(submission.attendance).toEqual(ids.slice(0, 3));
    expect(submission.winners.first.map((winner: { name: string }) => winner.name)).toEqual(['Student A', 'Student B']);
    expect(submission.participants[3]).toMatchObject({ feePaid: true, present: false, email: expect.stringMatching(/@example\.com$/) });

    // Locked: no fee, attendance, winner or enrolment changes, by the coordinator or the desk.
    expect((await as('POST', `/registrations/${ids[3]}/attendance`, { present: true })).body.code).toBe('RESULTS_FINALIZED');
    expect((await as('POST', '/winners', { first: [ids[0]] })).body.code).toBe('RESULTS_FINALIZED');
    expect((await as('POST', '/submit', {})).body.code).toBe('ALREADY_SUBMITTED');
    expect((await as('POST', '/reopen', { reason: 'typo' })).status).toBe(403);

    // The certificate team sees the final lists and when they came in.
    const certificate = await h.staff('CERTIFICATE');
    const overview = await h.call('GET', '/api/admin/events', undefined, { token: certificate.token });
    const paper = overview.body.events.find((event: { eventId: string }) => event.eventId === 'paper-presentation');
    expect(paper).toMatchObject({ enrolled: 4, feePaid: 4, present: 3, result: { status: 'SUBMITTED', submission: { submittedAt: '2026-10-17T05:00:00.000Z' } } });
    const roster = await h.call('GET', '/api/admin/events/paper-presentation', undefined, { token: certificate.token });
    expect(roster.body).toMatchObject({ canOperate: false });
    expect(roster.body.participants[0]).toHaveProperty('email');
    expect(roster.body.participants[0]).not.toHaveProperty('phone');

    // An admin authorises a correction; the coordinator fixes and submits again.
    expect((await h.asOwner('POST', '/api/admin/events/paper-presentation/reopen', {})).status).toBe(400);
    const reopened = await h.asOwner('POST', '/api/admin/events/paper-presentation/reopen', { reason: 'Second place was wrong' });
    expect(reopened.body.result).toMatchObject({ status: 'REOPENED', reopened: { by: ADMIN.username, reason: 'Second place was wrong' } });
    await as('POST', `/registrations/${ids[3]}/attendance`, { present: true });
    await as('POST', '/winners', { first: [ids[0], ids[1]], second: [ids[3]], third: [ids[2]] });
    const again = await as('POST', '/submit', {});
    expect(again.body.result.submission).toMatchObject({ number: 2, attendance: ids });
    expect(again.body.result.previousSubmissions).toEqual([{ number: 1, submittedBy: coordinator.username, submittedAt: '2026-10-17T05:00:00.000Z' }]);
    expect(again.body.result.reopened).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------

describe('reports', () => {
  it('totals registrations, gate passes, event fees and attendance, with who collected the cash', async () => {
    const h = setup({ at: TIMES.online });
    await approvedOnline(h, { events: ['cognix'] });
    await h.submit();
    h.setTime(TIMES.eventDay);
    const desk = await h.staff('DESK', [], 'desk-one');
    const coordinator = await h.staff('COORDINATOR', ['cognix'], 'quiz-lead');
    const walkIn = (await h.onsite(desk.token, { events: ['cognix'] })).body.registration.registrationId;
    await h.onsite(desk.token, { payment: { method: 'UPI', reference: 'UPI55554444', confirmedReceived: true } });
    await h.call('POST', `/api/admin/events/cognix/registrations/${walkIn}/fee`, cash, { token: coordinator.token });
    await h.call('POST', `/api/admin/events/cognix/registrations/${walkIn}/attendance`, { present: true }, { token: coordinator.token });

    const { report } = (await h.asOwner('GET', '/api/admin/reports')).body;
    expect(report.registrations).toEqual({ total: 4, online: 2, onsite: 2, pending: 1, approved: 3, rejected: 0, cancelled: 0 });
    expect(report.gatePass).toEqual({ onlineVerified: { count: 1, amount: 100 }, deskCash: { count: 1, amount: 100 }, deskUpi: { count: 1, amount: 100 } });
    expect(report.events.find((event: { eventId: string }) => event.eventId === 'cognix')).toMatchObject({ enrolled: 2, feesPaid: 1, cash: 1, upi: 0, cashAmount: 50, upiAmount: 0, amount: 50, present: 1 });
    expect(report.collectedBy).toEqual([
      { username: 'desk-one', cash: 100, upi: 100, count: 2 },
      { username: 'quiz-lead', cash: 50, upi: 0, count: 1 },
    ]);
  });
});
