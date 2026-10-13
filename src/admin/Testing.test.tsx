import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registrationPhase } from '../lib/schedule';
import { currentSchedule, liveScheduleForTests, refreshSchedule } from '../lib/liveSchedule';
import { ROLE_PERMISSIONS, type SessionInfo, type StaffRole } from '../lib/staff';
import { CLEAR_PHRASE, type TestingState } from '../lib/testTools';
import { AdminApp } from './AdminApp';

const session = (role: StaffRole, testing?: SessionInfo['testing']): SessionInfo => ({
  username: `${role.toLowerCase()}1`,
  displayName: 'Test Staff',
  role,
  kind: 'staff',
  eventIds: [],
  permissions: [...ROLE_PERMISSIONS[role]],
  expiresAt: '2026-10-12T12:00:00.000Z',
  serverTime: '2026-10-12T04:00:00.000Z',
  phase: 'online',
  eventDayStarted: false,
  schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber: null,
  ...(testing && { testing }),
});

const testingState = (overrides: Partial<TestingState> = {}): TestingState => ({
  success: true,
  timeline: {
    schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
    standard: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
    override: null,
    phase: 'online',
    serverTime: '2026-10-12T04:00:00.000Z',
  },
  session: null,
  records: [
    { registrationId: '262001', name: 'Tester One', phone: '9876501234', college: 'Sona College', source: 'ONSITE', status: 'APPROVED', submittedAt: '2026-10-12T04:10:00.000Z', createdBy: 'desk1', session: 't1' },
  ],
  helpRequests: 1,
  results: ['code-flex'],
  realOnsite: 0,
  ...overrides,
});

/** Answers like the API, and records what was sent. */
function api(info: SessionInfo, answers: (url: string, body: Record<string, unknown> | undefined) => object | undefined = () => undefined) {
  sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
  const sent: { url: string; body: Record<string, unknown> | undefined }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    if (init?.method === 'POST') sent.push({ url, body });
    const answer = answers(url, body) ?? (url.endsWith('/api/admin/session') ? info : url.endsWith('/api/admin/registrations') ? { registrations: [] } : {});
    return new Response(JSON.stringify({ success: true, ...answer }), { headers: { 'Content-Type': 'application/json' } });
  });
  return sent;
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  liveScheduleForTests(false);
});

const open = async (name: string) => fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name }));

describe('Testing (admins)', () => {
  it('starts an event-day test in one click: a test session and on-site registration open now', async () => {
    const sent = api(session('ADMIN'), (url) => (url.endsWith('/api/admin/testing') ? testingState() : url.endsWith('/testing/timeline') ? { timeline: testingState().timeline } : undefined));
    render(<AdminApp />);
    await open('Testing');
    fireEvent.change(await screen.findByLabelText('Session name (optional)'), { target: { value: 'Rehearsal 1' } });
    fireEvent.change(screen.getByLabelText('On-site open for'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start an event-day test' }));
    expect(await screen.findByText(/Event-day test started: the website is in on-site mode for 4 hours/)).toBeInTheDocument();
    expect(sent.map((call) => [call.url.replace(/.*\/api/, '/api'), call.body]).filter(([url]) => String(url).includes('/testing/'))).toEqual([
      ['/api/admin/testing/session', { action: 'start', label: 'Rehearsal 1' }],
      ['/api/admin/testing/timeline', { mode: 'onsite-now', hours: 4 }],
    ]);
  });

  it('shows the test records, keeps a real one, and deletes the test data only after the phrase is typed', async () => {
    let round = 0;
    const sent = api(session('ADMIN'), (url) => {
      if (url.endsWith('/api/admin/testing')) return testingState();
      if (url.endsWith('/testing/clear')) {
        round += 1;
        return round === 1
          ? { cleared: 40, remaining: 3, backup: 'backups/test-data-a.json', results: 0, helpRequests: 0, deskIdsRestarted: false }
          : { cleared: 3, remaining: 0, backup: 'backups/test-data-b.json', results: 1, helpRequests: 1, deskIdsRestarted: true };
      }
      if (url.endsWith('/fest/test-data/clear')) return { cleared: 12, results: 2, restarted: ['CSE', 'IT'] };
      return undefined;
    });
    render(<AdminApp />);
    await open('Testing');
    const records = await screen.findByRole('region', { name: 'Test data' });
    expect(within(records).getByText('Tester One')).toBeInTheDocument();
    fireEvent.click(within(records).getByRole('button', { name: 'Keep: a real student' }));
    await waitFor(() => expect(sent.some((call) => call.url.endsWith('/testing/records/262001') && call.body?.test === false)).toBe(true));

    const remove = screen.getByRole('region', { name: 'Delete test data' });
    const button = within(remove).getByRole('button', { name: /Delete the test data/ });
    expect(button).toBeDisabled();
    fireEvent.change(within(remove).getByLabelText(/to confirm/), { target: { value: CLEAR_PHRASE } });
    fireEvent.click(button);
    expect(await within(remove).findByText(/Deleted 43 test records, 1 event results, 1 help requests; desk IDs start again at 262001/)).toBeInTheDocument();
    // The fest's test registrations in every department too.
    expect(within(remove).getByText('Fest: deleted 12 test registrations and 2 event results; IDs start again at -0001 in CSE, IT.')).toBeInTheDocument();
    // Twice (40, then the last 3), the fest's, then the session ended and the real schedule back.
    const calls = sent.map((call) => call.url.replace(/.*\/api/, '/api')).filter((url) => (url.includes('/testing/') || url.includes('/test-data/')) && !url.includes('/records/'));
    expect(calls).toEqual(['/api/admin/testing/clear', '/api/admin/testing/clear', '/api/admin/fest/test-data/clear', '/api/admin/testing/session', '/api/admin/testing/timeline']);
    expect(sent.find((call) => call.url.endsWith('/testing/clear'))?.body).toEqual({ confirm: CLEAR_PHRASE, results: true, helpRequests: true, restartDeskIds: true });
    expect(sent.filter((call) => call.url.endsWith('/testing/timeline')).pop()?.body).toEqual({ mode: 'standard' });
  });

  it('tells every signed-in coordinator while a test session or timeline is on', async () => {
    api(session('DESK', { session: 'Rehearsal 1', timeline: true }));
    render(<AdminApp />);
    const banner = await screen.findByText(/Test session on: Rehearsal 1/);
    expect(banner.closest('p')).toHaveTextContent('Everything registered now is test data');
    expect(banner.closest('p')).toHaveTextContent('The website is following a test timeline.');
    expect(screen.queryByRole('button', { name: 'Testing' })).toBeNull();
  });
});

describe('the website follows the timeline the API gives', () => {
  it('switches to on-site mode when a test timeline is set, and back', async () => {
    liveScheduleForTests(true);
    const now = Date.parse('2026-10-12T04:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const answer = (schedule: object) => vi.fn(async () => new Response(JSON.stringify({ success: true, schedule }), { headers: { 'Content-Type': 'application/json' } }));
    const phase = () => registrationPhase(currentSchedule(), now);
    await act(() => refreshSchedule(answer({ onlineClosesAt: '2026-10-12T09:00:00', onsiteOpensAt: '2026-10-12T09:01:00', onsiteClosesAt: '2026-10-12T18:00:00' })));
    expect(currentSchedule().onsiteOpensAt).toBe('2026-10-12T09:01:00');
    expect(phase()).toBe('onsite');
    // Back to the real schedule.
    await act(() => refreshSchedule(answer({ onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' })));
    expect(phase()).toBe('online');
    // A broken answer changes nothing.
    await act(() => refreshSchedule(answer({ onlineClosesAt: 42 })));
    expect(currentSchedule().onsiteOpensAt).toBe('2026-10-17T00:00:00');
  });
});
