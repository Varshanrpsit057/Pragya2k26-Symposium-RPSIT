/**
 * The website's switches and the online payment settings, which the web assist team changes in
 * Website controls: each part of the portal can be turned off and on again, and the UPI QR code
 * students pay with can be uploaded, replaced or removed. Shared by the API (which enforces every
 * switch) and the dashboard. Plain data only.
 */
import { DEFAULT_UPI, UPI_ID } from './fest';

/** The staff roles whose sign-in can be switched off all at once. */
export const LOGIN_ROLES = ['OVERALL', 'DEPT_ADMIN', 'DESK', 'COORDINATOR'] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

export interface PortalSwitches {
  /** Students register themselves on their phones. */
  selfRegistration: boolean;
  /** Students pay the entry fee on the website by UPI (the QR code) and send the UTR. */
  onlinePayment: boolean;
  /** Students find their registration ID with their mobile number and email. */
  studentLookup: boolean;
  /** Registration desks register walk-in students. */
  deskRegistration: boolean;
  /** Event coordinators enter students at the venue, take the event fee and mark attendance. */
  eventEntry: boolean;
  /** Event coordinators enter and submit winners. */
  results: boolean;
  /** Excel downloads in the dashboards. */
  downloads: boolean;
  /** Sign-in for each role (off: those accounts are signed out and cannot sign in). */
  logins: Record<LoginRole, boolean>;
}

export interface PortalSettings extends PortalSwitches {
  /** The UPI account the QR code pays (shown under it, and used by the "Open UPI app" button). */
  upiId: string;
  upiPayee: string;
  /** When the QR code picture was uploaded; null when there is none. */
  qrAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type SwitchName = Exclude<keyof PortalSwitches, 'logins'>;

export const DEFAULT_PORTAL: PortalSettings = {
  selfRegistration: true,
  onlinePayment: true,
  studentLookup: true,
  deskRegistration: true,
  eventEntry: true,
  results: true,
  downloads: true,
  logins: { OVERALL: true, DEPT_ADMIN: true, DESK: true, COORDINATOR: true },
  upiId: DEFAULT_UPI.upiId,
  upiPayee: DEFAULT_UPI.upiPayee,
  qrAt: null,
  updatedAt: null,
  updatedBy: null,
};

/** What each switch does, as Website controls explains it (in this order). */
export const SWITCH_INFO: Record<SwitchName, { label: string; on: string; off: string }> = {
  selfRegistration: {
    label: 'Student registration on phones',
    on: 'Students register themselves on the website and get their ID at once.',
    off: 'The website says registration on phones is paused: students register at a desk.',
  },
  onlinePayment: {
    label: 'Online payment (UPI QR code)',
    on: 'After registering, students may pay by UPI with the QR code and send the UTR, or pay at the desk.',
    off: 'Students pay at their department’s desk only (cash or UPI there).',
  },
  studentLookup: {
    label: 'Students find their registration',
    on: '“My registration ID” finds a registration by mobile number and email.',
    off: 'Only the phone that registered shows the ID; others ask at a desk.',
  },
  deskRegistration: {
    label: 'Desks register a student for them',
    on: 'Only for a student who cannot register on a phone: the desk types their details (online), then collects the fee as for anyone.',
    off: 'Students register on their phones only; desks collect and verify payments.',
  },
  eventEntry: {
    label: 'Event entry at the venues',
    on: 'Event coordinators enter students, take event fees and mark attendance.',
    off: 'Event windows are read-only for coordinators.',
  },
  results: {
    label: 'Results entry',
    on: 'Event coordinators enter and submit each event’s winners.',
    off: 'Winners cannot be entered or submitted.',
  },
  downloads: {
    label: 'Excel downloads',
    on: 'The overall coordinator and department admins download their lists as Excel files.',
    off: 'Download buttons are hidden (the web assist team still has them).',
  },
};

export const LOGIN_LABELS: Record<LoginRole, string> = {
  OVERALL: 'Overall coordinator (HOD)',
  DEPT_ADMIN: 'Department admins',
  DESK: 'Registration desks',
  COORDINATOR: 'Event coordinators',
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const words = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The settings as stored (or sent by the dashboard), with every missing value at its default. */
export function readPortal(value: unknown, base: PortalSettings = DEFAULT_PORTAL): PortalSettings {
  const input = isObject(value) ? value : {};
  const logins = isObject(input.logins) ? input.logins : {};
  const upiId = typeof input.upiId === 'string' ? input.upiId.trim() : base.upiId;
  return {
    selfRegistration: flag(input.selfRegistration, base.selfRegistration),
    onlinePayment: flag(input.onlinePayment, base.onlinePayment),
    studentLookup: flag(input.studentLookup, base.studentLookup),
    deskRegistration: flag(input.deskRegistration, base.deskRegistration),
    eventEntry: flag(input.eventEntry, base.eventEntry),
    results: flag(input.results, base.results),
    downloads: flag(input.downloads, base.downloads),
    logins: Object.fromEntries(LOGIN_ROLES.map((role) => [role, flag(logins[role], base.logins[role])])) as Record<LoginRole, boolean>,
    upiId,
    upiPayee: typeof input.upiPayee === 'string' ? words(input.upiPayee, 80) : base.upiPayee,
    qrAt: typeof input.qrAt === 'string' ? input.qrAt : input.qrAt === null ? null : base.qrAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    updatedBy: typeof input.updatedBy === 'string' ? input.updatedBy : base.updatedBy,
  };
}

/** What is wrong with the payment settings, or '' when they can be saved. */
export function portalProblem(settings: PortalSettings): string {
  if (settings.upiId && !UPI_ID.test(settings.upiId)) return 'The UPI ID looks wrong (like name@bank).';
  if (settings.onlinePayment && !settings.upiId && !settings.qrAt) return 'Online payment needs the QR code or the UPI ID.';
  return '';
}

/**
 * How the last scheduled backups went (every 10 minutes): the private copy in the bucket and the
 * Google Sheet copy, with when each last succeeded. A failed copy is tried again at the next run.
 */
export interface BackupStatus {
  at: string;
  file: 'saved' | 'failed';
  sheet: 'written' | 'unchanged' | 'failed' | 'off';
  /** Why the Google Sheet copy failed (the last run), if it did. */
  sheetError: string | null;
  lastFileAt: string | null;
  lastSheetAt: string | null;
}

/** A UPI reference number (UTR): the 12 digits every UPI app shows for a payment. */
export const UTR = /^\d{12}$/;
/** '1234 5678 9012' → '123456789012' */
export const tidyUtr = (value: string) => value.replace(/[\s-]/g, '');

/** The QR code picture: a PNG, JPEG or WebP, small enough to send in one request. */
export const QR_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const QR_MAX_CHARS = 60_000;

/** The "pay with a UPI app" link (opens GPay, PhonePe, Paytm… on a phone), with the amount and the student's ID as the note. */
export const upiLink = (upiId: string, payee: string, amount: number, note: string) =>
  `upi://pay?${new URLSearchParams({ pa: upiId, pn: payee, am: String(amount), cu: 'INR', tn: note }).toString()}`;
