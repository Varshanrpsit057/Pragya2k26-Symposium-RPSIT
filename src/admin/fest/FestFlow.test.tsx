/**
 * The fest screens against the real API (server/http.ts with in-memory stores): students register
 * on their phones; a desk opens their ID and collects or verifies the fee (a clashing UTR shown and
 * corrected); an event coordinator; the overall coordinator's filters and college ranking; the import.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../../server/http';
import { TIMES, setup } from '../../../server/testing';
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

/** Catches what the dashboard downloads (saveFile makes a Blob link and clicks it). */
function downloads() {
  const files: Blob[] = [];
  Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (files.push(blob), `blob:${files.length}`)), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return files;
}
/** The text of an .xlsx (written uncompressed, its text inline). */
const xlsxText = async (file: Blob) => new TextDecoder().decode(await file.arrayBuffer());

/** A student registers on their phone (the QR code at the gate); `utr`: they paid by UPI there and sent it. */
async function onPhone(h: Harness, dept: string, n: number, extra: { name?: string; college?: string; events?: string[]; utr?: string } = {}) {
  const submissionId = `flow-phone-key-${dept.toLowerCase()}-${String(n).padStart(6, '0')}`;
  const made = await h.call(
    'POST',
    '/api/fest/register',
    {
      submissionId,
      dept,
      participant: { name: extra.name ?? `Student ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[n % 26]}`, phone: `98${String(40000000 + n).padStart(8, '0')}`, college: extra.college ?? 'Sona College of Technology, Salem', collegeCode: '2615', branch: 'B.E. CSE', year: '2nd Year', email: `p${n}@example.com` },
      events: extra.events ?? [],
    },
    { ip: '10.0.0.8' },
  );
  expect(made.status).toBe(200);
  const id = made.body.registration.id as string;
  if (extra.utr) expect((await h.call('POST', '/api/fest/me/payment', { id, key: submissionId, txn: extra.utr }, { ip: '10.0.0.8' })).status).toBe(200);
  return id;
}

/** The desk collects the entry fee (through the API). */
const collect = (h: Harness, token: string, id: string, payment: Record<string, unknown> = { method: 'CASH', confirmed: true }) =>
  h.call('POST', `/api/admin/fest/registrations/${id}`, { action: 'collect', payment }, { token });

describe('a registration desk', () => {
  it('stays on the list it chose (Fee due): after each student it comes back there, for the next one', async () => {
    const h = setup({ at: TIMES.eventDay });
    await onPhone(h, 'CSE', 1, { name: 'Kavin R' });
    await onPhone(h, 'CSE', 2, { name: 'Asha K' });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await collect(h, desk.token, await onPhone(h, 'CSE', 3, { name: 'Paid Already' }));
    backend(h);
    signIn(desk.token);
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fee due (2)' }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2001' }));
    // Back without doing anything: still on Fee due.
    fireEvent.click(await screen.findByRole('button', { name: '← Back to the list' }));
    expect(screen.getByRole('button', { name: 'Fee due (2)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2001' }));
    const fee = await screen.findByRole('region', { name: 'Entry fee' });
    fireEvent.click(within(fee).getByRole('radio', { name: 'Cash' }));
    fireEvent.click(within(fee).getByRole('checkbox', { name: 'I have received ₹100 in cash.' }));
    await act(async () => fireEvent.click(within(fee).getByRole('button', { name: 'Collect ₹100 (cash)' })));
    // Collected: back on Fee due, the next student waiting there.
    expect(await screen.findByRole('button', { name: 'Fee due (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Open CSE-2001' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open CSE-2002' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open CSE-2003' })).toBeNull();
  });

  it('lists the department’s IDs; opening one shows the student; collecting cash marks them paid', async () => {
    const h = setup({ at: TIMES.eventDay });
    await onPhone(h, 'CSE', 1, { name: 'Kavin R' });
    await onPhone(h, 'CSE', 2, { name: 'Asha K', utr: '612345678901' });
    await onPhone(h, 'AIDS', 3, { name: 'Other Dept' });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    backend(h);
    signIn(desk.token);
    render(<AdminApp />);

    // The desk opens on its department's students; one sent a UTR to verify.
    expect(await screen.findByRole('button', { name: 'Students (1 to verify)' }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'CSE students (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open CSE-2001' })).toBeInTheDocument();
    expect(screen.queryByText('Other Dept')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'UTR sent · to verify (1)' }));
    expect(screen.queryByRole('button', { name: 'Open CSE-2001' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open CSE-2002' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All (2)' }));
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'kavin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2001' }));

    // Their details, to check with the student, then the fee.
    const details = await screen.findByRole('region', { name: 'CSE-2001 details' });
    expect(within(details).getByText('9840000001')).toBeInTheDocument();
    expect(within(details).getByText('Sona College of Technology, Salem')).toBeInTheDocument();
    const fee = screen.getByRole('region', { name: 'Entry fee' });
    fireEvent.click(within(fee).getByRole('radio', { name: 'Cash' }));
    const button = within(fee).getByRole('button', { name: 'Collect ₹100 (cash)' });
    expect(button).toBeDisabled();
    fireEvent.click(within(fee).getByRole('checkbox', { name: 'I have received ₹100 in cash.' }));
    await act(async () => fireEvent.click(button));
    // Collected: the student closes by itself, the list is back and the search waits (empty) for the next ID.
    expect(await screen.findByRole('status')).toHaveTextContent('✓ CSE-2001 Kavin R: ₹100 collected in cash. Next student: type their ID.');
    expect(screen.queryByRole('region', { name: 'Entry fee' })).toBeNull();
    expect(screen.getByLabelText('Find')).toHaveValue('');
    expect(screen.getByLabelText('Find')).toHaveFocus();
    expect((await sync(h, desk.token)).find((item) => item.id === 'CSE-2001')).toMatchObject({ entry: { status: 'PAID', payment: { method: 'CASH', desk: 1, by: 'cse-desk1' } }, checkedIn: { desk: 1 } });
    // Opened again, it shows how it was paid.
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2001' }));
    expect(await within(screen.getByRole('region', { name: 'Entry fee' })).findByText(/Payment collected and verified: ₹100 in cash/)).toBeInTheDocument();

    // With no signal nothing is pretended: the desk is told nothing was saved (and stays on the student).
    fireEvent.click(screen.getByRole('button', { name: '← Back to the list' }));
    fireEvent.change(screen.getByLabelText('Find'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2002' }));
    const network = backend(h);
    network.offline();
    const second = await screen.findByRole('region', { name: 'Entry fee' });
    fireEvent.click(within(second).getByRole('button', { name: /They paid at the desk instead/ }));
    fireEvent.click(within(second).getByRole('radio', { name: 'Cash' }));
    fireEvent.click(within(second).getByRole('checkbox', { name: 'I have received ₹100 in cash.' }));
    await act(async () => fireEvent.click(within(second).getByRole('button', { name: 'Collect ₹100 (cash)' })));
    expect(await within(second).findByRole('alert')).toHaveTextContent(/Nothing was saved/);
    expect((await sync(h, desk.token)).find((item) => item.id === 'CSE-2002')?.entry.status).toBe('DUE');
  });

  it('verifies a UTR; a clash shows both students, and the desk corrects the wrong one', async () => {
    const h = setup({ at: TIMES.eventDay });
    // Two students sent the same UTR (one of them typed it from the other's phone).
    await onPhone(h, 'CSE', 1, { name: 'Student A', utr: '612345678901' });
    await onPhone(h, 'CSE', 2, { name: 'Student B', utr: '612345678901' });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend(h);
    signIn(desk.token);
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open CSE-2001' }, { timeout: 5000 }));
    let fee = await screen.findByRole('region', { name: 'Entry fee' });
    // Only the last 4 digits of the student's UTR are shown; the other student has it too.
    expect(within(fee).getByText(/UTR ending/)).toHaveTextContent('UTR ending 8901');
    expect(within(fee).getByRole('alert')).toHaveTextContent('This UTR is also on CSE-2002 (Student B)');
    const typed = within(fee).getByLabelText(/^UTR on the payment/);
    fireEvent.click(within(fee).getByRole('checkbox', { name: 'I have seen ₹100 paid with this UTR.' }));
    fireEvent.change(typed, { target: { value: '6123 4567 8000' } });
    expect(within(fee).getByText(/Not the UTR they sent \(theirs ends 8901\)/)).toBeInTheDocument();
    expect(within(fee).getByRole('button', { name: 'Verify CSE-2001' })).toBeDisabled();
    fireEvent.change(typed, { target: { value: '6123 4567 8901' } });
    expect(within(fee).getByText('✓ Matches the UTR CSE-2001 sent.')).toBeInTheDocument();
    await act(async () => fireEvent.click(within(fee).getByRole('button', { name: 'Verify CSE-2001' })));
    await waitFor(async () => expect((await sync(h, desk.token)).find((item) => item.id === 'CSE-2001')?.entry).toMatchObject({ status: 'PAID', payment: { txn: '612345678901' } }));
    // Verified: back to the list for the next student.
    expect(await screen.findByText(/✓ CSE-2001 Student A: UTR verified: payment collected/)).toBeInTheDocument();

    // The other student: the server refuses the same UTR and shows who has it.
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2002' }));
    fee = await screen.findByRole('region', { name: 'Entry fee' });
    fireEvent.change(within(fee).getByLabelText(/^UTR on the payment/), { target: { value: '612345678901' } });
    fireEvent.click(within(fee).getByRole('checkbox', { name: 'I have seen ₹100 paid with this UTR.' }));
    await act(async () => fireEvent.click(within(fee).getByRole('button', { name: 'Verify CSE-2002' })));
    expect(await within(fee).findByText(/already accepted for CSE-2001/)).toBeInTheDocument();
    const holders = await within(fee).findByRole('region', { name: 'Who has the UTR 612345678901' });
    const items = await within(holders).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([expect.stringMatching(/^CSE-2001 Student A.*Paid with it/), expect.stringMatching(/^CSE-2002 Student B.*Sent it · not verified yet/)]);

    // Student B shows their own payment: it has a different UTR. The desk corrects B's.
    const mine = items[1];
    fireEvent.click(within(mine).getByRole('button', { name: 'Change UTR…' }));
    fireEvent.change(within(mine).getByLabelText('The right UTR'), { target: { value: '612345678955' } });
    fireEvent.change(within(mine).getByLabelText('Why (kept in their log)'), { target: { value: 'Typed A’s UTR; their payment shows 8955' } });
    await act(async () => fireEvent.click(within(mine).getByRole('button', { name: 'Save the UTR' })));
    await waitFor(async () => expect((await sync(h, desk.token)).find((item) => item.id === 'CSE-2002')?.utrLog?.[0]).toMatchObject({ from: '612345678901', to: '612345678955', by: 'cse-desk1' }));
    expect(await screen.findByRole('region', { name: 'UTR changes' })).toHaveTextContent('612345678901 → 612345678955');

    // Now it verifies with the right UTR.
    fee = screen.getByRole('region', { name: 'Entry fee' });
    fireEvent.change(within(fee).getByLabelText(/^UTR on the payment/), { target: { value: '612345678955' } });
    await act(async () => fireEvent.click(within(fee).getByRole('button', { name: 'Verify CSE-2002' })));
    await waitFor(async () => expect((await sync(h, desk.token)).find((item) => item.id === 'CSE-2002')?.entry).toMatchObject({ status: 'PAID', payment: { txn: '612345678955' } }));
  });

  it('registers a student who cannot do it on a phone (online), then collects their fee', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    backend(h);
    signIn(desk.token);
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Register for them' }));
    fireEvent.change(await screen.findByLabelText('Name with initial'), { target: { value: 'Kavin R' } });
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '9840011111' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kavin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^College/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search colleges' }), { target: { value: 'sona' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Sona College of Technology, Salem' }));
    fireEvent.click(screen.getByRole('button', { name: /^Department \/ course/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search departments' }), { target: { value: 'Computer Science and Engineering' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Computer Science and Engineering (CSE)' }));
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2nd Year' } });
    // No events here: they are joined at each venue.
    expect(screen.queryByRole('checkbox', { name: /Hackathon/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Register, then collect the fee' })));

    // Straight to the new student: the phones' IDs, the fee due.
    expect(await screen.findByRole('region', { name: 'CSE-2001 details' })).toHaveTextContent('Desk (for them)');
    const [made] = await sync(h, desk.token);
    expect(made).toMatchObject({ id: 'CSE-2001', source: 'SELF', name: 'Kavin R', created: { by: 'cse-desk1' }, entry: { status: 'DUE' }, events: [] });
    const fee = screen.getByRole('region', { name: 'Entry fee' });
    fireEvent.click(within(fee).getByRole('radio', { name: 'UPI / GPay' }));
    fireEvent.change(within(fee).getByLabelText(/UPI transaction ID/), { target: { value: '512345678901' } });
    fireEvent.click(within(fee).getByRole('checkbox', { name: 'I have seen ₹100 paid on the student’s phone.' }));
    await act(async () => fireEvent.click(within(fee).getByRole('button', { name: 'Collect ₹100 (UPI)' })));
    await waitFor(async () => expect((await sync(h, desk.token))[0].entry).toMatchObject({ status: 'PAID', payment: { method: 'UPI', txn: '512345678901' } }));

    // The same mobile number again: told whose it is, with a way to open it.
    fireEvent.click(screen.getByRole('button', { name: 'Register for them' }));
    fireEvent.change(await screen.findByLabelText(/^Mobile number/), { target: { value: '98400 11111' } });
    expect(await screen.findByText(/Already registered as/)).toHaveTextContent('Already registered as CSE-2001 (Kavin R).');
  });
});

describe('an event coordinator', () => {
  it('shows the UPI transaction ID it typed for an event fee, with who took it, on screen and in the event’s Excel columns', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack1', { department: 'CSE' });
    const path = (id: string) => `/api/admin/fest/registrations/${id}/events/cse-hackathon`;
    for (const [n, name] of [
      [1, 'Kavin R'],
      [2, 'Asha K'],
    ] as const) {
      const id = await onPhone(h, 'CSE', n, { name });
      await collect(h, desk.token, id);
      await h.call('POST', path(id), { action: 'add' }, { token: coordinator.token });
    }
    await h.call('POST', path('CSE-2001'), { action: 'fee', payment: { method: 'UPI', txn: '612345678955', confirmed: true } }, { token: coordinator.token });
    await h.call('POST', path('CSE-2001'), { action: 'present' }, { token: coordinator.token });
    await h.call('POST', path('CSE-2002'), { action: 'fee', payment: { method: 'CASH', confirmed: true } }, { token: coordinator.token });
    const files = downloads();
    backend(h);
    signIn(coordinator.token);
    render(<AdminApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'In this event (2)' }, { timeout: 5000 }));
    expect(screen.getByText('Fee paid · UPI ₹50 · UTR 612345678955')).toBeInTheDocument();
    expect(screen.getByText('Fee paid · Cash ₹50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2001' }));
    const card = screen.getByRole('group', { name: 'CSE-2001 details' });
    expect(within(card).getByText('UPI ₹50 · UTR 612345678955')).toBeInTheDocument();
    expect(within(card).getAllByText(/^by cse-hack1/)).toHaveLength(2);

    // The event's Excel: its fee (cash or UPI), the UTR typed at the venue, present or absent.
    fireEvent.click(screen.getByRole('button', { name: 'Download this event (Excel)' }));
    const sheet = await xlsxText(files[0]!);
    for (const text of ['Hackathon: fee', 'Hackathon: UTR', 'Hackathon: present / absent', 'UPI ₹50', '612345678955', 'Cash ₹50', 'Present', 'Absent', 'Gate pass paid by (cash / UPI)']) expect(sheet).toContain(text);
  });

  it('has every department student: opens one by ID, checks them, adds them, takes ₹50, marks attendance and submits the winners', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack1', { department: 'CSE' });
    await collect(h, desk.token, await onPhone(h, 'CSE', 1, { name: 'Kavin R' }));
    await collect(h, desk.token, await onPhone(h, 'CSE', 2, { name: 'Asha K' }));
    await onPhone(h, 'CSE', 3, { name: 'Not Paid' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend(h);
    signIn(coordinator.token);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: 'Hackathon' })).toBeInTheDocument();

    // Every CSE student is listed (nobody chose events at the gate); the coordinator adds them here.
    expect(await screen.findByRole('button', { name: 'All CSE students (3)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'In this event (0)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Find a student'), { target: { value: 'cse 2001' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open CSE-2001' }));
    const kavin = screen.getByRole('group', { name: 'CSE-2001 details' });
    expect(within(kavin).getByText('Paid · verified at the desk')).toBeInTheDocument();
    fireEvent.click(within(kavin).getByRole('button', { name: 'Add to Hackathon' }));
    // Added: the ₹50 fee comes up at once.
    fireEvent.click(await screen.findByRole('radio', { name: 'Cash' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have received ₹50 in cash.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save the fee' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark present' }));
    await waitFor(async () => expect((await sync(h, coordinator.token)).find((item) => item.id === 'CSE-2001')?.events[0].present).toBeTruthy());
    // Present: the card closes and the search, emptied, waits for the next student's ID.
    expect(screen.getByRole('status')).toHaveTextContent('✓ CSE-2001 Kavin R is marked present at Hackathon. Next student: type their ID.');
    expect(screen.queryByRole('group', { name: 'CSE-2001 details' })).toBeNull();
    expect(screen.getByLabelText('Find a student')).toHaveValue('');
    expect(screen.getByLabelText('Find a student')).toHaveFocus();

    // One who has not paid is sent to the desk; another is added too.
    fireEvent.change(screen.getByLabelText('Find a student'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2003' }));
    expect(within(screen.getByRole('group', { name: 'CSE-2003 details' })).getByText('Not paid: send them to the CSE desk')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open CSE-2002' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'CSE-2002 details' })).getByRole('button', { name: 'Add to Hackathon' }));
    await waitFor(async () => expect((await sync(h, coordinator.token)).find((item) => item.id === 'CSE-2002')?.events.map((entry) => entry.eventId)).toEqual(['cse-hackathon']));

    // Winners are found in the event's own participants marked present: CSE-2002 joined but is not present.
    const winners = screen.getByRole('region', { name: 'Winners' });
    fireEvent.change(within(winners).getByLabelText('Find the 1st place winner'), { target: { value: 'cse 2002' } });
    expect(within(winners).getByText(/Nobody present in this event matches/)).toBeInTheDocument();
    fireEvent.change(within(winners).getByLabelText('Find the 1st place winner'), { target: { value: 'kavin' } });
    fireEvent.click(within(winners).getByRole('button', { name: 'CSE-2001 Kavin R' }));
    // A row for the student; placed once, they are no longer offered for another place.
    expect(within(winners).getByRole('button', { name: 'Remove CSE-2001 from the 1st place' })).toBeInTheDocument();
    fireEvent.change(within(winners).getByLabelText('Find the 2nd place winner'), { target: { value: 'kavin' } });
    expect(within(winners).getByText(/Nobody present in this event matches/)).toBeInTheDocument();
    fireEvent.click(within(winners).getByRole('button', { name: 'Submit results' }));
    await waitFor(async () => {
      const result = (await h.call('POST', '/api/admin/fest/sync', {}, { token: coordinator.token })).body.results[0];
      expect(result).toMatchObject({ eventId: 'cse-hackathon', places: [{ place: 1, ids: ['CSE-2001'] }], submitted: { by: 'cse-hack1' } });
    });
    expect(await within(winners).findByRole('cell', { name: 'Kavin R' })).toBeInTheDocument();
  });

  it('makes a team once (its name and members); in Winners, typing the team’s name adds every member marked present', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hack1', { department: 'CSE' });
    const names = ['Kavin R', 'Asha K', 'Divya S', 'Ravi T'];
    for (const [index, name] of names.entries()) {
      const id = await onPhone(h, 'CSE', index + 1, { name });
      await collect(h, desk.token, id);
      const path = `/api/admin/fest/registrations/${id}/events/cse-hackathon`;
      await h.call('POST', path, { action: 'add' }, { token: coordinator.token });
      await h.call('POST', path, { action: 'fee', payment: { method: 'CASH', confirmed: true } }, { token: coordinator.token });
      // Ravi T (CSE-2004) joined but is not marked present.
      if (name !== 'Ravi T') await h.call('POST', path, { action: 'present' }, { token: coordinator.token });
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend(h);
    signIn(coordinator.token);
    render(<AdminApp />);

    // Teams: a name, then the members, found by ID or name among this event's participants.
    const teams = await screen.findByRole('region', { name: 'Teams' }, { timeout: 5000 });
    const make = within(teams).getByRole('form', { name: 'Make a team' });
    fireEvent.change(within(make).getByLabelText('Team name'), { target: { value: 'Nova' } });
    for (const [query, button] of [
      ['kavin', 'CSE-2001 Kavin R'],
      ['cse 2002', 'CSE-2002 Asha K'],
      ['ravi', 'CSE-2004 Ravi T'],
    ]) {
      fireEvent.change(within(make).getByLabelText(/^Add (a|another) member$/), { target: { value: query } });
      fireEvent.click(await within(make).findByRole('button', { name: button }));
      // One student alone is no team.
      if (button === 'CSE-2001 Kavin R') expect(within(make).getByRole('button', { name: 'Make team Nova (1)' })).toBeDisabled();
    }
    fireEvent.click(within(make).getByRole('button', { name: 'Make team Nova (3)' }));
    const nova = await within(teams).findByRole('article', { name: 'Team Nova' });
    expect(within(nova).getByText('3 of up to 4')).toBeInTheDocument();
    await waitFor(async () =>
      expect(
        (await sync(h, coordinator.token))
          .filter((item) => item.events[0]?.team === 'Nova')
          .map((item) => item.id)
          .sort(),
      ).toEqual(['CSE-2001', 'CSE-2002', 'CSE-2004']),
    );
    // The same name again is refused: they are added to the team that has it.
    fireEvent.change(within(make).getByLabelText('Team name'), { target: { value: 'nova' } });
    expect(within(make).getByText('Team Nova already exists: add members to it below.')).toBeInTheDocument();

    // Winners: the team's name shows every member; the one not present is left out.
    const winners = screen.getByRole('region', { name: 'Winners' });
    fireEvent.change(within(winners).getByLabelText('Find the 1st place winner'), { target: { value: 'nov' } });
    const pick = within(winners).getByRole('button', { name: 'Team Nova: add its members' });
    expect(pick).toHaveTextContent('CSE-2001 Kavin R · CSE-2002 Asha K');
    expect(pick).toHaveTextContent('Not marked present, left out: CSE-2004 Ravi T');
    fireEvent.click(pick);
    expect(within(winners).getByRole('button', { name: 'Remove CSE-2001 from the 1st place' })).toBeInTheDocument();
    expect(within(winners).getByRole('button', { name: 'Remove CSE-2002 from the 1st place' })).toBeInTheDocument();
    expect(within(winners).getByLabelText('Team name (optional, on the certificates)')).toHaveValue('Nova');
    // Teams are optional: Divya S (CSE-2003, in no team) wins 2nd on her own, with no team name.
    fireEvent.change(within(winners).getByLabelText('Find the 2nd place winner'), { target: { value: 'divya' } });
    fireEvent.click(within(winners).getByRole('button', { name: 'CSE-2003 Divya S' }));
    expect(within(winners).getAllByLabelText('Team name (optional, on the certificates)')[1]).toHaveValue('');
    fireEvent.click(within(winners).getByRole('button', { name: 'Submit results' }));
    await waitFor(async () => {
      const result = (await h.call('POST', '/api/admin/fest/sync', {}, { token: coordinator.token })).body.results[0];
      expect(result).toMatchObject({
        places: [
          { place: 1, ids: ['CSE-2001', 'CSE-2002'], team: 'Nova' },
          { place: 2, ids: ['CSE-2003'] },
        ],
        submitted: { by: 'cse-hack1' },
      });
      expect(result.places[1].team).toBeUndefined();
    });
    // A row per student: the team's name on its members' rows, "Individual" for her.
    const rows = (await within(winners).findAllByRole('row')).slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['Nova', 'CSE-2001', 'Kavin R', 'Sona College of Technology, Salem (2615)'],
      ['Nova', 'CSE-2002', 'Asha K', 'Sona College of Technology, Salem (2615)'],
      ['Individual', 'CSE-2003', 'Divya S', 'Sona College of Technology, Salem (2615)'],
    ]);
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
    const cse = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const it_ = await h.staff('DESK', [], 'it-desk1', { department: 'IT', deskNumber: 1 });
    // (Each UPI payment has its own transaction ID: one is accepted once across the fest.)
    await collect(h, cse.token, await onPhone(h, 'CSE', 1), { method: 'UPI', txn: '412345678911', confirmed: true });
    await collect(h, cse.token, await onPhone(h, 'CSE', 2), { method: 'UPI', txn: '412345678922', confirmed: true });
    await collect(h, it_.token, await onPhone(h, 'IT', 3), { method: 'UPI', txn: '412345678933', confirmed: true });
    const overall = await h.staff('OVERALL');
    backend(h);
    signIn(overall.token);
    render(<AdminApp />);
    const registered = async () => (await screen.findByText('Students registered', { selector: '.fest-stat__label' })).parentElement!;
    await waitFor(async () => expect(await registered()).toHaveTextContent('3'));
    expect(screen.getByRole('heading', { name: 'By department' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'IT' } });
    await waitFor(async () => expect((await registered()).querySelector('.fest-stat__value')).toHaveTextContent('1'));
    // Two desks a department, nothing more.
    expect(screen.getByRole('rowheader', { name: 'IT · Desk 2' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'IT · Desk 3' })).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Students' }));
    expect(await screen.findByText('1 student')).toBeInTheDocument();
    expect(screen.getByText('IT-2001')).toBeInTheDocument();
  });

  it('ranks the colleges like a medal table, filters by participations and prizes, and downloads it in that order', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon', 'cse-cyber-hunt'], 'cse-coord', { department: 'CSE' });
    const events = ['cse-hackathon', 'cse-cyber-hunt'];
    const people: Record<string, string[]> = {};
    let n = 0;
    for (const [college, count] of [['DGCT', 3], ['KSR College', 4], ['Sona College', 1]] as const) {
      people[college] = [];
      for (let index = 0; index < count; index += 1) {
        n += 1;
        const id = await onPhone(h, 'CSE', n, { college });
        await collect(h, desk.token, id);
        for (const eventId of events) {
          const path = `/api/admin/fest/registrations/${id}/events/${eventId}`;
          await h.call('POST', path, { action: 'add' }, { token: coordinator.token });
          await h.call('POST', path, { action: 'fee', payment: { method: 'CASH', confirmed: true } }, { token: coordinator.token });
          await h.call('POST', path, { action: 'present' }, { token: coordinator.token });
        }
        people[college].push(id);
      }
    }
    const submit = (eventId: string, places: [number, string][]) =>
      h.call('POST', `/api/admin/fest/events/${eventId}/results`, { action: 'submit', places: places.map(([place, id]) => ({ place, ids: [id] })) }, { token: coordinator.token });
    // DGCT: two 1st places; KSR: one 1st, more students; Sona: one 2nd.
    await submit('cse-hackathon', [[1, people.DGCT[0]], [2, people['Sona College'][0]], [3, people['KSR College'][0]]]);
    await submit('cse-cyber-hunt', [[1, people.DGCT[1]], [2, people['KSR College'][1]]]);

    const files = downloads();
    const overall = await h.staff('OVERALL');
    backend(h);
    signIn(overall.token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Results' }));
    fireEvent.click(await screen.findByRole('button', { name: 'College ranking' }));
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(4));
    const rows = () => within(table).getAllByRole('row').slice(1).map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
    // Rank, college, code, students, participations, 1st, 2nd, 3rd, total prizes.
    expect(rows().map((row) => row.filter((_, index) => index !== 2))).toEqual([
      ['1', 'DGCT', '3', '6', '2', '0', '0', '2'],
      ['2', 'KSR College', '4', '8', '0', '1', '1', '2'],
      ['3', 'Sona College', '1', '2', '0', '1', '0', '1'],
    ]);
    // Only colleges with at least 2 prizes, then at least 7 participations.
    fireEvent.change(screen.getByLabelText('Prizes won (at least)'), { target: { value: '2' } });
    await waitFor(() => expect(rows().map((row) => row[1])).toEqual(['DGCT', 'KSR College']));
    fireEvent.change(screen.getByLabelText('Event participations (at least)'), { target: { value: '7' } });
    await waitFor(() => expect(rows().map((row) => row[1])).toEqual(['KSR College']));
    fireEvent.change(screen.getByLabelText('Event participations (at least)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Prizes won (at least)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download (Excel)' }));
    const sheet = await xlsxText(files.at(-1)!);
    expect(sheet.indexOf('DGCT')).toBeLessThan(sheet.indexOf('KSR College'));
    expect(sheet.indexOf('KSR College')).toBeLessThan(sheet.indexOf('Sona College'));
  });
});

describe('deleting the test data', () => {
  it('takes the deleted test registrations off every open phone at its next update', async () => {
    const h = setup({ at: TIMES.eventDay });
    await onPhone(h, 'CSE', 1, { name: 'Real Student' });
    await h.asOwner('POST', '/api/admin/testing/session', { action: 'start', label: 'Rehearsal' });
    await onPhone(h, 'CSE', 2, { name: 'Test Student' });
    const overall = await h.staff('OVERALL');
    backend(h);
    signIn(overall.token);
    render(<AdminApp />);
    const registered = async () => (await screen.findByText('Students registered', { selector: '.fest-stat__label' })).parentElement!;
    await waitFor(async () => expect((await registered()).querySelector('.fest-stat__value')).toHaveTextContent('2'));

    // Deleted elsewhere (e.g. from the Testing panel on another device): gone here at the next update.
    expect((await h.asOwner('POST', '/api/admin/fest/test-data/clear', {})).body).toMatchObject({ cleared: 1, remaining: 0 });
    h.setTime(new Date(Date.parse(TIMES.eventDay) + 60_000).toISOString());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Refresh|Updating/ })));
    await waitFor(async () => expect((await registered()).querySelector('.fest-stat__value')).toHaveTextContent('1'));
  });
});

describe('a department admin', () => {
  it('types in an online registration from the form: the next -5001 ID, the entry fee paid online, events added unpaid', async () => {
    const h = setup({ at: TIMES.online });
    const admin = await h.staff('DEPT_ADMIN', [], 'aids-admin', { department: 'AIDS' });
    backend(h);
    signIn(admin.token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Online registrations' }));
    const form = await screen.findByRole('form', { name: 'Type in an online registration' });
    // Nothing typed: told what is missing, nothing added.
    fireEvent.click(within(form).getByRole('button', { name: 'Add and give the ID' }));
    expect(await within(form).findByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^Name with initial/), { target: { value: 'Abi S' } });
    fireEvent.change(within(form).getByLabelText(/^Mobile number/), { target: { value: '96000 00009' } });
    fireEvent.click(within(form).getByRole('button', { name: /^College/ }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Search colleges' }), { target: { value: 'sona' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /^Sona College of Technology, Salem$/ }));
    fireEvent.change(within(form).getByLabelText(/^UTR of the/), { target: { value: '6287 8563 2560' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Cognix (Quiz)' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add and give the ID' }));
    expect(await within(form).findByText('AI&DS-5001')).toBeInTheDocument();
    const [made] = await sync(h, admin.token);
    expect(made).toMatchObject({ id: 'AIDS-5001', source: 'ONLINE', name: 'Abi S', college: 'Sona College of Technology, Salem', entry: { status: 'PAID', payment: { method: 'ONLINE', txn: '628785632560' } } });
    expect(made.events).toEqual([expect.objectContaining({ eventId: 'aids-cognix' })]);
    expect(made.events[0].fee).toBeUndefined();
    // The form is empty for the next one.
    expect(within(form).getByLabelText(/^Name with initial/)).toHaveValue('');
  });

  it('uploads the online form’s CSV: checks it, then imports it with -5001 IDs', async () => {
    const h = setup({ at: TIMES.online });
    const admin = await h.staff('DEPT_ADMIN', [], 'cse-admin', { department: 'CSE' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend(h);
    signIn(admin.token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Online registrations' }));
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

describe('Website controls', () => {
  it('lets the web assist team switch parts off, switch a role’s sign-in off and remove the QR code', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.asOwner('POST', '/api/admin/portal/qr', { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' });
    const token = await h.login();
    backend(h);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    signIn(token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Switches & payment' }));

    const phones = await screen.findByRole('switch', { name: 'Student registration on phones' });
    expect(phones).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(phones);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Student registration on phones' })).toHaveAttribute('aria-checked', 'false'));
    expect((await h.call('GET', '/api/fest/info')).body.selfRegistration).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: 'Registration desks' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Registration desks' })).toHaveAttribute('aria-checked', 'false'));
    expect((await h.asOwner('GET', '/api/admin/portal')).body.portal.logins).toMatchObject({ DESK: false, COORDINATOR: true });

    expect(screen.getByRole('img', { name: 'The UPI QR code students see' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the QR code' }));
    await waitFor(() => expect(screen.getByText('No QR code uploaded')).toBeInTheDocument());
    expect((await h.call('GET', '/api/fest/payment')).body.qr).toBeNull();
  });
});

describe('department logins', () => {
  it('makes every login of a department in one click and saves them in a Word file that works', async () => {
    const h = setup({ at: TIMES.eventDay });
    // An account made by hand earlier gets a new password (and its role is put right).
    await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-desk1', { department: 'CSE' });
    const token = await h.login();
    backend(h);
    const files = downloads();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    signIn(token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Accounts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Department logins' }));
    const chooser = screen.getByRole('group', { name: 'Departments' });
    fireEvent.click(within(chooser).getByRole('button', { name: 'CSE' }));
    fireEvent.click(within(chooser).getByRole('button', { name: 'Non-technical events (view only)' }));
    // CSE: its admin, 2 desks and 6 events; and the shared non-technical login.
    fireEvent.click(screen.getByRole('button', { name: 'Make 10 logins and download the Word file' }));
    const made = await screen.findByRole('region', { name: 'Logins made' }, { timeout: 20_000 });
    expect(within(made).getByRole('heading', { name: 'Logins made (10)' })).toBeInTheDocument();

    const doc = await xlsxText(files.at(-1)!);
    for (const text of ['word/document.xml', 'cse-admin', 'cse-desk1', 'cse-desk2', 'cse-hackathon', 'nontech', 'Non-technical events (view only)', 'landing/cse/admin/?event=cse-hackathon']) expect(doc).toContain(text);

    // The password in the file signs in, with the role the department needs.
    const row = within(made).getByRole('cell', { name: 'cse-desk1' }).closest('tr') as HTMLElement;
    const password = within(row).getAllByRole('cell')[3].textContent!;
    expect(doc).toContain(password);
    const desk = await h.loginAs('cse-desk1', password);
    expect((await h.call('GET', '/api/admin/session', undefined, { token: desk })).body).toMatchObject({ role: 'DESK', department: 'CSE', deskNumber: 1 });
    expect(await h.loginAs('nontech', within(within(made).getByRole('cell', { name: 'nontech' }).closest('tr') as HTMLElement).getAllByRole('cell')[3].textContent!)).toBeTruthy();
  });
});

describe('the gate pass check (non-technical events)', () => {
  it('shows only that screen: type an ID, see whether the entry fee is paid', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await collect(h, desk.token, await onPhone(h, 'CSE', 1, { name: 'Kavin R' }));
    await onPhone(h, 'IT', 2, { name: 'Asha K' });
    const gate = await h.staff('NONTECH', [], 'nontech');
    backend(h);
    signIn(gate.token);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: 'Non-technical events' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
    await screen.findByText('Kavin R');
    fireEvent.change(screen.getByLabelText('Registration ID or name'), { target: { value: 'cse 2001' } });
    expect(await screen.findByText(/Entry fee paid and verified/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Registration ID or name'), { target: { value: 'IT-2001' } });
    expect(await screen.findByText(/send them to the IT registration desk to pay/)).toBeInTheDocument();
    // No phone numbers anywhere.
    expect(document.body.textContent).not.toContain('98400');
  });
});

describe('the web assist console', () => {
  it('opens on Home: pauses and resumes the portal, turns one part back on, backs up now and saves the full copy', async () => {
    const h = setup({ at: TIMES.eventDay });
    const desk = await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await collect(h, desk.token, await onPhone(h, 'CSE', 1, { name: 'Kavin R' }));
    await onPhone(h, 'CSE', 2, { name: 'Asha K', utr: '612345678901' });
    const token = await h.login();
    backend(h);
    const files = downloads();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    signIn(token);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: 'Web assist console' })).toBeInTheDocument();
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    // A payment waits for a desk: Home says so.
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(await within(attention).findByText(/1 payment sent by students, waiting for a desk to check/)).toBeInTheDocument();

    const off = screen.getByRole('region', { name: 'Switched off right now' });
    await within(off).findByText(/Every part of the portal is on/);
    fireEvent.click(screen.getByRole('button', { name: 'Pause everything' }));
    expect(await within(off).findByText('Student registration on phones')).toBeInTheDocument();
    expect((await h.call('GET', '/api/fest/info')).body.selfRegistration).toBe(false);
    fireEvent.click(within(off).getAllByRole('button', { name: 'Turn on' })[0]);
    await waitFor(() => expect(within(off).queryByText('Student registration on phones')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Resume everything' }));
    expect(await within(off).findByText(/Every part of the portal is on/)).toBeInTheDocument();

    const controls = screen.getByRole('region', { name: 'Emergency controls' });
    fireEvent.click(within(controls).getByRole('button', { name: 'Back up now' }));
    expect(await within(controls).findByText('Backed up just now.')).toBeInTheDocument();
    fireEvent.click(within(controls).getByRole('button', { name: 'Download a full copy (Excel)' }));
    const sheet = await xlsxText(files.at(-1)!);
    for (const text of ['Students', 'Winners', 'College ranking', 'Money', 'Kavin R', 'Asha K', 'TO CHECK']) expect(sheet).toContain(text);
  });
});

describe('the event window and the department rule', () => {
  it('shows only the event’s department students; Website controls has no switch to open events to everyone', async () => {
    const h = setup({ at: TIMES.eventDay });
    await onPhone(h, 'AIDS', 0, { name: 'Student A' });
    await onPhone(h, 'CSE', 1, { name: 'Student B' });
    const coordinator = await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    backend(h);
    signIn(coordinator.token);
    const first = render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'All CSE students (1)' }, { timeout: 5000 }));
    fireEvent.change(screen.getByLabelText('Find a student'), { target: { value: 'student' } });
    expect(screen.getByText('CSE-2001')).toBeInTheDocument();
    expect(screen.queryByText('AI&DS-2001')).toBeNull();
    fireEvent.change(screen.getByLabelText('Find a student'), { target: { value: 'aids 1' } });
    expect(screen.getByText(/A student of another department takes part in their own department’s events/)).toBeInTheDocument();
    first.unmount();

    signIn(await h.login());
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Switches & payment' }));
    expect(await screen.findByRole('switch', { name: 'Event entry at the venues' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /own department’s events/ })).toBeNull();
  });
});

describe('the load test button', () => {
  it('adds up to 1,000 mock participants, and adds nothing more once there are 1,000', async () => {
    const h = setup({ at: TIMES.eventDay });
    const token = await h.login();
    backend(h);
    signIn(token);
    render(<AdminApp />);
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Testing' }));
    const card = await screen.findByRole('region', { name: 'Load test' });
    fireEvent.click(within(card).getByRole('button', { name: 'Add 1,000 mock participants' }));
    expect(await within(card).findByText(/Added 1000\. 1000 test participants now/, undefined, { timeout: 30_000 })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Add 1,000 mock participants' }));
    expect(await within(card).findByText(/Nothing added: 1000 test participants now/, undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect((await h.asOwner('POST', '/api/admin/fest/sync', {})).body.registrations).toHaveLength(1000);
  });
});
