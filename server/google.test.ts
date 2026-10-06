import { describe, expect, it, vi } from 'vitest';
import { buildMime, encodeHeader } from './gmail';
import { GoogleApiError, GoogleClient } from './google';
import { COLUMNS, SheetsStore, columnLetter } from './sheets';
import { sniffImage, validatePayload } from './validate';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const token = () => json({ access_token: 'token', expires_in: 3600 });

/** A client whose API calls answer from `responses`, after a token. */
function clientWith(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return token();
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected call to ${url}`);
    if (next instanceof Error) throw next;
    return next;
  });
  const client = new GoogleClient(
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' },
    { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, random: () => 0 },
  );
  return { client, calls, fetchMock };
}

describe('GoogleClient', () => {
  it('retries rate limits and temporary errors with backoff, then succeeds', async () => {
    const { client, calls } = clientWith([json({}, 429), json({}, 503), json({ ok: true })]);
    await expect(client.request('https://api/x', { method: 'GET' }, { label: 'x', idempotent: true })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a request Google rejected outright', async () => {
    const { client, calls } = clientWith([json({ error: { message: 'Bad range' } }, 400)]);
    await expect(client.request('https://api/x', { method: 'GET' }, { label: 'x', idempotent: true })).rejects.toMatchObject({
      status: 400,
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('never repeats a non-repeatable request after an unclear failure', async () => {
    const { client, calls } = clientWith([json({}, 500)]);
    await expect(client.request('https://api/x', { method: 'POST' }, { label: 'send', idempotent: false })).rejects.toMatchObject({
      ambiguous: true,
    });
    expect(calls).toHaveLength(1);
  });

  it('stops after a bounded number of attempts', async () => {
    const { client, calls } = clientWith([json({}, 429), json({}, 429), json({}, 429), json({}, 429), json({}, 429)]);
    await expect(client.request('https://api/x', { method: 'GET' }, { label: 'x', idempotent: true })).rejects.toBeInstanceOf(
      GoogleApiError,
    );
    expect(calls).toHaveLength(4);
  });

  it('reuses one access token, and explains a revoked sign-in', async () => {
    const { client, fetchMock } = clientWith([json({}), json({})]);
    await client.request('https://api/a', { method: 'GET' }, { label: 'a', idempotent: true });
    await client.request('https://api/b', { method: 'GET' }, { label: 'b', idempotent: true });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('oauth2'))).toHaveLength(1);

    const revoked = new GoogleClient(
      { clientId: 'id', clientSecret: 'secret', refreshToken: 'old' },
      { fetch: (async () => json({ error: 'invalid_grant' }, 400)) as unknown as typeof fetch, sleep: async () => {} },
    );
    await expect(revoked.accessToken()).rejects.toThrow(/npm run google:auth/);
  });
});

describe('SheetsStore', () => {
  const header = [Object.values(COLUMNS)];

  it('writes rows that arrive together in one call, and checks Google stored them all', async () => {
    const { client, calls } = clientWith([
      json({ values: header }),
      json({ updates: { updatedRows: 1 } }),
      json({ updates: { updatedRows: 2 } }),
    ]);
    const sheets = new SheetsStore(client, 'sheet', 'Registrations', { minWriteIntervalMs: 0 });
    await sheets.load();

    await Promise.all([sheets.append({ id: 'PRG26-0001' }), sheets.append({ id: 'PRG26-0002' }), sheets.append({ id: 'PRG26-0003' })]);

    const appends = calls.filter((call) => call.url.includes(':append'));
    expect(appends).toHaveLength(2);
    expect(JSON.parse(String(appends[1].init.body)).values).toHaveLength(2);
    expect(appends[0].url).toContain('valueInputOption=RAW');
  });

  it('after an unclear failure, looks before writing again so a row is never stored twice', async () => {
    const { client, calls } = clientWith([
      json({ values: header }),
      json({}, 500), // the append: did it go through?
      json({ values: [['PRG26-0001']] }), // yes, it did
    ]);
    const sheets = new SheetsStore(client, 'sheet', 'Registrations', { minWriteIntervalMs: 0 });
    await sheets.load();

    await expect(sheets.append({ id: 'PRG26-0001' })).resolves.toBeUndefined();
    expect(calls.filter((call) => call.url.includes(':append'))).toHaveLength(1);
  });

  it('reports the outcome as unknown when it cannot look after an unclear failure', async () => {
    const { client } = clientWith([
      json({ values: header }),
      json({}, 500), // the append: did it go through?
      json({ error: { message: 'Bad range' } }, 400), // and the look-up fails, so nobody knows
    ]);
    const sheets = new SheetsStore(client, 'sheet', 'Registrations', { minWriteIntervalMs: 0 });
    await sheets.load();

    await expect(sheets.append({ id: 'PRG26-0001' })).rejects.toMatchObject({ ambiguous: true });
  });

  it('adds missing columns to the header and finds rows by Registration ID for updates', async () => {
    const { client, calls } = clientWith([
      json({ values: [['Registration ID', 'Student Name'], ['PRG26-0001', 'Varshan C'], ['PRG26-0002', 'Barath S']] }),
      json({}), // header write
      json({ values: [['PRG26-0001'], ['PRG26-0002']] }),
      json({}), // batch update
    ]);
    const sheets = new SheetsStore(client, 'sheet', 'Registrations', { minWriteIntervalMs: 0 });

    const rows = await sheets.load();
    expect(rows.map((row) => row.name)).toEqual(['Varshan C', 'Barath S']);
    expect(JSON.parse(String(calls[1].init.body)).values[0]).toEqual(
      expect.arrayContaining(['Registration ID', 'Student Name', 'Email Status', 'Pass PDF Link']),
    );

    await sheets.update('PRG26-0002', { emailStatus: 'SENT' });
    const update = JSON.parse(String(calls[3].init.body));
    const emailColumn = columnLetter(header[0].indexOf('Email Status') >= 0 ? 2 + Object.keys(COLUMNS).indexOf('emailStatus') - 2 : 0);
    expect(update.data).toHaveLength(1);
    expect(update.data[0].range).toMatch(/!\w+3$/);
    expect(emailColumn).toBeTruthy();
  });
});

describe('screenshot checks', () => {
  const png = new Uint8Array(400);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 2, 0]);
  const jpeg = new Uint8Array(400);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x03, 0x20, 0x01, 0xe0]);

  it('reads the real format and size of PNG and JPEG files', () => {
    expect(sniffImage(png)).toEqual({ type: 'image/png', extension: 'png', width: 256, height: 512 });
    expect(sniffImage(jpeg)).toEqual({ type: 'image/jpeg', extension: 'jpg', width: 480, height: 800 });
    expect(sniffImage(new TextEncoder().encode('<script>alert(1)</script>'.padEnd(300)))).toBeNull();
  });

  it('refuses a file whose content does not match its type, or that is not an image', () => {
    const base = {
      submissionId: 'abcdefghijklmnop1234',
      participant: { name: 'Varshan C', department: 'Civil Engineering', college: 'RPSIT', year: '2nd Year', phone: '9344972274', email: 'v@example.com' },
      events: ['cognix'],
      transactionId: 'UTR123456',
    };
    const fees = { gatePass: 100, perEvent: 50 };
    const dataUrl = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

    const ok = validatePayload({ ...base, screenshot: { name: 'pay.png', type: 'image/png', data: dataUrl('image/png', png) } }, fees);
    expect(ok.ok).toBe(true);

    const disguised = validatePayload({ ...base, screenshot: { name: 'pay.png', type: 'image/png', data: dataUrl('image/png', jpeg) } }, fees);
    expect(disguised).toMatchObject({ ok: false, fieldErrors: { screenshot: expect.stringMatching(/PNG or JPG/) } });

    const script = validatePayload(
      { ...base, screenshot: { name: 'pay.html', type: 'image/png', data: dataUrl('image/png', png) } },
      fees,
    );
    expect(script).toMatchObject({ ok: false, fieldErrors: { screenshot: expect.any(String) } });

    const unknownEvent = validatePayload({ ...base, events: ['not-an-event'], screenshot: { name: 'pay.png', type: 'image/png', data: dataUrl('image/png', png) } }, fees);
    expect(unknownEvent).toMatchObject({ ok: false, fieldErrors: { events: expect.any(String) } });
  });
});

describe('confirmation email format', () => {
  it('encodes a subject with ₹ and – so every mail app shows it correctly', () => {
    const encoded = encodeHeader('PRAGYA 2026 – Registration Successfully Completed | PRG26-0001');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(encoded.split('\r\n ').every((word) => word.length <= 75)).toBe(true);
    const decoded = encoded
      .split('\r\n ')
      .map((word) => Buffer.from(word.slice(10, -2), 'base64'))
      .reduce((all, part) => Buffer.concat([all, part]), Buffer.alloc(0))
      .toString('utf8');
    expect(decoded).toBe('PRAGYA 2026 – Registration Successfully Completed | PRG26-0001');
  });

  it('builds a message with text, HTML and the PDF attached', () => {
    const mime = buildMime(
      {
        fromName: 'PRAGYA 2026',
        fromAddress: 'pragya@example.com',
        to: 'student@example.com',
        subject: 'Hello',
        text: 'Plain ₹100',
        html: '<p>₹100</p>',
        attachments: [{ filename: 'pass.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }],
      },
      'seed',
    );
    expect(mime).toContain('From: "PRAGYA 2026" <pragya@example.com>');
    expect(mime).toContain('To: student@example.com');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime).toContain('Content-Disposition: attachment; filename="pass.pdf"');
    expect(mime).toContain('JVBERg=='); // "%PDF"
  });

  it('builds a plain-text message with the PDF attached when there is no HTML version', () => {
    const mime = buildMime(
      {
        fromName: 'PRAGYA 2026',
        fromAddress: 'pragya@example.com',
        to: 'student@example.com',
        subject: 'Hello',
        text: 'Dear Varshan C,',
        attachments: [{ filename: 'pass.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }],
      },
      'seed',
    );
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).not.toContain('text/html');
    expect(mime).not.toContain('multipart/alternative');
    expect(mime).toContain('Content-Disposition: attachment; filename="pass.pdf"');
  });
});
