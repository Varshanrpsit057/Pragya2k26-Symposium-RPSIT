import { describe, expect, it } from 'vitest';
import type { AdminRegistration, EventParticipant, EventRoster } from '../lib/admin';
import type { Cell } from '../lib/xlsx';
import { allDataSheets, eventSheets, eventWorkbook } from './workbooks';

const now = Date.parse('2026-10-17T10:00:00.000Z');
const text = (row: Cell[]) => row.map((cell) => (cell && typeof cell === 'object' ? cell.value : cell));

const participant = (registrationId: string, name: string, extra: Partial<EventParticipant> = {}): EventParticipant => ({
  registrationId,
  source: 'ONSITE',
  status: 'APPROVED',
  name,
  college: 'Sona College of Technology, Salem',
  department: 'CSE',
  year: '2nd Year',
  phone: '9840011111',
  gatePassVerified: true,
  addedBy: 'desk1',
  addedAt: '2026-10-17T04:00:00.000Z',
  team: null,
  gateTeam: null,
  fee: { status: 'UNPAID', method: null, amount: 50, reference: null, verifiedBy: null, verifiedAt: null, voided: null },
  attendance: null,
  feeProof: null,
  ...extra,
});

describe('the event coordinator’s Excel', () => {
  const roster: EventRoster = {
    event: { id: 'viz-craft', name: 'VIZ CRAFT' },
    result: { eventId: 'viz-craft', status: 'DRAFT', revision: 1, winners: { first: ['262002'], second: [], third: [] }, savedBy: null, savedAt: null, submission: null, previousSubmissions: [], reopened: null },
    canOperate: true,
    participants: [
      participant('262001', 'Asha K'),
      participant('262002', 'Bala M', {
        fee: { status: 'PAID', method: 'UPI', amount: 50, reference: 'UTR55556667', verifiedBy: 'vizcraft-lead', verifiedAt: '2026-10-17T05:00:00.000Z', voided: null },
        attendance: { present: true, markedBy: 'vizcraft-lead', markedAt: '2026-10-17T05:00:00.000Z' },
        feePayment: {
          kind: 'viz-craft',
          label: 'VIZ CRAFT ₹50',
          amount: 50,
          status: 'PAID',
          method: 'UPI',
          screenshot: { source: 'STUDENT_LOGIN', proofId: 'p1', uploadedAt: '2026-10-17T04:30:00.000Z' },
          uploadedBy: 'Bala M',
          studentTransactionId: 'UTR55556666',
          approvedTransactionId: 'UTR55556667',
          approvedBy: 'vizcraft-lead',
          approvedAt: '2026-10-17T05:00:00.000Z',
          approvedAtDesk: null,
        },
      }),
    ],
  };

  it('has a summary, every participant (present first) with fee and attendance details, and the winners', () => {
    const [summary, people, winners] = eventSheets(roster, 'Viz Lead', now);
    expect(text(summary.rows[1])[0]).toBe('Generated 17 October 2026 · 3:30 PM IST by Viz Lead. Results not submitted yet: NOT FINAL.');
    expect(summary.rows.map(text).find((row) => row[0] === 'Fees paid by GPay / UPI')).toEqual(['Fees paid by GPay / UPI', 1, 50]);
    const rows = people.rows.slice(3).map(text);
    expect(rows.map((row) => row[0])).toEqual(['262002', '262001']);
    expect(rows[0]).toEqual([
      '262002', 'Bala M', 'Sona College of Technology, Salem', 'CSE', '2nd Year', '9840011111', '', 'Verified', 'Paid', 'GPay / UPI',
      'UTR55556666', 'UTR55556667', 'vizcraft-lead', '17 October 2026 · 10:30 AM IST', 'Present', 'vizcraft-lead', '17 October 2026 · 10:30 AM IST',
    ]);
    expect(text(winners.rows[3])).toEqual(['First place', '262002', 'Bala M', 'Sona College of Technology, Salem', 'CSE', '2nd Year', '']);
    expect(eventWorkbook(roster, 'Viz Lead', now).name).toBe('PRAGYA-2026-VIZ-CRAFT-17-Oct-2026-0330PM.xlsx');
  });
});

describe('the admin’s all-data Excel', () => {
  const registration = {
    registrationId: '262001',
    status: 'APPROVED',
    source: 'ONSITE',
    deskNumber: 2,
    createdBy: 'desk2',
    submittedAt: '2026-10-17T04:00:00.000Z',
    participant: { name: 'Asha K', college: 'Sona College', department: 'CSE', year: '2nd Year', phone: '9840011111', email: 'asha@example.com' },
    teamName: null,
    technicalEvents: ['VIZ CRAFT'],
    rejectionReason: null,
    cancelled: null,
    events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', team: null, addedBy: null, addedAt: null, fee: { status: 'PAID', method: 'CASH', amount: 50, reference: null, verifiedBy: 'vizcraft-lead', verifiedAt: '2026-10-17T05:00:00.000Z', voided: null }, attendance: { present: true, markedBy: 'vizcraft-lead', markedAt: '2026-10-17T05:00:00.000Z' } }],
    payments: [
      { kind: 'GATE_PASS', label: 'Gate pass ₹100', amount: 100, status: 'PAID', method: 'UPI', screenshot: { source: 'STUDENT_LOGIN', proofId: 'g1', uploadedAt: '2026-10-17T04:05:00.000Z' }, uploadedBy: 'Asha K', studentTransactionId: 'UTR1', approvedTransactionId: 'UTR2', approvedBy: 'desk2', approvedAt: '2026-10-17T04:06:00.000Z', approvedAtDesk: 2 },
    ],
  } as unknown as AdminRegistration;

  it('has every registration with its desk, every payment with both transaction IDs, attendance, and the deleted records', () => {
    const [all, payments, attendance, deleted] = allDataSheets({ registrations: [registration], deleted: [{ at: '2026-10-17T06:00:00.000Z', registrationId: '262009', name: 'Test', by: 'admin1', reason: 'Test entry' }], generatedBy: 'Admin', now });
    expect(all.name).toBe('All registrations');
    const row = text(all.rows[3]);
    expect(row.slice(0, 6)).toEqual(['262001', 'Approved', 'At the desk', 'Desk 2', 'desk2', '17 October 2026 · 9:30 AM IST']);
    expect(row).toContain('UTR1');
    expect(row).toContain('desk2 (desk 2)');
    expect(text(payments.rows[3])).toEqual(['262001', 'Asha K', 'Gate pass ₹100', 100, 'Paid', 'GPay / UPI', 'Student login, 17 October 2026 · 9:35 AM IST', 'UTR1', 'UTR2', 'NO: differs', 'desk2', 'Desk 2', '17 October 2026 · 9:36 AM IST']);
    expect(text(attendance.rows[3])).toEqual(['VIZ CRAFT', '262001', 'Asha K', 'Sona College', '', 'Paid (cash)', 'Present', 'vizcraft-lead', '17 October 2026 · 10:30 AM IST']);
    expect(text(deleted.rows[3])).toEqual(['17 October 2026 · 11:30 AM IST', '262009', 'Test', 'admin1', 'Test entry']);
  });
});
