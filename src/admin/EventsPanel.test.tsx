import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventParticipant, EventResultView } from '../lib/admin';
import { ROLE_PERMISSIONS, type SessionInfo } from '../lib/staff';
import { AdminApp } from './AdminApp';

const coordinator: SessionInfo = {
  username: 'vizcraft-lead',
  displayName: 'Viz Craft Lead',
  role: 'COORDINATOR',
  kind: 'staff',
  eventIds: ['viz-craft'],
  permissions: [...ROLE_PERMISSIONS.COORDINATOR],
  expiresAt: '2026-10-17T12:00:00.000Z',
  serverTime: '2026-10-17T04:00:00.000Z',
  phase: 'onsite',
  eventDayStarted: true,
  schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber: null,
};

const result: EventResultView = {
  eventId: 'viz-craft',
  status: 'DRAFT',
  revision: 0,
  winners: { first: [], second: [], third: [] },
  savedBy: null,
  savedAt: null,
  submission: null,
  previousSubmissions: [],
  reopened: null,
};

const unpaid = { status: 'UNPAID' as const, method: null, amount: 50, reference: null, verifiedBy: null, verifiedAt: null, voided: null };

const entered: EventParticipant = {
  registrationId: '262001',
  source: 'ONSITE',
  status: 'APPROVED',
  name: 'Asha K',
  college: 'Sona College of Technology, Salem',
  department: 'CSE',
  year: '2nd Year',
  phone: '9840000001',
  gatePassVerified: true,
  addedBy: 'vizcraft-lead',
  addedAt: '2026-10-17T04:00:00.000Z',
  team: 'Data Wizards',
  gateTeam: 'Data Wizards',
  fee: { ...unpaid, status: 'PAID', method: 'CASH', verifiedBy: 'vizcraft-lead', verifiedAt: '2026-10-17T04:00:00.000Z' },
  attendance: null,
  feeProof: null,
};

/** Answers like the API for one coordinator of Viz Craft, and records what is sent. */
function venueApi() {
  sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
  const sent: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.body) sent.push({ url, body: JSON.parse(String(init.body)) });
    const body = url.endsWith('/api/admin/session')
      ? coordinator
      : url.endsWith('/api/admin/events')
        ? { events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', enrolled: 0, feePaid: 0, present: 0, result }] }
        : url.endsWith('/api/admin/events/viz-craft')
          ? { event: { id: 'viz-craft', name: 'VIZ CRAFT' }, result, participants: sent.length ? [entered] : [], canOperate: true }
          : url.endsWith('/api/admin/lookup/262001')
            ? {
                registrationId: '262001',
                source: 'ONSITE',
                status: 'APPROVED',
                name: 'Asha K',
                college: 'Sona College of Technology, Salem',
                department: 'CSE',
                year: '2nd Year',
                gatePassVerified: true,
                teamName: 'Data Wizards',
                events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', enrolled: false, team: null, fee: unpaid, attendance: null }],
              }
            : url.includes('/enroll')
              ? { participant: entered }
              : {};
    return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
  });
  return sent;
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('coordinator at the venue', () => {
  it('finds the participant by gate-pass ID, offers individual or team (gate team filled in), then takes the ₹50 in the same step', async () => {
    const sent = venueApi();
    render(<AdminApp />);
    fireEvent.change(await screen.findByLabelText('Find by Registration ID'), { target: { value: '262001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    await waitFor(() => expect(document.querySelector('.adm-lookup__card')).not.toBeNull());
    const card = document.querySelector('.adm-lookup__card') as HTMLElement;
    expect(card).toHaveTextContent('262001 · Asha K · Sona College of Technology, Salem');
    expect(within(card).getByText('Gate team · Data Wizards')).toBeInTheDocument();
    expect(within(card).getByRole('radio', { name: 'Team' })).toBeChecked();
    expect(within(card).getByLabelText('Team name (up to 2 members)')).toHaveValue('Data Wizards');
    expect(within(card).getByText(/Each team member pays ₹50 separately/)).toBeInTheDocument();

    const pay = within(card).getByRole('button', { name: 'Add to VIZ CRAFT and record ₹50' });
    expect(pay).toBeDisabled();
    fireEvent.click(within(card).getByRole('radio', { name: 'Cash' }));
    expect(pay).toBeDisabled();
    fireEvent.click(within(card).getByRole('checkbox', { name: /I have received ₹50 in cash/ }));
    fireEvent.click(pay);

    await waitFor(() => expect(sent.some((request) => request.url.includes('/enroll'))).toBe(true));
    expect(sent.find((request) => request.url.includes('/enroll'))).toEqual({
      url: '/api/admin/events/viz-craft/registrations/262001/enroll',
      body: { team: 'Data Wizards', payment: { method: 'CASH', confirmedReceived: true } },
    });
    // The participant now shows in the list with their team and the paid fee.
    const row = (await screen.findByText('262001', { selector: 'td' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('Data Wizards')).toBeInTheDocument();
    expect(within(row).getByText('Paid · Cash')).toBeInTheDocument();
  });
});
