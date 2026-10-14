/**
 * Staff sign-in and the safeguards around it: a password copied with a space still signs in, each
 * refused sign-in is kept with why, "Check a password" answers without signing in, the owner alone
 * deletes every staff account, and "Signed in now" leaves out sessions a new password ended.
 */
import { describe, expect, it, vi } from 'vitest';
import { DELETE_ALL_STAFF } from '../src/lib/staff';
import { ADMIN, STAFF_PASSWORD, TIMES, setup } from './testing';

vi.setConfig({ testTimeout: 30_000 });

const login = (h: ReturnType<typeof setup>, username: string, password: string, ip = '10.20.0.1') => h.call('POST', '/api/admin/login', { username, password }, { ip });

describe('staff sign-in', () => {
  it('signs in a new account at once, with a username in any case and a password copied with spaces around it', async () => {
    const h = setup({ at: TIMES.eventDay });
    const made = await h.asOwner('POST', '/api/admin/staff', { username: 'cse-deskx', displayName: 'CSE Desk X', role: 'DESK', department: 'CSE', deskNumber: 1, password: '  Abcdefg-Hijkmn-9  ' });
    expect(made.status).toBe(200);
    // Set without the spaces: the password is exactly what was shown.
    expect((await login(h, 'cse-deskx', 'Abcdefg-Hijkmn-9')).status).toBe(200);
    expect((await login(h, ' CSE-DeskX ', ' Abcdefg-Hijkmn-9\t')).status).toBe(200);
    // Never a different password: one character off is refused.
    expect((await login(h, 'cse-deskx', 'Abcdefg-Hijkmn-8')).body.code).toBe('INVALID_LOGIN');
    // The owner's own sign-in is unchanged.
    expect((await login(h, ADMIN.username, ADMIN.password)).status).toBe(200);
  });

  it('keeps each refused sign-in with why (never the password), and when each account last signed in', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    await login(h, 'nobody-here', 'whatever-it-is');
    await login(h, 'it-desk1', 'Wrong-Password-2026');
    await h.asOwner('POST', '/api/admin/staff/it-desk1', { active: false });
    await login(h, 'it-desk1', STAFF_PASSWORD);
    await h.asOwner('POST', '/api/admin/staff/it-desk1', { active: true });
    await h.asOwner('POST', '/api/admin/portal', { portal: { logins: { DESK: false } } });
    await login(h, 'it-desk1', STAFF_PASSWORD);

    const listed = await h.asOwner('GET', '/api/admin/staff');
    expect(listed.body.failures.map((item: { username: string; reason: string }) => [item.username, item.reason])).toEqual([
      ['it-desk1', 'sign-in switched off'],
      ['it-desk1', 'account deactivated'],
      ['it-desk1', 'wrong password'],
      ['nobody-here', 'no such account'],
    ]);
    expect(JSON.stringify(listed.body)).not.toContain('Wrong-Password-2026');
    const account = listed.body.staff.find((item: { username: string }) => item.username === 'it-desk1');
    expect(account.lastSignInAt).toEqual(expect.any(String));
    expect(desk.token).toEqual(expect.any(String));
  });

  it('checks a password for the web assist team without signing in, and says what is wrong', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    const check = (username: string, password: string) => h.asOwner('POST', `/api/admin/staff/${username}/check-password`, { password });
    expect((await check('cse-hackathon', STAFF_PASSWORD)).body).toMatchObject({ exists: true, active: true, matches: true, signInOff: false });
    expect((await check('cse-hackathon', 'Event-Day-Staff-2025')).body).toMatchObject({ exists: true, matches: false });
    expect((await check('cse-hackthon', STAFF_PASSWORD)).body).toMatchObject({ exists: false, matches: false });
    // No session was made by checking.
    const sessions = (await h.asOwner('GET', '/api/admin/sessions')).body.sessions.filter((item: { username: string }) => item.username === 'cse-hackathon');
    expect(sessions).toHaveLength(1);
    // Only those who manage accounts.
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    expect((await h.call('POST', '/api/admin/staff/cse-hackathon/check-password', { password: STAFF_PASSWORD }, { token: desk.token })).status).toBe(403);
  });

  it('lets only the owner delete every staff account, after typing the confirmation; everyone is signed out', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const webAssist = await h.staff('ADMIN', [], 'web-assist1');
    expect((await h.call('POST', '/api/admin/staff/delete-all', { confirm: DELETE_ALL_STAFF }, { token: webAssist.token })).body.code).toBe('FORBIDDEN');
    expect((await h.asOwner('POST', '/api/admin/staff/delete-all', { confirm: 'delete all' })).body.code).toBe('INVALID');
    const deleted = await h.asOwner('POST', '/api/admin/staff/delete-all', { confirm: DELETE_ALL_STAFF });
    expect(deleted.body).toMatchObject({ deleted: 2 });
    expect((await h.asOwner('GET', '/api/admin/staff')).body.staff).toEqual([]);
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk.token })).status).toBe(401);
    expect((await login(h, 'cse-desk1', STAFF_PASSWORD)).body.code).toBe('INVALID_LOGIN');
    // The owner carries on, and makes the logins again by hand.
    expect((await h.asOwner('POST', '/api/admin/staff', { username: 'cse-desk1', displayName: 'CSE Desk 1', role: 'DESK', department: 'CSE', deskNumber: 1, password: 'New-Desk-Pass-2026' })).status).toBe(200);
    expect((await login(h, 'cse-desk1', 'New-Desk-Pass-2026')).status).toBe(200);
    // The old session stays ended (it was made with the old password).
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk.token })).status).toBe(401);
    // "delete-all" is never a username.
    expect((await h.asOwner('POST', '/api/admin/staff', { username: 'delete-all', displayName: 'Nobody', role: 'DESK', department: 'CSE', deskNumber: 2, password: 'New-Desk-Pass-2026' })).body.code).toBe('USERNAME_TAKEN');
  });

  it('leaves sessions a new password ended out of "Signed in now"', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const names = async () => (await h.asOwner('GET', '/api/admin/sessions')).body.sessions.map((item: { username: string }) => item.username);
    expect(await names()).toContain('cse-desk1');
    await h.asOwner('POST', '/api/admin/staff/cse-desk1', { password: 'Another-Pass-2026' });
    expect(await names()).not.toContain('cse-desk1');
  });
});
