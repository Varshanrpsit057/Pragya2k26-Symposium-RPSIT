/**
 * Staff accounts for the event day (desk, coordinators, certificate team, more admins),
 * kept in the Control table. The ADMIN_USERNAME secret stays the owner's account and is
 * never stored here. Passwords are kept only as scrypt hashes, made on the server.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import { STAFF_USERNAME, isStaffRole, type StaffAccountView, type StaffRole } from '../src/lib/staff';
import { hashPassword, passwordProblem, sha256 } from './auth';
import { ApiError } from './errors';
import type { Actor } from './roles';
import type { StaffAccount, Store } from './store';

const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'()&-]{1,59}$/u;

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
    active: account.active,
    createdAt: account.createdAt,
    createdBy: account.createdBy,
    updatedAt: account.updatedAt,
    updatedBy: account.updatedBy,
    passwordChangedAt: account.passwordChangedAt,
  };
}

function readRole(value: unknown): StaffRole {
  if (!isStaffRole(value)) throw new ApiError(400, 'INVALID', 'Choose a role: Admin, Registration desk, Event coordinator, Certificate team or Web assistant team.');
  return value;
}

/** Coordinators need at least one event; every other role sees all events, so it keeps none. */
function readEvents(value: unknown, role: StaffRole): string[] {
  if (role !== 'COORDINATOR') return [];
  const requested = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  if (requested.some((id) => !eventCatalog.some((event) => event.id === id))) {
    throw new ApiError(400, 'INVALID', 'Assign events from the list only.');
  }
  const eventIds = eventCatalog.filter((event) => requested.includes(event.id)).map((event) => event.id);
  if (!eventIds.length) throw new ApiError(400, 'INVALID', 'Assign at least one event to a coordinator.');
  return eventIds;
}

function readDisplayName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!DISPLAY_NAME.test(name)) throw new ApiError(400, 'INVALID', 'Enter the student coordinator’s name (2–60 letters).');
  return name;
}

async function readPassword(value: unknown): Promise<string> {
  const password = typeof value === 'string' ? value.slice(0, 200) : '';
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
    if (username === this.deps.ownerUsername.toLowerCase()) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already in use.');
    }
    const role = readRole(body.role);
    const now = this.iso();
    const account: StaffAccount = {
      username,
      displayName: readDisplayName(body.displayName),
      role,
      eventIds: readEvents(body.eventIds, role),
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.deps.store.getStaff(key);
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'There is no such student coordinator account.');
      const role = body.role === undefined ? current.role : readRole(body.role);
      const active = body.active === undefined ? current.active : body.active === true;
      if (actor.kind === 'staff' && actor.username === key && (!active || role !== 'ADMIN')) {
        throw new ApiError(400, 'INVALID', 'You cannot remove your own admin access. Ask another admin.');
      }
      const now = this.iso();
      const next: StaffAccount = {
        ...current,
        displayName: body.displayName === undefined ? current.displayName : readDisplayName(body.displayName),
        role,
        eventIds: body.eventIds === undefined && role === current.role ? current.eventIds : readEvents(body.eventIds ?? current.eventIds, role),
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
