import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS, type SessionInfo, type StaffRole } from '../lib/staff';
import { AdminApp } from './AdminApp';

const session = (role: StaffRole, deskNumber: number | null = null): SessionInfo => ({
  username: role === 'DESK' ? 'desk2' : 'admin1',
  displayName: role === 'DESK' ? 'Desk Two' : 'Admin One',
  role,
  kind: 'staff',
  eventIds: [],
  permissions: [...ROLE_PERMISSIONS[role]],
  expiresAt: '2026-10-17T12:00:00.000Z',
  serverTime: '2026-10-17T04:00:00.000Z',
  phase: 'onsite',
  eventDayStarted: true,
  schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber,
});

/** Answers like the API, and records what is sent. */
function api(answers: (url: string, body: unknown) => object | undefined) {
  const sent: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body) sent.push({ url, body });
    const answer = answers(url, body) ?? (url.endsWith('/api/admin/registrations') ? { registrations: [] } : {});
    return new Response(JSON.stringify({ success: true, ...answer }), { headers: { 'Content-Type': 'application/json' } });
  });
  return sent;
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the desk number of each desk sign-in', () => {
  it('is not asked on the sign-in page: the desk account carries it, and the header shows it', async () => {
    const sent = api((url) => (url.endsWith('/api/admin/login') ? { token: 'x'.repeat(43) } : url.endsWith('/api/admin/session') ? session('DESK', 2) : undefined));
    render(<AdminApp />);
    expect(screen.queryByLabelText(/Desk number/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'desk2' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Preview-Staff-Pass-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // Signed in: the header shows the desk.
    await waitFor(() => expect(screen.queryByLabelText('Username')).toBeNull());
    expect(await screen.findByText('Desk 2')).toBeInTheDocument();
    expect(sent.find((call) => call.url.endsWith('/api/admin/login'))?.body).toEqual({ username: 'desk2', password: 'Preview-Staff-Pass-2026' });
  });

  it('is asked for after signing in when it was not chosen, and saved for the session', async () => {
    sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
    let current = session('DESK');
    const sent = api((url, body) => {
      if (url.endsWith('/api/admin/session/desk')) current = session('DESK', (body as { deskNumber: number }).deskNumber);
      if (url.endsWith('/api/admin/session') || url.endsWith('/api/admin/session/desk')) return current;
      return undefined;
    });
    render(<AdminApp />);
    const ask = await screen.findByRole('region', { name: 'Choose your desk' });
    expect(ask).toHaveTextContent('Which registration desk are you at?');
    fireEvent.click(within(ask).getByRole('button', { name: 'Desk 2' }));
    expect(await screen.findByText('Desk 2')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Choose your desk' })).toBeNull();
    expect(sent.find((call) => call.url.endsWith('/api/admin/session/desk'))?.body).toEqual({ deskNumber: 2 });
  });

  it('shows admins who is signed in now, at which desk', async () => {
    sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
    api((url) =>
      url.endsWith('/api/admin/session')
        ? session('ADMIN')
        : url.endsWith('/api/admin/sessions')
          ? {
              sessions: [
                { username: 'desk1', displayName: 'Desk One', role: 'DESK', kind: 'staff', deskNumber: 1, since: '2026-10-17T03:00:00.000Z', until: '2026-10-17T15:00:00.000Z' },
                { username: 'desk9', displayName: 'Desk Nine', role: 'DESK', kind: 'staff', deskNumber: null, since: '2026-10-17T03:10:00.000Z', until: '2026-10-17T15:10:00.000Z' },
                { username: 'vizcraft-lead', displayName: 'Viz Lead', role: 'COORDINATOR', kind: 'staff', deskNumber: null, since: '2026-10-17T03:20:00.000Z', until: '2026-10-17T15:20:00.000Z' },
              ],
            }
          : url.endsWith('/api/admin/staff')
            ? { staff: [] }
            : undefined,
    );
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Accounts' }));
    const signedIn = await screen.findByRole('region', { name: 'Signed in now' });
    await waitFor(() => expect(within(signedIn).getAllByRole('row')).toHaveLength(4));
    const rows = within(signedIn).getAllByRole('row').map((row) => row.textContent);
    expect(rows[1]).toContain('Desk One');
    expect(rows[1]).toContain('Desk 1');
    expect(rows[2]).toContain('Not chosen');
    expect(rows[3]).toContain('Event coordinator');
  });
});
