/**
 * The PRAGYA 2026 registration form: its fields, validation, fees and submission.
 *
 * Shared by the browser and the registration server (server/), so both check a
 * registration by exactly the same rules. Keep it free of browser-only code at the top
 * level: the server imports it too.
 */
import type { SymposiumEvent } from '../content/types';
import { parseEventStart } from './countdown';

/** True once `closesAt` (e.g. '2026-10-16T17:00:00', IST) has passed. Never closes if null. */
export function isRegistrationClosed(closesAt: string | null, now: number): boolean {
  const end = closesAt ? parseEventStart(closesAt) : null;
  return end !== null && now >= end;
}

export const YEARS_OF_STUDY = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'PG'] as const;

/** Choosing this opens a field to type the department instead. */
export const OTHER_DEPARTMENT = 'Other';

/** The Department dropdown, in this order, with Other last. */
export const DEPARTMENTS = [
  'Computer Science and Engineering (CSE)',
  'Artificial Intelligence and Data Science (AI & DS)',
  'Artificial Intelligence and Machine Learning (AI & ML)',
  'Computer Science and Engineering (Cyber Security)',
  'Information Technology (IT)',
  'Electronics and Communication Engineering (ECE)',
  'Electrical and Electronics Engineering (EEE)',
  'Mechanical Engineering',
  'Cyber Security',
  'Internet of Things (IoT)',
  'Computer Science and Business Systems (CSBS)',
  'Electronics Engineering (VLSI)',
  'Electronics and Instrumentation Engineering (EIE)',
  'Biomedical Engineering',
  'Biotechnology',
  'Mechatronics Engineering',
  'Automobile Engineering',
  'Civil Engineering',
  'Chemical Engineering',
  'Food Technology',
  'Textile Technology',
  'Agricultural Engineering',
  OTHER_DEPARTMENT,
] as const;

export const NO_EVENTS_MESSAGE = 'Please select at least one event to continue.';

export interface Fees {
  /** Gate pass, paid online with the registration (₹). */
  gatePass: number;
  /** Per event, paid on-site at the college (₹). */
  perEvent: number;
}

export interface FeeSummary {
  eventCount: number;
  /** Paid on-site: the number of events × the fee per event. */
  eventTotal: number;
  /** Gate pass + event total. */
  grandTotal: number;
}

/** Always worked out from the selection, never stored as a fixed amount. */
export function feeSummary(eventIds: readonly string[], fees: Fees): FeeSummary {
  const eventCount = new Set(eventIds).size;
  const eventTotal = eventCount * fees.perEvent;
  return { eventCount, eventTotal, grandTotal: fees.gatePass + eventTotal };
}

/** '₹1,250' in Indian grouping. */
/** One formatter for every amount: building it is the costly part of formatting. */
const inr = new Intl.NumberFormat('en-IN');
export const rupees = (amount: number) => `₹${inr.format(amount)}`;

/** Largest payment screenshot accepted (the server applies the same limit). */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** Formats the server stores. Other images are converted to JPEG in the browser first. */
export const ACCEPTED_SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Longest value accepted for each text field. */
export const FIELD_MAX_LENGTH = {
  name: 60,
  department: 80,
  college: 150,
  email: 254,
} as const;

export interface RegistrationInput {
  name: string;
  /** One of DEPARTMENTS. */
  department: string;
  /** Typed by the participant when the department is Other; empty otherwise. */
  departmentOther: string;
  college: string;
  year: string;
  phone: string;
  email: string;
  /** Ids of the selected events, from both categories. */
  events: string[];
  transactionId: string;
  screenshot: File | null;
}

export type RegistrationField = keyof RegistrationInput;
export type RegistrationErrors = Partial<Record<RegistrationField, string>>;

export const EMPTY_REGISTRATION: RegistrationInput = {
  name: '',
  department: '',
  departmentOther: '',
  college: '',
  year: '',
  phone: '',
  email: '',
  events: [],
  transactionId: '',
  screenshot: null,
};

/** '+91 93449-72274' or '093449 72274' → '9344972274' */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** Collapses runs of spaces, so 'R  P Sarathy ' and 'R P Sarathy' are the same. */
export const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');

/** The department that is saved: the chosen one, or what was typed for Other. */
export const resolvedDepartment = (input: Pick<RegistrationInput, 'department' | 'departmentOther'>) =>
  input.department === OTHER_DEPARTMENT ? tidy(input.departmentOther) : input.department;

/** The reverse, for a saved department: a listed one, or Other with the typed name. */
export function splitDepartment(value: string): Pick<RegistrationInput, 'department' | 'departmentOther'> {
  const listed = value !== OTHER_DEPARTMENT && (DEPARTMENTS as readonly string[]).includes(value);
  return listed ? { department: value, departmentOther: '' } : { department: OTHER_DEPARTMENT, departmentOther: value };
}

/**
 * Letters, digits and simple punctuation, starting with a letter or digit. This keeps a
 * value from being read as a formula (=, +, -, @) when the sheet is opened in Excel.
 */
const PLAIN_TEXT = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} &.,()'/:-]*$/u;

/** Starts with a letter or digit for the same reason. */
const EMAIL = /^[A-Za-z0-9][^\s@]*@[^\s@]+\.[^\s@]{2,}$/;

/** Checks one field; returns the message to show, or undefined when it is fine. */
export function validateField(field: RegistrationField, input: RegistrationInput): string | undefined {
  switch (field) {
    case 'name': {
      const name = tidy(input.name);
      if (!name) return 'Enter your name with initial.';
      if (!/^[A-Za-z][A-Za-z .']*$/.test(name)) return 'Use letters, spaces and dots only.';
      if (!/[ .]/.test(name) || name.length < 3) return 'Add your initial, e.g. Varshan C.';
      if (name.length > FIELD_MAX_LENGTH.name) return `Keep your name under ${FIELD_MAX_LENGTH.name} characters.`;
      return undefined;
    }
    case 'department':
      return (DEPARTMENTS as readonly string[]).includes(input.department) ? undefined : 'Please select your department.';
    case 'departmentOther': {
      // Needed only when the department is Other.
      if (input.department !== OTHER_DEPARTMENT) return undefined;
      const department = tidy(input.departmentOther);
      if (department.length < 2) return 'Please specify your department.';
      if (department.length > FIELD_MAX_LENGTH.department) return 'Shorten the department name.';
      return PLAIN_TEXT.test(department) ? undefined : 'Use letters, numbers and simple punctuation only.';
    }
    case 'college': {
      const college = tidy(input.college);
      if (college.length < 3) return 'Enter your college name.';
      if (college.length > FIELD_MAX_LENGTH.college) return 'Shorten the college name.';
      return PLAIN_TEXT.test(college) ? undefined : 'Use letters, numbers and simple punctuation only.';
    }
    case 'year':
      return (YEARS_OF_STUDY as readonly string[]).includes(input.year) ? undefined : 'Choose your year of study.';
    case 'phone':
      if (!input.phone.trim()) return 'Enter your phone number.';
      return /^[6-9]\d{9}$/.test(normalisePhone(input.phone))
        ? undefined
        : 'Enter a valid 10-digit mobile number.';
    case 'email': {
      const email = input.email.trim();
      if (!email) return 'Enter your email ID.';
      return EMAIL.test(email) && email.length <= FIELD_MAX_LENGTH.email ? undefined : 'Enter a valid email ID.';
    }
    case 'events':
      return input.events.length > 0 ? undefined : NO_EVENTS_MESSAGE;
    case 'transactionId':
      if (!input.transactionId.trim()) return 'Enter the transaction ID of your payment.';
      return /^[A-Za-z0-9]{6,35}$/.test(input.transactionId.trim())
        ? undefined
        : 'Use the 6–35 letters or digits shown in your payment app (UTR / reference no.).';
    case 'screenshot': {
      const file = input.screenshot;
      if (!file) return 'Upload a screenshot of your payment.';
      if (!file.type.startsWith('image/')) return 'The screenshot must be an image (PNG or JPG).';
      if (file.size > MAX_SCREENSHOT_BYTES) return 'The image must be 5 MB or smaller.';
      return undefined;
    }
  }
}

/** In the order they appear in the form, so the first error found is the first on screen. */
export const REGISTRATION_FIELDS: readonly RegistrationField[] = [
  'name',
  'department',
  'departmentOther',
  'year',
  'college',
  'phone',
  'email',
  'events',
  'screenshot',
  'transactionId',
];

export function validateRegistration(input: RegistrationInput): RegistrationErrors {
  const errors: RegistrationErrors = {};
  for (const field of REGISTRATION_FIELDS) {
    const message = validateField(field, input);
    if (message) errors[field] = message;
  }
  return errors;
}

type EventSummary = Pick<SymposiumEvent, 'id' | 'name' | 'category'>;

export interface ParticipantDetails {
  name: string;
  /** The listed department, or the one typed for Other (never just 'Other'). */
  department: string;
  college: string;
  year: string;
  phone: string;
  email: string;
}

/** What is saved for one registration (besides the screenshot, which goes to Drive). */
export interface RegistrationRecord {
  participant: ParticipantDetails;
  technicalEvents: string[];
  nonTechnicalEvents: string[];
  payment: {
    gatePassAmount: number;
    transactionId: string;
  };
  eventRegistration: {
    eventCount: number;
    feePerEvent: number;
    /** Worked out from the selection; paid on-site. */
    totalEventFee: number;
  };
}

/** Turns the form into the record that is saved, with the fees worked out from the selection. */
export function buildRegistrationRecord(
  input: Omit<RegistrationInput, 'screenshot'>,
  catalog: readonly EventSummary[],
  fees: Fees,
): RegistrationRecord {
  const chosen = catalog.filter((event) => input.events.includes(event.id));
  const { eventCount, eventTotal } = feeSummary(
    chosen.map((event) => event.id),
    fees,
  );
  return {
    participant: {
      name: tidy(input.name),
      department: resolvedDepartment(input),
      college: tidy(input.college),
      year: input.year,
      phone: normalisePhone(input.phone),
      email: input.email.trim().toLowerCase(),
    },
    technicalEvents: chosen.filter((event) => event.category === 'technical').map((event) => event.name),
    nonTechnicalEvents: chosen.filter((event) => event.category === 'non-technical').map((event) => event.name),
    payment: { gatePassAmount: fees.gatePass, transactionId: input.transactionId.trim() },
    eventRegistration: { eventCount, feePerEvent: fees.perEvent, totalEventFee: eventTotal },
  };
}

// ---------------------------------------------------------------------------------------
// What travels between the form and the registration server (POST /api/register).

export interface ScreenshotUpload {
  name: string;
  type: string;
  /** base64 data URL */
  data: string;
}

export interface RegistrationPayload {
  /**
   * Made once per filled-in form and kept until it succeeds. Sending the same form again
   * (after a timeout or a lost connection) returns the first result, never a second registration.
   */
  submissionId: string;
  participant: ParticipantDetails;
  /** Event ids; the server looks up their names and works out the fees itself. */
  events: string[];
  transactionId: string;
  screenshot: ScreenshotUpload;
}

export type EmailStatus = 'PENDING' | 'SENT' | 'FAILED';

/** The server's answer once Google Drive and Google Sheets have both stored the registration. */
export interface RegistrationSuccess {
  success: true;
  registrationId: string;
  emailStatus: EmailStatus;
  /** When the registration was stored (ISO 8601). */
  registeredAt: string;
  /** This person was already registered with the same email and transaction ID. */
  duplicate?: boolean;
}

export interface RegistrationFailure {
  success: false;
  error: string;
  code?: string;
  fieldErrors?: RegistrationErrors;
}

export const SUBMISSION_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** A random id for one filled-in form. Works on plain http too, unlike crypto.randomUUID. */
export function newSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class RegistrationError extends Error {
  readonly code?: string;
  readonly fieldErrors?: RegistrationErrors;

  constructor(message: string, details: { code?: string; fieldErrors?: RegistrationErrors } = {}) {
    super(message);
    this.code = details.code;
    this.fieldErrors = details.fieldErrors;
  }
}

