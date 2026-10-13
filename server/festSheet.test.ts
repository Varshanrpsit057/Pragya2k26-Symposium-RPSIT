import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATALOG, type FestRegistration, type FestResult } from '../src/lib/fest';
import { FEST_TABS, FestSheetBackup, REGISTRATION_HEADER, RESULT_HEADER, type FestSnapshot } from './festSheet';
import { GoogleClient } from './google';
import { TIMES, setup } from './testing';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A Google client whose API calls answer from `responses` (the sign-in is not counted). */
function googleWith(responses: Response[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'token', expires_in: 3600 });
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected call to ${url}`);
    return next;
  });
  const google = new GoogleClient({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }, { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, random: () => 0 });
  return { google, calls };
}

const settings = () => {
  const values = new Map<string, string>();
  return { getSetting: async (name: string) => values.get(name) ?? null, putSetting: async (name: string, value: string) => void values.set(name, value) };
};

const student = (id: string, extra: Partial<FestRegistration> = {}): FestRegistration => ({
  id,
  dept: id.split('-')[0],
  source: 'SELF',
  name: 'Divya R',
  phone: '9840011111',
  email: 'divya.r@example.com',
  college: 'Sona College of Technology',
  branch: 'B.E. CSE',
  year: '2nd Year',
  team: '',
  entry: { status: 'DUE' },
  events: [{ eventId: 'cse-hackathon', added: { at: '2026-10-17T03:00:00.000Z', by: 'student' } }],
  created: { at: '2026-10-17T03:00:00.000Z', by: 'student' },
  sid: 'private-key-of-the-phone-000000000001',
  v: 1,
  u: '2026-10-17T03:00:00.000Z',
  ...extra,
});

const snapshot = (registrations: FestRegistration[], results: FestResult[] = []): FestSnapshot => ({ at: '2026-10-17T04:00:00.000Z', catalog: DEFAULT_CATALOG, registrations, results });

type Written = { valueInputOption: string; data: { range: string; values: (string | number)[][] }[] };

describe('the fest backup in the Google Sheet', () => {
  it('writes both tabs in one request (RAW, never the phone’s private key), and sends nothing while nothing changed', async () => {
    const { google, calls } = googleWith([json({})]);
    const backup = new FestSheetBackup(google, 'sheet-id', settings());
    const paid = student('CSE-2002', {
      name: '=HYPERLINK("x")',
      entry: { status: 'PAID', payment: { method: 'UPI', amount: 100, txn: '512345678901', at: '2026-10-17T04:00:00.000Z', by: 'cse-desk1', desk: 1 } },
    });
    const result: FestResult = { eventId: 'cse-hackathon', dept: 'CSE', places: [{ place: 1, ids: ['CSE-2002'] }], saved: null, submitted: { at: '2026-10-17T09:00:00.000Z', by: 'cse-hack-1' }, v: 1, u: '' };

    expect(await backup.save(snapshot([paid, student('CSE-2001')], [result]))).toEqual({ written: true, registrations: 2, results: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values:batchUpdate');
    const body = calls[0].body as Written;
    expect(body.valueInputOption).toBe('RAW');
    expect(body.data.map((item) => item.range)).toEqual([`'${FEST_TABS.registrations}'!A1`, `'${FEST_TABS.results}'!A1`]);
    const [registrations, results] = body.data.map((item) => item.values);
    expect(registrations[0]).toEqual(REGISTRATION_HEADER);
    const cell = (row: (string | number)[], column: string) => row[REGISTRATION_HEADER.indexOf(column)];
    // By department and ID; the fee as the desk took it.
    expect(registrations.slice(1).map((row) => cell(row, 'Registration ID'))).toEqual(['CSE-2001', 'CSE-2002']);
    expect(cell(registrations[1], 'Entry fee')).toBe('Due');
    expect(cell(registrations[2], 'Entry fee')).toBe('Paid');
    expect(cell(registrations[2], 'Paid by')).toBe('UPI');
    expect(cell(registrations[2], 'Transaction ID')).toBe('512345678901');
    expect(cell(registrations[2], 'Name')).toBe('=HYPERLINK("x")');
    expect(cell(registrations[1], 'Events')).toMatch(/^CSE · /);
    expect(JSON.stringify(body)).not.toContain('private-key-of-the-phone');
    expect(results[0]).toEqual(RESULT_HEADER);
    expect(results[1].slice(1, 5)).toEqual(['CSE', 'First', 'CSE-2002', '=HYPERLINK("x")']);

    // The same data 10 minutes later: no request at all.
    expect(await backup.save({ ...snapshot([paid, student('CSE-2001')], [result]), at: '2026-10-17T04:10:00.000Z' })).toMatchObject({ written: false });
    expect(calls).toHaveLength(1);
  });

  it('blanks the rows left over when the copy gets shorter (e.g. test data deleted), still in one request', async () => {
    const { google, calls } = googleWith([json({}), json({})]);
    const backup = new FestSheetBackup(google, 'sheet-id', settings());
    await backup.save(snapshot([student('CSE-2001'), student('CSE-2002'), student('CSE-2003')]));
    await backup.save(snapshot([student('CSE-2001')]));
    expect(calls).toHaveLength(2);
    const values = (calls[1].body as Written).data[0].values;
    expect(values).toHaveLength(4);
    expect(values[1][0]).toBe('CSE-2001');
    expect(values.slice(2).every((row) => row.length === REGISTRATION_HEADER.length && row.every((value) => value === ''))).toBe(true);
  });

  it('adds only the missing tab the first time, then writes', async () => {
    const { google, calls } = googleWith([
      json({ error: { message: `Unable to parse range: '${FEST_TABS.results}'!A1` } }, 400),
      json({ sheets: [{ properties: { title: 'Registrations' } }, { properties: { title: FEST_TABS.registrations } }] }),
      json({}),
      json({}),
    ]);
    const backup = new FestSheetBackup(google, 'sheet-id', settings());
    expect(await backup.save(snapshot([student('CSE-2001')]))).toMatchObject({ written: true });
    expect(calls.map((call) => call.url.replace('https://sheets.googleapis.com/v4/spreadsheets/sheet-id', ''))).toEqual(['/values:batchUpdate', '?fields=sheets.properties.title', ':batchUpdate', '/values:batchUpdate']);
    expect(calls[2].body).toEqual({ requests: [{ addSheet: { properties: { title: FEST_TABS.results, gridProperties: { frozenRowCount: 1 } } } }] });
  });

  it('tries again at the next run after a failure (nothing is remembered as written)', async () => {
    const { google, calls } = googleWith([json({ error: { message: 'Backend Error' } }, 500), json({ error: { message: 'Backend Error' } }, 500), json({})]);
    const backup = new FestSheetBackup(google, 'sheet-id', settings());
    await expect(backup.save(snapshot([student('CSE-2001')]))).rejects.toThrow('Sheets: fest backup');
    expect(calls).toHaveLength(2);
    expect(await backup.save(snapshot([student('CSE-2001')]))).toMatchObject({ written: true });
  });
});

describe('the scheduled backup', () => {
  it('keeps the private file even when the Google Sheet copy fails, and says so', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Google is down'));
    const h = setup({ at: TIMES.eventDay, festSheet: { save } });
    expect(await h.service.fest.backup()).toEqual({ registrations: 0, results: 0, file: 'saved', sheet: 'failed' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(h.files.objects.has('backups/fest/all.json')).toBe(true);
  });
});
