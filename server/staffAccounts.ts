/**
 * Staff accounts for the event day (desk, coordinators, certificate team, more admins),
 * kept in the Control table. The ADMIN_USERNAME secret stays the owner's account and is
 * never stored here. Passwords are kept only as scrypt hashes, made on the server.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import { DESKS, departmentOf, tidyPhone, type FestCatalog } from '../src/lib/fest';
import { DEPARTMENT_REQUIRED, DEPARTMENT_ROLES, STAFF_USERNAME, isStaffRole, type StaffAccountView, type StaffRole } from '../src/lib/staff';
import { hashPassword, passwordProblem, sha256 } from './auth';
import { ApiError } from './errors';
import type { Actor } from './roles';
import type { StaffAccount, Store } from './store';

const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'()&-]{1,59}$/u;
/** Their own department or class ('B.E. CSE', 'AI&DS') and year ('3rd Year'): short plain text. */
const CONTACT_TEXT = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'()&/-]{0,39}$/u;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Changes whenever the account's password changes: sessions made before then end. */
export const staffCredential = (account: Pick<StaffAccount, 'username' | 'passwordHash'>) =>
  sha256(`staff\n${account.username}\n${account.passwordHash}`);

export function staffView(account: StaffAccount): StaffAccountView {
  return {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    eventIds: account.eventIds,
    department: account.department ?? null,
    deskNumber: account.deskNumber ?? null,
    studyDept: account.studyDept ?? '',
    year: account.year ?? '',
    phone: account.phone ?? '',
    active: account.active,
    createdAt: account.createdAt,
    createdBy: account.createdBy,
    updatedAt: account.updatedAt,
    updatedBy: account.updatedBy,
    passwordChangedAt: account.passwordChangedAt,
    lastSignInAt: account.lastSignInAt ?? null,
  };
}

function readRole(value: unknown): StaffRole {
  if (!isStaffRole(value)) throw new ApiError(400, 'INVALID', 'Choose a role: Web assist team, Overall coordinator, Department HOD, Department admin, Registration desk or Event coordinator.');
  return value;
}

/** The department of a department role (from the catalog); null for roles that see every department. */
function readDepartment(catalog: FestCatalog, value: unknown, role: StaffRole): string | null {
  if (!DEPARTMENT_ROLES.includes(role)) return null;
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!code) {
    if (DEPARTMENT_REQUIRED.includes(role)) throw new ApiError(400, 'INVALID', 'Choose the department.');
    return null;
  }
  if (!departmentOf(catalog, code)) throw new ApiError(400, 'INVALID', 'Choose a department from the list.');
  return code;
}

/**
 * Coordinators need at least one event: of their department (from the catalog), or, for an
 * account with no department, of the symposium's own list. Every other role keeps none.
 */
function readEvents(catalog: FestCatalog, value: unknown, role: StaffRole, department: string | null): string[] {
  if (role !== 'COORDINATOR') return [];
  const requested = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  const allowed = department ? catalog.events.filter((event) => event.dept === department).map((event) => event.id) : eventCatalog.map((event) => event.id);
  if (requested.some((id) => !allowed.includes(id))) {
    throw new ApiError(400, 'INVALID', department ? `Assign ${department} events only.` : 'Assign events from the list only.');
  }
  const eventIds = allowed.filter((id) => requested.includes(id));
  if (!eventIds.length) throw new ApiError(400, 'INVALID', 'Assign at least one event to a coordinator.');
  return eventIds;
}

/** A department's desk accounts are desks 1..its number of desks. */
function readDesk(catalog: FestCatalog, value: unknown, role: StaffRole, department: string | null): number | undefined {
  if (role !== 'DESK' || !department) return undefined;
  // Every department has two desks, whatever an older catalog says.
  const desks = departmentOf(catalog, department) ? DESKS : 0;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > desks) throw new ApiError(400, 'INVALID', `Choose the desk: 1 to ${desks}.`);
  return number;
}

function readDisplayName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!DISPLAY_NAME.test(name)) throw new ApiError(400, 'INVALID', 'Enter the student coordinator’s name (2–60 letters).');
  return name;
}

/**
 * How to reach the person given this login (all optional): their own department, year and mobile
 * number. Only the fields sent; an empty one clears it.
 */
function readContact(body: Record<string, unknown>): Partial<Pick<StaffAccount, 'studyDept' | 'year' | 'phone'>> {
  const contact: Partial<Pick<StaffAccount, 'studyDept' | 'year' | 'phone'>> = {};
  for (const [field, label] of [
    ['studyDept', 'their department'],
    ['year', 'their year'],
  ] as const) {
    const raw = body[field];
    if (raw === undefined) continue;
    const value = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (value && !CONTACT_TEXT.test(value)) throw new ApiError(400, 'INVALID', `Check ${label}: up to 40 letters, digits and simple punctuation.`);
    contact[field] = value;
  }
  if (body.phone !== undefined) {
    const phone = typeof body.phone === 'string' ? tidyPhone(body.phone) : '';
    if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, 'INVALID', 'Check their mobile number: 10 digits.');
    contact.phone = phone;
  }
  return contact;
}

async function readPassword(value: unknown): Promise<string> {
  // Never with spaces at its ends: a password copied from a page often brings one along.
  const password = typeof value === 'string' ? value.slice(0, 200).trim() : '';
  const problem = passwordProblem(password);
  if (problem) throw new ApiError(400, 'WEAK_PASSWORD', `Password: ${problem}`);
  return hashPassword(password);
}

export class StaffAccounts {
  constructor(
    private readonly deps: {
      store: Store;
      /** The owner's username (ADMIN_USERNAME): no staff account may use it. */
      ownerUsername: string;
      /** The fest's departments and events (for department roles). */
      catalog: () => Promise<FestCatalog>;
      now: () => number;
      log: (message: string, details?: Record<string, unknown>) => void;
    },
  ) {}

  private iso() {
    return new Date(this.deps.now()).toISOString();
  }

  async list(): Promise<{ success: true; staff: StaffAccountView[] }> {
    return { success: true, staff: (await this.deps.store.listStaff()).map(staffView) };
  }

  async create(actor: Actor, body: unknown): Promise<{ success: true; account: StaffAccountView }> {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The account could not be read.');
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!STAFF_USERNAME.test(username)) {
      throw new ApiError(400, 'INVALID', 'Usernames are 3–32 lower-case letters, digits, dots, dashes or underscores.');
    }
    // 'delete-all' is the address of Delete every account, not a username.
    if (username === this.deps.ownerUsername.toLowerCase() || username === 'delete-all') {
      throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already in use.');
    }
    const role = readRole(body.role);
    const catalog = await this.deps.catalog();
    const department = readDepartment(catalog, body.department, role);
    const deskNumber = readDesk(catalog, body.deskNumber, role, department);
    const now = this.iso();
    const account: StaffAccount = {
      username,
      displayName: readDisplayName(body.displayName),
      role,
      eventIds: readEvents(catalog, body.eventIds, role, department),
      ...(department && { department }),
      ...(deskNumber && { deskNumber }),
      ...readContact(body),
      passwordHash: await readPassword(body.password),
      active: true,
      createdAt: now,
      createdBy: actor.username,
      updatedAt: now,
      updatedBy: actor.username,
      passwordChangedAt: now,
      revision: 1,
    };
    if (!(await this.deps.store.saveStaff(account, 0))) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already in use.');
    }
    this.deps.log('Staff account created', { username, role, by: actor.username });
    return { success: true, account: staffView(account) };
  }

  /** Changes name, role, events, active state and/or password; only the fields sent. */
  async update(actor: Actor, username: string, body: unknown): Promise<{ success: true; account: StaffAccountView }> {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The change could not be read.');
    const key = username.toLowerCase();
    const passwordHash = body.password === undefined ? null : await readPassword(body.password);
    const catalog = await this.deps.catalog();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.deps.store.getStaff(key);
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'There is no such student coordinator account.');
      const role = body.role === undefined ? current.role : readRole(body.role);
      const active = body.active === undefined ? current.active : body.active === true;
      if (actor.kind === 'staff' && actor.username === key && (!active || role !== 'ADMIN')) {
        throw new ApiError(400, 'INVALID', 'You cannot remove your own admin access. Ask another admin.');
      }
      const now = this.iso();
      const sameScope = role === current.role && body.department === undefined;
      const department = sameScope ? (current.department ?? null) : readDepartment(catalog, body.department ?? current.department, role);
      const deskNumber =
        role === current.role && body.deskNumber === undefined && department === (current.department ?? null) ? current.deskNumber : readDesk(catalog, body.deskNumber ?? current.deskNumber, role, department);
      const next: StaffAccount = {
        ...current,
        displayName: body.displayName === undefined ? current.displayName : readDisplayName(body.displayName),
        role,
        eventIds:
          body.eventIds === undefined && sameScope ? current.eventIds : readEvents(catalog, body.eventIds ?? current.eventIds, role, department),
        department: department ?? undefined,
        deskNumber,
        ...readContact(body),
        active,
        ...(passwordHash && { passwordHash, passwordChangedAt: now }),
        updatedAt: now,
        updatedBy: actor.username,
        revision: current.revision + 1,
      };
      if (await this.deps.store.saveStaff(next, current.revision)) {
        this.deps.log('Staff account changed', {
          username: key,
          role: next.role,
          active: next.active,
          passwordChanged: Boolean(passwordHash),
          by: actor.username,
        });
        return { success: true, account: staffView(next) };
      }
    }
    throw new ApiError(409, 'BUSY', 'The account was changed by someone else at the same moment. Please reload and try again.');
  }

  /** Signs the person out on every device now (e.g. a lost phone); they can sign in again. */
  async signOut(actor: Actor, username: string): Promise<{ success: true; signedOut: string }> {
    const key = username.toLowerCase();
    if (actor.kind === 'staff' && actor.username === key) throw new ApiError(400, 'INVALID', 'Use Sign out at the top to sign yourself out.');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.deps.store.getStaff(key);
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'There is no such student coordinator account.');
      const now = this.iso();
      const next: StaffAccount = { ...current, signedOutAt: now, updatedAt: now, updatedBy: actor.username, revision: current.revision + 1 };
      if (await this.deps.store.saveStaff(next, current.revision)) {
        this.deps.log('Staff member signed out', { username: key, by: actor.username });
        return { success: true, signedOut: key };
      }
    }
    throw new ApiError(409, 'BUSY', 'The account was changed by someone else at the same moment. Please reload and try again.');
  }

  /**
   * Deletes the account (e.g. one made for testing): it can no longer sign in and anyone
   * signed in with it is signed out at their next request. What it recorded keeps its name.
   */
  async remove(actor: Actor, username: string): Promise<{ success: true; deleted: string }> {
    const key = username.toLowerCase();
    if (actor.kind === 'staff' && actor.username === key) throw new ApiError(400, 'INVALID', 'You cannot delete your own account. Ask another admin.');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.deps.store.getStaff(key);
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'There is no such student coordinator account.');
      if (await this.deps.store.deleteStaff(key, current.revision)) {
        this.deps.log('Staff account deleted', { username: key, role: current.role, by: actor.username });
        return { success: true, deleted: key };
      }
    }
    throw new ApiError(409, 'BUSY', 'The account was changed by someone else at the same moment. Please reload and try again.');
  }
}
