/**
 * The gate desk and the event venue: the desk takes the gate pass and the events the
 * participant chooses (individual or team, with the team name), and each coordinator sees
 * them at once; at the venue the coordinator finds the participant by the ID on their gate
 * pass, enters them (individual or team) if they are not yet, and records the ₹50 fee. Each
 * team member pays separately. Also the numeric Registration IDs.
 */
import { describe, expect, it } from 'vitest';
import { TIMES, setup } from './testing';

const cash = { method: 'CASH', confirmedReceived: true };

describe('gate desk: the gate pass and the events chosen, individual or team', () => {
  it('records the team and the chosen events; team events take the gate team, and each coordinator sees the participant at once', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
    const solo = await h.onsite(desk.token);
    expect(solo.body.registration).toMatchObject({ teamName: null, events: [], eventCount: 0, payableAtVenue: 0 });

    const team = await h.onsite(desk.token, { teamName: '  Code   Ninjas ', events: ['code-flex', 'viz-craft'] });
    expect(team.status).toBe(200);
    const registration = team.body.registration;
    const id = registration.registrationId as string;
    expect(registration).toMatchObject({ teamName: 'Code Ninjas', technicalEvents: ['VIZ CRAFT', 'CODE FLEX'], eventCount: 2, payableAtVenue: 100 });
    // A team event takes the gate team, an individual event never does; both are paid at the venue.
    expect(registration.events).toEqual([
      expect.objectContaining({ eventId: 'viz-craft', team: 'Code Ninjas', addedBy: desk.username, fee: expect.objectContaining({ status: 'UNPAID' }) }),
      expect.objectContaining({ eventId: 'code-flex', team: null, addedBy: desk.username, fee: expect.objectContaining({ status: 'UNPAID' }) }),
    ]);
    const row = h.sheets.rows.find((candidate) => candidate.id === id);
    expect(row).toMatchObject({ technicalEvents: 'VIZ CRAFT, CODE FLEX', teams: 'Gate: Code Ninjas · VIZ CRAFT: Code Ninjas' });

    // The coordinator sees them at once, unpaid, and takes the ₹50 at the venue.
    const roster = await h.call('GET', '/api/admin/events/viz-craft', undefined, { token: coordinator.token });
    expect(roster.body.participants).toEqual([
      expect.objectContaining({ registrationId: id, team: 'Code Ninjas', gateTeam: 'Code Ninjas', fee: expect.objectContaining({ status: 'UNPAID' }) }),
    ]);
    const paid = await h.call('POST', `/api/admin/events/viz-craft/registrations/${id}/enroll`, { team: 'Code Ninjas', payment: cash }, { token: coordinator.token });
    expect(paid.body.participant.fee).toMatchObject({ status: 'PAID', verifiedBy: coordinator.username });

    // Viz Craft teams have at most 2 members: a third is refused at the desk, before anything is stored.
    expect((await h.onsite(desk.token, { teamName: 'code ninjas', events: ['viz-craft'] })).status).toBe(200);
    const third = await h.onsite(desk.token, { teamName: 'Code Ninjas', events: ['viz-craft'], email: 'third@example.com' });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('TEAM_FULL');
    expect(await h.store.findClaim('email', 'third@example.com')).toBeNull();

    const nameless = await h.onsite(desk.token, { body: { participation: 'TEAM', teamName: '' } });
    expect(nameless.status).toBe(400);
    expect(nameless.body.error).toBe('Enter the team name.');
    expect((await h.onsite(desk.token, { body: { participation: 'GROUP' } })).status).toBe(400);

    // The desk can correct the events: add one (a team event with the gate team) or remove an unpaid one.
    const change = (registrationId: string, body: unknown) => h.call('POST', `/api/admin/registrations/${registrationId}/events`, body, { token: desk.token });
    const added = await change(id, { add: ['pro-pitch'] });
    expect(added.body.registration.events).toContainEqual(expect.objectContaining({ eventId: 'pro-pitch', team: 'Code Ninjas', addedBy: desk.username }));
    expect((await change(id, { remove: ['viz-craft'] })).body.code).toBe('EVENT_IN_USE');
    const soloId = solo.body.registration.registrationId as string;
    expect((await change(soloId, { add: ['cognix'] })).body.registration.technicalEvents).toEqual(['COGNIX']);
    // A desk registration may end up with no events (online ones keep at least one).
    expect((await change(soloId, { remove: ['cognix'] })).body.registration.eventCount).toBe(0);
  });

  it('gives a desk registration no pass and no email: the Registration ID is enough', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const registration = (await h.onsite(desk.token)).body.registration;
    await h.service.runScheduled();
    expect((await h.store.getRegistration(registration.registrationId))?.pdfStatus).toBe('NOT_STARTED');
    expect(h.sendMail).not.toHaveBeenCalled();
    expect([...h.files.objects.keys()].some((key) => key.startsWith('passes/'))).toBe(false);
  });
});

describe('event venue: find by ID, enter as individual or team, pay in the same step', () => {
  it('enters a participant and records the fee at once; team members each pay; team size and individual events are enforced', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['viz-craft', 'code-flex']);
    const enter = (id: string, eventId: string, body: unknown) =>
      h.call('POST', `/api/admin/events/${eventId}/registrations/${id}/enroll`, body, { token: coordinator.token });
    const a = (await h.onsite(desk.token, { teamName: 'Data Wizards' })).body.registration.registrationId;
    const b = (await h.onsite(desk.token)).body.registration.registrationId;
    const c = (await h.onsite(desk.token)).body.registration.registrationId;

    // The coordinator looks the participant up by the ID on their gate pass.
    const found = await h.call('GET', `/api/admin/lookup/${a}`, undefined, { token: coordinator.token });
    expect(found.body).toMatchObject({ registrationId: a, teamName: 'Data Wizards', gatePassVerified: true });

    const paid = await enter(a, 'viz-craft', { team: 'Data Wizards', payment: cash });
    expect(paid.status).toBe(200);
    expect(paid.body.participant).toMatchObject({
      team: 'Data Wizards',
      gateTeam: 'Data Wizards',
      addedBy: coordinator.username,
      fee: { status: 'PAID', method: 'CASH', amount: 50, verifiedBy: coordinator.username },
    });

    // Each team member pays for themselves; team names match whatever their case or spacing.
    expect((await enter(b, 'viz-craft', { team: 'data  wizards', payment: { method: 'UPI', reference: 'UPI12312312', confirmedReceived: true } })).status).toBe(200);
    // Viz Craft teams have at most 2 members: the third is refused and not entered.
    const third = await enter(c, 'viz-craft', { team: 'Data Wizards', payment: cash });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('TEAM_FULL');
    expect((await h.store.getRegistration(c))?.eventIds).toEqual([]);

    // Individual events take no team.
    const solo = await enter(c, 'code-flex', { team: 'Lone Wolves' });
    expect(solo.status).toBe(400);
    expect(solo.body.code).toBe('INDIVIDUAL_EVENT');
    expect((await enter(c, 'code-flex', { payment: cash })).body.participant).toMatchObject({ team: null, fee: { status: 'PAID' } });

    // Paying twice is refused; the team can still be corrected before results are submitted.
    expect((await enter(a, 'viz-craft', { payment: cash })).body.code).toBe('ALREADY_PAID');
    expect((await enter(a, 'viz-craft', { team: null })).body.participant.team).toBeNull();

    // A payment still needs the money confirmed as received: a reference alone is not proof.
    const unconfirmed = await enter(c, 'viz-craft', { payment: { method: 'UPI', reference: 'UPI45645645' } });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.code).toBe('PAYMENT_NOT_CONFIRMED');

    // Entering without paying is allowed (they pay later); attendance still needs the fee.
    const d = (await h.onsite(desk.token)).body.registration.registrationId;
    expect((await enter(d, 'code-flex', {})).body.participant.fee.status).toBe('UNPAID');
    const present = await h.call('POST', `/api/admin/events/code-flex/registrations/${d}/attendance`, { present: true }, { token: coordinator.token });
    expect(present.body.code).toBe('EVENT_FEE_UNPAID');
  });

  it('takes no event fee until the gate pass is verified', async () => {
    const h = setup({ at: TIMES.online });
    const pending = (await h.submit({ events: ['cognix'] })).body.registrationId;
    h.setTime(TIMES.eventDay);
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    const response = await h.call('POST', `/api/admin/events/cognix/registrations/${pending}/enroll`, { payment: cash }, { token: coordinator.token });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('GATE_PASS_NOT_VERIFIED');
  });

  it('keeps teams in the submitted lists and the winners for certificates', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['pro-pitch']);
    const ids: string[] = [];
    for (const name of ['Asha K', 'Bala M']) {
      ids.push((await h.onsite(desk.token, { name, teamName: 'Prompt Pilots' })).body.registration.registrationId);
    }
    const as = (path: string, body: unknown) => h.call('POST', `/api/admin/events/pro-pitch${path}`, body, { token: coordinator.token });
    for (const id of ids) {
      expect((await as(`/registrations/${id}/enroll`, { team: 'Prompt Pilots', payment: cash })).status).toBe(200);
      expect((await as(`/registrations/${id}/attendance`, { present: true })).status).toBe(200);
    }
    expect((await as('/winners', { first: ids })).status).toBe(200);
    const submitted = await as('/submit', {});
    expect(submitted.body.result.submission.winners.first).toEqual([
      expect.objectContaining({ registrationId: ids[0], team: 'Prompt Pilots' }),
      expect.objectContaining({ registrationId: ids[1], team: 'Prompt Pilots' }),
    ]);
    expect(submitted.body.result.submission.participants.map((person: { team: string }) => person.team)).toEqual(['Prompt Pilots', 'Prompt Pilots']);
  });
});

describe('numeric Registration IDs', () => {
  it('continues the online serial after earlier IDs of either form, and still finds the earlier ones', async () => {
    const h = setup({ at: TIMES.online });
    h.sheets.rows.push({ id: 'PRG26-0041' }, { id: '261009' }, { id: '262003' });
    // The online serial continues after both earlier forms; on-site numbers never count.
    expect((await h.submit()).body.registrationId).toBe('261042');

    const fresh = await h.store.getRegistration('261042');
    h.store.registrations.set('PRG26-0007', { ...fresh!, registrationId: 'PRG26-0007', status: 'APPROVED' });
    h.setTime(TIMES.eventDay);
    const coordinator = await h.staff('COORDINATOR', ['code-flex']);
    const found = await h.call('GET', '/api/admin/lookup/prg26-0007', undefined, { token: coordinator.token });
    expect(found.status).toBe(200);
    expect(found.body.registrationId).toBe('PRG26-0007');
    expect((await h.call('GET', '/api/admin/lookup/PRG26-OS-0001', undefined, { token: coordinator.token })).status).toBe(404);
    expect((await h.call('GET', '/api/admin/lookup/300001', undefined, { token: coordinator.token })).status).toBe(404);
  });
});
