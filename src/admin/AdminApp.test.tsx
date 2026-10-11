import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminRegistration } from '../lib/admin';
import { ROLE_PERMISSIONS, type SessionInfo, type StaffRole } from '../lib/staff';
import { AdminApp } from './AdminApp';

const session = (role: StaffRole, eventIds: string[] = []): SessionInfo => ({
  username: `${role.toLowerCase()}1`,
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

/** Answers like the API: the session, and empty lists for everything else. */
function signedInAs(info: SessionInfo) {
  sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.endsWith('/api/admin/session')
      ? info
      : url.endsWith('/api/admin/events')
        ? { events: [] }
        : url.endsWith('/api/admin/registrations')
          ? { registrations: [] }
          : {};
    return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
  });
}

afterEach(() => {
  sessionStorage.clear();
  // The desk form's draft.
  localStorage.clear();
  vi.restoreAllMocks();
});

const sections = async () => {
  const nav = await screen.findByRole('navigation', { name: 'Sections' });
  return within(nav).getAllByRole('button').map((button) => button.textContent);
};

describe('dashboard of the student coordinators', () => {
  it.each([
    [
      'ADMIN',
      ['Registration desk', 'Online payments', 'Events', 'Results & certificates', 'Help requests', 'System status', 'Campus map', 'Student coordinators', 'Reports', 'Roles'],
    ],
    ['DESK', ['Registration desk', 'Roles']],
    ['COORDINATOR', ['Events', 'Results & certificates', 'Roles']],
    ['CERTIFICATE', ['Results & certificates', 'Roles']],
    ['SUPPORT', ['Registrations', 'Help requests', 'System status', 'Campus map', 'Roles']],
  ] as const)('shows %s only its own sections', async (role, expected) => {
    signedInAs(session(role, role === 'COORDINATOR' ? ['code-flex'] : []));
    render(<AdminApp />);
    expect(await sections()).toEqual(expected);
    expect(screen.getByText(/On-site registration open/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PRAGYA 2026 · Student coordinators' })).toBeInTheDocument();
    // Everyone can reach the admins.
    expect(screen.getByRole('button', { name: /Contact admin/ })).toBeInTheDocument();
  });

  it('documents what every role may do, marking the signed-in role', async () => {
    signedInAs(session('COORDINATOR', ['cognix']));
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Roles' }));

    const heading = screen.getByRole('heading', { name: 'Roles and permissions' });
    const panel = heading.closest('section') as HTMLElement;
    for (const role of ['Admin', 'Registration desk', 'Event coordinator', 'Certificate team', 'Web assistant team']) {
      expect(within(panel).getByRole('heading', { name: role })).toBeInTheDocument();
    }
    const coordinator = within(panel).getByRole('heading', { name: 'Event coordinator' }).closest('article') as HTMLElement;
    expect(coordinator).toHaveClass('is-mine');
    expect(within(coordinator).getByText(/enter them in the event \(individual or team\) with the ₹50 fee, mark attendance.*\(assigned events only\)/)).toBeInTheDocument();
    expect(within(coordinator).getByText(/Verify a ₹100 gate pass paid online by GPay/)).toBeInTheDocument();
    const desk = within(panel).getByRole('heading', { name: 'Registration desk' }).closest('article') as HTMLElement;
    expect(within(desk).getByText(/register students \(individual or team\) with the events they choose and take the ₹100 gate pass/)).toBeInTheDocument();
    expect(within(panel).getByText(/A QR scan, screenshot or transaction ID alone is never proof/)).toBeInTheDocument();
  });

  it('registers in a full-screen window: individual or team, events, college from the list, money confirmed, the GPay QR shown', async () => {
    signedInAs(session('DESK'));
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New registration' }));
    const dialog = screen.getByRole('dialog', { name: 'New registration' });
    const form = within(dialog).getByRole('form', { name: 'New on-site registration' });
    const submit = within(dialog).getByRole('button', { name: /Register and record ₹100/ });
    expect(submit).toBeDisabled();
    // The five events, chosen with the participant; each one's ₹50 is paid at its venue.
    const events = within(form).getByRole('group', { name: '3 Events' });
    expect(within(events).getAllByRole('checkbox')).toHaveLength(5);
    fireEvent.click(within(events).getByRole('checkbox', { name: /VIZ CRAFT/ }));
    fireEvent.click(within(events).getByRole('checkbox', { name: /CODE FLEX/ }));
    expect(within(dialog).getByText(/2 events: ₹100 to pay at the venues/)).toBeInTheDocument();
    expect(within(events).getByRole('checkbox', { name: /CODE FLEX.*individual event/ })).toBeChecked();
    // The college is typed with suggestions from the Tamil Nadu list, nearby colleges first.
    const college = within(form).getByRole('combobox', { name: /college/i });
    const suggestions = [...form.querySelectorAll(`#${college.getAttribute('list')} option`)].map((option) => option.getAttribute('value'));
    expect(suggestions[0]).toBe('R P Sarathy Institute of Technology, Salem');
    expect(suggestions.length).toBeGreaterThan(500);

    // A team needs its name.
    fireEvent.click(within(form).getByRole('radio', { name: 'Team' }));
    const teamName = within(form).getByLabelText('Team name');
    // A team event takes the team; an individual event never does.
    expect(within(events).getByRole('checkbox', { name: /VIZ CRAFT.*with the team \(up to 2\)/ })).toBeChecked();
    // Cash: ticked with the money in hand.
    fireEvent.click(within(form).getByRole('radio', { name: 'Cash' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: /I have received ₹100 in cash/ }));
    expect(submit).toBeDisabled();
    fireEvent.change(teamName, { target: { value: 'Code Ninjas' } });
    expect(submit).toBeEnabled();
    // GPay: the student pays from Student login on their phone, and the desk approves it after.
    fireEvent.click(within(form).getByRole('radio', { name: 'GPay / UPI' }));
    const steps = within(form).getByRole('list', { name: 'How a GPay payment works' });
    expect(steps).toHaveTextContent(/Student login on their phone \(http:\/\/localhost(:\d+)?\/landing\/student\/\)/);
    expect(steps).toHaveTextContent(/type the transaction ID from it and press Approve payment/);
    const gpay = within(dialog).getByRole('button', { name: 'Register student (GPay next)' });
    expect(gpay).toBeEnabled();
    fireEvent.click(within(form).getByRole('radio', { name: 'Individual' }));
    expect(within(form).queryByLabelText('Team name')).toBeNull();
    expect(gpay).toBeEnabled();
    expect(within(dialog).getByText(/Draft saved/)).toBeInTheDocument();
  });
});

describe('cancelling a registration', () => {
  const approved: AdminRegistration = {
    registrationId: '262004',
    source: 'ONSITE',
    status: 'APPROVED',
    submittedAt: '2026-10-17T04:00:00.000Z',
    approvedAt: '2026-10-17T04:00:00.000Z',
    rejectedAt: null,
    reviewedBy: 'desk1',
    rejectionReason: null,
    cancelled: null,
    createdBy: 'desk1',
    deskNumber: null,
    teamName: null,
    participant: {
      name: 'Nila R',
      department: 'Computer Science and Engineering (CSE)',
      college: 'Sona College of Technology, Salem',
      year: '2nd Year',
      phone: '9840000004',
      email: 'nila@example.com',
    },
    technicalEvents: [],
    discontinuedEvents: [],
    eventCount: 0,
    feePerEvent: 50,
    payableAtVenue: 0,
    payment: { amount: 100, transactionId: '' },
    gatePass: { status: 'VERIFIED', method: 'CASH', amount: 100, reference: null, verifiedBy: 'desk1', verifiedAt: '2026-10-17T04:00:00.000Z' },
    events: [],
    proofs: [],
    payments: [],
    screenshot: null,
    pdfStatus: 'GENERATED',
    pdfGeneratedAt: '2026-10-17T04:00:00.000Z',
    pdfError: null,
    emailStatus: 'SENT',
    emailSentAt: '2026-10-17T04:00:00.000Z',
    emailError: null,
    emailAttempts: 1,
    driveLinks: { payment: null, pass: null },
    sheet: { synced: true, error: null },
    processing: false,
  };

  it('lets an admin cancel an approved registration only with a reason, then shows who cancelled it and why', async () => {
    sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
    const sent: { url: string; body: unknown }[] = [];
    const cancelled: AdminRegistration = { ...approved, status: 'CANCELLED', cancelled: { at: '2026-10-17T05:00:00.000Z', by: 'admin1', reason: 'Registered twice' } };
    // What the server holds: the list refreshes live, so it must reflect the cancellation.
    let stored = approved;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.body) sent.push({ url, body: JSON.parse(String(init.body)) });
      const body = url.endsWith('/api/admin/session')
        ? session('ADMIN')
        : url.endsWith('/api/admin/registrations')
          ? { registrations: [stored] }
          : url.endsWith('/cancel')
            ? { registration: (stored = cancelled) }
            : {};
      return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
    });
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Online payments' }));
    fireEvent.click(await screen.findByRole('tab', { name: /Approved/ }));
    fireEvent.click(await screen.findByRole('button', { name: '262004' }));
    const details = screen.getByRole('dialog', { name: /262004 · Nila R/ });

    fireEvent.click(within(details).getByRole('button', { name: 'Cancel registration' }));
    expect(within(details).getByText(/makes their pass invalid and takes them off every event list/)).toBeInTheDocument();
    const confirm = within(details).getByRole('button', { name: 'Confirm cancellation' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(details).getByLabelText(/Reason \(required/), { target: { value: '  Registered twice ' } });
    fireEvent.click(confirm);

    // 'Why' appears only once the cancellation is stored (the typed reason is also in the textarea until then).
    expect(await within(details).findByText('Why')).toBeInTheDocument();
    expect(within(details).getByText('Registered twice')).toBeInTheDocument();
    expect(sent).toEqual([{ url: '/api/admin/registrations/262004/cancel', body: { reason: 'Registered twice' } }]);
    expect(within(details).getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(within(details).queryByRole('button', { name: 'Cancel registration' })).toBeNull();
    expect(screen.getByRole('tab', { name: /Cancelled/ })).toHaveTextContent('Cancelled 1');
  });
});

describe('student login switch', () => {
  it('lets an admin turn the event-day student page on (with a confirmation), and is hidden from other roles', async () => {
    sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
    const sent: { url: string; body: unknown }[] = [];
    let enabled = false;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.body) {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith('/api/admin/student-portal')) enabled = (JSON.parse(String(init.body)) as { enabled: boolean }).enabled;
      }
      const body = url.endsWith('/api/admin/session')
        ? session('ADMIN')
        : url.endsWith('/api/admin/student-portal')
          ? { enabled, changedBy: enabled ? 'admin1' : null, changedAt: enabled ? '2026-10-17T04:30:00.000Z' : null }
          : url.endsWith('/api/admin/registrations')
            ? { registrations: [] }
            : {};
      return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
    });
    render(<AdminApp />);
    const strip = await screen.findByRole('region', { name: 'Student login on the website' });
    expect(await within(strip).findByText('Paused')).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Turn on' }));
    expect(await within(strip).findByText('On')).toBeInTheDocument();
    expect(within(strip).getByText(/by admin1 17 Oct 2026, 10:00 am IST/)).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(sent).toEqual([{ url: '/api/admin/student-portal', body: { enabled: true } }]);
  });

  it('is not shown to the desk', async () => {
    signedInAs(session('DESK'));
    render(<AdminApp />);
    await screen.findByRole('navigation', { name: 'Sections' });
    expect(screen.queryByRole('region', { name: 'Student login on the website' })).toBeNull();
  });
});
