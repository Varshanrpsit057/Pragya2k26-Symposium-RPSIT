/**
 * Creating each department's accounts (the real API with in-memory stores): the logins download
 * as a Word document (and Excel) with their passwords; accounts made earlier get new passwords so
 * their logins can be downloaded again; every department at once.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../server/http';
import { TIMES, setup } from '../../server/testing';
import { AdminApp } from './AdminApp';
import { buildLoginsDoc } from './loginsDoc';

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

/** Catches what the dashboard downloads (saveFile makes a Blob link and clicks it). */
function downloads() {
  const files: Blob[] = [];
  Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (files.push(blob), `blob:${files.length}`)), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return files;
}

/** The password next to a username in the Word document's table (it is stored as plain XML). */
async function passwordIn(file: Blob, username: string) {
  const text = new TextDecoder().decode(await file.arrayBuffer());
  const cells = [...text.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((match) => match[1]);
  return cells[cells.indexOf(username) + 1];
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
  return screen.findByRole('heading', { name: 'Create a department’s accounts' }).then((heading) => heading.closest('section') as HTMLElement);
}

describe('the logins as a Word document', () => {
  it('is a .docx with each department’s table of roles, usernames and passwords', () => {
    const bytes = buildLoginsDoc([{ title: 'CSE · Computer Science and Engineering', signInAt: 'https://pragya2k26.online/landing/cse/admin/', rows: [{ role: 'Event coordinator', for: 'Tom & <Jerry>', username: 'cse-tom', password: 'Abc-Def-9' }] }], 'test');
    const text = new TextDecoder().decode(bytes);
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]); // a zip
    for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/footer1.xml']) expect(text).toContain(part);
    expect(text).toContain('cse-tom');
    expect(text).toContain('Abc-Def-9');
    expect(text).toContain('Tom &amp; &lt;Jerry&gt;');
  });
});

describe('creating a department’s accounts', () => {
  it('downloads the new logins as Word, and gives accounts made earlier new passwords to download again', async () => {
    const h = setup({ at: TIMES.eventDay });
    const files = downloads();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let card = await openAccounts(h);
    fireEvent.change(within(card).getByLabelText('Department'), { target: { value: 'CSE' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Create 9 accounts' }));
    await waitFor(() => expect(within(card).getAllByText('Created')).toHaveLength(9), { timeout: 30_000 });
    fireEvent.click(within(card).getByRole('button', { name: 'Download the logins (Word)' }));
    const first = files.at(-1)!;
    expect(first.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const firstPassword = await passwordIn(first, 'cse-admin');
    expect(firstPassword).toMatch(/^[A-Za-z0-9]{7}-[A-Za-z0-9]{7}-9$/);
    expect((await h.call('POST', '/api/admin/login', { username: 'cse-admin', password: firstPassword }, { ip: '10.0.9.1' })).status).toBe(200);

    // Later (the page opened again): they exist, so their logins cannot be downloaded…
    card = await (async () => {
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Roles' }));
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Accounts' }));
      return (await screen.findByRole('heading', { name: 'Create a department’s accounts' })).closest('section') as HTMLElement;
    })();
    fireEvent.change(within(card).getByLabelText('Department'), { target: { value: 'CSE' } });
    expect(within(card).getAllByText('Already exists')).toHaveLength(9);
    expect(within(card).getByRole('button', { name: 'Download the logins (Word)' })).toBeDisabled();
    // …until they get new passwords: the old one stops working, the new one in the document works.
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'New passwords for the 9 existing accounts' })));
    await waitFor(() => expect(within(card).getAllByText('New password')).toHaveLength(9), { timeout: 30_000 });
    fireEvent.click(within(card).getByRole('button', { name: 'Download the logins (Word)' }));
    const fresh = await passwordIn(files.at(-1)!, 'cse-admin');
    expect(fresh).not.toBe(firstPassword);
    expect((await h.call('POST', '/api/admin/login', { username: 'cse-admin', password: firstPassword }, { ip: '10.0.9.2' })).status).toBe(401);
    expect((await h.call('POST', '/api/admin/login', { username: 'cse-admin', password: fresh }, { ip: '10.0.9.3' })).status).toBe(200);
  });

  it('plans every department at once: 68 accounts', async () => {
    const h = setup({ at: TIMES.eventDay });
    const card = await openAccounts(h);
    fireEvent.change(within(card).getByLabelText('Department'), { target: { value: '*' } });
    expect(within(card).getByRole('button', { name: 'Create 68 accounts' })).toBeInTheDocument();
    expect(within(card).getByText('aids-admin')).toBeInTheDocument();
    expect(within(card).getByText('sh-desk2')).toBeInTheDocument();
  });
});
