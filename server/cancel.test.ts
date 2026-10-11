/**
 * Cancelling an approved registration (admins only): a duplicate, wrong details at the desk,
 * or a participant who withdrew. The pass stops working, the participant leaves every event
 * list and the totals, and their email and phone may register again. Deleting the row from
 * the Google Sheet does none of this: DynamoDB is the record, the sheet only a copy.
 */
import { describe, expect, it } from 'vitest';
import { ADMIN, TIMES, setup } from './testing';

const cash = { method: 'CASH', confirmedReceived: true };

describe('cancelling an on-site registration', () => {
  it('takes the participant off the events and the totals, stops the pass, and frees their email and phone', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    const walkIn = { email: 'twice@example.com', phone: '9840099999' };
    const id = (await h.onsite(desk.token, walkIn)).body.registration.registrationId as string;
    // Entered in an event, not paid yet.
    expect((await h.call('POST', `/api/admin/events/cognix/registrations/${id}/enroll`, {}, { token: coordinator.token })).status).toBe(200);

    // Desk staff and coordinators cannot cancel; an admin must give a reason.
    for (const token of [desk.token, coordinator.token]) {
      expect((await h.call('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Registered twice' }, { token })).status).toBe(403);
    }
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, {})).body.code).toBe('INVALID');
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: ' x ' })).status).toBe(400);

    h.advance(60_000);
    const cancelled = await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Registered twice\nby mistake' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.registration).toMatchObject({
      status: 'CANCELLED',
      cancelled: { at: '2026-10-17T04:01:00.000Z', by: ADMIN.username, reason: 'Registered twice by mistake' },
      gatePass: { status: 'CANCELLED', method: 'CASH' },
    });

    // The coordinator no longer sees them, and cannot enter them again.
    const roster = await h.call('GET', '/api/admin/events/cognix', undefined, { token: coordinator.token });
    expect(roster.body.participants).toEqual([]);
    const found = await h.call('GET', `/api/admin/lookup/${id}`, undefined, { token: coordinator.token });
    expect(found.body).toMatchObject({ status: 'CANCELLED', gatePassVerified: false });
    const again = await h.call('POST', `/api/admin/events/cognix/registrations/${id}/enroll`, { payment: cash }, { token: coordinator.token });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CANCELLED');

    // The pass is no longer handed out, and the ₹100 is not counted as collected.
    expect((await h.asOwner('GET', `/api/admin/registrations/${id}/pass`)).body.code).toBe('CANCELLED');
    const { report } = (await h.asOwner('GET', '/api/admin/reports')).body;
    expect(report.registrations).toMatchObject({ total: 1, approved: 0, cancelled: 1 });
    expect(report.gatePass.deskCash).toEqual({ count: 0, amount: 0 });
    expect(report.collectedBy).toEqual([]);

    // The sheet shows the cancellation (the row stays: it is a copy of DynamoDB).
    const row = h.sheets.rows.find((candidate) => candidate.id === id);
    expect(row).toMatchObject({ status: 'CANCELLED', gatePassPayment: 'Cash at desk · cancelled' });
    expect(row?.notes).toContain('Cancelled by pragya-admin 2026-10-17 09:31:00: Registered twice by mistake');

    // The same student can be registered again with the same email and phone.
    const fresh = await h.onsite(desk.token, walkIn);
    expect(fresh.status).toBe(200);
    expect(fresh.body.registration.registrationId).not.toBe(id);

    // Cancelling again changes nothing; a cancelled registration cannot be approved or rejected.
    const twice = await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Another reason' });
    expect(twice.body.registration.cancelled).toMatchObject({ reason: 'Registered twice by mistake' });
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/approve`)).body.code).toBe('ALREADY_CANCELLED');
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/reject`, { reason: 'x' })).body.code).toBe('ALREADY_CANCELLED');
  });

  it('is refused while an event fee is recorded (until it is voided) or the participant is a winner', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const coordinator = await h.staff('COORDINATOR', ['cognix']);
    const venue = (path: string, body: unknown) => h.call('POST', `/api/admin/events/cognix${path}`, body, { token: coordinator.token });
    const paid = (await h.onsite(desk.token)).body.registration.registrationId as string;
    const winner = (await h.onsite(desk.token)).body.registration.registrationId as string;
    const cancel = (id: string) => h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Withdrew' });

    expect((await venue(`/registrations/${paid}/enroll`, { payment: cash })).status).toBe(200);
    const refused = await cancel(paid);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'FEES_RECORDED', error: expect.stringContaining('COGNIX') });
    expect((await h.store.getRegistration(paid))?.status).toBe('APPROVED');
    // Voided (and refunded) first, the registration can be cancelled.
    expect((await h.asOwner('POST', `/api/admin/events/cognix/registrations/${paid}/void-fee`, { reason: 'Refunded' })).status).toBe(200);
    expect((await cancel(paid)).body.registration.status).toBe('CANCELLED');

    expect((await venue(`/registrations/${winner}/enroll`, { payment: cash })).status).toBe(200);
    expect((await venue(`/registrations/${winner}/attendance`, { present: true })).status).toBe(200);
    expect((await venue('/winners', { first: [winner] })).status).toBe(200);
    expect((await cancel(winner)).body).toMatchObject({ code: 'IS_WINNER', error: expect.stringContaining('COGNIX') });
  });

  it('waits while the pass or email is being sent', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK');
    const id = (await h.onsite(desk.token)).body.registration.registrationId as string;
    const now = Date.parse(TIMES.eventDay);
    const lease = await h.store.acquireLease(id, now + 60_000, now);
    expect(lease).not.toBeNull();
    const busy = await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Duplicate' });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('BUSY');
    await h.store.releaseLease(id, lease!);
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Duplicate' })).body.registration.status).toBe('CANCELLED');
  });
});

describe('cancelling an online registration', () => {
  it('tells the student why, withdraws their pass and lets the email register again (the transaction ID stays used)', async () => {
    const h = setup({ at: TIMES.online });
    const submitted = await h.submit({ email: 'student@example.com', transactionId: 'UTR123456789' });
    const id = submitted.body.registrationId as string;

    // Not approved yet: rejecting is the way.
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Withdrew' })).body.code).toBe('NOT_APPROVED');
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/approve`)).status).toBe(200);
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Withdrew from the symposium' })).status).toBe(200);

    const status = await h.call('POST', '/api/status', { registrationId: id, key: submitted.key });
    expect(status.body).toMatchObject({ status: 'CANCELLED', passAvailable: false, reason: 'Withdrew from the symposium' });
    const pass = await h.call('POST', '/api/pass', { registrationId: id, key: submitted.key });
    expect(pass.status).toBe(403);
    expect(pass.body.error).toMatch(/cancelled/);

    expect((await h.submit({ email: 'student@example.com', transactionId: 'UTR123456789' })).body.code).toBe('DUPLICATE_TRANSACTION');
    expect((await h.submit({ email: 'student@example.com', transactionId: 'UTR987654321' })).status).toBe(200);

    // The admin list shows it under its own status.
    const list = await h.asOwner('GET', '/api/admin/registrations');
    expect(list.body.registrations.find((item: { registrationId: string }) => item.registrationId === id)).toMatchObject({ status: 'CANCELLED' });
  });

  it('is not possible for a rejected registration', async () => {
    const h = setup({ at: TIMES.online });
    const id = (await h.submit()).body.registrationId as string;
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/reject`, { reason: 'Wrong amount' })).status).toBe(200);
    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/cancel`, { reason: 'Withdrew' })).body.code).toBe('ALREADY_REJECTED');
  });
});
