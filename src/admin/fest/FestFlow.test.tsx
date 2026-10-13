/**
 * The fest screens against the real API (server/http.ts with in-memory stores): a desk with
 * and without signal, an event coordinator, the overall coordinator's filters and the import.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../server/http';
import { STAFF_PASSWORD, TIMES, setup } from '../../../server/testing';
import type { FestRegistration } from '../../lib/fest';
import { AdminApp } from '../AdminApp';

type Harness = ReturnType<typeof setup>;

// Each test makes several staff accounts (passwords are hashed slowly on purpose): generous when every test runs at once.
vi.setConfig({ testTimeout: 30_000 });

/** The browser's fetch, answered by the real API; `offline()` drops the network. */
function backend(h: Harness) {
  let down = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (down) throw new TypeError('Failed to fetch');
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const answer = await route(
      { method: init?.method ?? 'GET', path: new URL(String(input), 'http://localhost').pathname, headers, body: typeof init?.body === 'string' ? init.body : null, ip: '10.0.0.7' },
      h.service,
      () => {},
    );
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  });
  return {
    offline: () => {
      down = true;
    },
    online: () => {
      down = false;
    },
  };
}

const signIn = (token: string) => sessionStorage.setItem('pragya-admin-session', token);
const sync = async (h: Harness, token: string) => (await h.call('POST', '/api/admin/fest/sync', {}, { token })).body.registrations as FestRegistration[];

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function fillStudent(name: string, phone: string) {
  fireEvent.change(await screen.findByLabelText('Name with initial'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: phone } });
  fireEvent.change(screen.getByLabelText('College'), { target: { value: 'Sona College of Technology' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Hackathon/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Cash' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have received ₹100 in cash.' }));
}

describe('a registration desk', () => {
  it('registers with the phone’s own IDs, and keeps registering with no signal, sending when it is back', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const network = backend(h);
    signIn(desk.token);
    render(<AdminApp />);
    // The desk opens on the payments to check; walk-ins are registered in Register.
    fireEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('50 IDs on this phone')).toBeInTheDocument();

    await fillStudent('Kavin R', '9840011111');
    fireEvent.click(screen.getByRole('button', { name: 'Register · ₹100 received' }));
    expect(await screen.findByText('CSE-0001')).toBeInTheDocument();
    await waitFor(async () => expect((await sync(h, desk.token)).map((item) => item.id)).toEqual(['CSE-0001']));
    const saved = (await sync(h, desk.token))[0];
    expect(saved).toMatchObject({ name: 'Kavin R', desk: 1, entry: { payment: { method: 'CASH', amount: 100 } } });
    expect(saved.events.map((entry) => entry.eventId)).toEqual(['cse-hackathon']);

    // The same phone again: the desk is told at once, without registering.
    fireEvent.click(screen.getByRole('button', { name: 'Register the next student' }));
    fireEvent.change(await screen.findByLabelText(/^Mobile number/), { target: { value: '98400 11111' } });
    expect(await screen.findByText(/Already registered as/)).toHaveTextContent('Already registered as CSE-0001 (Kavin R).');

    // No signal: the next registration gets its ID at once and waits on the phone.
    network.offline();
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '9840022222' } });
    await fillStudent('Asha K', '9840022222');
    fireEvent.click(screen.getByRole('button', { name: 'Register · ₹100 received' }));
    expect(await screen.findByText('CSE-0002')).toBeInTheDocument();
    expect(screen.getByText(/Saved on this phone: it is sent as soon as the signal is back/)).toBeInTheDocument();
    expect(await screen.findByText('1 waiting to send')).toBeInTheDocument();
    expect((await sync(h, desk.token)).map((item) => item.id)).toEqual(['CSE-0001']);

    network.online();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Refresh|Updating/ })));
    await waitFor(async () => expect((await sync(h, desk.token)).map((item) => item.id).sort()).toEqual(['CSE-0001', 'CSE-0002']));
    await waitFor(() => expect(screen.queryByText('1 waiting to send')).toBeNull());
  });

  it('loses nothing when the phone switches off with registrations waiting: they are sent when the desk signs in again', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const network = backend(h);
    signIn(desk.token);
    const before = render(<AdminApp />);
    // The desk opens on the payments to check; walk-ins are registered in Register.
    fireEvent.click(await screen.findByRole('button', { name: 'Register' }));
    expect(await screen.findByText('50 IDs on this phone')).toBeInTheDocument();

    network.offline();
    await fillStudent('Asha K', '9840022222');
    fireEvent.click(screen.getByRole('button', { name: 'Register · ₹100 received' }));
    expect(await screen.findByText('CSE-0001')).toBeInTheDocument();
    expect(await screen.findByText('1 waiting to send')).toBeInTheDocument();

    // Signing out first says what happens to it (here the desk stays).
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(confirm.mock.calls[0][0]).toMatch(/^1 change is still waiting to send from this device\. They stay saved here and are sent the next time cse-desk1 signs in/);
    expect(screen.getByText('1 waiting to send')).toBeInTheDocument();

    // The phone switches off: the page and its sign-in are gone; the server has nothing yet.
    before.unmount();
    sessionStorage.clear();
    expect(await sync(h, desk.token)).toEqual([]);

    // Back on, with signal: the same desk signs in again on the same phone, and it is sent.
    network.online();
    signIn(await h.loginAs('cse-desk1', STAFF_PASSWORD));
    render(<AdminApp />);
    await waitFor(async () => expect((await sync(h, desk.token)).map((item) => item.id)).toEqual(['CSE-0001']));
    expect((await sync(h, desk.token))[0]).toMatchObject({ name: 'Asha K', desk: 1, entry: { payment: { method: 'CASH', amount: 100 } } });
  });
});

describe('an event coordinator', () => {
  it('takes the fee, marks attendance and submits the winners', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack1', { department: 'CSE' });
    await h.call('POST', '/api/admin/fest/registrations', { submissionId: 'sub-flow-00001', id: 'CSE-0001', participant: { name: 'Kavin R', phone: '9840011111', college: 'Sona' }, events: ['cse-hackathon'], payment: { method: 'CASH', confirmed: true } }, { token: desk.token });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend(h);
    signIn(coordinator.token);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: 'Hackathon' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Take ₹50' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Cash' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have received ₹50 in cash.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the fee' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark present' }));
    await waitFor(async () => expect((await sync(h, coordinator.token))[0].events[0].present).toBeTruthy());

    const winners = screen.getByRole('region', { name: 'Winners' });
    fireEvent.change(within(winners).getByLabelText('1st place'), { target: { value: 'cse 1' } });
    fireEvent.click(within(winners).getByRole('button', { name: 'Submit results' }));
    await waitFor(async () => {
      const result = (await h.call('POST', '/api/admin/fest/sync', {}, { token: coordinator.token })).body.results[0];
      expect(result).toMatchObject({ eventId: 'cse-hackathon', places: [{ place: 1, ids: ['CSE-0001'] }], submitted: { by: 'cse-hack1' } });
    });
    expect(await within(winners).findByText(/CSE-0001 Kavin R/)).toBeInTheDocument();
  });

  it('opens straight on the event its link names', async () => {
    const h = setup({ at: TIMES.eventDay });
    const admin = await h.staff('DEPT_ADMIN', [], 'cse-admin', { department: 'CSE' });
    backend(h);
    signIn(admin.token);
    window.history.pushState({}, '', '/landing/cse/admin/?event=cse-cyber-hunt');
    try {
      render(<AdminApp />);
      expect(await screen.findByRole('heading', { name: 'Cyber Hunt (Technical Quiz)' })).toBeInTheDocument();
      expect(screen.getByLabelText('Event')).toHaveValue('cse-cyber-hunt');
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});

describe('the overall coordinator', () => {
  it('sees every department, and filters by department like the university portal', async () => {
    const h = setup({ at: TIMES.eventDay });
    const register = async (dept: string, id: string, phone: string) => {
      const desk = await h.staff('DESK', [], `${dept.toLowerCase()}-desk-${id.slice(-1)}`, { department: dept, deskNumber: 1 });
      await h.call('POST', '/api/admin/fest/registrations', { submissionId: `sub-${id}-000`, id, participant: { name: 'Student', phone, college: 'Sona' }, events: [], payment: { method: 'UPI', txn: '412345678901', confirmed: true } }, { token: desk.token });
    };
    await register('CSE', 'CSE-0001', '9840011111');
    await register('CSE', 'CSE-0002', '9840022222');
    await register('IT', 'IT-0001', '9840033333');
    const overall = await h.staff('OVERALL');
    backend(h);
    signIn(overall.token);
    render(<AdminApp />);
    const registered = async () => (await screen.findByText('Registered', { selector: '.fest-stat__label' })).parentElement!;
    await waitFor(async () => expect(await registered()).toHaveTextContent('3'));
    expect(screen.getByRole('heading', { name: 'By department' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'IT' } });
    await waitFor(async () => expect((await registered()).querySelector('.fest-stat__value')).toHaveTextContent('1'));
    expect(screen.getByRole('heading', { name: 'IT desks' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Registrations' }));
    expect(await screen.findByText('1 registrations')).toBeInTheDocument();
    expect(screen.getByText('IT-0001')).toBeInTheDocument();
  });
});

describe('deleting the test data', () => {
  it('takes the deleted test registrations off every open phone at its next update', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await h.call('POST', '/api/admin/fest/registrations', { submissionId: 'sub-real-00001', id: 'CSE-0001', participant: { name: 'Real Student', phone: '9840011111', college: 'Sona' }, events: [], payment: { method: 'CASH', confirmed: true } }, { token: desk.token });
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'start', label: 'Rehearsal' });
    await h.call('POST', '/api/admin/fest/registrations', { submissionId: 'sub-test-00001', id: 'CSE-0002', participant: { name: 'Test Student', phone: '9840022222', college: 'Sona' }, events: [], payment: { method: 'CASH', confirmed: true } }, { token: desk.token });
    const overall = await h.staff('OVERALL');
    backend(h);
    signIn(overall.token);
    render(<AdminApp />);
    const registered = async () => (await screen.findByText('Registered', { selector: '.fest-stat__label' })).parentElement!;
    await waitFor(async () => expect((await registered()).querySelector('.fest-stat__value')).toHaveTextContent('2'));

    // Deleted elsewhere (e.g. from the Testing panel on another device): gone here at the next update.
    expect((await h.asOwner('POST', '/api/admin/fest/test-data/clear', {})).body).toMatchObject({ cleared: 1, remaining: 0 });
    h.setTime(new Date(Date.parse(TIMES.eventDay) + 60_000).toISOString());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Refresh|Updating/ })));
    await waitFor(async () => expect((await registered()).querySelector('.fest-stat__value')).toHaveTextContent('1'));
  });
});

describe('a department admin', () => {
  it('uploads the online form’s CSV: checks it, then imports it with -5001 IDs', async () => {
    const h = setup({ at: TIMES.online });
    const admin = await h.staff('DEPT_ADMIN', [], 'cse-admin', { department: 'CSE' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend(h);
    signIn(admin.token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Online & paper' }));
    const csv = 'Timestamp,Full Name,Mobile Number,Email,College Name,Department,Year,Events\n1,Kavin R,9840011111,k@example.com,Sona College,CSE,2nd Year,"Hackathon, Snap with AI"\n2,Asha K,9840022222,a@example.com,KSR,IT,3rd Year,Underwater basket weaving\n';
    fireEvent.change(await screen.findByLabelText('CSV file'), { target: { files: [new File([csv], 'cse.csv', { type: 'text/csv' })] } });
    expect(await screen.findByText(/cse.csv: 2 rows/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check the file' }));
    expect(await screen.findByText(/1 ready to import\. 0 already registered · 1 with a problem\./)).toBeInTheDocument();
    expect(screen.getByText(/Not CSE events: Underwater basket weaving/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new registrations' }));
    expect(await screen.findByText(/Imported 1 registrations\./)).toBeInTheDocument();
    const [imported] = await sync(h, admin.token);
    expect(imported).toMatchObject({ id: 'CSE-5001', source: 'ONLINE', name: 'Kavin R', entry: { status: 'PAID', payment: { method: 'ONLINE' } } });
  });
});
