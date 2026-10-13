/**
 * The students' page against the real API (server/http.ts with in-memory stores): register on
 * the phone, see the ID at once (and again later), a desk verifies, the page says so.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../server/http';
import { TIMES, setup } from '../../server/testing';
import { RegisterApp } from './RegisterApp';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 30_000 });

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

/** Chooses AI&DS (the first step), then fills in the details. */
async function fill() {
  fireEvent.click(await screen.findByRole('button', { name: /^AI&DS/ }));
  fireEvent.change(await screen.findByLabelText('Name with initial'), { target: { value: 'Meena K' } });
  fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '97900 11122' } });
  fireEvent.change(screen.getByLabelText('College'), { target: { value: 'Sona College of Technology' } });
}

describe('a student on their phone', () => {
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
    try {
      render(<RegisterApp />);
      await screen.findByLabelText('Name with initial');
      expect(document.querySelector('.reg-chosen')).toHaveTextContent('Department MECH · Mechanical Engineering');
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('opens straight on "Your registration" from the home page’s My registration ID (/register/?my)', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    window.history.pushState({}, '', '/register/?my');
    try {
      render(<RegisterApp />);
      expect(await screen.findByRole('heading', { name: 'Your registration' })).toBeInTheDocument();
      expect(screen.getByLabelText('Registration ID')).toBeInTheDocument();
      expect(screen.queryByLabelText('Name with initial')).toBeNull();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('registers, sees the ID and what to do next at once, and still sees it when the page is opened again', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    const first = render(<RegisterApp />);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    // The transaction ID is needed.
    expect(await screen.findByText(/Type the transaction ID \(UTR\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^UPI transaction ID/), { target: { value: '7123 4567 8901' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('AI&DS-2001')).toBeInTheDocument();
    expect(await screen.findByText('Payment not verified yet')).toBeInTheDocument();
    expect(screen.getByText(/Verify your payment at a payment verification desk/)).toBeInTheDocument();
    expect(screen.getByText(/you can register for events at each event’s venue/)).toBeInTheDocument();

    // Closed and opened again: the ID is still there; a desk has verified it meanwhile.
    first.unmount();
    const desk = await h.staff('DESK', [], 'aids-desk1', { department: 'AIDS', deskNumber: 1 });
    await h.call('POST', '/api/admin/fest/registrations/AIDS-2001', { action: 'verify', confirmed: true }, { token: desk.token });
    render(<RegisterApp />);
    expect(await screen.findByText('AI&DS-2001')).toBeInTheDocument();
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/You are verified/)).toBeInTheDocument();
  });

  it('keeps what was typed when the connection drops, and is told plainly', async () => {
    const h = setup({ at: TIMES.eventDay });
    backend(h);
    render(<RegisterApp />);
    await fill();
    fireEvent.change(screen.getByLabelText(/^UPI transaction ID/), { target: { value: '712345678901' } });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Register' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection');
    expect(screen.getByLabelText('Name with initial')).toHaveValue('Meena K');
    expect(JSON.parse(localStorage.getItem('techfest-draft')!)).toMatchObject({ name: 'Meena K', txn: '712345678901' });
  });

  it('finds an earlier registration with its ID and mobile number', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.call('POST', '/api/fest/register', { submissionId: 'self-test-key-0000000000001', dept: 'CSE', participant: { name: 'Divya R', phone: '9840011111', college: 'Sona' }, events: [], txn: '412345678901' }, { ip: '10.0.0.8' });
    backend(h);
    render(<RegisterApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Already registered? See your registration' }));
    fireEvent.change(screen.getByLabelText('Registration ID'), { target: { value: 'cse 2001' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9999999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show my registration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No registration has that ID with that mobile number.');
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98400 11111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show my registration' }));
    await waitFor(() => expect(screen.getByText('Divya R')).toBeInTheDocument());
    expect(screen.getByText('CSE-2001')).toBeInTheDocument();
    // Events are registered at each venue: none to choose here.
    expect(screen.queryByRole('button', { name: 'Add events' })).toBeNull();
  });
});
