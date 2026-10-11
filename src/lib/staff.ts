/**
 * The roles of the student coordinators who run the event (called "staff" in the code) and
 * what each may do, shared by the registration API (which enforces them on every request)
 * and the admin dashboard (which shows them and hides what a role cannot use). One list, so
 * the permissions the dashboard documents are exactly the ones the server checks.
 *
 * Types only and plain data: nothing here reaches the public site's bundle.
 */

export const STAFF_ROLES = ['ADMIN', 'DESK', 'COORDINATOR', 'CERTIFICATE', 'SUPPORT'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission =
  | 'registrations.list'
  | 'registrations.approve'
  | 'registrations.onsite'
  | 'registrations.events'
  | 'registrations.edit'
  | 'registrations.pass'
  | 'registrations.retry'
  | 'registrations.remove'
  | 'registrations.delete'
  | 'events.operate'
  | 'events.correct'
  | 'results.view'
  | 'staff.manage'
  | 'reports.view'
  | 'portal.manage'
  | 'help.manage'
  | 'system.view'
  | 'map.edit'
  | 'registration.window'
  | 'site.notice'
  | 'system.testing';

/** What each permission allows, as the dashboard explains it. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'registrations.list': 'See and search every registration, with contact details',
  'registrations.approve': 'Verify a ₹100 gate pass paid online by GPay: check the payment screenshot, then approve or reject',
  'registrations.onsite': 'Register students at the desk (individual or team, with the team name, and the events they choose) and record their ₹100 gate pass (cash or GPay)',
  'registrations.events': "Add or remove events on a student's registration (each event's ₹50 is paid at its venue)",
  'registrations.edit': "Correct a student's details: name, college, department, year, phone or email",
  'registrations.pass': 'Download student passes (PDF)',
  'registrations.retry': 'Retry a pass, email or Google Sheet copy that failed',
  'registrations.remove': "Cancel a student's registration",
  'registrations.delete': "Delete a student's record: it leaves every list and goes to the Deleted list, where it can be restored",
  'events.operate': 'Search student IDs, enter them in the event (individual or team) with the ₹50 fee, mark attendance, enter winners and submit results',
  'events.correct': 'Authorise corrections: void an event fee, reopen finalized results',
  'results.view': 'See event-wise participants, attendance, winners and submission times; download them as Excel',
  'staff.manage': 'Create student coordinator accounts, set roles, assign events, reset passwords, sign someone out, deactivate or delete accounts',
  'reports.view': 'See reports and download the Excel report: registrations, cash and GPay collected, attendance',
  'portal.manage': 'Turn the student login on the website on or off (pause it while the desks need the network)',
  'help.manage': 'See and answer the help requests sent with Contact admin',
  'system.view': 'See the system status: website checks, failed emails, passes and Sheet copies',
  'map.edit': 'Edit the campus map: room names, photo spots and directions to each venue',
  'registration.window': 'Change the registration times: reopen or extend on-site registration, close registration now, or set new times; the website, the desks and the API follow within seconds',
  'site.notice': 'Post a notice on the website and the student page (e.g. a venue or time change); every open page shows it within two minutes',
  'system.testing': 'Test sessions: set the timeline the website follows, mark records made while testing, and delete that test data',
};

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  ADMIN: [
    'registrations.list',
    'registrations.approve',
    'registrations.onsite',
    'registrations.events',
    'registrations.edit',
    'registrations.pass',
    'registrations.retry',
    'registrations.remove',
    'registrations.delete',
    'events.operate',
    'events.correct',
    'results.view',
    'staff.manage',
    'reports.view',
    'portal.manage',
    'help.manage',
    'system.view',
    'map.edit',
    'registration.window',
    'site.notice',
    'system.testing',
  ],
  // Passes are the students' own (Student login): the desk and the web team do not download them.
  DESK: ['registrations.list', 'registrations.approve', 'registrations.onsite', 'registrations.events', 'registrations.edit'],
  COORDINATOR: ['registrations.approve', 'events.operate', 'results.view'],
  CERTIFICATE: ['results.view'],
  SUPPORT: ['registrations.list', 'registrations.edit', 'registrations.retry', 'registrations.delete', 'portal.manage', 'help.manage', 'system.view', 'map.edit'],
};

/** Roles whose event permissions cover only the events assigned to the account. */
export const EVENT_SCOPED_ROLES: readonly StaffRole[] = ['COORDINATOR'];

export const ROLE_INFO: Record<StaffRole, { label: string; summary: string }> = {
  ADMIN: {
    label: 'Admin',
    summary: 'Full control: everything the other roles do, plus the registration times (reopen or extend on-site registration), a notice on the website, student coordinator accounts (create, change, sign out, delete), cancelling or deleting records, corrections, reports and test sessions. Every event.',
  },
  DESK: {
    label: 'Registration desk',
    summary: 'Register students at the desk (individual or team) with the events they choose and take the ₹100 gate pass (cash, or GPay the student pays from Student login); verify GPay payments; correct details. Desk registrations get no pass: the Registration ID is enough. Event fees are paid at each venue.',
  },
  COORDINATOR: {
    label: 'Event coordinator',
    summary: 'Assigned events only: find the student by their Registration ID (verifying a GPay payment made online if needed), enter them (individual or team) with the ₹50 fee, mark attendance, enter winners and submit results.',
  },
  CERTIFICATE: {
    label: 'Certificate team',
    summary: 'Read-only: event-wise participant, attendance and winner lists with submission times, downloaded as Excel.',
  },
  SUPPORT: {
    label: 'Web assistant team',
    summary: 'Keeps the website running: help requests, system status, failed emails, passes and Sheet copies, correcting or deleting student records (and restoring deleted ones), the student login switch and the campus map.',
  },
};

export const hasPermission = (role: StaffRole, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);

/** Staff usernames: lower-case letters, digits, dot, dash or underscore; 3 to 32 long. */
export const STAFF_USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const isStaffRole = (value: unknown): value is StaffRole => (STAFF_ROLES as readonly unknown[]).includes(value);

/** A student coordinator's account as the dashboard sees it (never the password hash). */
export interface StaffAccountView {
  username: string;
  displayName: string;
  role: StaffRole;
  /** Assigned events (coordinators only). */
  eventIds: string[];
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  passwordChangedAt: string;
}

/** Who is signed in, and what the server's clock says about registration right now. */
export interface SessionInfo {
  username: string;
  displayName: string;
  role: StaffRole;
  /** 'owner': the ADMIN_USERNAME account from the Amplify secrets; 'staff': an account made in the dashboard. */
  kind: 'owner' | 'staff';
  eventIds: string[];
  permissions: Permission[];
  expiresAt: string;
  /** The server's time (ISO), the phase it gives and the schedule it enforces. */
  serverTime: string;
  phase: 'online' | 'between' | 'onsite' | 'closed';
  eventDayStarted: boolean;
  schedule: { onlineClosesAt: string | null; onsiteOpensAt: string | null; onsiteClosesAt: string | null };
  fees: { gatePass: number; perEvent: number };
  /** Passes are emailed (off for now: students download them from the website). */
  passByEmail: boolean;
  /** The registration desk (1, 2, …) this sign-in is at; null for other roles or not chosen yet. */
  deskNumber: number | null;
  /** A test session (its name) and whether a test timeline replaces the real schedule. */
  testing?: { session: string | null; timeline: boolean; window?: { setBy: string; setAt: string } | null; notice?: string | null };
}

/** The highest desk number that can be chosen. */
export const MAX_DESK_NUMBER = 20;

/** A desk number as typed or chosen, or null when it is not one. */
export function readDeskNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(number) && number >= 1 && number <= MAX_DESK_NUMBER ? number : null;
}

/** Someone signed in right now, for admins: who, which role and desk, since when. */
export interface SignedInView {
  username: string;
  displayName: string;
  role: StaffRole;
  kind: 'owner' | 'staff';
  deskNumber: number | null;
  since: string;
  until: string;
}
