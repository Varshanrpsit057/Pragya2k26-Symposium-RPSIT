/**
 * The students' page against the real API (server/http.ts with in-memory stores): register on
 * the phone (stream and department from searchable lists), see the ID at once, then pay by UPI
 * here (the QR code and the UTR) or at the desk; the desk verifies, the page says so. "My
 * registration ID" on another phone finds it by mobile number and email.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../server/http';
import { TIMES, setup } from '../../server/testing';
import { RegisterApp } from './RegisterApp';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

/** A 1×1 PNG, as the dashboard uploads it. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function backend(h: Harness) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const answer = await route(
      { method: init?.method ?? 'GET', path: new URL(String(input), 'http://localhost').pathname, headers, body: typeof init?.body === 'string' ? init.body : null, ip: '10.0.0.9' },
      h.service,
      () => {},
    );
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  });
}

afterEach(() => {
  // The page keeps the chosen department in the address (?dept=…): start each test without it.
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Opens a searchable list and chooses an option by typing part of it. */
async function pick(label: string, search: string, option: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
  fireEvent.change(screen.getByRole('combobox', { name: `Search ${label.toLowerCase()}s` }), { target: { value: search } });
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

/** Chooses AI&DS (the first step), then fills in the details. */
async function fill() {
  fireEvent.click(await screen.findByRole('button', { name: /^AI&DS/ }));
  fireEvent.change(await screen.findByLabelText('Name with initial'), { target: { value: 'Meena K' } });
  fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '97900 11122' } });
  fireEvent.change(screen.getByLabelText('College'), { target: { value: 'Sona College of Technology' } });
  await pick('Stream', 'b.e', /^B\.E\.$/);
  await pick('Department', 'cse', /\(CSE\)$/);
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: '3rd Year' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'meena.k@example.com' } });
}

describe('a student on their phone', () => {
  it('chooses the stream and the department from searchable lists, and must give the year and the email', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    render(<RegisterApp />);
    expect(await screen.findByText('On-site Registration Portal · R P Sarathy Institute of Technology')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^AI&DS/ }));
    await screen.findByLabelText('Name with initial');
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText('Choose your stream.')).toBeInTheDocument();
    expect(screen.getByText('Choose your department.')).toBeInTheDocument();
    expect(screen.getByText('Choose your year.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();

    // The department list searches as the student types; "Other" lets them type their own.
    fireEvent.click(screen.getByRole('button', { name: /^Department/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search departments' }), { target: { value: 'mech' } });
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toBe('Mechanical Engineering (MECH)');
    expect(options).not.toContain('Civil Engineering');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search departments' }), { target: { value: 'other' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Other' }));
    expect(screen.getByLabelText(/^Your department/)).toBeInTheDocument();
  });

  it('chooses the department first (all 8), then registers without choosing events (they register at each venue)', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    render(<RegisterApp />);
    expect(await screen.findByRole('heading', { name: 'Choose your department' })).toBeInTheDocument();
    for (const code of ['CSE', 'AI&DS', 'IT', 'ECE', 'CYBER', 'EEE', 'MECH', 'S&H']) expect(screen.getByRole('button', { name: new RegExp(`^${code}`) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^CYBER/ }));
    await screen.findByLabelText('Name with initial');
    expect(document.querySelector('.reg-chosen')).toHaveTextContent('Department CYBER · Computer Science and Engineering (Cyber Security)');
    expect(screen.queryByText('Events (optional)')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('opens on the department chosen in the home page’s pop-up (/register/?dept=MECH)', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    window.history.pushState({}, '', '/register/?dept=mech');
    render(<RegisterApp />);
    await screen.findByLabelText('Name with initial');
    expect(document.querySelector('.reg-chosen')).toHaveTextContent('Department MECH · Mechanical Engineering');
  });

  it('registers, sees the ID at once, pays by UPI with the QR code and sends the UTR; the desk verifies it', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.asOwner('POST', '/api/admin/portal/qr', { image: PNG });
    backend(h);
    const first = render(<RegisterApp />);
    await fill();
    expect(screen.getByText(/After you register, pay it here by UPI/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('AI&DS-2001')).toBeInTheDocument();
    expect(await screen.findByText('Entry fee not paid yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How will you pay the ₹100 entry fee?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Pay now by UPI/ }));
    expect(await screen.findByRole('img', { name: /UPI QR code/ })).toHaveAttribute('src', PNG);
    expect(screen.getByRole('link', { name: 'Open a UPI app on this phone' }).getAttribute('href')).toMatch(/^upi:\/\/pay\?pa=.+&am=100&cu=INR&tn=AIDS-2001$/);

    // The UTR is needed (12 digits) before it can be sent.
    const send = screen.getByRole('button', { name: 'I have paid · send the UTR' });
    fireEvent.change(screen.getByLabelText(/^UPI reference number/), { target: { value: '4123 4567' } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^UPI reference number/), { target: { value: '4123 4567 8901' } });
    await act(async () => fireEvent.click(send));
    expect(await screen.findByText('Payment sent · desk to check')).toBeInTheDocument();
    expect(screen.getByText(/UTR ending 8901/)).toBeInTheDocument();

    // Closed and opened again: the ID is still there; the desk matched the UTR meanwhile.
    first.unmount();
    const desk = await h.staff('DESK', [], 'aids-desk1', { department: 'AIDS', deskNumber: 1 });
    expect((await h.call('POST', '/api/admin/fest/registrations/AIDS-2001', { action: 'verify', txn: '412345678901', confirmed: true }, { token: desk.token })).status).toBe(200);
    render(<RegisterApp />);
    expect(await screen.findByText('AI&DS-2001')).toBeInTheDocument();
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/You are verified/)).toBeInTheDocument();
  });

  it('may pay in cash at the desk instead (the choice is kept), and sees only the desk while online payment is off', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    const first = render(<RegisterApp />);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Pay at the desk/ }));
    expect(screen.getByText(/Pay the ₹100 entry fee at the AI&DS registration desk/)).toBeInTheDocument();
    first.unmount();
    const again = render(<RegisterApp />);
    expect(await screen.findByText(/Pay the ₹100 entry fee at the AI&DS registration desk/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay by UPI now instead' })).toBeInTheDocument();
    again.unmount();

    await h.asOwner('POST', '/api/admin/portal', { portal: { onlinePayment: false } });
    localStorage.removeItem('techfest-pay-choice');
    render(<RegisterApp />);
    expect(await screen.findByText(/Pay the ₹100 entry fee at the AI&DS registration desk/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay now by UPI/ })).toBeNull();
  });

  it('keeps what was typed when the connection drops, and is told plainly', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    render(<RegisterApp />);
    await fill();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Register' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection');
    expect(screen.getByLabelText('Name with initial')).toHaveValue('Meena K');
    expect(JSON.parse(localStorage.getItem('techfest-draft')!)).toMatchObject({ name: 'Meena K', email: 'meena.k@example.com', stream: 'B.E.' });
  });

  it('is sent to a desk while registration on phones is paused', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.asOwner('POST', '/api/admin/portal', { portal: { selfRegistration: false } });
    backend(h);
    render(<RegisterApp />);
    expect(await screen.findByRole('heading', { name: 'Registration on phones is paused' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^AI&DS/ })).toBeNull();
  });
});

describe('“My registration ID” on another phone', () => {
  it('opens straight on finding it (/register/?my): the mobile number and email, never the ID', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.call('POST', '/api/fest/register', { submissionId: 'self-test-key-0000000000001', dept: 'CSE', participant: { name: 'Divya R', phone: '9840011111', college: 'Sona', branch: 'B.E. CSE', year: '2nd Year', email: 'divya.r@example.com' }, events: [] }, { ip: '10.0.0.8' });
    backend(h);
    window.history.pushState({}, '', '/register/?my');
    render(<RegisterApp />);
    expect(await screen.findByRole('heading', { name: 'Find your registration ID' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Registration ID')).toBeNull();
    expect(screen.queryByLabelText('Name with initial')).toBeNull();

    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98400 11111' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone.else@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my registration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No registration has that mobile number with that email.');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Divya.R@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find my registration' }));
    await waitFor(() => expect(screen.getByText('Divya R')).toBeInTheDocument());
    expect(screen.getByText('CSE-2001')).toBeInTheDocument();
    // Seen on another phone: pay at the desk (UPI here only on the phone that registered).
    expect(await screen.findByText(/open this page on the phone you registered with/)).toBeInTheDocument();
  });

  it('says to ask at a desk while finding is switched off', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.asOwner('POST', '/api/admin/portal', { portal: { studentLookup: false } });
    backend(h);
    window.history.pushState({}, '', '/register/?my');
    render(<RegisterApp />);
    expect(await screen.findByText(/ask at any registration desk with your mobile number/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find my registration' })).toBeNull();
  });
});
