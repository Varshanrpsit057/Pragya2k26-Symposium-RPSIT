/**
 * The registration desk number of each desk sign-in: chosen when signing in (or after), kept on
 * the registrations and gate passes made there, and shown to admins with who is signed in now.
 */
import { describe, expect, it } from 'vitest';
import { STAFF_PASSWORD, TIMES, pngBytes, setup } from './testing';

describe('desk numbers', () => {
  it('keeps the desk of each desk sign-in on what it registers and receives, and shows admins who is signed in at which desk', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.staff('DESK', [], 'desk-a');
    const coordinator = await h.staff('COORDINATOR', ['viz-craft'], 'lead-a');
    // Signing in at desk 2 (a desk number is only kept for desk accounts).
    const signIn = (username: string, deskNumber?: unknown) => h.call('POST', '/api/admin/login', { username, password: STAFF_PASSWORD, ...(deskNumber !== undefined && { deskNumber }) });
    const desk = (await signIn('desk-a', 2)).body.token as string;
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk })).body.deskNumber).toBe(2);
    const lead = (await signIn('lead-a', 2)).body.token as string;
    expect((await h.call('GET', '/api/admin/session', undefined, { token: lead })).body.deskNumber).toBeNull();
    expect((await h.call('POST', '/api/admin/session/desk', { deskNumber: 1 }, { token: lead })).status).toBe(400);
    // A nonsense desk number is ignored at sign-in and refused afterwards.
    const other = (await signIn('desk-a', 'abc')).body.token as string;
    expect((await h.call('GET', '/api/admin/session', undefined, { token: other })).body.deskNumber).toBeNull();
    expect((await h.call('POST', '/api/admin/session/desk', { deskNumber: 99 }, { token: other })).status).toBe(400);
    expect((await h.call('POST', '/api/admin/session/desk', { deskNumber: '4' }, { token: other })).body.deskNumber).toBe(4);

    // Registered and paid at desk 2.
    const cash = (await h.onsite(desk, { phone: '9840011111', events: ['viz-craft'] })).body.registration;
    expect(cash).toMatchObject({ deskNumber: 2, gatePass: { method: 'CASH', verifiedBy: 'desk-a' } });
    expect(cash.payments[0]).toMatchObject({ approvedBy: 'desk-a', approvedAtDesk: 2 });
    // Registered at desk 4, paid by GPay, approved at desk 2.
    const gpay = (await h.onsite(other, { phone: '9840022222', payment: { method: 'UPI', studentPays: true } })).body.registration;
    expect(gpay.deskNumber).toBe(4);
    const approved = (await h.call('POST', `/api/admin/registrations/${gpay.registrationId}/approve`, { payment: { method: 'UPI', reference: 'UTR90909090' } }, { token: desk })).body.registration;
    expect(approved.payments[0]).toMatchObject({ approvedBy: 'desk-a', approvedAtDesk: 2 });

    // The report, desk by desk.
    const report = (await h.asOwner('GET', '/api/admin/reports')).body.report;
    expect(report.desks).toEqual([
      { desk: 2, registrations: 1, cashCount: 1, cash: 100, upiCount: 1, upi: 100 },
      { desk: 4, registrations: 1, cashCount: 0, cash: 0, upiCount: 0, upi: 0 },
    ]);

    // Admins see who is signed in, at which desk; nobody else may, and no tokens are shown.
    const sessions = (await h.asOwner('GET', '/api/admin/sessions')).body.sessions;
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: 'desk-a', role: 'DESK', deskNumber: 2 }),
        expect.objectContaining({ username: 'desk-a', role: 'DESK', deskNumber: 4 }),
        expect.objectContaining({ username: 'lead-a', role: 'COORDINATOR', deskNumber: null }),
      ]),
    );
    expect(JSON.stringify(sessions)).not.toMatch(/credential|token/i);
    for (const token of [desk, coordinator.token]) expect((await h.call('GET', '/api/admin/sessions', undefined, { token })).status).toBe(403);
    // Signed out: gone from the list.
    await h.call('POST', '/api/admin/logout', undefined, { token: other });
    expect((await h.asOwner('GET', '/api/admin/sessions')).body.sessions.filter((item: { deskNumber: number | null }) => item.deskNumber === 4)).toEqual([]);
  });

  it('lets a coordinator open only the screenshots of their own events (and gate passes, to verify them)', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const viz = await h.staff('COORDINATOR', ['viz-craft']);
    const cognix = await h.staff('COORDINATOR', ['cognix']);
    const id = (await h.onsite(desk.token, { phone: '9840011111', events: ['viz-craft'] })).body.registration.registrationId as string;
    const ticket = await h.call('POST', '/api/student/upload', { registrationId: id, phone: '9840011111', contentType: 'image/png', size: 2048 });
    h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
    const view = await h.call('POST', '/api/student/proof', { registrationId: id, phone: '9840011111', uploadId: ticket.body.uploadId, kind: 'viz-craft' });
    expect(view.status).toBe(200);
    const proofId = (await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token: desk.token })).body.registration.proofs[0].id;
    const open = (token: string) => h.call('GET', `/api/admin/registrations/${id}/proofs/${proofId}`, undefined, { token });
    expect((await open(viz.token)).status).toBe(200);
    expect((await open(cognix.token)).body.code).toBe('EVENT_NOT_ASSIGNED');
    expect((await open(desk.token)).status).toBe(200);
  });
});
