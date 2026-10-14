/**
 * The load test's mock participants (capped at 1,000, most from the colleges around Salem, all
 * TEST) and the rule that students take part only in their own department's events (on by default;
 * Website controls can open events to every department and close them again).
 */
import { describe, expect, it, vi } from 'vitest';
import type { FestRegistration } from '../src/lib/fest';
import { MAIN_COLLEGES, MAX_TEST_PARTICIPANTS } from './festLoadTest';
import { TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 60_000 });

const everyone = async (h: Harness) => (await h.asOwner('POST', '/api/admin/fest/sync', {})).body.registrations as FestRegistration[];

describe('the load test button', () => {
  it('adds 1,000 mock participants in batches, never more, most from the colleges around Salem, and they are deleted with the test data', async () => {
    const h = setup({ at: TIMES.eventDay });
    const totals: number[] = [];
    for (let call = 0; call < 6; call += 1) {
      const { body } = await h.asOwner('POST', '/api/admin/fest/test-data/seed', {});
      totals.push(body.total);
      if (!body.remaining) break;
    }
    expect(totals).toEqual([250, 500, 750, 1000]);
    // Capped: pressing it again adds nothing.
    expect((await h.asOwner('POST', '/api/admin/fest/test-data/seed', {})).body).toMatchObject({ added: 0, total: MAX_TEST_PARTICIPANTS, remaining: 0, cap: 1000 });

    const all = await everyone(h);
    expect(all).toHaveLength(1000);
    expect(all.every((item) => item.test && item.source === 'SELF' && /^[A-Z]{2,4}-[2-4]\d{3}$/.test(item.id))).toBe(true);
    // Every department gets its share, with unique mobile numbers in each.
    const perDept = new Map<string, FestRegistration[]>();
    for (const item of all) perDept.set(item.dept, [...(perDept.get(item.dept) ?? []), item]);
    expect([...perDept.values()].every((list) => list.length === 125 && new Set(list.map((item) => item.phone)).size === list.length)).toBe(true);
    // Most from the five main colleges (Sona, Dhirajlal Gandhi, PMC Tech, Shreenivasa, GEC Salem).
    const fromMain = all.filter((item) => MAIN_COLLEGES.includes(item.college)).length;
    expect(fromMain).toBeGreaterThan(500);
    for (const college of MAIN_COLLEGES) expect(all.some((item) => item.college === college)).toBe(true);
    // A mix of payments, and only their own department's events.
    expect(all.some((item) => item.entry.status === 'PAID')).toBe(true);
    expect(all.some((item) => item.entry.status === 'DUE' && item.entry.claim)).toBe(true);
    expect(all.some((item) => item.entry.status === 'DUE' && !item.entry.claim)).toBe(true);
    expect(all.every((item) => item.events.every((entry) => entry.eventId.startsWith(`${item.dept.toLowerCase()}-`)))).toBe(true);

    for (let call = 0; call < 10; call += 1) {
      if (!(await h.asOwner('POST', '/api/admin/fest/test-data/clear', {})).body.remaining) break;
    }
    expect(await everyone(h)).toEqual([]);
  });

  it('adds only up to the number asked for, and only the web assist team can use it', async () => {
    const h = setup({ at: TIMES.eventDay });
    expect((await h.asOwner('POST', '/api/admin/fest/test-data/seed', { count: 30 })).body).toMatchObject({ added: 30, total: 30, remaining: 0 });
    expect((await h.asOwner('POST', '/api/admin/fest/test-data/seed', { count: 5000 })).body).toMatchObject({ added: 250, total: 280 });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    expect((await h.call('POST', '/api/admin/fest/test-data/seed', {}, { token: desk.token })).status).toBe(403);
  });
});

describe('students join only their own department’s events', () => {
  const register = (h: Harness, dept: string, n: number) =>
    h.call(
      'POST',
      '/api/fest/register',
      { submissionId: `access-test-key-0000000${n}`, dept, participant: { name: `Student ${'ABC'[n]}`, phone: `977700000${n}`, college: 'Sona', collegeCode: '2615', branch: 'B.E. CSE', year: '2nd Year', email: `s${n}@example.com` }, events: [] },
      { ip: '10.6.0.1' },
    );

  it('keeps an AI&DS student to AI&DS events and each coordinator to their department, with no switch to open them', async () => {
    const h = setup({ at: TIMES.eventDay });
    await register(h, 'AIDS', 0);
    await register(h, 'CSE', 1);
    await register(h, 'AIDS', 2);
    const cse = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    const add = (id: string) => h.call('POST', `/api/admin/fest/registrations/${id}/events/cse-hackathon`, { action: 'add' }, { token: cse.token });
    const seen = async () => ((await h.call('POST', '/api/admin/fest/sync', {}, { token: cse.token })).body.registrations as FestRegistration[]).map((item) => item.id).sort();

    // The CSE coordinator gets only CSE students, and cannot add an AI&DS one.
    expect(await seen()).toEqual(['CSE-2001']);
    expect((await add('AIDS-2001')).body).toMatchObject({ code: 'OTHER_DEPARTMENT', error: expect.stringContaining('AI&DS events only') });
    expect((await add('CSE-2001')).status).toBe(200);

    // The old "open events to every department" setting does nothing any more.
    await h.asOwner('POST', '/api/admin/portal', { portal: { ownDepartmentEvents: false } });
    const sync = await h.call('POST', '/api/admin/fest/sync', {}, { token: cse.token });
    expect(sync.body.switches).not.toHaveProperty('ownDepartmentEvents');
    expect(await seen()).toEqual(['CSE-2001']);
    expect((await add('AIDS-2002')).body.code).toBe('OTHER_DEPARTMENT');
    // Nor does a registration bring any event with it (events are joined at the venue).
    const other = await h.call(
      'POST',
      '/api/fest/register',
      { submissionId: 'access-test-key-00000009', dept: 'AIDS', participant: { name: 'Student D', phone: '9777000009', college: 'Sona', collegeCode: '2615', branch: 'B.E. CSE', year: '2nd Year', email: 's9@example.com' }, events: ['cse-hackathon'] },
      { ip: '10.6.0.1' },
    );
    expect(other.body.registration).toMatchObject({ id: 'AIDS-2003', events: [] });
  });
});
