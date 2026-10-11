/**
 * Test sessions on the live website: a test timeline the API and the website follow, TEST
 * marks on what is made while a session is on, deleting only that test data (with a backup),
 * and the web assistant team's Deleted list.
 */
import { describe, expect, it } from 'vitest';
import { CLEAR_PHRASE } from '../src/lib/testTools';
import { ADMIN, TIMES, setup } from './testing';

describe('the test timeline', () => {
  it('opens on-site registration now for testing, everywhere, and goes back to the real schedule', async () => {
    const h = setup({ at: TIMES.online });
    expect((await h.asOwner('GET', '/api/admin/session')).body.phase).toBe('online');
    expect((await h.call('GET', '/api/schedule')).body).toMatchObject({ success: true, test: false, schedule: { onsiteOpensAt: '2026-10-17T00:00:00' } });

    const set = await h.asOwner('POST', '/api/admin/testing/timeline', { mode: 'onsite-now', hours: 6 });
    expect(set.status).toBe(200);
    expect(set.body.timeline).toMatchObject({ phase: 'onsite', override: { mode: 'onsite-now', setBy: ADMIN.username } });
    // 10 October 12:00 PM IST: on-site from 11:59 AM to 6:00 PM.
    expect(set.body.timeline.schedule).toEqual({ onlineClosesAt: '2026-10-10T11:58:00', onsiteOpensAt: '2026-10-10T11:59:00', onsiteClosesAt: '2026-10-10T18:00:00' });
    expect((await h.asOwner('GET', '/api/admin/session')).body).toMatchObject({ phase: 'onsite', eventDayStarted: true });
    expect((await h.call('GET', '/api/schedule')).body).toMatchObject({ test: true, schedule: { onsiteOpensAt: '2026-10-10T11:59:00' } });
    // Online registration follows the timeline too.
    expect((await h.submit()).body.code).toBe('REGISTRATION_CLOSED');

    await h.asOwner('POST', '/api/admin/testing/timeline', { mode: 'closed' });
    expect((await h.asOwner('GET', '/api/admin/session')).body.phase).toBe('closed');

    const back = await h.asOwner('POST', '/api/admin/testing/timeline', { mode: 'standard' });
    expect(back.body.timeline).toMatchObject({ phase: 'online', override: null });
    expect((await h.submit()).status).toBe(200);
  });

  it('takes a custom timeline only when it is readable and in order', async () => {
    const h = setup({ at: TIMES.online });
    const wrongOrder = await h.asOwner('POST', '/api/admin/testing/timeline', {
      mode: 'custom',
      schedule: { onlineClosesAt: '2026-10-12T10:00', onsiteOpensAt: '2026-10-12T09:00', onsiteClosesAt: '2026-10-12T18:00' },
    });
    expect(wrongOrder.status).toBe(400);
    expect((await h.asOwner('POST', '/api/admin/testing/timeline', { mode: 'custom', schedule: { onlineClosesAt: 'soon' } })).status).toBe(400);
    const custom = await h.asOwner('POST', '/api/admin/testing/timeline', {
      mode: 'custom',
      schedule: { onlineClosesAt: '2026-10-10T11:00', onsiteOpensAt: '2026-10-10T11:30', onsiteClosesAt: '2026-10-10T20:00' },
    });
    expect(custom.body.timeline).toMatchObject({ phase: 'onsite', schedule: { onsiteClosesAt: '2026-10-10T20:00:00' } });
  });
});

describe('test sessions and their data', () => {
  async function session() {
    const h = setup({ at: TIMES.online });
    // A real student, before testing starts.
    const real = (await h.submit({ email: 'real@example.com', transactionId: 'UTR999000111' })).body.registrationId as string;
    const desk = await h.staff('DESK');
    expect((await h.asOwner('POST', '/api/admin/testing/session', { label: 'Rehearsal 1' })).body.session).toMatchObject({ label: 'Rehearsal 1', startedBy: ADMIN.username });
    const online = (await h.submit({ email: 'tester@example.com' })).body.registrationId as string;
    const walkIn = (await h.onsite(desk.token, { phone: '9876501234', email: 'walkin@example.com', events: ['code-flex'] })).body.registration.registrationId as string;
    await h.call('POST', '/api/help', { category: 'OTHER', message: 'Testing the help form', name: 'Tester', contact: '9876500000' });
    return { h, real, online, walkIn, desk };
  }

  it('marks what is made while a session is on, and lets an admin keep a real one or mark another', async () => {
    const { h, real, online, walkIn } = await session();
    const state = (await h.asOwner('GET', '/api/admin/testing')).body;
    expect(state.session).toMatchObject({ label: 'Rehearsal 1' });
    expect(state.records.map((record: { registrationId: string }) => record.registrationId).sort()).toEqual([online, walkIn].sort());
    expect(state).toMatchObject({ helpRequests: 1, realOnsite: 0 });

    // The online one was a real student after all: kept. The real one from before: marked.
    await h.asOwner('POST', `/api/admin/testing/records/${online}`, { test: false });
    await h.asOwner('POST', `/api/admin/testing/records/${real}`, { test: true });
    const after = (await h.asOwner('GET', '/api/admin/testing')).body;
    expect(after.records.map((record: { registrationId: string }) => record.registrationId).sort()).toEqual([real, walkIn].sort());
    expect(after.realOnsite).toBe(0);

    // Ending the session: nothing new is marked.
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'stop' });
    const later = (await h.submit({ email: 'later@example.com' })).body.registrationId as string;
    expect((await h.store.getRegistration(later))?.test).toBeUndefined();
  });

  it('deletes only the test data, after saving it to a backup, and frees its phone and email', async () => {
    const { h, real, online, walkIn, desk } = await session();
    const walkInRecord = (await h.store.getRegistration(walkIn))!;
    await h.service.runScheduled();
    expect((await h.call('POST', '/api/admin/testing/clear', { confirm: 'yes' }, { token: (await h.staff('ADMIN')).token })).status).toBe(400);

    const cleared = await h.asOwner('POST', '/api/admin/testing/clear', { confirm: CLEAR_PHRASE, results: true, helpRequests: true, restartDeskIds: true });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ cleared: 2, remaining: 0, helpRequests: 1, deskIdsRestarted: true });
    // The real student is untouched; the test records are gone.
    expect(await h.store.getRegistration(real)).not.toBeNull();
    expect(await h.store.getRegistration(online)).toBeNull();
    expect(await h.store.getRegistration(walkIn)).toBeNull();
    // Saved first, privately.
    const backup = h.files.objects.get(cleared.body.backup);
    expect(cleared.body.backup).toMatch(/^backups\/test-data-.*\.json$/);
    const saved = JSON.parse(new TextDecoder().decode(backup!.bytes));
    expect(saved.registrations.map((record: { registrationId: string }) => record.registrationId).sort()).toEqual([online, walkIn].sort());
    // Files gone, Drive copies in the trash, sheet rows marked.
    expect(h.files.objects.has(walkInRecord.pdfKey ?? `screenshot-of-${online}`)).toBe(false);
    expect(h.drive.trashed.length).toBeGreaterThan(0);
    expect(h.sheets.rows.find((row) => row.id === walkIn)?.status).toBe('TEST CLEARED');
    expect(h.sheets.rows.find((row) => row.id === real)?.status).not.toBe('TEST CLEARED');
    // Its phone and email can be used again, and the desk starts again at 262001.
    const again = await h.onsite(desk.token, { phone: '9876501234', email: 'walkin@example.com' });
    expect(again.status).toBe(200);
    expect(again.body.registration.registrationId).toBe('262001');
    // Not in the web assistant team's Deleted list (test data), but in the log.
    expect((await h.asOwner('GET', '/api/admin/deleted')).body.deleted).toEqual([]);
    expect((await h.store.listAuditEntries())[0]).toMatchObject({ action: 'TEST_CLEARED', by: ADMIN.username });
  });
});

describe('the Deleted list (web assistant team)', () => {
  it('lets the web assistant team delete a student, hides them from everyone, and restores them', async () => {
    const h = setup({ at: TIMES.eventDay });
    const support = await h.staff('SUPPORT');
    const desk = await h.staff('DESK');
    const id = (await h.onsite(desk.token, { name: 'Asha K', phone: '9840022222', email: 'asha@example.com' })).body.registration.registrationId as string;

    const deleted = await h.call('POST', `/api/admin/registrations/${id}/delete`, { reason: 'Registered twice' }, { token: support.token });
    expect(deleted.status).toBe(200);
    // Gone for the desk; in the web assistant team's Deleted list.
    const list = (await h.call('GET', '/api/admin/registrations', undefined, { token: desk.token })).body.registrations;
    expect(list.some((registration: { registrationId: string }) => registration.registrationId === id)).toBe(false);
    expect((await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: desk.token })).status).toBe(404);
    const bin = (await h.call('GET', '/api/admin/deleted', undefined, { token: support.token })).body.deleted;
    expect(bin).toEqual([expect.objectContaining({ registrationId: id, name: 'Asha K', phone: '9840022222', source: 'ONSITE', deletedBy: support.username, reason: 'Registered twice' })]);
    expect((await h.call('GET', '/api/admin/deleted', undefined, { token: desk.token })).status).toBe(403);

    h.advance(60_000);
    const restored = await h.call('POST', `/api/admin/deleted/${id}/restore`, {}, { token: support.token });
    expect(restored.status).toBe(200);
    expect(restored.body.registration).toMatchObject({ registrationId: id, participant: { name: 'Asha K' } });
    expect((await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: desk.token })).status).toBe(200);
    expect((await h.call('GET', '/api/admin/deleted', undefined, { token: support.token })).body.deleted).toEqual([]);
    expect((await h.store.listAuditEntries())[0]).toMatchObject({ action: 'RESTORED', registrationId: id });
  });

  it('refuses to restore a student whose phone is now someone else’s', async () => {
    const h = setup({ at: TIMES.eventDay });
    const support = await h.staff('SUPPORT');
    const desk = await h.staff('DESK');
    const first = (await h.onsite(desk.token, { phone: '9840033333', email: 'one@example.com' })).body.registration.registrationId as string;
    await h.call('POST', `/api/admin/registrations/${first}/delete`, { reason: 'Mistake' }, { token: support.token });
    const second = (await h.onsite(desk.token, { phone: '9840033333', email: 'two@example.com' })).body.registration.registrationId as string;
    const refused = await h.call('POST', `/api/admin/deleted/${first}/restore`, {}, { token: support.token });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain(`phone number is now used by ${second}`);
    expect(await h.store.getRegistration(first)).toBeNull();
  });
});
