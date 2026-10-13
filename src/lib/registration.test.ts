import { describe, expect, it } from 'vitest';
import { events } from '../content/events';
import { site } from '../content/site';
import {
  DEPARTMENTS,
  EMPTY_REGISTRATION,
  NO_EVENTS_MESSAGE,
  OTHER_DEPARTMENT,
  REGISTRATION_ID,
  buildRegistrationRecord,
  feeSummary,
  formatOnlineId,
  formatOnsiteId,
  idParts,
  isRegistrationClosed,
  newSubmissionId,
  normalisePhone,
  normaliseRegistrationId,
  onlineSerial,
  resolvedDepartment,
  rupees,
  splitDepartment,
  validateField,
  validateRegistration,
  type RegistrationInput,
} from './registration';

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
  events: ['pro-pitch', 'code-flex', 'cognix'],
  transactionId: '412345678901',
  screenshot,
};

describe('feeSummary', () => {
  it.each([
    [0, 0, 100],
    [1, 50, 150],
    [2, 100, 200],
    [3, 150, 250],
    [5, 250, 350],
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

  it("closes the site's registration at 11:59 PM IST on 16 October 2026", () => {
    const deadline = Date.parse('2026-10-16T18:29:00Z');
    expect(site.registration.closesAt).toBe('2026-10-16T23:59:00');
    expect(isRegistrationClosed(site.registration.closesAt, deadline - 1)).toBe(false);
    expect(isRegistrationClosed(site.registration.closesAt, deadline)).toBe(true);
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
    expect(record.technicalEvents).toEqual(['PRO-PITCH', 'CODE FLEX', 'COGNIX']);
    expect(record).not.toHaveProperty('nonTechnicalEvents');
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
    expect(validateField('events', { ...valid, events: ['cognix'] })).toBeUndefined();
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

describe('Registration IDs: 26, then 1 (online) or 2 (desk), then the participant number', () => {
  it('makes, checks and reads them', () => {
    expect(formatOnlineId(7)).toBe('261007');
    expect(formatOnsiteId(15)).toBe('262015');
    expect(formatOnsiteId(1000)).toBe('2621000');
    for (const id of ['261007', '262015', '2621000', 'PRG26-0042']) expect(REGISTRATION_ID.test(id), id).toBe(true);
    for (const id of ['100001', '200001', '26100', '263001', '26100001']) expect(REGISTRATION_ID.test(id), id).toBe(false);
    // Online numbers continue the earlier PRG26 serial; desk numbers have their own.
    expect(onlineSerial('261042')).toBe(42);
    expect(onlineSerial('PRG26-0041')).toBe(41);
    expect(onlineSerial('262003')).toBeNaN();
  });

  it('accepts an ID typed in parts, and shows what each part means', () => {
    expect(normaliseRegistrationId(' 26 2 005 ')).toBe('262005');
    expect(normaliseRegistrationId('26-1-007')).toBe('261007');
    expect(normaliseRegistrationId('prg26-0042')).toBe('PRG26-0042');
    expect(idParts('262015')).toEqual({ parts: ['26', '2', '015'], meaning: '2026 · registration desk · participant 15' });
    expect(idParts('261007').meaning).toBe('2026 · online · participant 7');
    expect(idParts('PRG26-0042')).toEqual({ parts: ['PRG26-0042'], meaning: null });
  });
});
