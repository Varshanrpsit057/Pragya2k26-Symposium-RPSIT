import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATALOG } from '../lib/fest';
import { ROLE_PERMISSIONS, type SessionInfo, type StaffRole } from '../lib/staff';
import { AdminApp } from './AdminApp';

const session = (role: StaffRole, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  username: `${role.toLowerCase()}1`,
  displayName: 'Test Staff',
  role,
  kind: 'staff',
  eventIds: [],
  department: null,
  permissions: [...ROLE_PERMISSIONS[role]],
  expiresAt: '2026-10-17T12:00:00.000Z',
  serverTime: '2026-10-17T04:00:00.000Z',
  phase: 'onsite',
  eventDayStarted: true,
  schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-17T11:59:00' },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber: null,
  ...extra,
});

/** Answers like the API: the session, the catalog, no registrations yet. */
function signedInAs(info: SessionInfo) {
  sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.endsWith('/api/admin/session')
      ? info
      : url.endsWith('/api/admin/fest/catalog')
        ? { catalog: DEFAULT_CATALOG }
        : url.endsWith('/api/admin/fest/sync')
          ? { full: true, departments: [], registrations: [], results: [], cursor: '2026-10-17T04:00:00.000Z', catalogRevision: 0, serverTime: '2026-10-17T04:00:00.000Z' }
          : url.endsWith('/api/admin/fest/blocks')
            ? { dept: info.department, source: 'DESK', first: 1, last: 50 }
            : {};
    return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
  });
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const sections = async () => {
  const nav = await screen.findByRole('navigation', { name: 'Sections' });
  return within(nav).getAllByRole('button').map((button) => button.textContent);
};

describe('dashboard of the student coordinators', () => {
  it.each([
    ['ADMIN', {}, ['Overview', 'Registrations', 'Results', 'Colleges', 'Register', 'Event windows', 'Online & paper', 'Departments & events', 'Website controls', 'Accounts', 'Event-day controls', 'Help requests', 'System status', 'Testing', 'Roles']],
    ['OVERALL', {}, ['Overview', 'Registrations', 'Results', 'Colleges', 'Roles']],
    ['HOD', { department: 'CSE' }, ['Overview', 'Registrations', 'Results', 'Colleges', 'Roles']],
    ['DEPT_ADMIN', { department: 'CSE' }, ['Overview', 'Registrations', 'Results', 'Colleges', 'Register', 'Event windows', 'Online & paper', 'Roles']],
    ['DESK', { department: 'CSE', deskNumber: 2 }, ['Registration desk', 'Roles']],
    ['COORDINATOR', { department: 'CSE', eventIds: ['cse-hackathon'] }, ['My events', 'Roles']],
  ] as const)('shows %s only its own sections', async (role, extra, expected) => {
    signedInAs(session(role, extra as Partial<SessionInfo>));
    render(<AdminApp />);
    expect(await sections()).toEqual(expected);
    expect(screen.getByText(/On-site registration open/)).toBeInTheDocument();
    const title = 'department' in extra ? 'CSE · Computer Science and Engineering' : 'All departments';
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    // Everyone can reach the web assist team, and sees whether the phone is live.
    expect(screen.getByRole('button', { name: /Contact admin/ })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Connection' })).toHaveTextContent('Live');
  });

  it('names the department on its own sign-in page, and says so when an account opens another department’s page', async () => {
    window.history.replaceState(null, '', '/landing/it/admin/');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { unmount } = render(<AdminApp />);
    expect(screen.getByText('IT · Information Technology')).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    signedInAs(session('HOD', { department: 'CSE' }));
    render(<AdminApp />);
    expect(await screen.findByText(/This page is for IT; your account is for CSE/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the CSE page' })).toHaveAttribute('href', '/landing/cse/admin/');
  });

  it('lists every department’s staff page under the overall sign-in, not on a department’s own', () => {
    window.history.replaceState(null, '', '/landing/admin/');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { unmount } = render(<AdminApp />);
    const list = screen.getByRole('navigation', { name: 'Department staff pages' });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['cse', 'aids', 'it', 'ece', 'cys', 'eee', 'mech', 'sh'].map((code) => `/landing/${code}/admin/`));
    expect(within(list).getByRole('link', { name: /MECH\s*Mechanical Engineering/ })).toBeInTheDocument();
    unmount();
    window.history.replaceState(null, '', '/landing/cse/admin/');
    render(<AdminApp />);
    expect(screen.queryByRole('navigation', { name: 'Department staff pages' })).toBeNull();
  });

  it('documents what every role may do, marking the signed-in role', async () => {
    signedInAs(session('COORDINATOR', { department: 'CSE', eventIds: ['cse-hackathon'] }));
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Roles' }));
    const heading = screen.getByRole('heading', { name: 'Roles and permissions' });
    const panel = heading.closest('section') as HTMLElement;
    for (const role of ['Web assist team', 'Overall coordinator (HOD)', 'Department admin', 'Registration desk', 'Event coordinator']) {
      expect(within(panel).getByRole('heading', { name: role })).toBeInTheDocument();
    }
    // One HOD for every department (the overall coordinator): no HOD account per department.
    expect(within(panel).queryByRole('heading', { name: /Department HOD/ })).toBeNull();
    expect(within(panel).queryByRole('heading', { name: 'Certificate team' })).toBeNull();
    const coordinator = within(panel).getByRole('heading', { name: 'Event coordinator' }).closest('article') as HTMLElement;
    expect(coordinator).toHaveClass('is-mine');
    expect(within(coordinator).getByText(/Event window: search students, take the event fee.*\(assigned events only\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/IDs carry the department \(CSE-0147\)/)).toBeInTheDocument();
  });
});
