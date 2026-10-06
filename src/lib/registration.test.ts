import { describe, expect, it, vi } from 'vitest';
import { events } from '../content/events';
import {
  DEPARTMENTS,
  EMPTY_REGISTRATION,
  NO_EVENTS_MESSAGE,
  OTHER_DEPARTMENT,
  RegistrationError,
  buildRegistrationRecord,
  feeSummary,
  isRegistrationClosed,
  newSubmissionId,
  normalisePhone,
  resolvedDepartment,
  rupees,
  splitDepartment,
  validateField,
  validateRegistration,
  type RegistrationInput,
} from './registration';
import { submitRegistration } from './registrationClient';

const screenshot = new File(['png-bytes'], 'payment.png', { type: 'image/png' });
const fees = { gatePass: 100, perEvent: 50 };
const ids = events.map((event) => event.id);
const AI_DS = 'Artificial Intelligence and Data Science (AI & DS)';

const valid: RegistrationInput = {
  name: 'Barath S',
  department: AI_DS,
  departmentOther: '',
  college: 'R P Sarathy Institute of Technology',
  year: '3rd Year',
  phone: '+91 93449 72274',
  email: 'Barath@Example.com',
  events: ['pro-pitch', 'code-flex', 'short-film'],
  transactionId: '412345678901',
  screenshot,
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, ...init });

const submitOptions = { submissionId: 'a1b2c3d4e5f6a7b8c9d0', retryDelaysMs: [1, 1] };

describe('feeSummary', () => {
  it.each([
    [0, 0, 100],
    [1, 50, 150],
    [2, 100, 200],
    [3, 150, 250],
    [5, 250, 350],
    [10, 500, 600],
  ])('%i events: ₹%i in event fees, ₹%i in total with the gate pass', (count, eventTotal, grandTotal) => {
    expect(feeSummary(ids.slice(0, count), fees)).toEqual({ eventCount: count, eventTotal, grandTotal });
  });

  it('counts an event once even if it appears twice', () => {
    expect(feeSummary(['cognix', 'cognix'], fees).eventCount).toBe(1);
  });

  it('formats rupees with Indian grouping', () => {
    expect(rupees(150)).toBe('₹150');
    expect(rupees(125000)).toBe('₹1,25,000');
  });
});

describe('isRegistrationClosed', () => {
  const closesAt = '2026-10-16T17:00:00'; // IST
  const closesAtMs = Date.parse('2026-10-16T11:30:00Z');

  it('is open until 5 PM IST on the closing day and closed from then on', () => {
    expect(isRegistrationClosed(closesAt, closesAtMs - 1)).toBe(false);
    expect(isRegistrationClosed(closesAt, closesAtMs)).toBe(true);
    expect(isRegistrationClosed(closesAt, closesAtMs + 86_400_000)).toBe(true);
  });

  it('never closes when no closing time is set', () => {
    expect(isRegistrationClosed(null, Date.now())).toBe(false);
  });
});

describe('buildRegistrationRecord', () => {
  it('splits the events by track and works the fee out from the selection', () => {
    const record = buildRegistrationRecord(valid, events, fees);

    expect(record.participant).toEqual({
      name: 'Barath S',
      department: AI_DS,
      college: 'R P Sarathy Institute of Technology',
      year: '3rd Year',
      phone: '9344972274',
      email: 'barath@example.com',
    });
    expect(record.technicalEvents).toEqual(['PRO-PITCH', 'CODE FLEX']);
    expect(record.nonTechnicalEvents).toEqual(['SHORT FILM']);
    expect(record.payment).toEqual({ gatePassAmount: 100, transactionId: '412345678901' });
    expect(record.eventRegistration).toEqual({ eventCount: 3, feePerEvent: 50, totalEventFee: 150 });
  });
});

describe('departments', () => {
  it('lists the 23 departments in the agreed order, with Other last', () => {
    expect(DEPARTMENTS).toHaveLength(23);
    expect(DEPARTMENTS.slice(0, 4)).toEqual([
      'Computer Science and Engineering (CSE)',
      AI_DS,
      'Artificial Intelligence and Machine Learning (AI & ML)',
      'Computer Science and Engineering (Cyber Security)',
    ]);
    expect(DEPARTMENTS.at(-2)).toBe('Agricultural Engineering');
    expect(DEPARTMENTS.at(-1)).toBe(OTHER_DEPARTMENT);
    expect(new Set(DEPARTMENTS).size).toBe(23);
  });

  it('requires a department from the list', () => {
    expect(validateField('department', { ...valid, department: '' })).toBe('Please select your department.');
    expect(validateField('department', { ...valid, department: 'AI & DS' })).toBe('Please select your department.');
    for (const department of DEPARTMENTS) {
      expect(validateField('department', { ...valid, department })).toBeUndefined();
    }
  });

  it('asks for the typed department only when Other is chosen', () => {
    expect(validateField('departmentOther', { ...valid, departmentOther: '' })).toBeUndefined();

    const other = { ...valid, department: OTHER_DEPARTMENT };
    expect(validateField('departmentOther', { ...other, departmentOther: '  ' })).toBe('Please specify your department.');
    expect(validateField('departmentOther', { ...other, departmentOther: '=HYPERLINK("x")' })).toMatch(/letters/);
    expect(validateField('departmentOther', { ...other, departmentOther: 'Robotics and Automation Engineering' })).toBeUndefined();
  });

  it('saves the typed department for Other, never the word Other', () => {
    const other = { ...valid, department: OTHER_DEPARTMENT, departmentOther: ' Robotics  and Automation Engineering ' };
    expect(resolvedDepartment(other)).toBe('Robotics and Automation Engineering');
    expect(buildRegistrationRecord(other, events, fees).participant.department).toBe('Robotics and Automation Engineering');
    expect(resolvedDepartment(valid)).toBe(AI_DS);
  });

  it('splits a saved department back into the dropdown and the Other field', () => {
    expect(splitDepartment(AI_DS)).toEqual({ department: AI_DS, departmentOther: '' });
    expect(splitDepartment('Robotics')).toEqual({ department: OTHER_DEPARTMENT, departmentOther: 'Robotics' });
    expect(splitDepartment(OTHER_DEPARTMENT)).toEqual({ department: OTHER_DEPARTMENT, departmentOther: OTHER_DEPARTMENT });
  });
});

describe('normalisePhone', () => {
  it('reduces Indian numbers to their 10 digits', () => {
    expect(normalisePhone('+91 93449-72274')).toBe('9344972274');
    expect(normalisePhone('093449 72274')).toBe('9344972274');
    expect(normalisePhone('9344972274')).toBe('9344972274');
  });
});

describe('validateRegistration', () => {
  it('requires every field', () => {
    const errors = validateRegistration(EMPTY_REGISTRATION);
    expect(Object.keys(errors).sort()).toEqual(
      ['college', 'department', 'email', 'events', 'name', 'phone', 'screenshot', 'transactionId', 'year'].sort(),
    );
  });

  it('needs at least one event', () => {
    expect(validateField('events', { ...valid, events: [] })).toBe(NO_EVENTS_MESSAGE);
    expect(validateField('events', { ...valid, events: ['e-sports'] })).toBeUndefined();
  });

  it('accepts a complete, valid registration', () => {
    expect(validateRegistration(valid)).toEqual({});
  });

  it.each<[keyof RegistrationInput, string]>([
    ['name', 'Barath'],
    ['name', 'B4rath S'],
    ['name', `Barath ${'S'.repeat(60)}`],
    ['college', '=cmd|calc'],
    ['college', '<script>'],
    ['phone', '12345'],
    ['phone', '5344972274'],
    ['email', 'barath@example'],
    ['email', '=barath@example.com'],
    ['transactionId', 'abc'],
    ['transactionId', '4123-4567-8901'],
    ['year', 'Fifth year'],
  ])('rejects %s = %j', (field, value) => {
    expect(validateField(field, { ...valid, [field]: value })).toBeTruthy();
  });

  it('accepts a name with the initial first or last', () => {
    expect(validateField('name', { ...valid, name: 'S. Barath' })).toBeUndefined();
    expect(validateField('name', { ...valid, name: 'Mohan Prabu K' })).toBeUndefined();
  });

  it('accepts only images up to 5 MB as the screenshot', () => {
    const pdf = new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' });
    expect(validateField('screenshot', { ...valid, screenshot: pdf })).toMatch(/image/);

    const huge = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 6 * 1024 * 1024 });
    expect(validateField('screenshot', { ...valid, screenshot: huge })).toMatch(/5 MB/);
  });
});

describe('newSubmissionId', () => {
  it('makes a fresh 32-character id each time', () => {
    const first = newSubmissionId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(newSubmissionId()).not.toBe(first);
  });
});

describe('submitRegistration', () => {
  const endpoint = '/api/register';

  it('refuses to pretend when online registration is switched off', async () => {
    await expect(submitRegistration(valid, { endpoint: null, ...submitOptions })).rejects.toThrow(/not connected yet/);
  });

  it('posts the details, event ids and screenshot as JSON, and returns the Registration ID', async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, registrationId: 'PRG26-0042', emailStatus: 'PENDING' }));
    const result = await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl });

    expect(result).toEqual({ registrationId: 'PRG26-0042', emailStatus: 'PENDING', duplicate: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body.submissionId).toBe(submitOptions.submissionId);
    expect(body.participant).toEqual({
      name: 'Barath S',
      department: AI_DS,
      college: 'R P Sarathy Institute of Technology',
      year: '3rd Year',
      phone: '9344972274',
      email: 'Barath@Example.com',
    });
    expect(body.events).toEqual(['pro-pitch', 'code-flex', 'short-film']);
    expect(body.transactionId).toBe('412345678901');
    expect(body.screenshot).toMatchObject({ type: 'image/png', name: 'payment.png' });
    expect(body.screenshot.data).toMatch(/^data:image\/png;base64,/);
  });

  it('sends the typed department when Other is chosen', async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, registrationId: 'PRG26-0043', emailStatus: 'PENDING' }));
    const other = { ...valid, department: OTHER_DEPARTMENT, departmentOther: 'Robotics and Automation Engineering' };
    await submitRegistration(other, { endpoint, ...submitOptions, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).participant.department).toBe('Robotics and Automation Engineering');
  });

  it("shows the server's message and field errors when it rejects the registration", async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        { success: false, error: 'This transaction ID has already been used.', code: 'DUPLICATE_TRANSACTION', fieldErrors: { transactionId: 'Already used.' } },
        { status: 409 },
      ),
    );
    const failure = await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl }).catch((error) => error);

    expect(failure).toBeInstanceOf(RegistrationError);
    expect(failure.message).toBe('This transaction ID has already been used.');
    expect(failure.code).toBe('DUPLICATE_TRANSACTION');
    expect(failure.fieldErrors).toEqual({ transactionId: 'Already used.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('waits and tries again, with the same submission id, while the server is busy', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ success: false, error: 'Busy', code: 'BUSY' }, { status: 503 }))
      .mockResolvedValueOnce(json({ success: true, registrationId: 'PRG26-0044', emailStatus: 'PENDING' }));
    const result = await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl });

    expect(result.registrationId).toBe('PRG26-0044');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const ids = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).submissionId);
    expect(new Set(ids)).toEqual(new Set([submitOptions.submissionId]));
  });

  it('retries a dropped connection, then explains it if the server stays out of reach', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl }).catch((error) => error);

    expect(failure).toBeInstanceOf(RegistrationError);
    expect(failure.message).toMatch(/Couldn't reach the registration server/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries when a proxy answers for a server that is down, then says the server is out of reach', async () => {
    // What the Vite proxy (or a hosting proxy) sends when the registration server is not running.
    const fetchImpl = vi.fn(async () => new Response('', { status: 502, headers: { 'Content-Type': 'text/plain' } }));
    const failure = await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl }).catch((error) => error);

    expect(failure).toBeInstanceOf(RegistrationError);
    expect(failure.message).toMatch(/Couldn't reach the registration server/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gets through once the server is back after a proxy error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 504, headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(json({ success: true, registrationId: 'PRG26-0045', emailStatus: 'PENDING' }));

    expect((await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl })).registrationId).toBe('PRG26-0045');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry the server's own storage failure", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ success: false, code: 'STORAGE_FAILED', error: "We couldn't save your registration right now." }, { status: 502 }),
    );
    const failure = await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl }).catch((error) => error);

    expect(failure.message).toBe("We couldn't save your registration right now.");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('marks a duplicate registration reported by the server', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ success: true, registrationId: 'PRG26-0007', emailStatus: 'SENT', duplicate: true }),
    );
    expect(await submitRegistration(valid, { endpoint, ...submitOptions, fetchImpl })).toEqual({
      registrationId: 'PRG26-0007',
      emailStatus: 'SENT',
      duplicate: true,
    });
  });
});
