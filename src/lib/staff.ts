/**
 * The roles of the student coordinators who run the event (called "staff" in the code) and
 * what each may do, shared by the registration API (which enforces them on every request)
 * and the admin dashboard (which shows them and hides what a role cannot use). One list, so
 * the permissions the dashboard documents are exactly the ones the server checks.
 *
 * Types only and plain data: nothing here reaches the public site's bundle.
 */

export const STAFF_ROLES = ['ADMIN', 'OVERALL', 'HOD', 'DEPT_ADMIN', 'DESK', 'COORDINATOR', 'CERTIFICATE', 'SUPPORT'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The roles new accounts are made with: the web assist team (Admin), the overall coordinator (the
 * HOD, one account for every department), and in each department its admin, desks and event
 * coordinators. (Department HOD accounts made earlier still work, view only.)
 */
export const CREATABLE_ROLES: readonly StaffRole[] = ['ADMIN', 'OVERALL', 'DEPT_ADMIN', 'DESK', 'COORDINATOR'];

/** Roles that belong to one department: they see and work on that department only. */
export const DEPARTMENT_ROLES: readonly StaffRole[] = ['HOD', 'DEPT_ADMIN', 'DESK', 'COORDINATOR'];
/** Roles that need a department when an account is made (desks and coordinators made before the fest have none). */
export const DEPARTMENT_REQUIRED: readonly StaffRole[] = ['HOD', 'DEPT_ADMIN'];

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
  | 'system.testing'
  | 'site.switches'
  | 'fest.view'
  | 'fest.viewAll'
  | 'fest.register'
  | 'fest.import'
  | 'fest.edit'
  | 'fest.cancel'
  | 'fest.delete'
  | 'fest.event'
  | 'fest.correct'
  | 'fest.catalog';

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
  'site.switches': 'Website controls: switch each part of the portal off and on (student registration, online payment, lookups, desk registration, event entry, results, downloads, each role’s sign-in) and upload, replace or remove the UPI QR code',
  'fest.view': "See the live registrations, events, money and results (department roles: their own department only)",
  'fest.viewAll': 'See every department, with filters by department, event, venue and desk',
  'fest.register': 'The registration desk: open a student’s ID, collect the ₹100 entry fee (cash, or UPI with its UTR) or verify the UTR they sent, correct a UTR that clashes (kept in their UTR log), and register a student for them only when they cannot do it on a phone (online)',
  'fest.import': 'Upload the online registrations (the CSV from the online form) before the event day',
  'fest.edit': "Correct a student's details and change their events",
  'fest.cancel': 'Cancel a registration, or undo a cancellation',
  'fest.delete': 'Delete a registration (it can be restored), and restore it',
  'fest.event': 'Event window: every student of the department, added to the event at its venue; take the event fee, mark attendance, enter and submit winners (coordinators: their own events)',
  'fest.correct': 'Corrections: cancel an event fee recorded by mistake, reopen submitted results',
  'fest.catalog': 'Edit departments and events: names, venues, times, fees, team sizes, desks',
};

/** The permissions of today's system, as the Roles page lists them (the others belong to retired screens). */
export const CURRENT_PERMISSIONS: readonly Permission[] = [
  'fest.view',
  'fest.viewAll',
  'fest.register',
  'fest.import',
  'fest.edit',
  'fest.cancel',
  'fest.delete',
  'fest.event',
  'fest.correct',
  'fest.catalog',
  'staff.manage',
  'registration.window',
  'site.notice',
  'help.manage',
  'system.view',
  'system.testing',
  'site.switches',
];

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
    'site.switches',
    'fest.view',
    'fest.viewAll',
    'fest.register',
    'fest.import',
    'fest.edit',
    'fest.cancel',
    'fest.delete',
    'fest.event',
    'fest.correct',
    'fest.catalog',
  ],
  // The overall coordinator: every department's live data and results, and the corrections.
  OVERALL: ['fest.view', 'fest.viewAll', 'fest.correct'],
  HOD: ['fest.view'],
  DEPT_ADMIN: ['fest.view', 'fest.register', 'fest.import', 'fest.edit', 'fest.cancel', 'fest.event'],
  // Passes are the students' own (Student login): the desk and the web team do not download them.
  DESK: ['registrations.list', 'registrations.approve', 'registrations.onsite', 'registrations.events', 'registrations.edit', 'fest.view', 'fest.register', 'fest.edit'],
  COORDINATOR: ['registrations.approve', 'events.operate', 'results.view', 'fest.view', 'fest.event'],
  CERTIFICATE: ['results.view'],
  SUPPORT: ['registrations.list', 'registrations.edit', 'registrations.retry', 'registrations.delete', 'portal.manage', 'help.manage', 'system.view', 'map.edit', 'fest.view', 'fest.viewAll'],
};

/** Roles whose event permissions cover only the events assigned to the account. */
export const EVENT_SCOPED_ROLES: readonly StaffRole[] = ['COORDINATOR'];

export const ROLE_INFO: Record<StaffRole, { label: string; summary: string }> = {
  ADMIN: {
    label: 'Web assist team',
    summary:
      'Full control of the portal: Website controls (switch every part on or off, sign-in for each role, the UPI QR code), accounts (create, change, sign out, delete) and who is signed in, departments and events, registration times, the website notice, registrations (register, correct, cancel, delete, restore), event windows, corrections, test sessions and system status. Every department.',
  },
  OVERALL: {
    label: 'Overall coordinator (HOD)',
    summary: 'Every department and every event live, with filters on every category (department, event, venue, how they registered, desk, entry fee, status, college, search): registrations, money, attendance and winners; the college ranking (medal table: 1st, 2nd, 3rd, then participations), filtered by participations and prizes; all downloaded as Excel; corrections (cancel a fee recorded by mistake, reopen results).',
  },
  HOD: {
    label: 'Department HOD (no longer used)',
    summary: 'An earlier role: their department live, view only. The overall coordinator (the HOD) now sees every department.',
  },
  DEPT_ADMIN: {
    label: 'Department admin',
    summary: 'Their department: all its students and events, live; work at its desk (collect and verify payments), correct details, cancel registrations, help at any of its events, upload the online form’s CSV, download its lists as Excel.',
  },
  DESK: {
    label: 'Registration desk',
    summary: 'Their department’s desk. The department’s students are listed: open the ID the student tells you, check their details, then collect the ₹100 entry fee (cash, or UPI with its UTR) or verify the UTR they sent (it must match and be used once). A UTR that clashes shows every student who has it, and either one’s UTR can be corrected. Registers a student only when they cannot do it on a phone. Downloads the department’s list as Excel.',
  },
  COORDINATOR: {
    label: 'Event coordinator',
    summary: 'One per event. Every student of the department: find them by their Registration ID, check them, add them to the event (individual or team), take the event fee, mark attendance, enter the 1st, 2nd and 3rd places and submit the results. Downloads the event’s and the department’s lists as Excel.',
  },
  CERTIFICATE: {
    label: 'Certificate team',
    summary: 'Read-only: event-wise participant, attendance and winner lists with submission times, downloaded as Excel.',
  },
  SUPPORT: {
    label: 'Website helper',
    summary: 'An earlier, limited role (new web assist accounts are Web assist team): help requests, system status, the student login switch and the campus map; sees every department’s live data.',
  },
};

export const hasPermission = (role: StaffRole, permission: Permission) => (ROLE_PERMISSIONS[role] ?? []).includes(permission);

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
  /** The department (department roles), and the desk (desk accounts). */
  department: string | null;
  deskNumber: number | null;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  passwordChangedAt: string;
  /** When they last signed in (null: never, or not since this was recorded). */
  lastSignInAt: string | null;
}

/** A refused sign-in, kept for Accounts: the username tried, why, and when (never the password). */
export interface SignInFailure {
  username: string;
  reason: 'no such account' | 'wrong password' | 'account deactivated' | 'sign-in switched off';
  at: string;
}

/** What the owner types to delete every staff account. */
export const DELETE_ALL_STAFF = 'DELETE ALL';

/** Who is signed in, and what the server's clock says about registration right now. */
export interface SessionInfo {
  username: string;
  displayName: string;
  role: StaffRole;
  /** 'owner': the ADMIN_USERNAME account from the Amplify secrets; 'staff': an account made in the dashboard. */
  kind: 'owner' | 'staff';
  eventIds: string[];
  /** The department (department roles); null or missing for roles that see every department. */
  department?: string | null;
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
  department: string | null;
  deskNumber: number | null;
  since: string;
  until: string;
}
