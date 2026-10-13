/**
 * The college-wide technical fest (INFINITE TECHFEST'26): eight departments, their events,
 * and the registrations made at each department's desks or imported from the online form.
 *
 * Shared by the API and the dashboards: types, the starting catalog (the web assist team
 * edits it in the dashboard), registration IDs, field checks, CSV reading and the totals
 * every live view shows. Plain data and pure functions only.
 */

// ------------------------------------------------------------------------------------------
// Departments and events (the catalog)

export interface FestContact {
  name: string;
  phone: string;
}

export interface FestDepartment {
  /** 'CSE': the prefix of its registration IDs (CSE-0147). Never changes once registrations exist. */
  code: string;
  name: string;
  /** The head of the department, as shown on their live view. */
  hod: string;
  staffCoordinator: FestContact | null;
  studentCoordinator: FestContact | null;
  /** Registration desks (desk logins 1..desks). */
  desks: number;
  active: boolean;
}

export interface FestEvent {
  /** 'cse-hackathon': lower-case, unique. */
  id: string;
  /** The department's code. */
  dept: string;
  name: string;
  /** e.g. 'Ideathon', 'Using Claude AI'. */
  subtitle: string;
  venue: string;
  /** e.g. '10:30 AM – 12:30 PM'. */
  time: string;
  /** The event fee in rupees, paid to its coordinators. */
  fee: number;
  /** Team size: 1–1 individual; 1–4 individual or a team of up to 4. */
  teamMin: number;
  teamMax: number;
  active: boolean;
}

export interface FestCatalog {
  revision: number;
  /** The entry fee in rupees, paid at the desk (or online). */
  entryFee: number;
  /** The UPI account students pay the entry fee to when they register themselves (shown on their page). */
  upiId?: string;
  upiPayee?: string;
  departments: FestDepartment[];
  events: FestEvent[];
  updatedAt: string | null;
  updatedBy: string | null;
}

const contact = (name: string, phone: string): FestContact => ({ name, phone });

/** Events as on the poster: [id suffix, name, subtitle]. */
const POSTER: Record<string, { name: string; hod: string; staff: FestContact; student: FestContact; events: [string, string, string][] }> = {
  CSE: {
    name: 'Computer Science and Engineering',
    hod: '',
    staff: contact('Mr. M. Ramesh', '9500535551'),
    student: contact('Mr. P. Bhuvankumar', '9342232411'),
    events: [
      ['future-minds', 'Future Minds', 'Ideathon'],
      ['hackathon', 'Hackathon', ''],
      ['project-expo', 'Project Expo', 'Mobile Application Development'],
      ['snap-with-ai', 'Snap with AI', 'Poster Making'],
      ['cyber-hunt', 'Cyber Hunt', 'Technical Quiz'],
      ['ai-prompt-battle', 'AI Prompt Battle', 'Using Claude AI'],
    ],
  },
  AIDS: {
    name: 'Artificial Intelligence and Data Science',
    hod: '',
    staff: contact('Mrs. S. Priyanka', '9025593180'),
    student: contact('Mr. Balajimanikandhaan S S', '7358213736'),
    events: [
      ['paper-presentation', 'Paper Presentation', ''],
      ['pro-pitch', 'Pro-pitch', 'Prompt to app'],
      ['viz-craft', 'Viz Craft', 'Data visualization'],
      ['code-flex', 'Code Flex', 'Multi-language coding challenge'],
      ['cognix', 'Cognix', 'Quiz'],
    ],
  },
  IT: {
    name: 'Information Technology',
    hod: '',
    staff: contact('Mrs. A. Santhi', '8667845282'),
    student: contact('Ms. G. Akshaya', '6381761876'),
    events: [
      ['inno-papers', 'Paper Presentation', 'Inno Papers – The Spectrum of Innovation'],
      ['claude-prompt-battle', 'Claude Prompt Battle', ''],
      ['web-architects', 'Web Architects', ''],
      ['code-debugging', 'Code Debugging', ''],
      ['poster-pitch', 'Poster Pitch', ''],
      ['project-presentation', 'Project Presentation', ''],
    ],
  },
  ECE: {
    name: 'Electronics and Communication Engineering',
    hod: '',
    staff: contact('Mrs. S. Apshanaparvin', '9943044232'),
    student: contact('Mr. N. S. Shamraj', '9894183263'),
    events: [
      ['paper-presentation', 'Paper Presentation', ''],
      ['project-expo', 'Project Expo', ''],
      ['circuit-debugging', 'Circuit Debugging', ''],
      ['dronova', 'Dronova', ''],
      ['tech-escape-room', 'Tech Escape Room', ''],
      ['ece-hackathon', 'ECE Hackathon', ''],
    ],
  },
  CYS: {
    name: 'Computer Science and Engineering (Cyber Security)',
    hod: '',
    staff: contact('Mr. C. Mahavishu', '9629039155'),
    student: contact('Ms. R. Kavisri', '6374794582'),
    events: [
      ['cyber-paper-presentation', 'Cyber Paper Presentation', ''],
      ['cyber-hunt', 'Cyber Hunt', 'Technical Quiz'],
      ['phishguard', 'PhishGuard', 'Phishing Website Detection'],
      ['cyber-escape-room', 'Cyber Escape Room', ''],
      ['cybersecurity-spotlight', 'Cybersecurity Spotlight', 'Tech Talks'],
      ['cybersecure-hackathon', 'CyberSecure Hackathon', ''],
    ],
  },
  EEE: {
    name: 'Electrical and Electronics Engineering',
    hod: '',
    staff: contact('Mr. M. Dineshkumar', '9626132311'),
    student: contact('Mr. G. Santhosh', '8667685436'),
    events: [
      ['paper-presentation', 'Paper Presentation', ''],
      ['project-expo', 'Project Expo', ''],
      ['technical-quiz', 'Technical Quiz', ''],
      ['circuit-warriors', 'Circuit Warriors', ''],
      ['machine-master', 'Machine Master', ''],
    ],
  },
  MECH: {
    name: 'Mechanical Engineering',
    hod: '',
    staff: contact('Mr. S. Vijayakumar', '9629723720'),
    student: contact('Mr. N. Jayanishanth', '7200116278'),
    events: [
      ['paper-presentation', 'Paper Presentation', ''],
      ['mech-hack-x', 'Mech Hack X', ''],
      ['project-xplore', 'Project Xplore', ''],
      ['poster-pro', 'Poster Pro', ''],
      ['brain-bolt', 'Quiz – Brain Bolt', ''],
      ['aqua-rocket', 'Aqua Rocket', ''],
    ],
  },
  SH: {
    name: 'Science and Humanities',
    hod: '',
    staff: contact('Dr. K. Saranya', '9789158113'),
    student: contact('Mr. Shaher', '7418119675'),
    events: [
      ['paper-presentation-physics', 'Paper Presentation', 'Physics'],
      ['poster-presentation-chemistry', 'Poster Presentation', 'Chemistry'],
      ['extempore-speech', 'Extempore Speech', 'English'],
      ['math-puzzles', 'Math Puzzles & Logic Quiz', 'Maths'],
    ],
  },
};

/** The catalog before the web assist team changes anything: the poster's departments and events. */
export const DEFAULT_CATALOG: FestCatalog = {
  revision: 0,
  entryFee: 100,
  departments: Object.entries(POSTER).map(([code, item]) => ({
    code,
    name: item.name,
    hod: item.hod,
    staffCoordinator: item.staff,
    studentCoordinator: item.student,
    desks: 4,
    active: true,
  })),
  events: Object.entries(POSTER).flatMap(([code, item]) =>
    item.events.map(([slug, name, subtitle]) => ({
      id: `${code.toLowerCase()}-${slug}`,
      dept: code,
      name,
      subtitle,
      venue: '',
      time: '',
      fee: 50,
      // Team rules are set per event by the web assist team; until then, individual or a team of up to 4.
      teamMin: 1,
      teamMax: 4,
      active: true,
    })),
  ),
  updatedAt: null,
  updatedBy: null,
};

export const DEPT_CODE = /^[A-Z]{2,6}$/;
export const EVENT_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;

export const departmentOf = (catalog: FestCatalog, code: string | null | undefined) => catalog.departments.find((dept) => dept.code === code) ?? null;
export const eventOf = (catalog: FestCatalog, id: string) => catalog.events.find((event) => event.id === id) ?? null;
export const eventsOf = (catalog: FestCatalog, dept: string, { all = false } = {}) => catalog.events.filter((event) => event.dept === dept && (all || event.active));
export const eventLabel = (event: Pick<FestEvent, 'name' | 'subtitle'>) => (event.subtitle ? `${event.name} (${event.subtitle})` : event.name);
export const teamRule = (event: Pick<FestEvent, 'teamMin' | 'teamMax'>) =>
  event.teamMax <= 1 ? 'Individual' : event.teamMin <= 1 ? `Individual or team of up to ${event.teamMax}` : `Team of ${event.teamMin}–${event.teamMax}`;

/** What is wrong with a catalog, or null. */
export function catalogProblem(catalog: FestCatalog): string | null {
  if (!Number.isInteger(catalog.entryFee) || catalog.entryFee < 0 || catalog.entryFee > 10_000) return 'The entry fee must be a whole number of rupees.';
  if (catalog.upiId && !UPI_ID.test(catalog.upiId)) return 'The UPI ID looks wrong (like name@bank).';
  if (catalog.upiPayee && catalog.upiPayee.length > 80) return 'The account holder name is too long.';
  const codes = new Set<string>();
  for (const dept of catalog.departments) {
    if (!DEPT_CODE.test(dept.code)) return `Department code "${dept.code}" must be 2–6 capital letters.`;
    if (codes.has(dept.code)) return `Two departments use the code ${dept.code}.`;
    codes.add(dept.code);
    if (!dept.name.trim()) return `Department ${dept.code} needs a name.`;
    if (!Number.isInteger(dept.desks) || dept.desks < 1 || dept.desks > 20) return `Department ${dept.code}: desks must be 1–20.`;
  }
  const ids = new Set<string>();
  for (const event of catalog.events) {
    if (!EVENT_ID.test(event.id)) return `Event id "${event.id}" must be lower-case letters, digits and dashes.`;
    if (ids.has(event.id)) return `Two events use the id ${event.id}.`;
    ids.add(event.id);
    if (!codes.has(event.dept)) return `Event ${event.name || event.id} belongs to an unknown department (${event.dept}).`;
    if (!event.name.trim()) return `Event ${event.id} needs a name.`;
    if (!Number.isInteger(event.fee) || event.fee < 0 || event.fee > 10_000) return `${event.name}: the fee must be a whole number of rupees.`;
    if (!Number.isInteger(event.teamMin) || !Number.isInteger(event.teamMax) || event.teamMin < 1 || event.teamMax < event.teamMin || event.teamMax > 20) {
      return `${event.name}: the team size must be between 1 and 20, smallest first.`;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------
// Registrations

export type FestSource = 'DESK' | 'ONLINE' | 'PAPER' | 'SELF';

export type FestMethod = 'CASH' | 'UPI' | 'ONLINE';

/** Who recorded what, and when. */
export interface FestStamp {
  at: string;
  by: string;
}

export interface FestPayment extends FestStamp {
  method: FestMethod;
  amount: number;
  /** The UPI transaction ID, when paid by UPI. */
  txn?: string;
  desk?: number;
  /** Cancelled by an admin (e.g. recorded by mistake). */
  voided?: FestStamp & { reason: string };
}

export interface FestEntry {
  eventId: string;
  added: FestStamp;
  fee?: FestPayment;
  present?: FestStamp;
}

/** The UPI transaction ID a student typed when registering themselves, waiting for a desk to check it. */
export interface FestClaim {
  txn: string;
  amount: number;
  at: string;
}

export interface FestRegistration {
  /** 'CSE-0147', or '20017' for a student who registered themselves. */
  id: string;
  dept: string;
  source: FestSource;
  name: string;
  phone: string;
  email: string;
  college: string;
  /** The student's own branch (e.g. 'B.E. CSE'). */
  branch: string;
  year: string;
  team: string;
  /**
   * The entry fee. A self-registered student starts DUE with `claim` (the transaction ID they
   * typed); a desk verifies it (PAID, with the payment) or marks it not received (`rejected`).
   */
  entry: { status: 'PAID' | 'DUE'; payment?: FestPayment; claim?: FestClaim; rejected?: FestStamp & { reason: string } };
  /** An online registrant arrived at the desk. */
  checkedIn?: FestStamp & { desk?: number };
  events: FestEntry[];
  desk?: number;
  created: FestStamp;
  /** The online form's own reference, if it gave one. */
  ref?: string;
  cancelled?: FestStamp & { reason: string };
  deleted?: FestStamp & { reason: string };
  /** Made during a test session (deleted with the test data). */
  test?: boolean;
  /** The desk's submission this came from (a retry finds it instead of registering twice). */
  sid?: string;
  /** Version (each change adds one) and change stamp (for the live updates). */
  v: number;
  u: string;
}

export interface FestPlace {
  place: number;
  /** Registration IDs: one, or a whole team. */
  ids: string[];
  team?: string;
}

export interface FestResult {
  eventId: string;
  dept: string;
  places: FestPlace[];
  saved: FestStamp | null;
  submitted?: FestStamp;
  reopened?: (FestStamp & { reason: string })[];
  v: number;
  u: string;
}

/**
 * The numbers each source uses within a department: CSE-0001… at the desks, CSE-2001… for students
 * who registered on their own phone, CSE-5001… online, CSE-9001… on paper.
 */
export const ID_RANGES: Record<FestSource, { first: number; last: number }> = {
  DESK: { first: 1, last: 1999 },
  SELF: { first: 2001, last: 4999 },
  ONLINE: { first: 5001, last: 8999 },
  PAPER: { first: 9001, last: 9999 },
};

/** How many IDs a desk phone takes at a time, and when it asks for more. */
export const ID_BLOCK = 50;
export const ID_TOP_UP_AT = 15;

/**
 * How a department's code is shown to people: AIDS reads as AI&DS, CYS as CYBER, SH as S&H. The code itself stays in web
 * addresses (/landing/aids/admin/), usernames (aids-desk1), event IDs and stored records, where
 * '&' would break things.
 */
const SHOWN_CODES: Record<string, string> = { AIDS: 'AI&DS', CYS: 'CYBER', SH: 'S&H' };
export const deptShort = (code: string) => SHOWN_CODES[code] ?? code;
/** How a registration ID is shown: 'AIDS-0007' → 'AI&DS-0007' (others unchanged). */
export const showId = (id: string) => {
  const match = /^([A-Z]{2,6})-(\d{4})$/.exec(id);
  return match && SHOWN_CODES[match[1]] ? `${SHOWN_CODES[match[1]]}-${match[2]}` : id;
};
/** 'AI&DS-7', 'ai & ds 7' → 'AIDS-7'; 'cyber 7' → 'CYS-7'; 'S&H-7' → 'SH-7' (then read as usual). */
const typedCode = (input: string) =>
  Object.entries(SHOWN_CODES).reduce((text, [code, shown]) => text.replace(new RegExp(shown.replace(/[&]/g, '\\s*&\\s*'), 'i'), code), input);

export const FEST_ID = /^([A-Z]{2,6})-(\d{4})$/;
export const formatFestId = (dept: string, number: number) => `${dept}-${String(number).padStart(4, '0')}`;
export const parseFestId = (id: string) => {
  const match = FEST_ID.exec(id);
  return match ? { dept: match[1], number: Number(match[2]) } : null;
};
export const sourceOfNumber = (number: number): FestSource | null =>
  (Object.entries(ID_RANGES) as [FestSource, { first: number; last: number }][]).find(([, range]) => number >= range.first && number <= range.last)?.[0] ?? null;

/** 'cse 147', 'cse0147', 'CSE-147' → 'CSE-0147'; '' when it does not look like an ID. */
export function normaliseFestId(input: string): string {
  const match = /^\s*([a-z]{2,6})\s*-?\s*(\d{1,4})\s*$/i.exec(typedCode(input));
  return match ? formatFestId(match[1].toUpperCase(), Number(match[2])) : '';
}

/** IDs typed in a list ('CSE-0001, cse 2; CSE-0003 CSE-0004') → ['CSE-0001', 'CSE-0002', …], each once. */
export function parseIdList(text: string): string[] {
  const ids: string[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const whole = normaliseFestId(part);
    for (const id of whole ? [whole] : part.split(/\s+/).map(normaliseFestId)) if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** What a student sees of their own registration (their page, signed in with ID and mobile number). */
export interface StudentView {
  id: string;
  dept: string;
  name: string;
  college: string;
  branch: string;
  year: string;
  team: string;
  /** The last 4 digits of the mobile number, to show whose page this is. */
  phoneEnd: string;
  /** waiting: the desk has not checked the transaction ID yet; rejected: the desk did not find the payment. */
  status: 'verified' | 'waiting' | 'rejected' | 'due' | 'cancelled';
  /** The last 4 characters of the transaction ID (the desks see it whole). */
  txnEnd: string;
  /** False when opened with only the ID and mobile number: events and the transaction ID are changed from the phone that registered. */
  canChange: boolean;
  reason: string;
  entryFee: number;
  events: { eventId: string; feePaid: boolean; present: boolean }[];
  createdAt: string;
}

export function toStudentView(registration: FestRegistration, canChange = false): StudentView {
  const { entry } = registration;
  return {
    id: registration.id,
    dept: registration.dept,
    name: registration.name,
    college: registration.college,
    branch: registration.branch,
    year: registration.year,
    team: registration.team,
    phoneEnd: registration.phone.slice(-4),
    status: !isActive(registration) ? 'cancelled' : entry.status === 'PAID' ? 'verified' : entry.rejected ? 'rejected' : entry.claim ? 'waiting' : 'due',
    txnEnd: (entry.claim?.txn ?? entry.payment?.txn ?? '').slice(-4),
    canChange,
    reason: entry.rejected?.reason ?? '',
    entryFee: entry.claim?.amount ?? entry.payment?.amount ?? 0,
    events: registration.events.map((item) => ({ eventId: item.eventId, feePaid: feePaid(item), present: Boolean(item.present) })),
    createdAt: registration.created.at,
  };
}

/** The UPI account for the entry fee, until the web assist team sets one in Departments & events. */
export const DEFAULT_UPI = { upiId: '9342060452@nyes', upiPayee: 'Mrs Jayanthi Parthasarathy' };
export const UPI_ID = /^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,40}$/;
/** A UPI transaction ID (UTR) or bank reference: letters and digits. */
export const TXN = /^[A-Za-z0-9]{6,35}$/;

/** A student takes part in their own department's events. */
export const canJoin = (registration: Pick<FestRegistration, 'dept'>, event: Pick<FestEvent, 'dept'>) => registration.dept === event.dept;
/** A self-registered student whose transaction ID waits for a desk. */
export const awaitingCheck = (registration: FestRegistration) => registration.entry.status === 'DUE' && Boolean(registration.entry.claim) && !registration.entry.rejected;
/** The department's name, or what a self-registered student's "department" is called. */
export const deptLabel = (catalog: FestCatalog | null, code: string) => (catalog && departmentOf(catalog, code)?.name) || deptShort(code);

/** Neither cancelled nor deleted: counts everywhere. */
export const isActive = (registration: Pick<FestRegistration, 'cancelled' | 'deleted'>) => !registration.cancelled && !registration.deleted;
export const entryOf = (registration: FestRegistration, eventId: string) => registration.events.find((item) => item.eventId === eventId) ?? null;
export const feePaid = (entry: FestEntry | null) => Boolean(entry?.fee && !entry.fee.voided);

// ------------------------------------------------------------------------------------------
// The student's details (checked the same way in the browser and by the API)

export interface FestParticipant {
  name: string;
  phone: string;
  email: string;
  college: string;
  branch: string;
  year: string;
  team: string;
}

export const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'PG'] as const;

const NAME = /^[\p{L}][\p{L}\p{M} .']{1,79}$/u;
const PHONE = /^[6-9]\d{9}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** '+91 98765-43210' → '9876543210'. */
export const tidyPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
};
const tidy = (value: unknown, max = 120) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The participant from any input, tidied (spaces, phone digits, lower-case email). */
export function readParticipant(input: unknown): FestParticipant {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return {
    name: tidy(value.name, 80),
    phone: tidyPhone(tidy(value.phone, 30)),
    email: tidy(value.email, 254).toLowerCase(),
    college: tidy(value.college, 160),
    branch: tidy(value.branch, 120),
    year: tidy(value.year, 20),
    team: tidy(value.team, 60),
  };
}

/** What is wrong with each field (empty when fine). Email, branch, year and team are optional. */
export function participantProblems(participant: FestParticipant): Partial<Record<keyof FestParticipant, string>> {
  const problems: Partial<Record<keyof FestParticipant, string>> = {};
  if (!NAME.test(participant.name)) problems.name = 'Enter the name (letters, spaces and dots).';
  if (!PHONE.test(participant.phone)) problems.phone = 'Enter a 10-digit mobile number.';
  if (participant.email && !EMAIL.test(participant.email)) problems.email = 'Check the email address.';
  if (participant.college.length < 2) problems.college = 'Enter the college.';
  if (participant.team && participant.team.length < 2) problems.team = 'Team names have at least 2 letters.';
  return problems;
}

// ------------------------------------------------------------------------------------------
// CSV (the online form's export, and downloads)

/** Rows of a CSV text (quotes, commas and line breaks inside quotes, a BOM, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

/** One CSV line per row; cells quoted when needed. Starting '=', '+', '-' or '@' are kept as text. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // A byte-order mark first, so Excel reads the names as UTF-8.
  return `${String.fromCharCode(BOM)}${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** The byte-order mark some programs put at the start of a CSV file. */
const BOM = 0xfeff;

/** The column each detail comes from, guessed from the header row. */
export type ImportField = keyof FestParticipant | 'events' | 'ref';
export const IMPORT_FIELDS: { field: ImportField; label: string; required: boolean; hints: RegExp }[] = [
  { field: 'name', label: 'Name', required: true, hints: /^(full ?)?name|participant|student/i },
  { field: 'phone', label: 'Phone', required: true, hints: /phone|mobile|contact|whats ?app/i },
  { field: 'email', label: 'Email', required: false, hints: /e-?mail/i },
  { field: 'college', label: 'College', required: true, hints: /college|institut|university|school/i },
  { field: 'branch', label: 'Branch', required: false, hints: /branch|department|dept|course|stream/i },
  { field: 'year', label: 'Year', required: false, hints: /year|semester|sem\b/i },
  { field: 'events', label: 'Events', required: true, hints: /event/i },
  { field: 'team', label: 'Team name', required: false, hints: /team/i },
  { field: 'ref', label: 'Reference', required: false, hints: /^(id|ref|reference|submission|order|transaction|utr)/i },
];

/** For each field, the column whose header matches best (-1 when none). */
export function guessColumns(header: string[]): Record<ImportField, number> {
  const used = new Set<number>();
  const result = {} as Record<ImportField, number>;
  for (const { field, hints } of IMPORT_FIELDS) {
    const index = header.findIndex((title, column) => !used.has(column) && hints.test(title.trim()));
    result[field] = index;
    if (index >= 0) used.add(index);
  }
  return result;
}

/** Event names as typed on a form ('Hackathon; Snap with AI') → the department's events, and what did not match. */
export function matchEvents(catalog: FestCatalog, dept: string, text: string): { ids: string[]; unknown: string[] } {
  const events = eventsOf(catalog, dept, { all: true });
  const simple = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const part of text.split(/[,;|/\n]+/).map((value) => value.trim()).filter(Boolean)) {
    const key = simple(part);
    const found =
      events.find((event) => simple(event.id) === key || simple(event.name) === key || simple(eventLabel(event)) === key) ??
      events.find((event) => key.includes(simple(event.name)) || simple(event.name).includes(key));
    if (found && !ids.includes(found.id)) ids.push(found.id);
    else if (!found) unknown.push(part);
  }
  return { ids, unknown };
}

// ------------------------------------------------------------------------------------------
// Colleges (the overall coordinator's college-wise view)

/** 'Sona College of Technology, Salem.' → 'sona college of technology salem': one college however it is typed. */
export const collegeKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface CollegeRow {
  key: string;
  /** As most of its students typed it. */
  name: string;
  students: number;
  /** Places won in submitted results (a team counts once for its college). */
  first: number;
  second: number;
  third: number;
  places: number;
}

/** Students per college, and the 1st, 2nd and 3rd places its students won (submitted results only). */
export function collegeSummary(registrations: Iterable<FestRegistration>, results: Iterable<FestResult>): CollegeRow[] {
  const rows = new Map<string, CollegeRow & { spellings: Map<string, number> }>();
  const byId = new Map<string, FestRegistration>();
  const rowOf = (college: string) => {
    const key = collegeKey(college);
    let row = rows.get(key);
    if (!row) {
      row = { key, name: college || 'Not given', students: 0, first: 0, second: 0, third: 0, places: 0, spellings: new Map() };
      rows.set(key, row);
    }
    return row;
  };
  for (const registration of registrations) {
    if (!isActive(registration)) continue;
    byId.set(registration.id, registration);
    const row = rowOf(registration.college);
    row.students += 1;
    row.spellings.set(registration.college, (row.spellings.get(registration.college) ?? 0) + 1);
  }
  for (const result of results) {
    if (!result.submitted) continue;
    for (const place of result.places) {
      const colleges = new Set(place.ids.map((id) => byId.get(id)).filter((item): item is FestRegistration => Boolean(item)).map((item) => collegeKey(item.college)));
      for (const key of colleges) {
        const row = rows.get(key);
        if (!row) continue;
        if (place.place === 1) row.first += 1;
        else if (place.place === 2) row.second += 1;
        else if (place.place === 3) row.third += 1;
        row.places += 1;
      }
    }
  }
  return [...rows.values()]
    .map(({ spellings, ...row }) => ({ ...row, name: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Not given' }))
    .sort((a, b) => b.places - a.places || b.first - a.first || b.second - a.second || b.students - a.students || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------------------------------
// Totals (computed in the browser from the live data)

export interface FestTotals {
  registered: number;
  desk: number;
  online: number;
  paper: number;
  /** Registered themselves on their phone; `awaiting`: their transaction ID not checked yet. */
  self: number;
  awaiting: number;
  checkedIn: number;
  entryDue: number;
  /** Entry fees received at the desks, by method (online payments counted apart). */
  entryCash: number;
  entryUpi: number;
  entryOnline: number;
  /** Event registrations, fees and attendance. */
  eventEntries: number;
  feesPaid: number;
  feeCash: number;
  feeUpi: number;
  present: number;
}

export function totalsOf(registrations: Iterable<FestRegistration>, eventId?: string): FestTotals {
  const totals: FestTotals = {
    registered: 0,
    desk: 0,
    online: 0,
    paper: 0,
    self: 0,
    awaiting: 0,
    checkedIn: 0,
    entryDue: 0,
    entryCash: 0,
    entryUpi: 0,
    entryOnline: 0,
    eventEntries: 0,
    feesPaid: 0,
    feeCash: 0,
    feeUpi: 0,
    present: 0,
  };
  for (const registration of registrations) {
    if (!isActive(registration)) continue;
    if (eventId && !entryOf(registration, eventId)) continue;
    totals.registered += 1;
    if (registration.source === 'DESK') totals.desk += 1;
    else if (registration.source === 'ONLINE') totals.online += 1;
    else if (registration.source === 'SELF') totals.self += 1;
    else totals.paper += 1;
    if (awaitingCheck(registration)) totals.awaiting += 1;
    if (registration.source === 'ONLINE' || registration.source === 'SELF' ? registration.checkedIn : true) totals.checkedIn += 1;
    const payment = registration.entry.payment;
    if (registration.entry.status === 'DUE') totals.entryDue += 1;
    else if (payment && !payment.voided) {
      if (payment.method === 'CASH') totals.entryCash += payment.amount;
      else if (payment.method === 'UPI') totals.entryUpi += payment.amount;
      else totals.entryOnline += payment.amount;
    }
    for (const entry of registration.events) {
      if (eventId && entry.eventId !== eventId) continue;
      totals.eventEntries += 1;
      if (feePaid(entry)) {
        totals.feesPaid += 1;
        if (entry.fee!.method === 'UPI') totals.feeUpi += entry.fee!.amount;
        else totals.feeCash += entry.fee!.amount;
      }
      if (entry.present) totals.present += 1;
    }
  }
  return totals;
}

export const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
