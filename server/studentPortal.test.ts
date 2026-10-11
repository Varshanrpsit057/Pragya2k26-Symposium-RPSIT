/**
 * The student page on the event day: sign in with Registration ID and phone, download the
 * pass, see the events. Off until an admin turns it on, and capped so it never slows the staff.
 */
import { describe, expect, it } from 'vitest';
import { ADMIN, TIMES, setup } from './testing';

const cash = { method: 'CASH', confirmedReceived: true };

/** An event-day setup with a desk walk-in (team, two events) and student login turned on. */
async function eventDay() {
  const h = setup({ at: TIMES.eventDay });
  const desk = await h.staff('DESK');
  const walkIn = await h.onsite(desk.token, { phone: '9840012345', teamName: 'Pixel Pair', events: ['viz-craft', 'code-flex'] });
  const id = walkIn.body.registration.registrationId as string;
  expect((await h.asOwner('POST', '/api/admin/student-portal', { enabled: true })).status).toBe(200);
  const signIn = (phone: string, registrationId = id) => h.call('POST', '/api/student', { registrationId, phone });
  return { h, desk, id, signIn };
}

describe('student login: switched by admins', () => {
  it('is on unless an admin pauses it, and only admins and the web team may switch it', async () => {
    const h = setup({ at: TIMES.eventDay });
    // On by default: passes are not emailed for now, so students get them here.
    expect((await h.call('GET', '/api/student/portal')).body).toEqual({ success: true, enabled: true });
    expect((await h.asOwner('POST', '/api/admin/student-portal', { enabled: false })).body.enabled).toBe(false);
    const paused = await h.call('POST', '/api/student', { registrationId: '262001', phone: '9840012345' });
    expect(paused.status).toBe(503);
    expect(paused.body).toMatchObject({ code: 'STUDENT_LOGIN_PAUSED', error: expect.stringContaining('registration desks stay fast') });

    for (const role of ['DESK', 'COORDINATOR', 'CERTIFICATE'] as const) {
      // (The web assistant team may switch it, like admins.)
      const { token } = await h.staff(role, role === 'COORDINATOR' ? ['cognix'] : []);
      expect((await h.call('POST', '/api/admin/student-portal', { enabled: true }, { token })).status, role).toBe(403);
      expect((await h.call('GET', '/api/admin/student-portal', undefined, { token })).status, role).toBe(403);
    }
    expect((await h.asOwner('POST', '/api/admin/student-portal', { enabled: 'yes' })).status).toBe(400);

    const on = await h.asOwner('POST', '/api/admin/student-portal', { enabled: true });
    expect(on.body).toEqual({ success: true, enabled: true, changedBy: ADMIN.username, changedAt: '2026-10-17T04:00:00.000Z' });
    expect((await h.call('GET', '/api/student/portal')).body).toEqual({ success: true, enabled: true });
    // The public answer never says who switched it.
    expect((await h.call('GET', '/api/student/portal')).body).not.toHaveProperty('changedBy');

    // Paused again: at once on this server (others follow within seconds).
    expect((await h.asOwner('POST', '/api/admin/student-portal', { enabled: false })).body.enabled).toBe(false);
    expect((await h.call('POST', '/api/student', { registrationId: '262001', phone: '9840012345' })).status).toBe(503);
  });
});

describe('student login: the participant’s own pass and events', () => {
  it('signs in with the Registration ID and phone number and shows the events (a desk registration has no pass)', async () => {
    const { h, id, signIn } = await eventDay();
    // The phone as people type it: with +91, spaces or dashes.
    const view = await signIn('+91 98400-12345');
    expect(view.status).toBe(200);
    expect(view.body).toEqual({
      success: true,
      registrationId: id,
      name: 'Nila R',
      college: 'Sona College of Technology, Salem',
      status: 'APPROVED',
      source: 'ONSITE',
      teamName: 'Pixel Pair',
      events: [
        { eventId: 'viz-craft', name: 'VIZ CRAFT', team: 'Pixel Pair', feePaid: false, present: false },
        { eventId: 'code-flex', name: 'CODE FLEX', team: null, feePaid: false, present: false },
      ],
      feePerEvent: 50,
      // The details the desk typed, for the student to check.
      details: { department: 'Computer Science and Engineering (CSE)', year: '2nd Year', phone: '9840012345', email: expect.stringContaining('@') },
      payAtLogin: null,
      passAvailable: false,
      reason: null,
      proofs: [],
    });

    const pass = await h.call('POST', '/api/student/pass', { registrationId: id, phone: '9840012345' });
    expect(pass.status).toBe(404);
    expect(pass.body).toMatchObject({ code: 'NO_PASS', error: expect.stringContaining('show your Registration ID') });

    // A fee paid at the venue shows up on the next sign-in.
    const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
    await h.call('POST', `/api/admin/events/viz-craft/registrations/${id}/enroll`, { payment: cash }, { token: coordinator.token });
    expect((await signIn('9840012345')).body.events[0]).toMatchObject({ eventId: 'viz-craft', feePaid: true });
  });

  it('gives the same answer for a wrong phone and an unknown ID, and checks the format first', async () => {
    const { signIn, id } = await eventDay();
    const wrong = await signIn('9840099999');
    const unknown = await signIn('9840012345', '262999');
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(wrong.body.error).toBe(unknown.body.error);
    expect(wrong.body).not.toHaveProperty('registrationId');
    expect((await signIn('98400', id)).body.code).toBe('INVALID');
    expect((await signIn('9840012345', 'ABC')).body.code).toBe('INVALID');
  });

  it('shows a pending, rejected or cancelled registration without a pass', async () => {
    const h = setup({ at: TIMES.online });
    const pending = (await h.submit({ phone: '9876543210' })).body.registrationId as string;
    const cancelled = (await h.submit({ phone: '9876543211' })).body.registrationId as string;
    await h.asOwner('POST', `/api/admin/registrations/${cancelled}/approve`);
    h.setTime(TIMES.eventDay);
    await h.asOwner('POST', `/api/admin/registrations/${cancelled}/cancel`, { reason: 'Registered twice' });
    await h.asOwner('POST', '/api/admin/student-portal', { enabled: true });

    const waiting = await h.call('POST', '/api/student', { registrationId: pending, phone: '9876543210' });
    expect(waiting.body).toMatchObject({ status: 'PENDING', passAvailable: false, reason: null });
    expect((await h.call('POST', '/api/student/pass', { registrationId: pending, phone: '9876543210' })).body.code).toBe('PASS_NOT_AVAILABLE');
    const gone = await h.call('POST', '/api/student', { registrationId: cancelled, phone: '9876543211' });
    expect(gone.body).toMatchObject({ status: 'CANCELLED', passAvailable: false, reason: 'Registered twice' });
  });

  it('allows a few sign-ins per Registration ID, so a phone number cannot be guessed', async () => {
    const { signIn } = await eventDay();
    // Enough to pay and wait for the desk (the page checks every 30 s), far too few to guess.
    for (let attempt = 0; attempt < 40; attempt += 1) expect((await signIn('9840012345')).status).toBe(200);
    const blocked = await signIn('9840012345');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['Retry-After']).toBeDefined();
  });

  it('takes at most 300 sign-ins a minute from everyone together, so the staff dashboards stay fast', async () => {
    const { h, signIn } = await eventDay();
    for (let n = 0; n < 300; n += 1) await signIn('9840012345', `262${String(100 + n)}`);
    const busy = await signIn('9840012345');
    expect(busy.status).toBe(429);
    expect(busy.body.error).toMatch(/Many students are signing in right now/);
    // The staff are not affected.
    expect((await h.asOwner('GET', '/api/admin/registrations')).status).toBe(200);
    h.advance(60_000);
    expect((await signIn('9840012345')).status).toBe(200);
  });
});
