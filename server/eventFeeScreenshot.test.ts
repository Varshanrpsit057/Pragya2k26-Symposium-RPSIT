/**
 * An event's ₹50 fee paid by GPay from Student login: the student uploads the screenshot, the
 * event's coordinator sees it in their list and lookup, types the transaction ID and approves
 * it, marking the student present in the same step. The same steps as the desk's ₹100 check.
 */
import { describe, expect, it } from 'vitest';
import { TIMES, pngBytes, setup } from './testing';

async function venue() {
  const h = setup({ at: TIMES.eventDay });
  const desk = await h.staff('DESK');
  const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
  const registration = (await h.onsite(desk.token, { phone: '9840012345', events: ['viz-craft', 'cognix'], payment: { method: 'UPI', reference: 'GATEUTR12345', confirmedReceived: true } }))
    .body.registration;
  const id = registration.registrationId as string;
  const credentials = { registrationId: id, phone: '9840012345' };
  const upload = async (kind: string, transactionId = '') => {
    const ticket = await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 });
    h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
    return h.call('POST', '/api/student/proof', { ...credentials, uploadId: ticket.body.uploadId, kind, transactionId });
  };
  const roster = async () => (await h.call('GET', '/api/admin/events/viz-craft', undefined, { token: coordinator.token })).body;
  const approve = (body: unknown, token = coordinator.token, registrationId = id) =>
    h.call('POST', `/api/admin/events/viz-craft/registrations/${registrationId}/fee-screenshot`, body, { token });
  return { h, desk, coordinator, id, credentials, upload, roster, approve };
}

describe('event fee approved from the student’s GPay screenshot', () => {
  it('shows the screenshot to the event’s coordinator, who approves it with the transaction ID and marks them present', async () => {
    const { h, coordinator, id, credentials, upload, roster, approve } = await venue();
    expect((await roster()).participants[0].feeProof).toBeNull();

    expect((await upload('viz-craft', 'UTR55556666')).status).toBe(200);
    const proof = (await roster()).participants[0].feeProof;
    expect(proof).toEqual({ id: expect.stringMatching(/^[a-f0-9-]{12}$/), transactionId: 'UTR55556666', uploadedAt: '2026-10-17T04:00:00.000Z' });
    // In the ID lookup too, for this event only.
    const lookup = (await h.call('GET', `/api/admin/lookup/${id}`, undefined, { token: coordinator.token })).body;
    expect(lookup.events.find((event: { eventId: string }) => event.eventId === 'viz-craft').feeProof).toEqual(proof);
    // The coordinator can open it.
    expect((await h.call('GET', `/api/admin/registrations/${id}/proofs/${proof.id}`, undefined, { token: coordinator.token })).status).toBe(200);

    // The transaction ID is required, and only this event's coordinator (or an admin) may approve.
    expect((await approve({ proofId: proof.id, reference: '' })).body.code).toBe('TRANSACTION_REQUIRED');
    const other = await h.staff('COORDINATOR', ['cognix']);
    expect((await approve({ proofId: proof.id, reference: 'UTR55556666' }, other.token)).status).toBe(403);

    const approved = await approve({ proofId: proof.id, reference: 'utr 5555 6666', markPresent: true });
    expect(approved.status).toBe(200);
    expect(approved.body.participant).toMatchObject({
      fee: { status: 'PAID', method: 'UPI', amount: 50, reference: 'UTR55556666', verifiedBy: coordinator.username },
      attendance: { present: true, markedBy: coordinator.username },
      feeProof: null,
    });

    // The student sees it paid and present; a second screenshot for it is refused.
    const view = (await h.call('POST', '/api/student', credentials)).body;
    expect(view.events.find((event: { eventId: string }) => event.eventId === 'viz-craft')).toMatchObject({ feePaid: true, present: true });
    expect((await upload('viz-craft')).body.code).toBe('ALREADY_PAID');
    // Approving again is refused (already paid).
    expect((await approve({ proofId: proof.id, reference: 'UTR99990000' })).body.code).toBe('ALREADY_PAID');
    // Counted as GPay in the reports.
    const report = (await h.asOwner('GET', '/api/admin/reports')).body.report;
    expect(report.events.find((event: { eventId: string }) => event.eventId === 'viz-craft')).toMatchObject({ upi: 1, upiAmount: 50 });
  });

  it('never records one transaction ID twice, and frees it when the fee is voided', async () => {
    const { h, desk, id, upload, roster, approve } = await venue();
    await upload('viz-craft');
    const proof = (await roster()).participants[0].feeProof;

    // The gate pass reference of the same student, or a screenshot that is not for this event.
    expect((await approve({ proofId: proof.id, reference: 'GATEUTR12345' })).body).toMatchObject({ code: 'DUPLICATE_TRANSACTION', error: expect.stringContaining('another payment of') });
    expect((await approve({ proofId: 'nosuchproof1', reference: 'UTR11112222' })).body.code).toBe('NO_SCREENSHOT');
    // (Not recorded, so that ID is still free.)
    expect((await approve({ proofId: proof.id, reference: 'UTR11112222', markPresent: true })).status).toBe(200);

    // Another student cannot use it.
    const second = (await h.onsite(desk.token, { phone: '9840099999', events: ['viz-craft'] })).body.registration.registrationId as string;
    const ticket = await h.call('POST', '/api/student/upload', { registrationId: second, phone: '9840099999', contentType: 'image/png', size: 2048 });
    h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
    await h.call('POST', '/api/student/proof', { registrationId: second, phone: '9840099999', uploadId: ticket.body.uploadId, kind: 'viz-craft' });
    const secondProof = (await roster()).participants.find((item: { registrationId: string }) => item.registrationId === second).feeProof;
    const reused = await approve({ proofId: secondProof.id, reference: 'UTR11112222' }, undefined, second);
    expect(reused.body).toMatchObject({ code: 'DUPLICATE_TRANSACTION', details: { registrationId: id } });

    // An admin voids the first (recorded by mistake): the ID is free for the right student.
    expect((await h.asOwner('POST', `/api/admin/events/viz-craft/registrations/${id}/attendance`, { present: false })).status).toBe(200);
    expect((await h.asOwner('POST', `/api/admin/events/viz-craft/registrations/${id}/void-fee`, { reason: 'Wrong student' })).status).toBe(200);
    expect((await approve({ proofId: secondProof.id, reference: 'UTR11112222' }, undefined, second)).status).toBe(200);
  });
});
