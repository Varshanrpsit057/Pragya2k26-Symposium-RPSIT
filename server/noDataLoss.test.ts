/**
 * No data is lost: besides the database, every student has a complete record file (JSON) in
 * Google Drive and a full row in the Google Sheet, both kept up to date; their Student-login
 * screenshots are copied to Drive; a Google outage only delays the copies; and a deleted
 * record keeps its whole data, its files and its Drive file.
 */
import { describe, expect, it } from 'vitest';
import { TIMES, pngBytes, setup } from './testing';

/** An event-day desk registration (cash) for VIZ CRAFT, with its coordinator. */
async function walkIn() {
  const h = setup({ at: TIMES.eventDay });
  const desk = await h.staff('DESK');
  const coordinator = await h.staff('COORDINATOR', ['viz-craft']);
  const id = (await h.onsite(desk.token, { phone: '9840012345', events: ['viz-craft'] })).body.registration.registrationId as string;
  const credentials = { registrationId: id, phone: '9840012345' };
  const upload = async (kind: string, transactionId: string) => {
    const ticket = await h.call('POST', '/api/student/upload', { ...credentials, contentType: 'image/png', size: 2048 });
    h.files.objects.set(ticket.body.fields.key, { bytes: pngBytes(), type: 'image/png' });
    return h.call('POST', '/api/student/proof', { ...credentials, uploadId: ticket.body.uploadId, kind, transactionId });
  };
  const recordFile = () => h.drive.files.find((file) => file.properties?.kind === 'record' && file.properties.registrationId === id);
  const row = () => h.sheets.rows.find((item) => item.id === id)!;
  return { h, desk, coordinator, id, upload, recordFile, row };
}

describe('the student’s record in Google Drive and the Google Sheet', () => {
  it('writes one JSON file per student with their details, payments and events, and links it from the sheet', async () => {
    const { h, desk, id, recordFile, row } = await walkIn();
    await h.service.runScheduled();

    const file = recordFile()!;
    expect(file.name).toBe(`${id} Nila R.json`);
    expect(file.folderId).toBe('passes-folder');
    const record = h.drive.json(file.id);
    expect(record).toMatchObject({
      format: 'pragya-2026-student-record',
      registrationId: id,
      status: 'APPROVED',
      source: 'ONSITE',
      registeredBy: desk.username,
      student: { name: 'Nila R', college: 'Sona College of Technology, Salem', department: 'Computer Science and Engineering (CSE)', year: '2nd Year', phone: '9840012345' },
      payments: [
        { kind: 'GATE_PASS', status: 'PAID', method: 'CASH', approvedBy: desk.username },
        { kind: 'viz-craft', label: 'VIZ CRAFT ₹50', status: 'UNPAID' },
      ],
      events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', feePaid: false, attended: false }],
      eventsAttended: [],
      deleted: null,
    });
    expect(row().recordLink).toBe(`https://drive.google.com/file/d/${file.id}/view`);
    // Nothing more to do on the next run.
    expect((await h.service.runScheduled()).recorded).toBe(0);
  });

  it('copies Student-login screenshots to Drive and keeps the file up to date with fees and attendance', async () => {
    const { h, coordinator, id, upload, recordFile, row } = await walkIn();
    await h.service.runScheduled();
    const fileId = recordFile()!.id;

    await upload('viz-craft', 'UTR55556666');
    const proof = (await h.call('GET', '/api/admin/events/viz-craft', undefined, { token: coordinator.token })).body.participants[0].feeProof;
    await h.call('POST', `/api/admin/events/viz-craft/registrations/${id}/fee-screenshot`, { proofId: proof.id, reference: 'UTR55556667', markPresent: true }, { token: coordinator.token });
    await h.service.runScheduled();

    // The screenshot in Drive, next to the online payment screenshots.
    const copy = h.drive.files.find((file) => file.properties?.kind === 'proof' && file.properties.proofId === proof.id)!;
    expect(copy).toMatchObject({ name: `${id}_viz-craft_${proof.id}.png`, folderId: 'payments-folder' });
    // The same record file, updated (Drive keeps the earlier version).
    expect(recordFile()!.id).toBe(fileId);
    expect(recordFile()!.revisions).toBeGreaterThan(1);
    const record = h.drive.json(fileId);
    expect(record.eventsAttended).toEqual(['VIZ CRAFT']);
    expect(record.events[0]).toMatchObject({ feePaid: true, attended: true, attendance: { present: true, markedBy: coordinator.username } });
    expect(record.payments[1]).toMatchObject({
      status: 'PAID',
      studentTransactionId: 'UTR55556666',
      approvedTransactionId: 'UTR55556667',
      approvedBy: coordinator.username,
      screenshotDriveLink: `https://drive.google.com/file/d/${copy.id}/view`,
    });
    // The sheet has the evidence too.
    expect(row()).toMatchObject({
      eventFeeDetails: expect.stringMatching(/^VIZ CRAFT: UPI txn UTR55556667 \(student typed UTR55556666\) by vizcraft-lead|^VIZ CRAFT: UPI txn UTR55556667 \(student typed UTR55556666\) by coordinator/),
      attendanceDetails: expect.stringMatching(/^VIZ CRAFT: present \(/),
      screenshotLinks: `VIZ CRAFT ₹50: https://drive.google.com/file/d/${copy.id}/view`,
      gatePassApprovedBy: expect.stringMatching(/^desk\d+ /),
    });
  });

  it('keeps every change while Google Drive is down, and copies it once Drive is back', async () => {
    const { h, id, recordFile } = await walkIn();
    h.drive.failing = true;
    await h.service.runScheduled();
    expect(recordFile()).toBeUndefined();
    // The registration itself is safe, and the problem shows in System status.
    const status = (await h.asOwner('GET', '/api/admin/system')).body;
    expect(status.problems).toEqual([expect.objectContaining({ registrationId: id, problems: [expect.stringContaining('Google Drive record copy failing')] })]);
    expect((await h.asOwner('GET', `/api/admin/registrations/${id}`)).body.registration.status).toBe('APPROVED');

    h.drive.failing = false;
    await h.service.runScheduled();
    expect(h.drive.json(recordFile()!.id).registrationId).toBe(id);
    expect((await h.asOwner('GET', '/api/admin/system')).body.problems).toEqual([]);
  });

  it('keeps a deleted record whole: the full data in the log, its files, and its Drive file and sheet row marked deleted', async () => {
    const { h, id, upload, recordFile, row } = await walkIn();
    await upload('GATE_PASS', 'UTR12121212');
    await h.service.runScheduled();
    const filesBefore = [...h.files.objects.keys()].filter((key) => key.includes(id));
    expect(filesBefore.length).toBeGreaterThanOrEqual(1);

    expect((await h.asOwner('POST', `/api/admin/registrations/${id}/delete`, { reason: 'Test entry' })).status).toBe(200);
    // The whole record, as it was, in the log.
    const entry = h.store.audit.find((item) => item.registrationId === id)!;
    expect(JSON.parse(entry.snapshot!)).toMatchObject({ registrationId: id, record: { participant: { name: 'Nila R', phone: '9840012345' } }, proofs: [expect.objectContaining({ transactionId: 'UTR12121212' })] });
    // Its files stay.
    for (const key of filesBefore) expect(h.files.objects.has(key), key).toBe(true);
    // The Drive file and the sheet row stay, marked deleted.
    expect(h.drive.json(recordFile()!.id)).toMatchObject({ registrationId: id, status: 'DELETED', deleted: { by: expect.any(String), reason: 'Test entry' }, student: { name: 'Nila R' } });
    expect(row()).toMatchObject({ status: 'DELETED', name: 'Nila R' });
    // The dashboard lists the deletion, without the stored data.
    const deleted = (await h.asOwner('GET', '/api/admin/system')).body.deleted;
    expect(deleted).toEqual([expect.objectContaining({ registrationId: id, reason: 'Test entry' })]);
    expect(deleted[0]).not.toHaveProperty('snapshot');
  });
});
