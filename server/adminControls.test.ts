/**
 * Controls only admins have: the registration times (reopen or extend on-site registration,
 * close it, set new times, back to the plan) and deleting staff accounts.
 */
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, STAFF_ROLES } from '../src/lib/staff';
import { STAFF_PASSWORD, TIMES, setup } from './testing';

const WINDOW = '/api/admin/registration-window';

describe('the registration times', () => {
  it('reopens on-site registration after 11:59 AM, until the time the admin sets, for the desk and the website', async () => {
    const h = setup({ at: TIMES.onsiteCloses });
    const desk = await h.staff('DESK');
    // 17 October, 11:59 AM: the desk is closed as planned.
    expect((await h.onsite(desk.token)).body.code).toBe('ONSITE_CLOSED');

    const reopened = await h.asOwner('POST', WINDOW, { action: 'onsite-until', onsiteClosesAt: '2026-10-17T14:00' });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({
      phase: 'onsite',
      planned: { onsiteClosesAt: '2026-10-17T11:59:00' },
      real: { onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-17T14:00:00' },
      inForce: { onsiteClosesAt: '2026-10-17T14:00:00' },
      changed: { setBy: 'pragya-admin' },
      testTimeline: false,
    });
    expect((await h.onsite(desk.token)).status).toBe(200);
    // The website and every dashboard follow.
    expect((await h.call('GET', '/api/schedule')).body.schedule.onsiteClosesAt).toBe('2026-10-17T14:00:00');
    const session = await h.call('GET', '/api/admin/session', undefined, { token: desk.token });
    expect(session.body).toMatchObject({ phase: 'onsite', testing: { window: { setBy: 'pragya-admin' } } });

    // At 2 PM it closes again, with the new time in the message.
    h.setTime('2026-10-17T08:30:00Z');
    expect((await h.onsite(desk.token)).body).toMatchObject({ code: 'ONSITE_CLOSED', error: 'On-site registration closed at 17 October 2026 · 2:00 PM IST.' });

    // Back to the plan.
    const planned = await h.asOwner('POST', WINDOW, { action: 'planned' });
    expect(planned.body).toMatchObject({ changed: null, real: { onsiteClosesAt: '2026-10-17T11:59:00' } });
  });

  it('closes every registration now, and refuses times that do not work', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const closed = await h.asOwner('POST', WINDOW, { action: 'close-now' });
    expect(closed.body).toMatchObject({ phase: 'closed', real: { onsiteClosesAt: '2026-10-17T09:30:00' } });
    expect((await h.onsite(desk.token)).body.code).toBe('ONSITE_CLOSED');

    const past = await h.asOwner('POST', WINDOW, { action: 'onsite-until', onsiteClosesAt: '2026-10-17T09:00' });
    expect(past.status).toBe(400);
    const backwards = await h.asOwner('POST', WINDOW, {
      action: 'custom',
      schedule: { onlineClosesAt: '2026-10-16T23:59', onsiteOpensAt: '2026-10-17T00:00', onsiteClosesAt: '2026-10-16T22:00' },
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toMatch(/closes before it opens/);

    const custom = await h.asOwner('POST', WINDOW, {
      action: 'custom',
      schedule: { onlineClosesAt: '2026-10-16T23:59', onsiteOpensAt: '2026-10-17T00:00', onsiteClosesAt: '2026-10-17T13:00' },
    });
    expect(custom.body).toMatchObject({ phase: 'onsite', real: { onsiteClosesAt: '2026-10-17T13:00:00' } });
    expect((await h.onsite(desk.token)).status).toBe(200);
  });

  it('opens the desk now when it was not open yet, closing online registration', async () => {
    const h = setup({ at: TIMES.online });
    const opened = await h.asOwner('POST', WINDOW, { action: 'onsite-until', onsiteClosesAt: '2026-10-10T18:00' });
    expect(opened.body).toMatchObject({ phase: 'onsite', real: { onlineClosesAt: '2026-10-10T11:59:00', onsiteOpensAt: '2026-10-10T11:59:00', onsiteClosesAt: '2026-10-10T18:00:00' } });
    expect((await h.call('POST', '/api/uploads', { contentType: 'image/png', size: 2048 })).body.code).toBe('REGISTRATION_CLOSED');
  });

  it('stays under a test timeline while one is on, and is the real schedule the Testing section goes back to', async () => {
    const h = setup({ at: TIMES.onsiteCloses });
    await h.asOwner('POST', WINDOW, { action: 'onsite-until', onsiteClosesAt: '2026-10-17T15:00' });
    await h.asOwner('POST', '/api/admin/testing/timeline', { mode: 'closed' });
    const underTest = await h.asOwner('GET', WINDOW);
    expect(underTest.body).toMatchObject({ testTimeline: true, phase: 'closed', real: { onsiteClosesAt: '2026-10-17T15:00:00' } });
    const back = await h.asOwner('POST', '/api/admin/testing/timeline', { mode: 'standard' });
    expect(back.body.timeline).toMatchObject({ override: null, phase: 'onsite', standard: { onsiteClosesAt: '2026-10-17T15:00:00' } });
  });

  it('is for admins only', async () => {
    const h = setup({ at: TIMES.eventDay });
    for (const role of STAFF_ROLES.filter((item) => item !== 'ADMIN')) {
      const other = await h.staff(role, role === 'COORDINATOR' ? ['cognix'] : []);
      expect((await h.call('GET', WINDOW, undefined, { token: other.token })).status, role).toBe(403);
      expect((await h.call('POST', WINDOW, { action: 'close-now' }, { token: other.token })).status, role).toBe(403);
    }
    const admin = await h.staff('ADMIN');
    expect((await h.call('GET', WINDOW, undefined, { token: admin.token })).status).toBe(200);
  });
});

describe('admins have every permission', () => {
  it('lists every permission any role has under Admin', () => {
    const all = new Set(Object.values(ROLE_PERMISSIONS).flat());
    expect([...all].filter((permission) => !ROLE_PERMISSIONS.ADMIN.includes(permission))).toEqual([]);
    expect(ROLE_PERMISSIONS.ADMIN).toContain('registration.window');
  });
});

describe('deleting a staff account', () => {
  it('signs them out, removes them from the list, and frees the username', async () => {
    const h = setup({ at: TIMES.eventDay });
    const coordinator = await h.staff('COORDINATOR', ['cognix'], 'cognix-test');
    expect((await h.call('GET', '/api/admin/events', undefined, { token: coordinator.token })).status).toBe(200);

    const deleted = await h.asOwner('POST', '/api/admin/staff/cognix-test/delete', {});
    expect(deleted.body).toMatchObject({ success: true, deleted: 'cognix-test' });
    expect((await h.call('GET', '/api/admin/events', undefined, { token: coordinator.token })).status).toBe(401);
    expect((await h.call('POST', '/api/admin/login', { username: 'cognix-test', password: STAFF_PASSWORD })).status).toBe(401);
    expect((await h.asOwner('GET', '/api/admin/staff')).body.staff.map((account: { username: string }) => account.username)).not.toContain('cognix-test');

    expect((await h.asOwner('POST', '/api/admin/staff/cognix-test/delete', {})).status).toBe(404);
    // The username can be used again.
    await h.staff('COORDINATOR', ['cognix'], 'cognix-test');
  });

  it('is for admins only, and an admin cannot delete their own account', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const support = await h.staff('SUPPORT');
    expect((await h.call('POST', `/api/admin/staff/${desk.username}/delete`, {}, { token: support.token })).status).toBe(403);
    const admin = await h.staff('ADMIN');
    const self = await h.call('POST', `/api/admin/staff/${admin.username}/delete`, {}, { token: admin.token });
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/your own account/);
    expect((await h.call('POST', `/api/admin/staff/${desk.username}/delete`, {}, { token: admin.token })).status).toBe(200);
  });
});

describe('the notice on the website', () => {
  it('goes up for every open page and dashboard, and comes down', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    expect((await h.call('GET', '/api/schedule')).body.notice).toBeNull();

    const posted = await h.asOwner('POST', '/api/admin/site-notice', { text: '  COGNIX Round 2 has moved\n to LH-05 at 12:15 PM.  ' });
    expect(posted.body.notice).toMatchObject({ text: 'COGNIX Round 2 has moved to LH-05 at 12:15 PM.', setBy: 'pragya-admin' });
    const site = (await h.call('GET', '/api/schedule')).body;
    // The public answer carries no names.
    expect(site.notice).toEqual({ text: 'COGNIX Round 2 has moved to LH-05 at 12:15 PM.', setAt: posted.body.notice.setAt });
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk.token })).body.testing.notice).toBe('COGNIX Round 2 has moved to LH-05 at 12:15 PM.');

    expect((await h.asOwner('POST', '/api/admin/site-notice', { text: 'x'.repeat(301) })).status).toBe(400);
    expect((await h.call('POST', '/api/admin/site-notice', { text: 'Hi' }, { token: desk.token })).status).toBe(403);

    expect((await h.asOwner('POST', '/api/admin/site-notice', { text: '' })).body.notice).toBeNull();
    expect((await h.call('GET', '/api/schedule')).body.notice).toBeNull();
  });
});

describe('signing someone out', () => {
  it('ends every session they have now; they can sign in again', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const before = await h.asOwner('GET', '/api/admin/sessions');
    expect(before.body.sessions.map((item: { username: string }) => item.username)).toContain(desk.username);

    h.advance(1000);
    expect((await h.asOwner('POST', `/api/admin/staff/${desk.username}/sign-out`, {})).body).toMatchObject({ success: true, signedOut: desk.username });
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk.token })).status).toBe(401);
    expect((await h.asOwner('GET', '/api/admin/sessions')).body.sessions.map((item: { username: string }) => item.username)).not.toContain(desk.username);

    h.advance(1000);
    const again = await h.loginAs(desk.username, STAFF_PASSWORD);
    expect((await h.call('GET', '/api/admin/session', undefined, { token: again })).status).toBe(200);
  });
});
