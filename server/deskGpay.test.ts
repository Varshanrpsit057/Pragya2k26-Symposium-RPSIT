/**
 * The ₹100 gate pass paid by GPay at the desk: the desk registers the student first, the
 * student signs in to Student login, checks the details the desk typed, pays and uploads the
 * screenshot; staff then approve it with the transaction ID from the screenshot (or record
 * cash, if the student paid cash in the end). Only then is the pass made.
 */
import { describe, expect, it } from 'vitest';
import { TIMES, pngBytes, setup } from './testing';

const studentPays = { method: 'UPI', studentPays: true };

/** An event-day desk with one student registered to pay by GPay from Student login. */
async function deskGpay(phone = '9840012345') {
  const h = setup({ at: TIMES.eventDay });
  const desk = await h.staff('DESK');
  const registered = await h.onsite(desk.token, { phone, events: ['viz-craft'], payment: studentPays });
  const registration = registered.body.registration;
  const credentials = { registrationId: registration.registrationId as string, phone };
  /** What the student page does: an upload to S3, then the proof. */
  const upload = async (transactionId = '') => {
    const ticket = await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 });
    h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
    return h.call('POST', '/api/student/proof', { ...credentials, uploadId: ticket.body.uploadId, kind: 'GATE_PASS', transactionId });
  };
  const record = async () => (await h.call('GET', `/api/admin/registrations/${credentials.registrationId}`, undefined, { token: desk.token })).body.registration;
  const approve = (body: unknown, token = desk.token) => h.call('POST', `/api/admin/registrations/${credentials.registrationId}/approve`, body, { token });
  return { h, desk, registered, registration, credentials, upload, record, approve };
}

describe('desk GPay paid by the student from Student login', () => {
  it('waits for the student: details to check, pay, upload, then the desk approves with the transaction ID', async () => {
    const { h, desk, registered, registration, credentials, upload, record, approve } = await deskGpay();
    // Registered, but not paid yet: no pass, nothing collected.
    expect(registered.status).toBe(200);
    expect(registration).toMatchObject({
      source: 'ONSITE',
      status: 'PENDING',
      createdBy: desk.username,
      pdfStatus: 'NOT_STARTED',
      gatePass: { status: 'AWAITING_VERIFICATION', method: 'UPI', amount: 100, reference: null, verifiedBy: null },
    });

    // The student signs in: first the details the desk typed, then the payment.
    const first = (await h.call('POST', '/api/student', credentials)).body;
    expect(first).toMatchObject({
      status: 'PENDING',
      name: 'Nila R',
      details: { department: 'Computer Science and Engineering (CSE)', year: '2nd Year', phone: '9840012345', email: expect.stringContaining('@') },
      events: [expect.objectContaining({ eventId: 'viz-craft' })],
      payAtLogin: { amount: 100, screenshotSent: false },
      passAvailable: false,
    });
    expect((await h.call('POST', '/api/student/pass', credentials)).body.code).toBe('PASS_NOT_AVAILABLE');

    // Paid and uploaded: submitted for approval.
    const uploaded = await upload('UTR 4455 6677'.replace(/\s/g, ''));
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.payAtLogin).toEqual({ amount: 100, screenshotSent: true });

    // The desk sees the screenshot and must type the transaction ID to approve.
    const waiting = await record();
    expect(waiting.proofs).toEqual([expect.objectContaining({ kind: 'GATE_PASS', transactionId: 'UTR44556677' })]);
    expect((await approve({})).body.code).toBe('TRANSACTION_REQUIRED');
    expect((await approve({ payment: { method: 'UPI', reference: 'abc' } })).body.code).toBe('TRANSACTION_REQUIRED');
    expect((await record()).status).toBe('PENDING');

    const approved = await approve({ payment: { method: 'UPI', reference: 'utr44556677' } });
    expect(approved.status).toBe(200);
    expect(approved.body.registration).toMatchObject({
      status: 'APPROVED',
      reviewedBy: desk.username,
      pdfStatus: 'GENERATED',
      payment: { amount: 100, transactionId: 'UTR44556677' },
      gatePass: { status: 'VERIFIED', method: 'UPI', amount: 100, reference: 'UTR44556677', verifiedBy: desk.username },
    });

    // The student's page moves on: the pass, the events, no payment step.
    const after = (await h.call('POST', '/api/student', credentials)).body;
    expect(after).toMatchObject({ status: 'APPROVED', payAtLogin: null, passAvailable: true });
    expect((await h.call('POST', '/api/student/pass', credentials)).status).toBe(200);

    // Counted as GPay at the desk, for the desk member who approved it.
    const report = (await h.asOwner('GET', '/api/admin/reports')).body.report;
    expect(report.gatePass.deskUpi).toEqual({ count: 1, amount: 100 });
    // Approving again changes nothing.
    expect((await approve({ payment: { method: 'UPI', reference: 'OTHER123456' } })).body.registration.gatePass.reference).toBe('UTR44556677');
  });

  it('never records one transaction ID twice', async () => {
    const { h, desk, approve } = await deskGpay();
    expect((await approve({ payment: { method: 'UPI', reference: 'UTR10002000' } })).status).toBe(200);
    const second = (await h.onsite(desk.token, { phone: '9840099999', payment: studentPays })).body.registration.registrationId as string;
    const reused = await h.call('POST', `/api/admin/registrations/${second}/approve`, { payment: { method: 'UPI', reference: 'utr10002000' } }, { token: desk.token });
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ code: 'DUPLICATE_TRANSACTION', details: { registrationId: '262001' } });
    expect((await h.call('GET', `/api/admin/registrations/${second}`, undefined, { token: desk.token })).body.registration.status).toBe('PENDING');
  });

  it('records cash instead when the student pays cash in the end', async () => {
    const { desk, approve } = await deskGpay();
    const approved = await approve({ payment: { method: 'CASH' } });
    expect(approved.body.registration).toMatchObject({ status: 'APPROVED', gatePass: { status: 'VERIFIED', method: 'CASH', reference: null, verifiedBy: desk.username } });
  });

  it('lets a coordinator approve it at the venue, from the screenshot in the ID lookup', async () => {
    const { h, credentials, upload } = await deskGpay();
    const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
    const before = (await h.call('GET', `/api/admin/lookup/${credentials.registrationId}`, undefined, { token: coordinator.token })).body;
    expect(before.payment).toEqual({ amount: 100, transactionId: null, hasScreenshot: false, proofId: null });
    await upload();
    const lookup = (await h.call('GET', `/api/admin/lookup/${credentials.registrationId}`, undefined, { token: coordinator.token })).body;
    expect(lookup.payment.proofId).toMatch(/^[a-f0-9-]{12}$/);
    expect((await h.call('GET', `/api/admin/registrations/${credentials.registrationId}/proofs/${lookup.payment.proofId}`, undefined, { token: coordinator.token })).status).toBe(200);
    const approved = await h.call('POST', `/api/admin/registrations/${credentials.registrationId}/approve`, { payment: { method: 'UPI', reference: 'UTR77778888' } }, { token: coordinator.token });
    expect(approved.body.registration).toMatchObject({ status: 'APPROVED', gatePass: { verifiedBy: coordinator.username } });
  });

  it('frees the phone number when it is rejected, so the student can register again', async () => {
    const { h, desk, credentials } = await deskGpay();
    expect((await h.call('POST', `/api/admin/registrations/${credentials.registrationId}/reject`, { reason: 'Did not pay' }, { token: desk.token })).status).toBe(200);
    const again = await h.onsite(desk.token, { phone: credentials.phone, payment: { method: 'CASH', confirmedReceived: true } });
    expect(again.status).toBe(200);
    expect(again.body.registration.status).toBe('APPROVED');
  });

  it('is only for GPay: cash is still received at the desk and ticked', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const cash = await h.onsite(desk.token, { payment: { method: 'CASH', studentPays: true } });
    expect(cash.status).toBe(400);
    expect(cash.body.fieldErrors.transactionId).toMatch(/Tick the box/);
  });
});
