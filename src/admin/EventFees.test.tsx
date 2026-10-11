import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventParticipant, EventResultView } from '../lib/admin';
import { ROLE_PERMISSIONS, type SessionInfo, type StaffRole } from '../lib/staff';
import { AdminApp } from './AdminApp';

const session = (role: StaffRole, eventIds: string[]): SessionInfo => ({
  username: role === 'COORDINATOR' ? 'vizcraft-lead' : 'cert-team',
  displayName: 'Test Staff',
  role,
  kind: 'staff',
  eventIds,
  permissions: [...ROLE_PERMISSIONS[role]],
  expiresAt: '2026-10-17T12:00:00.000Z',
  serverTime: '2026-10-17T04:00:00.000Z',
  phase: 'onsite',
  eventDayStarted: true,
  schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber: null,
});

const draft: EventResultView = {
  eventId: 'viz-craft',
  status: 'DRAFT',
  revision: 2,
  winners: { first: ['262003'], second: ['262001'], third: [] },
  savedBy: 'vizcraft-lead',
  savedAt: '2026-10-17T07:00:00.000Z',
  submission: null,
  previousSubmissions: [],
  reopened: null,
};

const unpaid = { status: 'UNPAID' as const, method: null, amount: 50, reference: null, verifiedBy: null, verifiedAt: null, voided: null };
const paid = { ...unpaid, status: 'PAID' as const, method: 'UPI' as const, reference: 'UTR55556666', verifiedBy: 'vizcraft-lead', verifiedAt: '2026-10-17T05:00:00.000Z' };

const person = (registrationId: string, name: string, extra: Partial<EventParticipant> = {}): EventParticipant => ({
  registrationId,
  source: 'ONSITE',
  status: 'APPROVED',
  name,
  college: 'Sona College of Technology, Salem',
  department: 'Computer Science and Engineering (CSE)',
  year: '2nd Year',
  gatePassVerified: true,
  addedBy: 'desk1',
  addedAt: '2026-10-17T04:00:00.000Z',
  team: null,
  gateTeam: null,
  fee: unpaid,
  attendance: null,
  feeProof: null,
  ...extra,
});

/** Answers like the API, and records what is sent. */
function api(role: StaffRole, participants: EventParticipant[], answers: Record<string, unknown> = {}) {
  sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
  const sent: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.body) sent.push({ url, body: JSON.parse(String(init.body)) });
    const answer = Object.entries(answers).find(([suffix]) => url.endsWith(suffix))?.[1];
    const body =
      answer ??
      (url.endsWith('/api/admin/session')
        ? session(role, role === 'COORDINATOR' ? ['viz-craft'] : [])
        : url.endsWith('/api/admin/events')
          ? { events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', enrolled: participants.length, feePaid: 0, present: 0, result: draft }] }
          : url.endsWith('/api/admin/events/viz-craft')
            ? { event: { id: 'viz-craft', name: 'VIZ CRAFT' }, result: draft, participants, canOperate: role === 'COORDINATOR' }
            : {});
    return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
  });
  return sent;
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('event fee paid by GPay from Student login', () => {
  it('lets the event’s coordinator check the screenshot big, type the transaction ID, approve and mark present in one press', async () => {
    const waiting = person('262001', 'Asha K', { feeProof: { id: 'abc123def456', transactionId: 'UTR55556666', uploadedAt: '2026-10-17T04:30:00.000Z' } });
    const sent = api('COORDINATOR', [person('262002', 'Bala M'), waiting], {
      '/proofs/abc123def456': { url: 'https://bucket.s3.test/proofs/262001/abc123def456.png' },
      '/fee-screenshot': { participant: { ...waiting, fee: paid, feeProof: null, attendance: { present: true, markedBy: 'vizcraft-lead', markedAt: '2026-10-17T05:00:00.000Z' } } },
    });
    render(<AdminApp />);

    // Screenshots to check come first in the list.
    const heading = await screen.findByRole('heading', { name: /Participants \(2\)/ });
    expect(heading).toHaveTextContent('1 GPay screenshot to check');
    const rows = within(heading.closest('section')!).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('262001');
    expect(rows[1]).toHaveTextContent('GPay screenshot to check');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Check GPay screenshot' }));

    const check = screen.getByRole('dialog', { name: 'VIZ CRAFT fee · 262001 · Asha K' });
    expect(await within(check).findByRole('img', { name: 'VIZ CRAFT fee screenshot for 262001' })).toHaveAttribute('src', 'https://bucket.s3.test/proofs/262001/abc123def456.png');
    expect(within(check).getByLabelText(/Transaction ID from the screenshot/)).toHaveValue('UTR55556666');
    const approve = within(check).getByRole('button', { name: 'Approve ₹50 and mark present' });
    expect(approve).toBeDisabled();
    fireEvent.click(within(check).getByRole('checkbox', { name: /I have checked the screenshot: ₹50 was paid to Mrs Jayanthi Parthasarathy/ }));
    fireEvent.click(approve);

    expect(await screen.findByText('Present')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /VIZ CRAFT fee/ })).toBeNull();
    expect(sent.find((call) => call.url.endsWith('/fee-screenshot'))).toEqual({
      url: '/api/admin/events/viz-craft/registrations/262001/fee-screenshot',
      body: { proofId: 'abc123def456', reference: 'UTR55556666', markPresent: true },
    });
  });
});

describe('results for the certificate writers', () => {
  it('shows everyone who took part, present first, then the three prizes with each student’s details', async () => {
    const present = { present: true, markedBy: 'vizcraft-lead', markedAt: '2026-10-17T05:00:00.000Z' };
    api('CERTIFICATE', [
      person('262001', 'Asha K', { fee: paid, attendance: present, email: 'asha@example.com', year: '3rd Year' }),
      person('262002', 'Bala M', { email: 'bala@example.com' }),
      person('262003', 'Charu S', { fee: paid, attendance: present, email: 'charu@example.com', department: 'Information Technology (IT)' }),
      // Not approved yet: not on any list.
      person('262004', 'Dev R', { status: 'PENDING', gatePassVerified: false }),
    ]);
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'VIZ CRAFT' }));
    const results = await screen.findByRole('region', { name: 'VIZ CRAFT results' });
    expect(within(results).getByText(/Not submitted yet by the coordinator/)).toBeInTheDocument();

    const tables = within(results).getAllByRole('table');
    const headings = within(results).getAllByRole('heading', { level: 4 }).map((item) => item.textContent);
    expect(headings).toEqual(['Present: participation certificates (2)', 'Registered but not marked present (1): no certificate', 'Prizes']);
    // Present first, with what the certificates need.
    const presentRows = within(tables[0]).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(presentRows).toEqual([
      '1262001Asha KSona College of Technology, SalemComputer Science and Engineering (CSE)3rd Yearasha@example.com',
      '2262003Charu SSona College of Technology, SalemInformation Technology (IT)2nd Yearcharu@example.com',
    ]);
    expect(within(tables[1]).getAllByRole('row')).toHaveLength(2);
    expect(tables[1]).toHaveTextContent('Bala M');
    expect(results).not.toHaveTextContent('Dev R');

    // Then the three prizes, with details.
    const prizeRows = within(tables[2]).getAllByRole('row').slice(1).map((row) => row.textContent);
    expect(prizeRows).toEqual([
      'First place262003Charu SSona College of Technology, SalemInformation Technology (IT)2nd Yearcharu@example.com',
      'Second place262001Asha KSona College of Technology, SalemComputer Science and Engineering (CSE)3rd Yearasha@example.com',
      'Third placeNot chosen yet',
    ]);
  });
});

describe('payment details for the event lead', () => {
  it('shows the student’s screenshot and transaction ID next to the one entered, after approval too', async () => {
    const approved = person('262001', 'Asha K', {
      fee: paid,
      feePayment: {
        kind: 'viz-craft',
        label: 'VIZ CRAFT ₹50',
        amount: 50,
        status: 'PAID',
        method: 'UPI',
        screenshot: { source: 'STUDENT_LOGIN', proofId: 'abc123def456', uploadedAt: '2026-10-17T04:30:00.000Z' },
        uploadedBy: 'Asha K',
        studentTransactionId: 'UTR55556666',
        approvedTransactionId: 'UTR55556667',
        approvedBy: 'vizcraft-lead',
        approvedAt: '2026-10-17T05:00:00.000Z',
        approvedAtDesk: null,
      },
    });
    api('COORDINATOR', [approved], { '/proofs/abc123def456': { url: 'https://bucket.s3.test/proofs/262001/abc123def456.png' } });
    render(<AdminApp />);
    const row = (await screen.findByText('262001')).closest('tr')!;
    expect(row).toHaveTextContent('Txn UTR55556667');
    fireEvent.click(within(row).getByRole('button', { name: 'Payment details' }));

    const details = screen.getByRole('dialog', { name: 'VIZ CRAFT fee · 262001 · Asha K' });
    expect(details).toHaveTextContent('Uploaded by the student, Asha K, from Student login');
    expect(details).toHaveTextContent('Transaction ID typed by the studentUTR55556666');
    expect(details).toHaveTextContent("UTR55556667by vizcraft-leadDiffers from the student's");
    expect(details).toHaveTextContent('Approved byvizcraft-lead');
    // The screenshot, big, at once.
    expect(await within(details).findByRole('img', { name: 'VIZ CRAFT ₹50 screenshot for 262001' })).toHaveAttribute('src', 'https://bucket.s3.test/proofs/262001/abc123def456.png');
  });
});
