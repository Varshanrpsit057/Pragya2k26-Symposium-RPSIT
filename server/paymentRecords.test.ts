/**
 * Every payment with its evidence, for admins, the desk and the event leads: the screenshot
 * (who uploaded it, when), the transaction ID the student typed, the one the staff member
 * entered when approving, and who approved it.
 */
import { describe, expect, it } from 'vitest';
import { TIMES, pngBytes, setup } from './testing';

describe('payment records', () => {
  it('shows the online payment with the form screenshot and the student’s transaction ID, and who approved it', async () => {
    const h = setup({ at: TIMES.online });
    const id = (await h.submit({ transactionId: 'UTR123456789' })).body.registrationId as string;
    const waiting = (await h.asOwner('GET', `/api/admin/registrations/${id}`)).body.registration.payments;
    expect(waiting[0]).toEqual(
      {
        kind: 'GATE_PASS',
        label: 'Gate pass ₹100',
        amount: 100,
        status: 'WAITING',
        method: 'ONLINE_UPI',
        screenshot: { source: 'ONLINE_FORM', proofId: null, uploadedAt: expect.any(String) },
        uploadedBy: 'Varshan C',
        studentTransactionId: 'UTR123456789',
        approvedTransactionId: null,
        approvedBy: null,
        approvedAt: null,
        approvedAtDesk: null,
      },
    );
    // Then each event, not paid yet.
    expect(waiting.slice(1).map((item: { status: string }) => item.status)).toEqual(['UNPAID', 'UNPAID']);
    await h.asOwner('POST', `/api/admin/registrations/${id}/approve`, {});
    const [paid] = (await h.asOwner('GET', `/api/admin/registrations/${id}`)).body.registration.payments;
    expect(paid).toMatchObject({ status: 'PAID', approvedBy: expect.any(String), approvedAt: expect.any(String) });
  });

  it('shows the desk’s GPay and the event fee with the student’s screenshot, both transaction IDs and who approved them, to the desk and the event lead', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    // This desk sign-in is at desk 3.
    expect((await h.call('POST', '/api/admin/session/desk', { deskNumber: 3 }, { token: desk.token })).body.deskNumber).toBe(3);
    const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
    const id = (await h.onsite(desk.token, { phone: '9840012345', events: ['viz-craft', 'cognix'], payment: { method: 'UPI', studentPays: true } })).body.registration
      .registrationId as string;
    const credentials = { registrationId: id, phone: '9840012345' };
    const upload = async (kind: string, transactionId: string) => {
      const ticket = await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 });
      h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
      return h.call('POST', '/api/student/proof', { ...credentials, uploadId: ticket.body.uploadId, kind, transactionId });
    };
    const record = async (token = desk.token) => (await h.call('GET', `/api/admin/registrations/${id}`, undefined, { token })).body.registration;

    // Nothing yet: the gate pass and both events unpaid.
    expect((await record()).payments.map((item: { kind: string; status: string }) => [item.kind, item.status])).toEqual([
      ['GATE_PASS', 'UNPAID'],
      ['viz-craft', 'UNPAID'],
      ['cognix', 'UNPAID'],
    ]);

    // The gate pass: the student's screenshot and typed ID, then the desk's (a different one).
    await upload('GATE_PASS', 'UTR11112222');
    expect((await record()).payments[0]).toMatchObject({ status: 'WAITING', uploadedBy: 'Nila R', studentTransactionId: 'UTR11112222', screenshot: { source: 'STUDENT_LOGIN' } });
    await h.call('POST', `/api/admin/registrations/${id}/approve`, { payment: { method: 'UPI', reference: 'UTR11113333' } }, { token: desk.token });
    const gate = (await record()).payments[0];
    expect(gate).toEqual({
      kind: 'GATE_PASS',
      label: 'Gate pass ₹100',
      amount: 100,
      status: 'PAID',
      method: 'UPI',
      screenshot: { source: 'STUDENT_LOGIN', proofId: expect.stringMatching(/^[a-f0-9-]{12}$/), uploadedAt: expect.any(String) },
      uploadedBy: 'Nila R',
      studentTransactionId: 'UTR11112222',
      approvedTransactionId: 'UTR11113333',
      approvedBy: desk.username,
      approvedAt: expect.any(String),
      approvedAtDesk: 3,
    });
    expect((await record()).deskNumber).toBe(3);

    // The event fee: waiting with the screenshot, then approved by the event lead.
    await upload('viz-craft', 'UTR55556666');
    const roster = async (token = coordinator.token) => (await h.call('GET', '/api/admin/events/viz-craft', undefined, { token })).body.participants[0];
    const before = await roster();
    expect(before.feePayment).toMatchObject({ kind: 'viz-craft', label: 'VIZ CRAFT ₹50', status: 'WAITING', studentTransactionId: 'UTR55556666', uploadedBy: 'Nila R' });
    await h.call('POST', `/api/admin/events/viz-craft/registrations/${id}/fee-screenshot`, { proofId: before.feeProof.id, reference: 'UTR55556666' }, { token: coordinator.token });
    const after = (await roster()).feePayment;
    expect(after).toMatchObject({ status: 'PAID', method: 'UPI', studentTransactionId: 'UTR55556666', approvedTransactionId: 'UTR55556666', approvedBy: coordinator.username });
    expect(after.screenshot.proofId).toBe(before.feeProof.id);
    // The desk sees the same in the record; the event lead can open the screenshot after approval too.
    expect((await record()).payments[1]).toEqual(after);
    expect((await h.call('GET', `/api/admin/registrations/${id}/proofs/${after.screenshot.proofId}`, undefined, { token: coordinator.token })).status).toBe(200);

    // A cash fee: no screenshot, received by the coordinator.
    const cognix = await h.staff('COORDINATOR', ['cognix']);
    await h.call('POST', `/api/admin/events/cognix/registrations/${id}/fee`, { method: 'CASH', confirmedReceived: true }, { token: cognix.token });
    expect((await record()).payments[2]).toMatchObject({ status: 'PAID', method: 'CASH', screenshot: null, approvedTransactionId: null, approvedBy: cognix.username });

    // The certificate team sees no payment details.
    const certificate = await h.staff('CERTIFICATE');
    expect(await roster(certificate.token)).not.toHaveProperty('feePayment');
  });
});
