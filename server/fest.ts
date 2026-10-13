/**
 * The college-wide fest: eight departments, each with its desks, events and coordinators.
 *
 *   catalog        departments and events (the web assist team edits them; Control table)
 *   sync           each screen asks for what changed since it last asked: its department, or
 *                  every department for the overall coordinator and the web assist team
 *   ID blocks      a desk phone takes 50 IDs at a time (CSE-0001…), so it can register offline
 *   registrations  desk (and paper) registrations: one phone per department, one registration
 *                  per desk submission (a retry returns the first one); online ones imported
 *   event window   fee, attendance, adding a student, winners; submitted results lock the event
 *
 * Every rule is checked here; the dashboards only hide what a role cannot use.
 */
import {
  DEFAULT_CATALOG,
  DEFAULT_UPI,
  ID_BLOCK,
  ID_RANGES,
  OPEN_DEPT,
  TXN,
  canJoin,
  toStudentView,
  catalogProblem,
  departmentOf,
  entryOf,
  eventOf,
  feePaid,
  formatFestId,
  isActive,
  matchEvents,
  normaliseFestId,
  parseFestId,
  participantProblems,
  readParticipant,
  sourceOfNumber,
  type FestCatalog,
  type FestDepartment,
  type FestEvent,
  type FestMethod,
  type FestParticipant,
  type FestPayment,
  type FestPlace,
  type FestRegistration,
  type FestResult,
  type FestSource,
  type FestStamp,
} from '../src/lib/fest';
import { formatIst, parseEventStart } from '../src/lib/countdown';
import { registrationPhase, type RegistrationSchedule } from '../src/lib/schedule';
import { DEPARTMENT_ROLES, hasPermission, type Permission } from '../src/lib/staff';
import { ApiError } from './errors';
import type { FileStore } from './files';
import type { FestStore } from './festStore';
import { requirePermission, type Actor } from './roles';
import type { Store } from './store';

export const CATALOG_SETTING = 'fest-catalog';
/** When test data was last deleted: every phone that sees a new value drops its copy and loads afresh. */
export const RESET_SETTING = 'fest-reset';
/** Test registrations deleted per call (the dashboard calls again until none are left), several at a time. */
const CLEAR_BATCH = 250;
const PURGE_PARALLEL = 20;
/** Who made a change from a student's own page. */
const STUDENT = 'student';
const ALREADY_SELF = 'This mobile number is already registered. Open "Already registered?" with your ID, or ask at any registration desk.';
/** How long an instance trusts the catalog it read. */
const CATALOG_TTL_MS = 10_000;
/** Each sync returns what changed since a little before the last one, so nothing written meanwhile is missed. */
export const SYNC_OVERLAP_MS = 20_000;
const MAX_IMPORT_ROWS = 200;
const SUBMISSION = /^[A-Za-z0-9-]{8,80}$/;
const MAX_PLACES = 3;

export interface FestDeps {
  store: FestStore;
  settings: Pick<Store, 'getSetting' | 'putSetting'>;
  files: Pick<FileStore, 'put'>;
  /** The schedule in force (shared, changed in place by the registration times and test timelines). */
  schedule: RegistrationSchedule;
  /** { test } while a test session is on. */
  testMark: () => Promise<{ test?: unknown }>;
  now: () => number;
  log: (message: string, details?: Record<string, unknown>) => void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : fallback);

export class FestService {
  private cached: { at: number; catalog: FestCatalog } | null = null;
  private resetCached: { at: number; value: string | null } | null = null;

  constructor(private readonly deps: FestDeps) {}

  private iso(offset = 0) {
    return new Date(this.deps.now() + offset).toISOString();
  }

  private stamp(actor: Actor): FestStamp {
    return { at: this.iso(), by: actor.username };
  }

  // -----------------------------------------------------------------------------------------
  // The catalog

  async catalog(force = false): Promise<FestCatalog> {
    const now = this.deps.now();
    if (!force && this.cached && now - this.cached.at < CATALOG_TTL_MS) return this.cached.catalog;
    let catalog = DEFAULT_CATALOG;
    try {
      const stored = await this.deps.settings.getSetting(CATALOG_SETTING);
      if (stored) catalog = JSON.parse(stored) as FestCatalog;
    } catch (error) {
      if (this.cached) return this.cached.catalog;
      this.deps.log('Could not read the fest catalog; using the last one', { error: error instanceof Error ? error.message : String(error) });
    }
    this.cached = { at: now, catalog };
    return catalog;
  }

  async catalogView() {
    return { success: true as const, catalog: await this.catalog() };
  }

  /** The web assist team saves departments and events (the whole catalog, from the revision it started from). */
  async saveCatalog(actor: Actor, body: unknown) {
    if (!isObject(body) || !isObject(body.catalog)) throw new ApiError(400, 'INVALID', 'The catalog could not be read.');
    const current = await this.catalog(true);
    if (body.baseRevision !== current.revision) {
      throw new ApiError(409, 'CATALOG_CHANGED', 'Someone else saved the departments and events meanwhile. Reload, then make your change again.');
    }
    const input = body.catalog;
    const departments: FestDepartment[] = (Array.isArray(input.departments) ? input.departments : []).filter(isObject).map((dept) => ({
      code: text(dept.code, 6).toUpperCase(),
      name: text(dept.name, 120),
      hod: text(dept.hod, 80),
      staffCoordinator: readContact(dept.staffCoordinator),
      studentCoordinator: readContact(dept.studentCoordinator),
      desks: int(dept.desks, 4),
      active: dept.active !== false,
    }));
    const events: FestEvent[] = (Array.isArray(input.events) ? input.events : []).filter(isObject).map((event) => ({
      id: text(event.id, 60).toLowerCase(),
      dept: text(event.dept, 6).toUpperCase(),
      name: text(event.name, 100),
      subtitle: text(event.subtitle, 120),
      venue: text(event.venue, 80),
      time: text(event.time, 60),
      fee: int(event.fee, 50),
      teamMin: int(event.teamMin, 1),
      teamMax: int(event.teamMax, 1),
      active: event.active !== false,
    }));
    const next: FestCatalog = { revision: current.revision + 1, entryFee: int(input.entryFee, current.entryFee), departments, events, updatedAt: this.iso(), updatedBy: actor.username };
    const problem = catalogProblem(next);
    if (problem) throw new ApiError(400, 'INVALID', problem);
    // A department with registrations keeps its code (its IDs carry it).
    for (const old of current.departments) {
      if (departments.some((dept) => dept.code === old.code)) continue;
      const { registrations } = await this.deps.store.changes(old.code, '');
      if (registrations.length) throw new ApiError(400, 'INVALID', `${old.code} has registrations, so it cannot be removed or renamed: switch it off instead.`);
    }
    await this.deps.settings.putSetting(CATALOG_SETTING, JSON.stringify(next));
    this.cached = { at: this.deps.now(), catalog: next };
    this.deps.log('Fest catalog saved', { revision: next.revision, departments: departments.length, events: events.length, by: actor.username });
    return { success: true as const, catalog: next };
  }

  // -----------------------------------------------------------------------------------------
  // Who may see and work on which department

  private async viewDepartments(actor: Actor, requested: unknown): Promise<string[]> {
    const catalog = await this.catalog();
    const wanted = text(requested, 6).toUpperCase();
    // Students who registered themselves can join any department's events: everyone sees them.
    if (hasPermission(actor.role, 'fest.viewAll')) {
      if (!wanted) return [...catalog.departments.map((dept) => dept.code), OPEN_DEPT];
      if (wanted === OPEN_DEPT) return [OPEN_DEPT];
      if (!departmentOf(catalog, wanted)) throw new ApiError(404, 'NOT_FOUND', 'There is no such department.');
      return [wanted, OPEN_DEPT];
    }
    const own = this.ownDepartment(actor);
    if (wanted && wanted !== own && wanted !== OPEN_DEPT) throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${own}.`);
    return [own, OPEN_DEPT];
  }

  private ownDepartment(actor: Actor): string {
    if (!actor.department) throw new ApiError(403, 'NO_DEPARTMENT', 'Your account has no department yet. Ask the web assist team to set it.');
    return actor.department;
  }

  /** The department a change is made in: a department role's own, or (web assist) the one named. */
  private async workDepartment(actor: Actor, requested: unknown): Promise<FestDepartment> {
    const catalog = await this.catalog();
    const wanted = text(requested, 6).toUpperCase();
    let code: string;
    if (DEPARTMENT_ROLES.includes(actor.role)) {
      code = this.ownDepartment(actor);
      if (wanted && wanted !== code) throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${code}.`);
    } else {
      if (!wanted) throw new ApiError(400, 'INVALID', 'Choose the department.');
      code = wanted;
    }
    const department = departmentOf(catalog, code);
    if (!department) throw new ApiError(404, 'NOT_FOUND', 'There is no such department.');
    return department;
  }

  // -----------------------------------------------------------------------------------------
  // Live data

  /** When test data was last deleted (read at most every few seconds). */
  private async resetMark(): Promise<string | null> {
    const now = this.deps.now();
    if (this.resetCached && now - this.resetCached.at < CATALOG_TTL_MS) return this.resetCached.value;
    try {
      const value = (await this.deps.settings.getSetting(RESET_SETTING)) ?? null;
      this.resetCached = { at: now, value };
      return value;
    } catch {
      return this.resetCached?.value ?? null;
    }
  }

  async sync(actor: Actor, body: unknown) {
    const since = isObject(body) && typeof body.since === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(body.since) ? body.since : '';
    const departments = await this.viewDepartments(actor, isObject(body) ? body.dept : undefined);
    const catalog = await this.catalog();
    const parts = await Promise.all(departments.map((dept) => this.deps.store.changes(dept, since)));
    return {
      success: true as const,
      full: !since,
      departments,
      registrations: parts.flatMap((part) => part.registrations),
      results: parts.flatMap((part) => part.results),
      cursor: this.iso(-SYNC_OVERLAP_MS),
      catalogRevision: catalog.revision,
      resetAt: await this.resetMark(),
      serverTime: this.iso(),
    };
  }

  /** IDs for a desk phone (50 at a time), or a block of paper slips. */
  async takeBlock(actor: Actor, body: unknown) {
    const department = await this.workDepartment(actor, isObject(body) ? body.dept : undefined);
    const source: FestSource = isObject(body) && body.source === 'PAPER' ? 'PAPER' : 'DESK';
    if (source === 'PAPER') requirePermission(actor, 'fest.import');
    const count = source === 'PAPER' ? Math.min(Math.max(int(isObject(body) ? body.count : 0, 50), 1), 200) : ID_BLOCK;
    const first = await this.deps.store.takeNumbers(department.code, source, count);
    const last = first + count - 1;
    if (last > ID_RANGES[source].last) throw new ApiError(409, 'IDS_EXHAUSTED', `${department.code} has used every ${source === 'PAPER' ? 'paper' : 'desk'} ID. Ask the web assist team.`);
    this.deps.log('Fest IDs handed out', { dept: department.code, source, first, last, by: actor.username });
    return { success: true as const, dept: department.code, source, first, last };
  }

  // -----------------------------------------------------------------------------------------
  // Registering

  /** The events asked for: the department's own, or any department's for a self-registered student. */
  private readEventIds(catalog: FestCatalog, dept: string, value: unknown): string[] {
    const requested = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 60) : [];
    const ids: string[] = [];
    for (const id of requested) {
      const event = eventOf(catalog, id);
      if (!event || !canJoin({ dept }, event)) throw new ApiError(400, 'INVALID', `${id} is not an event of ${dept}.`);
      if (!event.active || departmentOf(catalog, event.dept)?.active === false) throw new ApiError(400, 'INVALID', `${event.name} is closed for registration.`);
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  private async ensureOpenEvents(eventIds: string[]) {
    const catalog = await this.catalog();
    for (const eventId of eventIds) {
      const event = eventOf(catalog, eventId);
      if (event && (await this.deps.store.getResult(event.dept, eventId))?.submitted) {
        throw new ApiError(409, 'RESULTS_SUBMITTED', 'That event’s results are already submitted, so it takes no more participants.');
      }
    }
  }

  private readPayment(actor: Actor, value: unknown, amount: number): FestPayment {
    const method = isObject(value) ? value.method : null;
    const stamp = this.stamp(actor);
    const desk = actor.deskNumber ?? undefined;
    if (method === 'CASH') {
      if (!isObject(value) || value.confirmed !== true) throw new ApiError(400, 'INVALID', `Tick that you have received ₹${amount} in cash.`);
      return { method: 'CASH', amount, ...stamp, ...(desk && { desk }) };
    }
    if (method === 'UPI') {
      const txn = text(isObject(value) ? value.txn : '', 40).replace(/\s/g, '');
      if (!TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Type the UPI transaction ID (UTR) from the student’s payment screen.');
      if (!isObject(value) || value.confirmed !== true) throw new ApiError(400, 'INVALID', `Tick that you have seen ₹${amount} paid.`);
      return { method: 'UPI', amount, txn, ...stamp, ...(desk && { desk }) };
    }
    throw new ApiError(400, 'INVALID', 'Choose how the student paid: cash or UPI.');
  }

  private closedMessage() {
    const closes = this.deps.schedule.onsiteClosesAt ? parseEventStart(this.deps.schedule.onsiteClosesAt) : null;
    return `On-site registration closed${closes ? ` at ${formatIst(closes)}` : ''}.`;
  }

  async register(actor: Actor, body: unknown) {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The registration could not be read.');
    const department = await this.workDepartment(actor, body.dept);
    if (!department.active) throw new ApiError(400, 'INVALID', `${department.code} is not taking registrations.`);
    const dept = department.code;
    const source: 'DESK' | 'PAPER' = body.source === 'PAPER' ? 'PAPER' : 'DESK';
    if (source === 'PAPER') requirePermission(actor, 'fest.import');
    // Paper slips filled during an outage may be typed in after closing time.
    if (source === 'DESK' && registrationPhase(this.deps.schedule, this.deps.now()) === 'closed') throw new ApiError(403, 'ONSITE_CLOSED', this.closedMessage());

    const submissionId = text(body.submissionId, 80);
    if (!SUBMISSION.test(submissionId)) throw new ApiError(400, 'INVALID', 'The registration could not be read. Please try again.');
    const replay = await this.deps.store.findSubmission(dept, submissionId);
    if (replay) return { success: true as const, registration: await this.required(dept, replay), replayed: true };

    const id = normaliseFestId(text(body.id, 20));
    const parsed = parseFestId(id);
    if (!parsed || parsed.dept !== dept || sourceOfNumber(parsed.number) !== source) {
      throw new ApiError(400, 'INVALID_ID', `The ID must be a ${dept} ${source === 'PAPER' ? 'paper slip' : 'desk'} ID.`);
    }
    const participant = readParticipant(body.participant);
    const problems = participantProblems(participant);
    if (Object.keys(problems).length) throw new ApiError(400, 'INVALID', Object.values(problems)[0]!, undefined, undefined, problems as Record<string, string>);
    const catalog = await this.catalog();
    const eventIds = this.readEventIds(catalog, dept, body.events);
    await this.ensureOpenEvents(eventIds);
    const payment = this.readPayment(actor, body.payment, catalog.entryFee);
    const stamp = this.stamp(actor);
    const mark = await this.deps.testMark();
    const registration: FestRegistration = {
      id,
      dept,
      source,
      ...participant,
      entry: { status: 'PAID', payment },
      events: eventIds.map((eventId) => ({ eventId, added: stamp })),
      ...(actor.deskNumber && { desk: actor.deskNumber }),
      created: stamp,
      sid: submissionId,
      ...(mark.test ? { test: true } : {}),
      v: 1,
      u: this.iso(),
    };
    const created = await this.deps.store.createRegistration(registration, submissionId);
    if (created.created) {
      this.deps.log('Fest registration', { id, dept, source, events: eventIds.length, by: actor.username, ...(registration.test && { test: true }) });
      return { success: true as const, registration, replayed: false };
    }
    if (created.reason === 'submission') return { success: true as const, registration: await this.required(dept, created.existingId!), replayed: true };
    if (created.reason === 'phone') {
      throw new ApiError(409, 'DUPLICATE_PHONE', `This phone number is already registered in ${dept} as ${created.existingId}.`, undefined, undefined, { existingId: created.existingId ?? '' });
    }
    throw new ApiError(409, 'ID_TAKEN', `${id} is already used. The next free ID will be used.`);
  }

  private async required(dept: string, id: string) {
    const registration = await this.deps.store.getRegistration(dept, id);
    if (!registration) throw new ApiError(404, 'NOT_FOUND', 'There is no such registration.');
    return registration;
  }

  /** Reads, changes and saves a registration (again if someone else changed it at the same moment). */
  private async mutate(
    dept: string,
    id: string,
    change: (registration: FestRegistration) => { next: Partial<FestRegistration>; phone?: { from: string; to: string } } | null,
  ) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.required(dept, id);
      const result = change(current);
      if (!result) return { success: true as const, registration: current, changed: false };
      const next: FestRegistration = { ...current, ...result.next, v: current.v + 1, u: this.iso() };
      if (await this.deps.store.saveRegistration(next, current.v, result.phone)) return { success: true as const, registration: next, changed: true };
      if (result.phone?.to) {
        const holder = await this.deps.store.findPhone(dept, result.phone.to);
        if (holder && holder !== id) throw new ApiError(409, 'DUPLICATE_PHONE', `That phone number is already registered in ${dept} as ${holder}.`, undefined, undefined, { existingId: holder });
      }
    }
    throw new ApiError(409, 'BUSY', 'Someone else changed this registration at the same moment. Please try again.');
  }

  private target(rawId: string) {
    const id = normaliseFestId(rawId);
    const parsed = parseFestId(id);
    if (!parsed) throw new ApiError(404, 'NOT_FOUND', 'There is no such registration.');
    return { id, dept: parsed.dept };
  }

  /** Check-in, entry fee, details, events, cancel, delete and restore. */
  async act(actor: Actor, rawId: string, body: unknown) {
    const { id, dept } = this.target(rawId);
    const action = isObject(body) ? body.action : null;
    const needs: Record<string, Permission> = {
      checkin: 'fest.register',
      entry: 'fest.register',
      edit: 'fest.edit',
      events: 'fest.edit',
      cancel: 'fest.cancel',
      uncancel: 'fest.cancel',
      delete: 'fest.delete',
      restore: 'fest.delete',
      verify: 'fest.register',
      reject: 'fest.register',
    };
    if (typeof action !== 'string' || !needs[action]) throw new ApiError(400, 'INVALID', 'Choose what to do.');
    requirePermission(actor, needs[action]);
    // Self-registered students belong to no department: any department's desk may verify them.
    if (dept !== OPEN_DEPT) await this.workDepartment(actor, dept);
    const input = body as Record<string, unknown>;
    const catalog = await this.catalog();
    const stamp = this.stamp(actor);
    const reason = text(input.reason, 200);
    const live = (registration: FestRegistration) => {
      if (registration.deleted) throw new ApiError(409, 'DELETED', 'This registration was deleted.');
      if (registration.cancelled) throw new ApiError(409, 'CANCELLED', 'This registration was cancelled.');
    };

    if (action === 'events') return this.changeEvents(catalog, dept, id, input, stamp);

    if (action === 'verify') {
      // The desk has seen the money arrive with this transaction ID (it may correct a typo).
      const current = await this.required(dept, id);
      live(current);
      if (current.entry.status === 'PAID') return { success: true as const, registration: current, changed: false };
      const claim = current.entry.claim;
      if (!claim) throw new ApiError(409, 'NO_CLAIM', 'There is no transaction ID to check: take the entry fee instead.');
      const txn = (text(input.txn, 40) || claim.txn).replace(/\s/g, '');
      if (!TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Type the transaction ID as it appears in the payment.');
      if (input.confirmed !== true) throw new ApiError(400, 'INVALID', `Tick that you have seen ₹${claim.amount} received with this transaction ID.`);
      const holder = await this.deps.store.claimTxn(OPEN_DEPT, txn, id);
      if (holder && holder !== id) throw new ApiError(409, 'TXN_USED', `This transaction ID was already accepted for ${holder}.`, undefined, undefined, { existingId: holder });
      try {
        return await this.mutate(dept, id, (registration) => {
          live(registration);
          if (registration.entry.status === 'PAID') return null;
          const desk = actor.deskNumber ?? undefined;
          const payment: FestPayment = { method: 'UPI', amount: registration.entry.claim?.amount ?? catalog.entryFee, txn, ...stamp, ...(desk && { desk }) };
          return { next: { entry: { status: 'PAID', payment, claim: registration.entry.claim }, checkedIn: registration.checkedIn ?? { ...stamp, ...(desk && { desk }) } } };
        });
      } catch (error) {
        await this.deps.store.releaseTxn(OPEN_DEPT, txn, id);
        throw error;
      }
    }

    return this.mutate(dept, id, (registration) => {
      switch (action) {
        case 'checkin': {
          live(registration);
          if (registration.checkedIn) return null;
          const entry = registration.entry.status === 'DUE' ? { status: 'PAID' as const, payment: this.readPayment(actor, input.payment, catalog.entryFee) } : registration.entry;
          return { next: { checkedIn: { ...stamp, ...(actor.deskNumber && { desk: actor.deskNumber }) }, entry } };
        }
        case 'entry':
          live(registration);
          if (registration.entry.status === 'PAID') return null;
          return { next: { entry: { status: 'PAID', payment: this.readPayment(actor, input.payment, catalog.entryFee) } } };
        case 'edit': {
          live(registration);
          const participant = readParticipant({ ...pick(registration), ...(isObject(input.participant) ? input.participant : {}) });
          const problems = participantProblems(participant);
          if (Object.keys(problems).length) throw new ApiError(400, 'INVALID', Object.values(problems)[0]!, undefined, undefined, problems as Record<string, string>);
          if (Object.entries(participant).every(([key, value]) => registration[key as keyof FestParticipant] === value)) return null;
          return { next: participant, ...(participant.phone !== registration.phone && { phone: { from: registration.phone, to: participant.phone } }) };
        }
        case 'cancel':
          if (registration.cancelled) return null;
          if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say why it is cancelled.');
          return { next: { cancelled: { ...stamp, reason } } };
        case 'uncancel':
          if (!registration.cancelled) return null;
          return { next: { cancelled: undefined } };
        case 'delete':
          if (registration.deleted) return null;
          if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say why it is deleted.');
          return { next: { deleted: { ...stamp, reason } }, phone: { from: registration.phone, to: '' } };
        case 'restore':
          if (!registration.deleted) return null;
          return { next: { deleted: undefined }, phone: { from: '', to: registration.phone } };
        case 'reject':
          // The money was not found: the student sees why on their page and can send the right ID.
          live(registration);
          if (registration.entry.status === 'PAID' || !registration.entry.claim) return null;
          if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say what is wrong (e.g. not received, wrong amount).');
          return { next: { entry: { ...registration.entry, rejected: { ...stamp, reason } } } };
        default:
          return null;
      }
    });
  }

  /** Adds and removes events (a fee paid or attendance marked keeps an event). */
  private async changeEvents(catalog: FestCatalog, dept: string, id: string, input: Record<string, unknown>, stamp: FestStamp) {
    const add = this.readEventIds(catalog, dept, input.add);
    await this.ensureOpenEvents(add);
    const remove = Array.isArray(input.remove) ? input.remove.filter((value): value is string => typeof value === 'string') : [];
    await this.ensureOpenEvents(remove);
    return this.mutate(dept, id, (registration) => {
      if (registration.deleted) throw new ApiError(409, 'DELETED', 'This registration was deleted.');
      if (registration.cancelled) throw new ApiError(409, 'CANCELLED', 'This registration was cancelled.');
      for (const eventId of remove) {
        const entry = entryOf(registration, eventId);
        if (entry && (feePaid(entry) || entry.present)) {
          throw new ApiError(409, 'FEE_PAID', `${eventOf(catalog, eventId)?.name ?? eventId}: the fee is paid or attendance marked, so it cannot be removed.`);
        }
      }
      const kept = registration.events.filter((entry) => !remove.includes(entry.eventId));
      const added = add.filter((eventId) => !kept.some((entry) => entry.eventId === eventId)).map((eventId) => ({ eventId, added: stamp }));
      if (!added.length && kept.length === registration.events.length) return null;
      return { next: { events: [...kept, ...added] } };
    });
  }

  // -----------------------------------------------------------------------------------------
  // Students on their own phones (no sign-in: their ID and mobile number)

  /** What the students' page needs: is registration open, the fee and where to pay it, and every open event. */
  async publicInfo() {
    const catalog = await this.catalog();
    const departments = catalog.departments.filter((dept) => dept.active);
    const open = new Set(departments.map((dept) => dept.code));
    return {
      success: true as const,
      open: registrationPhase(this.deps.schedule, this.deps.now()) !== 'closed',
      closesAt: this.deps.schedule.onsiteClosesAt ?? null,
      entryFee: catalog.entryFee,
      upiId: catalog.upiId || DEFAULT_UPI.upiId,
      upiPayee: catalog.upiPayee || DEFAULT_UPI.upiPayee,
      departments: departments.map((dept) => ({ code: dept.code, name: dept.name })),
      events: catalog.events
        .filter((event) => event.active && open.has(event.dept))
        .map(({ id, dept, name, subtitle, venue, time, fee, teamMin, teamMax }) => ({ id, dept, name, subtitle, venue, time, fee, teamMin, teamMax })),
    };
  }

  /** A student registers themselves: an ID from 20001, any department's events, the entry fee's transaction ID for a desk to check. */
  async selfRegister(body: unknown) {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The registration could not be read.');
    if (registrationPhase(this.deps.schedule, this.deps.now()) === 'closed') throw new ApiError(403, 'ONSITE_CLOSED', this.closedMessage());
    const submissionId = text(body.submissionId, 80);
    if (!SUBMISSION.test(submissionId)) throw new ApiError(400, 'INVALID', 'The registration could not be read. Please try again.');
    const replay = await this.deps.store.findSubmission(OPEN_DEPT, submissionId);
    if (replay) return { success: true as const, registration: toStudentView(await this.required(OPEN_DEPT, replay)), replayed: true };

    const participant = readParticipant(body.participant);
    const problems = participantProblems(participant);
    if (Object.keys(problems).length) throw new ApiError(400, 'INVALID', Object.values(problems)[0]!, undefined, undefined, problems as Record<string, string>);
    const catalog = await this.catalog();
    const eventIds = this.readEventIds(catalog, OPEN_DEPT, body.events);
    await this.ensureOpenEvents(eventIds);
    const txn = text(body.txn, 40).replace(/\s/g, '');
    if (!TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Type the UPI transaction ID (UTR) from your payment.', undefined, undefined, { txn: 'Type the UPI transaction ID (UTR) from your payment.' });

    // Already registered somewhere (online, at a desk, or here)? Then a desk takes it from there.
    const codes = [...catalog.departments.map((dept) => dept.code), OPEN_DEPT];
    const holders = await Promise.all(codes.map(async (dept) => ((await this.deps.store.findPhone(dept, participant.phone)) ? dept : null)));
    const holder = holders.find(Boolean);
    if (holder) throw new ApiError(409, 'DUPLICATE_PHONE', holder === OPEN_DEPT ? ALREADY_SELF : `This mobile number is already registered with ${holder}. Go to a registration desk with it.`);

    const stamp: FestStamp = { at: this.iso(), by: STUDENT };
    const mark = await this.deps.testMark();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const number = await this.deps.store.takeNumbers(OPEN_DEPT, 'SELF', 1);
      if (number > ID_RANGES.SELF.last) throw new ApiError(409, 'IDS_EXHAUSTED', 'Registration is full. Please go to a registration desk.');
      const registration: FestRegistration = {
        id: String(number),
        dept: OPEN_DEPT,
        source: 'SELF',
        ...participant,
        entry: { status: 'DUE', claim: { txn, amount: catalog.entryFee, at: stamp.at } },
        events: eventIds.map((eventId) => ({ eventId, added: stamp })),
        created: stamp,
        sid: submissionId,
        ...(mark.test ? { test: true } : {}),
        v: 1,
        u: this.iso(),
      };
      const created = await this.deps.store.createRegistration(registration, submissionId);
      if (created.created) {
        this.deps.log('Fest self-registration', { id: registration.id, events: eventIds.length, ...(registration.test && { test: true }) });
        return { success: true as const, registration: toStudentView(registration), replayed: false };
      }
      if (created.reason === 'submission') return { success: true as const, registration: toStudentView(await this.required(OPEN_DEPT, created.existingId!)), replayed: true };
      if (created.reason === 'phone') throw new ApiError(409, 'DUPLICATE_PHONE', ALREADY_SELF);
      // 'id': that number is taken (e.g. after test data was cleared): take the next one.
    }
    throw new ApiError(409, 'BUSY', 'Registration is busy. Please try again.');
  }

  /** The student's own registration, found by ID and the mobile number it was made with. */
  private async ownRegistration(body: unknown): Promise<FestRegistration> {
    const id = normaliseFestId(text(isObject(body) ? body.id : '', 20));
    const phone = readParticipant({ phone: isObject(body) ? body.phone : '' }).phone;
    const parsed = parseFestId(id);
    const registration = parsed ? await this.deps.store.getRegistration(parsed.dept, id) : null;
    if (!registration || registration.deleted || registration.phone !== phone) throw new ApiError(404, 'NOT_FOUND', 'No registration has that ID with that mobile number.');
    return registration;
  }

  async studentView(body: unknown) {
    return { success: true as const, registration: toStudentView(await this.ownRegistration(body)) };
  }

  /** The student adds or removes their events (any department's if they registered themselves). */
  async studentEvents(body: unknown) {
    const registration = await this.ownRegistration(body);
    const result = await this.changeEvents(await this.catalog(), registration.dept, registration.id, body as Record<string, unknown>, { at: this.iso(), by: STUDENT });
    return { success: true as const, registration: toStudentView(result.registration) };
  }

  /** The student sends the right transaction ID after a desk did not find the payment. */
  async studentPayment(body: unknown) {
    const found = await this.ownRegistration(body);
    const txn = text(isObject(body) ? body.txn : '', 40).replace(/\s/g, '');
    if (!TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Type the UPI transaction ID (UTR) from your payment.');
    const catalog = await this.catalog();
    const result = await this.mutate(found.dept, found.id, (registration) => {
      if (!isActive(registration)) throw new ApiError(409, 'CANCELLED', 'This registration was cancelled.');
      if (registration.entry.status === 'PAID') return null;
      return { next: { entry: { status: 'DUE', claim: { txn, amount: catalog.entryFee, at: this.iso() } } } };
    });
    return { success: true as const, registration: toStudentView(result.registration) };
  }

  private eventAccess(actor: Actor, event: FestEvent) {
    if (actor.role === 'COORDINATOR') {
      if (actor.department !== event.dept || !actor.eventIds.includes(event.id)) throw new ApiError(403, 'EVENT_NOT_ASSIGNED', 'This event is not assigned to your account.');
    } else if (DEPARTMENT_ROLES.includes(actor.role)) {
      if (actor.department !== event.dept) throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${actor.department ?? 'another department'}.`);
    }
  }

  private async festEvent(eventId: string) {
    const event = eventOf(await this.catalog(), eventId);
    if (!event) throw new ApiError(404, 'NOT_FOUND', 'There is no such event.');
    return event;
  }

  /** The event window: add a student, take the fee, mark attendance; corrections cancel a fee. */
  async eventAct(actor: Actor, rawId: string, eventId: string, body: unknown) {
    const { id, dept } = this.target(rawId);
    const event = await this.festEvent(eventId);
    if (!canJoin({ dept }, event)) throw new ApiError(400, 'OTHER_DEPARTMENT', `${id} is not in ${event.dept}.`);
    const action = isObject(body) ? body.action : null;
    if (!['add', 'fee', 'present', 'absent', 'void-fee'].includes(String(action))) throw new ApiError(400, 'INVALID', 'Choose what to do.');
    requirePermission(actor, action === 'void-fee' ? 'fest.correct' : 'fest.event');
    if (action !== 'void-fee') this.eventAccess(actor, event);
    await this.ensureOpenEvents([event.id]);
    const input = body as Record<string, unknown>;
    const stamp = this.stamp(actor);
    return this.mutate(dept, id, (registration) => {
      if (!isActive(registration)) throw new ApiError(409, 'CANCELLED', 'This registration was cancelled or deleted.');
      const entry = entryOf(registration, event.id);
      const update = (next: Partial<NonNullable<typeof entry>>) => ({
        next: { events: registration.events.map((item) => (item.eventId === event.id ? { ...item, ...next } : item)) },
      });
      if (action === 'add') {
        if (entry) return null;
        if (!event.active) throw new ApiError(400, 'INVALID', `${event.name} is closed for registration.`);
        return { next: { events: [...registration.events, { eventId: event.id, added: stamp }] } };
      }
      if (!entry) throw new ApiError(409, 'NOT_IN_EVENT', `${id} is not registered for ${event.name}. Add them first.`);
      switch (action) {
        case 'fee': {
          if (feePaid(entry)) return null;
          const fee = this.readPayment(actor, input.payment, event.fee);
          return update({ fee });
        }
        case 'present':
          if (entry.present) return null;
          if (registration.entry.status !== 'PAID') throw new ApiError(409, 'ENTRY_DUE', 'The entry fee is not verified yet: send them to a registration desk.');
          if (event.fee > 0 && !feePaid(entry)) throw new ApiError(409, 'FEE_DUE', `Take the ₹${event.fee} event fee first.`);
          return update({ present: stamp });
        case 'absent':
          if (!entry.present) return null;
          return update({ present: undefined });
        case 'void-fee': {
          if (!feePaid(entry)) return null;
          if (entry.present) throw new ApiError(409, 'PRESENT', 'They are marked present: undo that first.');
          const reason = text(input.reason, 200);
          if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say why the fee is cancelled.');
          return update({ fee: { ...entry.fee!, voided: { ...stamp, reason } } });
        }
        default:
          return null;
      }
    });
  }

  // -----------------------------------------------------------------------------------------
  // Winners and results

  async results(actor: Actor, eventId: string, body: unknown) {
    const event = await this.festEvent(eventId);
    const action = isObject(body) ? body.action : null;
    if (!['save', 'submit', 'reopen'].includes(String(action))) throw new ApiError(400, 'INVALID', 'Choose what to do.');
    requirePermission(actor, action === 'reopen' ? 'fest.correct' : 'fest.event');
    if (action !== 'reopen') this.eventAccess(actor, event);
    const input = body as Record<string, unknown>;
    const current = await this.deps.store.getResult(event.dept, event.id);
    const stamp = this.stamp(actor);
    let next: FestResult;
    if (action === 'reopen') {
      if (!current?.submitted) throw new ApiError(409, 'NOT_SUBMITTED', 'These results are not submitted.');
      const reason = text(input.reason, 200);
      if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say why the results are reopened.');
      next = { ...current, submitted: undefined, reopened: [...(current.reopened ?? []), { ...stamp, reason }], v: current.v + 1, u: this.iso() };
    } else {
      if (current?.submitted) throw new ApiError(409, 'RESULTS_SUBMITTED', 'These results are submitted. Ask the overall coordinator to reopen them.');
      const places = input.places === undefined && current ? current.places : await this.readPlaces(event, input.places);
      if (action === 'submit' && !places.length) throw new ApiError(400, 'INVALID', 'Enter at least the first place before submitting.');
      next = {
        eventId: event.id,
        dept: event.dept,
        places,
        saved: stamp,
        ...(action === 'submit' && { submitted: stamp }),
        ...(current?.reopened && { reopened: current.reopened }),
        v: (current?.v ?? 0) + 1,
        u: this.iso(),
      };
    }
    if (!(await this.deps.store.saveResult(next, current?.v ?? 0))) {
      throw new ApiError(409, 'BUSY', 'Someone else changed these results at the same moment. Please reload and try again.');
    }
    this.deps.log('Fest results', { eventId: event.id, action, by: actor.username });
    return { success: true as const, result: next };
  }

  private async readPlaces(event: FestEvent, value: unknown): Promise<FestPlace[]> {
    const places: FestPlace[] = [];
    for (const item of (Array.isArray(value) ? value : []).filter(isObject)) {
      const place = int(item.place, 0);
      if (place < 1 || place > MAX_PLACES || places.some((other) => other.place === place)) throw new ApiError(400, 'INVALID', 'Places are 1st, 2nd and 3rd, once each.');
      const ids = [...new Set((Array.isArray(item.ids) ? item.ids : []).map((id) => normaliseFestId(String(id))).filter(Boolean))];
      if (!ids.length) continue;
      if (ids.length > event.teamMax) throw new ApiError(400, 'INVALID', `${event.name} allows teams of up to ${event.teamMax}.`);
      for (const id of ids) {
        const owner = parseFestId(id);
        const registration = owner && canJoin(owner, event) ? await this.deps.store.getRegistration(owner.dept, id) : null;
        const entry = registration && isActive(registration) ? entryOf(registration, event.id) : null;
        if (!entry) throw new ApiError(400, 'INVALID', `${id} is not registered for ${event.name}.`);
        if (!entry.present) throw new ApiError(400, 'INVALID', `${id} is not marked present at ${event.name}.`);
      }
      places.push({ place, ids, ...(text(item.team, 60) && { team: text(item.team, 60) }) });
    }
    return places.sort((a, b) => a.place - b.place);
  }

  // -----------------------------------------------------------------------------------------
  // The online registrations (the online form's CSV, uploaded before the event day)

  async importRows(actor: Actor, body: unknown) {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The upload could not be read.');
    const department = await this.workDepartment(actor, body.dept);
    const dept = department.code;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length > MAX_IMPORT_ROWS) throw new ApiError(400, 'INVALID', `Send at most ${MAX_IMPORT_ROWS} rows at a time.`);
    const dryRun = body.dryRun === true;
    const feesPaid = body.eventFeesPaid === true;
    const catalog = await this.catalog();
    const stamp = this.stamp(actor);
    type Outcome = { row: number; status: 'ok' | 'created' | 'duplicate' | 'error'; id?: string; message?: string };
    const outcomes: Outcome[] = [];
    const ready: { row: number; participant: FestParticipant; eventIds: string[]; ref: string }[] = [];
    const phones = new Map<string, number>();
    for (const [index, raw] of rows.entries()) {
      const row = int(isObject(raw) ? raw.row : index, index);
      const participant = readParticipant(raw);
      const problems = participantProblems(participant);
      if (Object.keys(problems).length) {
        outcomes.push({ row, status: 'error', message: Object.values(problems).join(' ') });
        continue;
      }
      const { ids, unknown } = matchEvents(catalog, dept, text(isObject(raw) ? raw.events : '', 500));
      if (unknown.length) {
        outcomes.push({ row, status: 'error', message: `Not ${dept} events: ${unknown.join(', ')}.` });
        continue;
      }
      if (!ids.length) {
        outcomes.push({ row, status: 'error', message: 'No events.' });
        continue;
      }
      if (phones.has(participant.phone)) {
        outcomes.push({ row, status: 'duplicate', message: `Same phone as row ${phones.get(participant.phone)}.` });
        continue;
      }
      phones.set(participant.phone, row);
      const existing = await this.deps.store.findPhone(dept, participant.phone);
      if (existing) {
        outcomes.push({ row, status: 'duplicate', id: existing, message: `Already registered as ${existing}.` });
        continue;
      }
      ready.push({ row, participant, eventIds: ids, ref: text(isObject(raw) ? raw.ref : '', 80) });
    }
    if (dryRun) {
      outcomes.push(...ready.map(({ row }) => ({ row, status: 'ok' as const })));
      return { success: true as const, dryRun, outcomes: outcomes.sort((a, b) => a.row - b.row) };
    }
    if (ready.length) {
      const first = await this.deps.store.takeNumbers(dept, 'ONLINE', ready.length);
      if (first + ready.length - 1 > ID_RANGES.ONLINE.last) throw new ApiError(409, 'IDS_EXHAUSTED', `${dept} has used every online ID.`);
      const mark = await this.deps.testMark();
      for (const [index, item] of ready.entries()) {
        const id = formatFestId(dept, first + index);
        const online = (amount: number): FestPayment => ({ method: 'ONLINE' as FestMethod, amount, ...stamp });
        const registration: FestRegistration = {
          id,
          dept,
          source: 'ONLINE',
          ...item.participant,
          entry: { status: 'PAID', payment: online(catalog.entryFee) },
          events: item.eventIds.map((eventId) => ({ eventId, added: stamp, ...(feesPaid && { fee: online(eventOf(catalog, eventId)?.fee ?? 0) }) })),
          created: stamp,
          ...(item.ref && { ref: item.ref }),
          ...(mark.test ? { test: true } : {}),
          v: 1,
          u: this.iso(),
        };
        const created = await this.deps.store.createRegistration(registration, null);
        if (created.created) outcomes.push({ row: item.row, status: 'created', id });
        else outcomes.push({ row: item.row, status: 'duplicate', id: created.existingId ?? undefined, message: `Already registered as ${created.existingId}.` });
      }
    }
    const createdCount = outcomes.filter((item) => item.status === 'created').length;
    this.deps.log('Fest online registrations imported', { dept, created: createdCount, rows: rows.length, by: actor.username });
    return { success: true as const, dryRun, outcomes: outcomes.sort((a, b) => a.row - b.row) };
  }

  // -----------------------------------------------------------------------------------------
  // Test data and backups

  /** Deletes the registrations made in test sessions (after saving them to a backup file). */
  /**
   * Deletes the registrations made in test sessions, a batch per call (well inside the API's time
   * limit); the dashboard calls again while some remain. The last call also clears event results
   * if asked, starts IDs again where nothing real is left, and tells every phone to load afresh.
   */
  async clearTest(actor: Actor, body: unknown) {
    const catalog = await this.catalog();
    const withResults = isObject(body) && body.results === true;
    const limit = Math.min(Math.max(int(isObject(body) ? body.limit : undefined, CLEAR_BATCH), 1), 500);
    const codes = [...catalog.departments.map((dept) => dept.code), OPEN_DEPT];
    const everything = await Promise.all(codes.map(async (dept) => ({ dept, ...(await this.deps.store.changes(dept, '')) })));
    const tests = everything.flatMap((part) => part.registrations.filter((registration) => registration.test));
    const batch = tests.slice(0, limit);
    const remaining = tests.length - batch.length;
    const last = remaining === 0;
    if (batch.length || (last && withResults)) {
      const stamp = this.iso().replace(/[:.]/g, '-');
      const saved = { at: this.iso(), by: actor.username, registrations: batch, results: last && withResults ? everything.flatMap((part) => part.results) : [] };
      await this.deps.files.put(`backups/fest-test-data-${stamp}.json`, new TextEncoder().encode(JSON.stringify(saved)), 'application/json');
    }
    for (let index = 0; index < batch.length; index += PURGE_PARALLEL) {
      await Promise.all(batch.slice(index, index + PURGE_PARALLEL).map((registration) => this.deps.store.purgeRegistration(registration)));
    }
    let results = 0;
    const restarted: string[] = [];
    if (last) {
      if (withResults) {
        const all = everything.flatMap((part) => part.results.map((result) => ({ dept: part.dept, eventId: result.eventId })));
        await Promise.all(all.map((result) => this.deps.store.purgeResult(result.dept, result.eventId)));
        results = all.length;
      }
      // Departments left with no registrations start their IDs again.
      for (const part of everything) {
        if (part.registrations.some((registration) => !registration.test)) continue;
        const sources: FestSource[] = part.dept === OPEN_DEPT ? ['SELF'] : ['DESK', 'ONLINE', 'PAPER'];
        await Promise.all(sources.map((source) => this.deps.store.resetCounter(part.dept, source)));
        restarted.push(part.dept);
      }
      await this.deps.settings.putSetting(RESET_SETTING, this.iso());
      this.resetCached = null;
    }
    this.deps.log('Fest test data deleted', { registrations: batch.length, remaining, results, restarted, by: actor.username });
    return { success: true as const, cleared: batch.length, remaining, results, restarted };
  }

  /** Every department's data to a private file (S3 keeps each earlier version): run by the schedule. */
  async backup() {
    const catalog = await this.catalog();
    const parts = await Promise.all([...catalog.departments.map((dept) => dept.code), OPEN_DEPT].map((dept) => this.deps.store.changes(dept, '')));
    const data = { at: this.iso(), catalog, registrations: parts.flatMap((part) => part.registrations), results: parts.flatMap((part) => part.results) };
    await this.deps.files.put('backups/fest/all.json', new TextEncoder().encode(JSON.stringify(data)), 'application/json');
    return { registrations: data.registrations.length, results: data.results.length };
  }
}

function readContact(value: unknown) {
  if (!isObject(value)) return null;
  const name = text(value.name, 80);
  const phone = text(value.phone, 20);
  return name || phone ? { name, phone } : null;
}

const pick = (registration: FestRegistration): FestParticipant => ({
  name: registration.name,
  phone: registration.phone,
  email: registration.email,
  college: registration.college,
  branch: registration.branch,
  year: registration.year,
  team: registration.team,
});
