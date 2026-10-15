/**
 * Accounts (the real API with in-memory stores): each login is made by hand and works at once;
 * Copy copies exactly the password; "Check a password" says whether a password is right without
 * signing in; refused sign-ins are listed with why; the owner deletes every staff account. The old
 * bulk creator (and its "new passwords for every account") is gone.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../server/http';
import { STAFF_PASSWORD, TIMES, setup } from '../../server/testing';
import { AdminApp } from './AdminApp';

type Harness = ReturnType<typeof setup>;

vi.setConfig({ testTimeout: 60_000 });

function backend(h: Harness) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const answer = await route(
      { method: init?.method ?? 'GET', path: new URL(String(input), 'http://localhost').pathname, headers, body: typeof init?.body === 'string' ? init.body : null, ip: '10.0.0.6' },
      h.service,
      () => {},
    );
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  });
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openAccounts(h: Harness) {
  const token = await h.login();
  backend(h);
  sessionStorage.setItem('pragya-admin-session', token);
  render(<AdminApp />);
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Accounts' }));
  await screen.findByRole('heading', { name: 'New staff account' });
}
const card = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement;

describe('Accounts', () => {
  it('makes a login by hand, shows it once with Copy, and the login works at once', async () => {
    const h = setup({ at: TIMES.eventDay });
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async (text: string) => void copied.push(text)) }, configurable: true });
    await openAccounts(h);
    // No bulk creator any more.
    expect(screen.queryByRole('heading', { name: 'Create a department’s accounts' })).toBeNull();

    const form = card('New staff account');
    fireEvent.change(within(form).getByLabelText('Username'), { target: { value: 'CSE-DeskX' } });
    fireEvent.change(within(form).getByLabelText('Name (who gets this login)'), { target: { value: 'CSE Desk X' } });
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'DESK' } });
    fireEvent.change(within(form).getByLabelText('Department'), { target: { value: 'CSE' } });
    const password = within(form).getByLabelText('Password (at least 14 characters)') as HTMLInputElement;
    // A phone keyboard cannot change it.
    expect(password).toHaveAttribute('autocapitalize', 'none');
    expect(password).toHaveAttribute('autocorrect', 'off');
    expect(password).toHaveAttribute('spellcheck', 'false');
    fireEvent.click(within(form).getByRole('button', { name: 'Generate' }));
    const generated = password.value;
    expect(generated).toMatch(/^[A-Za-z0-9]{7}-[A-Za-z0-9]{7}-9$/);
    fireEvent.click(within(form).getByRole('button', { name: 'Create account' }));

    const note = await within(form).findByRole('status');
    expect(note).toHaveTextContent('cse-deskx');
    expect(note).toHaveTextContent(generated);
    await act(async () => fireEvent.click(within(note).getAllByRole('button', { name: 'Copy' })[1]));
    expect(copied).toEqual([generated]);
    await act(async () => fireEvent.click(within(note).getByRole('button', { name: 'Copy both' })));
    expect(copied[1]).toBe(`Username: cse-deskx\nPassword: ${generated}`);
    // Signs in at once (on any department page: the same API), with what was copied.
    expect((await h.call('POST', '/api/admin/login', { username: 'cse-deskx', password: copied[0] }, { ip: '10.0.9.1' })).status).toBe(200);
  });

  it('checks a password without signing in, and lists refused sign-ins with why', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.staff('COORDINATOR', ['cse-hackathon'], 'cse-hackathon', { department: 'CSE' });
    await h.call('POST', '/api/admin/login', { username: 'cse-hackathon', password: 'Event-Day-Staff-2025' }, { ip: '10.0.9.4' });
    await openAccounts(h);
    fireEvent.click(screen.getByRole('button', { name: 'Sign-in problems' }));

    const checker = (await screen.findByRole('heading', { name: 'Check a password' })).closest('section') as HTMLElement;
    fireEvent.change(within(checker).getByLabelText('Username'), { target: { value: 'cse-hackathon' } });
    fireEvent.change(within(checker).getByLabelText('Password'), { target: { value: 'Event-Day-Staff-2025' } });
    fireEvent.click(within(checker).getByRole('button', { name: 'Check' }));
    expect(await within(checker).findByText(/That is not cse-hackathon's password/)).toBeInTheDocument();
    fireEvent.change(within(checker).getByLabelText('Password'), { target: { value: STAFF_PASSWORD } });
    fireEvent.click(within(checker).getByRole('button', { name: 'Check' }));
    expect(await within(checker).findByText(/The password is right and cse-hackathon can sign in/)).toBeInTheDocument();

    const failures = await screen.findByRole('heading', { name: /Recent failed sign-ins \(1\)/ });
    const table = failures.closest('section') as HTMLElement;
    expect(within(table).getByText('cse-hackathon')).toBeInTheDocument();
    expect(within(table).getByText('Wrong password')).toBeInTheDocument();
  });

  it('lets the owner delete every staff account after typing the confirmation', async () => {
    const h = setup({ at: TIMES.eventDay });
    await h.staff('DESK', [], 'cse-desk1', { department: 'CSE', deskNumber: 1 });
    await h.staff('DEPT_ADMIN', [], 'cse-admin', { department: 'CSE' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openAccounts(h);
    const danger = card('Delete every staff account');
    const button = await within(danger).findByRole('button', { name: 'Delete all 2 accounts' });
    expect(button).toBeDisabled();
    fireEvent.change(within(danger).getByLabelText('Type DELETE ALL'), { target: { value: 'DELETE ALL' } });
    await act(async () => fireEvent.click(button));
    expect(await within(danger).findByText(/Deleted 2 accounts/)).toBeInTheDocument();
    await waitFor(async () => expect((await h.asOwner('GET', '/api/admin/staff')).body.staff).toEqual([]));
  });
});
