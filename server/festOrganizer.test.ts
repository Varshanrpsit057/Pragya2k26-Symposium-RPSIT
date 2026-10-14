/**
 * What the organizers asked for on the event's last days: one department per student, the
 * non-technical events' view-only gate pass check, the desks' cash hand-over, and winners (a
 * student wins one place only).
 */
import { describe, expect, it, vi } from 'vitest';
import type { FestRegistration, GateStudent, HandOver } from '../src/lib/fest';
import { TIMES, setup } from './testing';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

let count = 0;
const student = (dept: string, extra: Record<string, unknown> = {}) => {
  count += 1;
  return {
    submissionId: `organizer-key-${String(count).padStart(12, '0')}`,
    participant: { name: 'Meena K', phone: `97${String(30000000 + count).padStart(8, '0')}`, email: `m${count}@example.com`, college: 'Sona College of Technology', collegeCode: '2615', branch: 'B.E. CSE', year: '2nd Year', team: '' },
    dept,
    events: [],
    ...extra,
  };
};
const onPhone = async (h: Harness, body: ReturnType<typeof student>) => {
  const made = await h.call('POST', '/api/fest/register', body, { ip: '10.8.0.1' });
  expect(made.status).toBe(200);
  return made.body.registration.id as string;
};
const cash = (h: Harness, token: string, id: string) => h.call('POST', `/api/admin/fest/registrations/${id}`, { action: 'collect', payment: { method: 'CASH', confirmed: true } }, { token });

describe('one department per student', () => {
  it('refuses the same mobile number under another department: on the phone, at a desk, in a correction and in an import', async () => {
    const h = setup({ at: TIMES.eventDay });
    const first = student('CSE');
    await onPhone(h, first);
    const phone = first.participant.phone;

    const desk = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    const atDesk = await h.call('POST', '/api/admin/fest/registrations', { ...student('IT'), participant: { ...student('IT').participant, phone } }, { token: desk.token });
    expect(atDesk.body).toMatchObject({ code: 'DUPLICATE_PHONE', error: expect.stringContaining('already registered under CSE as CSE-2001') });

    // A correction to another IT student's number cannot take it either.
    const other = await onPhone(h, student('IT'));
    const corrected = await h.call('POST', `/api/admin/fest/registrations/${other}`, { action: 'edit', participant: { phone } }, { token: desk.token });
    expect(corrected.body).toMatchObject({ code: 'DUPLICATE_PHONE' });

    const admin = await h.staff('DEPT_ADMIN', [], 'mech-admin', { department: 'MECH' });
    const imported = await h.call(
      'POST',
      '/api/admin/fest/import',
      { dryRun: true, rows: [{ name: 'Meena K', phone, email: 'x@example.com', college: 'Sona', collegeCode: '2615', branch: 'B.E.', year: '2nd Year', team: '', events: 'Paper Presentation', ref: '' }] },
      { token: admin.token },
    );
    expect(imported.body.outcomes[0]).toMatchObject({ status: 'duplicate', message: expect.stringContaining('under CSE') });
  });
});

describe('the non-technical events’ gate pass check', () => {
  it('shows every department’s students and whether they paid, without phone numbers, and changes nothing', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const paid = await onPhone(h, student('CSE'));
    await cash(h, desk.token, paid);
    await onPhone(h, student('AIDS', { txn: '512345678901' }));
    await onPhone(h, student('IT'));
    const gate = await h.staff('NONTECH', [], 'nontech');

    const list = (await h.call('GET', '/api/admin/fest/gate', undefined, { token: gate.token })).body.students as GateStudent[];
    expect(list.map((item) => [item.id, item.status])).toEqual([
      ['AIDS-2001', 'TO_CHECK'],
      ['CSE-2001', 'PAID'],
      ['IT-2001', 'DUE'],
    ]);
    expect(Object.keys(list[0]).sort()).toEqual(['college', 'collegeCode', 'dept', 'id', 'name', 'status']);
    // Nothing else: no live data, no changes.
    expect((await h.call('POST', '/api/admin/fest/sync', {}, { token: gate.token })).status).toBe(403);
    expect((await cash(h, gate.token, 'IT-2001')).status).toBe(403);
    // Only the web assist team and this login see it.
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack', { department: 'CSE' });
    expect((await h.call('GET', '/api/admin/fest/gate', undefined, { token: coordinator.token })).status).toBe(403);
  });
});

describe('the desks’ cash hand-over', () => {
  it('keeps what a desk counted beside what the system says it took; the overall coordinator sees every desk', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk2', { department: 'CSE', deskNumber: 2 });
    for (let n = 0; n < 3; n += 1) await cash(h, desk.token, await onPhone(h, student('CSE')));

    const short = await h.call('POST', '/api/admin/fest/handover', { counted: 200, note: 'to the HOD' }, { token: desk.token });
    expect(short.body.handOver).toMatchObject({ dept: 'CSE', desk: 2, counted: 200, system: 300, by: 'cse-desk2', note: 'to the HOD' });
    // A desk hands over its own desk's cash only (whatever it sends).
    const other = await h.call('POST', '/api/admin/fest/handover', { counted: 300, desk: 1, dept: 'IT' }, { token: desk.token });
    expect(other.status).toBe(403);
    expect((await h.call('POST', '/api/admin/fest/handover', { counted: -5 }, { token: desk.token })).status).toBe(400);
    await h.call('POST', '/api/admin/fest/handover', { counted: 300 }, { token: desk.token });

    const overall = await h.staff('OVERALL');
    const seen = (await h.call('GET', '/api/admin/fest/handovers', undefined, { token: overall.token })).body.handOvers as HandOver[];
    expect(seen.map((item) => [item.desk, item.counted, item.system])).toEqual([
      [2, 300, 300],
      [2, 200, 300],
    ]);
    // Another department's desk does not see CSE's.
    const itDesk = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    expect((await h.call('GET', '/api/admin/fest/handovers', undefined, { token: itDesk.token })).body.handOvers).toEqual([]);
  });
});

describe('winners', () => {
  it('refuses a student in two places', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack', { department: 'CSE' });
    const ids: string[] = [];
    for (let n = 0; n < 2; n += 1) {
      const id = await onPhone(h, student('CSE'));
      await cash(h, desk.token, id);
      const path = `/api/admin/fest/registrations/${id}/events/cse-hackathon`;
      await h.call('POST', path, { action: 'add' }, { token: coordinator.token });
      await h.call('POST', path, { action: 'fee', payment: { method: 'CASH', confirmed: true } }, { token: coordinator.token });
      await h.call('POST', path, { action: 'present' }, { token: coordinator.token });
      ids.push(id);
    }
    const save = (places: { place: number; ids: string[]; team?: string }[]) => h.call('POST', '/api/admin/fest/events/cse-hackathon/results', { action: 'save', places }, { token: coordinator.token });
    expect((await save([{ place: 1, ids }, { place: 2, ids: [ids[0]] }])).body).toMatchObject({ code: 'INVALID', error: expect.stringContaining('in two places') });
    // A team: a row per member, the team's name once.
    const saved = await save([{ place: 1, ids, team: 'Byte Me' }]);
    expect(saved.body.result.places).toEqual([{ place: 1, ids, team: 'Byte Me' }]);
    const [registration] = (await h.call('POST', '/api/admin/fest/sync', {}, { token: coordinator.token })).body.registrations as FestRegistration[];
    expect(registration.dept).toBe('CSE');
  });
});

describe('an event window', () => {
  it('takes a student added by mistake out again, but not once their fee is taken', async () => {
    const h = setup({ at: TIMES.eventDay });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack', { department: 'CSE' });
    const id = await onPhone(h, student('CSE'));
    const path = `/api/admin/fest/registrations/${id}/events/cse-hackathon`;
    await h.call('POST', path, { action: 'add' }, { token: coordinator.token });
    const removed = await h.call('POST', path, { action: 'remove' }, { token: coordinator.token });
    expect(removed.body.registration.events).toEqual([]);
    await h.call('POST', path, { action: 'add' }, { token: coordinator.token });
    await h.call('POST', path, { action: 'fee', payment: { method: 'CASH', confirmed: true } }, { token: coordinator.token });
    expect((await h.call('POST', path, { action: 'remove' }, { token: coordinator.token })).body.code).toBe('FEE_PAID');
  });
});
