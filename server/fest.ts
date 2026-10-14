/**
 * The college-wide fest: eight departments, each with its desks, events and coordinators.
 *
 *   catalog        departments and events (the web assist team edits them; Control table)
 *   sync           each screen asks for what changed since it last asked: its department, or
 *                  every department for the overall coordinator and the web assist team
 *   registrations  students register on their own phones (CSE-2001…); a desk may register one
 *                  for them (online, same IDs); online ones imported before the day
 *   desk           collects the entry fee (cash or UPI) or verifies the UTR the student sent; a
 *                  UTR counts once across the fest, and corrections keep an audit trail
 *   event window   fee, attendance, adding a student, winners; submitted results lock the event
 *
 * Every rule is checked here; the dashboards only hide what a role cannot use.
 */
import { canJoin, catalogProblem, DEFAULT_CATALOG, DESKS, departmentOf, deptShort, entryOf, eventOf, feePaid, formatFestId, ID_RANGES, isActive, matchEvents, normaliseFestId, parseFestId, participantProblems, readParticipant, selfRegistrationProblems, showId, toStudentView, TXN, type FestCatalog, type FestDepartment, type FestEvent, type FestMethod, type FestParticipant, type FestPayment, type FestPlace, type FestRegistration, type FestResult, type FestSource, type FestStamp, type UtrChange } from '../src/lib/fest';
import { timingSafeEqual } from 'node:crypto';
import { formatIst, parseEventStart } from '../src/lib/countdown';
import { DEFAULT_PORTAL, portalProblem, QR_IMAGE, QR_MAX_CHARS, readPortal, tidyUtr, UTR, type BackupStatus, type PortalSettings, type SwitchName } from '../src/lib/portal';
import { registrationPhase, type RegistrationSchedule } from '../src/lib/schedule';
import { DEPARTMENT_ROLES, hasPermission, type Permission } from '../src/lib/staff';
import { ApiError } from './errors';
import { TXN_SCOPE } from './festStore';
import type { FileStore } from './files';
import type { FestSheetBackup, FestSnapshot } from './festSheet';
import type { FestStore } from './festStore';
import { mockParticipant, mockRegistration, MAX_TEST_PARTICIPANTS } from './festLoadTest';
import { describeError } from './google';
import { requirePermission, type Actor } from './roles';
import type { Store } from './store';

export const CATALOG_SETTING = 'fest-catalog';
/** When test data was last deleted: every phone that sees a new value drops its copy and loads afresh. */
export const RESET_SETTING = 'fest-reset';
/** The website's switches and the online payment settings (Website controls). */
export const PORTAL_SETTING = 'portal-settings';
/** The UPI QR code picture students pay with (a data: URL), kept apart so the switches stay small. */
export const QR_SETTING = 'fest-upi-qr';
/** How the last scheduled backups went (shown in Website controls). */
export const BACKUP_SETTING = 'fest-backup-status';
/** Test registrations deleted per call (the dashboard calls again until none are left), several at a time. */
const CLEAR_BATCH = 250;
const PURGE_PARALLEL = 20;
/** Who made a change from a student's own page. */
const STUDENT = 'student';
/** How long an instance trusts the catalog it read. */
const CATALOG_TTL_MS = 10_000;
/** Each sync returns what changed since a little before the last one, so nothing written meanwhile is missed. */
export const SYNC_OVERLAP_MS = 20_000;
const MAX_IMPORT_ROWS = 200;
const SUBMISSION = /^[A-Za-z0-9-]{8,80}$/;
/** A student's own submission id: random and long, as it is also the private key of their page. */
const STUDENT_KEY = /^[A-Za-z0-9-]{20,80}$/;
/** Whether a request carries a private key: one rule for the rate limits (service.ts) and the lookup here. */
export const isStudentKey = (value: unknown): value is string => typeof value === 'string' && STUDENT_KEY.test(value);
const MAX_PLACES = 3;
/** Mock participants added per call of the load test (the dashboard calls again until it has them all). */
const SEED_BATCH = 250;

export interface FestDeps {
  store: FestStore;
  settings: Pick<Store, 'getSetting' | 'putSetting'>;
  files: Pick<FileStore, 'put'>;
  /** The Google Sheet copy of the backup (on AWS; none in tests and the local mock). */
  sheet?: Pick<FestSheetBackup, 'save'>;
  /** The schedule in force (shared, changed in place by the registration times and test timelines). */
  schedule: RegistrationSchedule;
  /** { test } while a test session is on. */
  testMark: () => Promise<{ test?: unknown }>;
  now: () => number;
  log: (message: string, details?: Record<string, unknown>) => void;
}

/** Compares two secrets in constant time. */
const sameSecret = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : fallback);

export class FestService {
  private cached: { at: number; catalog: FestCatalog } | null = null;
  private resetCached: { at: number; value: string | null } | null = null;
  private portalCached: { at: number; portal: PortalSettings } | null = null;
  private qrCached: { at: number; image: string | null } | null = null;

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
      desks: DESKS,
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
  // Website controls: the switches and the online payment settings

  async portal(force = false): Promise<PortalSettings> {
    const now = this.deps.now();
    if (!force && this.portalCached && now - this.portalCached.at < CATALOG_TTL_MS) return this.portalCached.portal;
    let portal = DEFAULT_PORTAL;
    try {
      const stored = await this.deps.settings.getSetting(PORTAL_SETTING);
      if (stored) portal = readPortal(JSON.parse(stored));
    } catch (error) {
      if (this.portalCached) return this.portalCached.portal;
      this.deps.log('Could not read the website switches; using the defaults', { error: error instanceof Error ? error.message : String(error) });
    }
    this.portalCached = { at: now, portal };
    return portal;
  }

  private async qrImage(force = false): Promise<string | null> {
    const now = this.deps.now();
    if (!force && this.qrCached && now - this.qrCached.at < CATALOG_TTL_MS) return this.qrCached.image;
    let image: string | null = null;
    try {
      image = (await this.deps.settings.getSetting(QR_SETTING)) || null;
    } catch {
      if (this.qrCached) return this.qrCached.image;
    }
    this.qrCached = { at: now, image };
    return image;
  }

  /** A switch the web assist team turned off stops everyone but the web assist team (who may fix things). */
  async requireSwitch(actor: Actor | null, name: SwitchName, message: string) {
    if (actor?.role === 'ADMIN') return;
    if (!(await this.portal())[name]) throw new ApiError(403, 'SWITCHED_OFF', message);
  }

  async portalView() {
    return { success: true as const, portal: await this.portal(true), qr: await this.qrImage(true), backup: await this.backupStatus() };
  }

  private async backupStatus(): Promise<BackupStatus | null> {
    try {
      const raw = await this.deps.settings.getSetting(BACKUP_SETTING);
      return raw ? (JSON.parse(raw) as BackupStatus) : null;
    } catch {
      return null;
    }
  }

  /** The web assist team changes the switches and the UPI account (the QR picture has its own route). */
  async savePortal(actor: Actor, body: unknown) {
    if (!isObject(body) || !isObject(body.portal)) throw new ApiError(400, 'INVALID', 'The settings could not be read.');
    const current = await this.portal(true);
    const next: PortalSettings = { ...readPortal(body.portal, current), qrAt: current.qrAt, updatedAt: this.iso(), updatedBy: actor.username };
    const problem = portalProblem(next);
    if (problem) throw new ApiError(400, 'INVALID', problem);
    await this.deps.settings.putSetting(PORTAL_SETTING, JSON.stringify(next));
    this.portalCached = { at: this.deps.now(), portal: next };
    this.deps.log('Website controls saved', { by: actor.username, off: offSwitches(next) });
    return { success: true as const, portal: next, qr: await this.qrImage() };
  }

  /** Uploads (or replaces) the UPI QR code picture, or removes it. */
  async saveQr(actor: Actor, body: unknown) {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The picture could not be read.');
    const current = await this.portal(true);
    let image = '';
    if (body.remove !== true) {
      image = typeof body.image === 'string' ? body.image : '';
      if (!QR_IMAGE.test(image) || image.length > QR_MAX_CHARS || !looksLikeImage(image)) {
        throw new ApiError(400, 'INVALID', 'Upload the QR code as a PNG, JPEG or WebP picture (it is made smaller before it is sent).');
      }
    }
    const next: PortalSettings = { ...current, qrAt: image ? this.iso() : null, updatedAt: this.iso(), updatedBy: actor.username };
    if (!image && next.onlinePayment && !next.upiId) next.onlinePayment = false;
    await this.deps.settings.putSetting(QR_SETTING, image);
    await this.deps.settings.putSetting(PORTAL_SETTING, JSON.stringify(next));
    this.qrCached = { at: this.deps.now(), image: image || null };
    this.portalCached = { at: this.deps.now(), portal: next };
    this.deps.log(image ? 'UPI QR code uploaded' : 'UPI QR code removed', { by: actor.username, ...(image && { chars: image.length }) });
    return { success: true as const, portal: next, qr: image || null };
  }

  /** The students' page's payment step: the QR code and the UPI account (none while online payment is off). */
  async publicPayment() {
    const portal = await this.portal();
    const online = portal.onlinePayment && Boolean(portal.upiId || portal.qrAt);
    return {
      success: true as const,
      online,
      upiId: online ? portal.upiId : '',
      upiPayee: online ? portal.upiPayee : '',
      qr: online && portal.qrAt ? await this.qrImage() : null,
    };
  }

  // -----------------------------------------------------------------------------------------
  // Who may see and work on which department

  private async viewDepartments(actor: Actor, requested: unknown): Promise<string[]> {
    const catalog = await this.catalog();
    const wanted = text(requested, 6).toUpperCase();
    if (hasPermission(actor.role, 'fest.viewAll')) {
      if (!wanted) return catalog.departments.map((dept) => dept.code);
      if (!departmentOf(catalog, wanted)) throw new ApiError(404, 'NOT_FOUND', 'There is no such department.');
      return [wanted];
    }
    const own = this.ownDepartment(actor);
    if (wanted && wanted !== own) throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${deptShort(own)}.`);
    return [own];
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
      if (wanted && wanted !== code) throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${deptShort(code)}.`);
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
      switches: await this.dashboardSwitches(),
      serverTime: this.iso(),
    };
  }

  /** The switches the dashboards follow (hiding what is off; the server refuses it anyway). */
  private async dashboardSwitches() {
    const { deskRegistration, eventEntry, results, downloads, onlinePayment } = await this.portal();
    return { deskRegistration, eventEntry, results, downloads, onlinePayment };
  }

  // -----------------------------------------------------------------------------------------
  // Registering

  /** The events asked for: the department's own only (a student takes part in their department's events). */
  private async readEventIds(catalog: FestCatalog, dept: string, value: unknown): Promise<string[]> {
    const requested = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 60) : [];
    const ids: string[] = [];
    for (const id of requested) {
      const event = eventOf(catalog, id);
      if (!event || !canJoin({ dept }, event)) throw new ApiError(400, 'INVALID', `${showId(id)} is not an event of ${deptShort(dept)}: students take part in their own department’s events.`);
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

  /**
   * A desk registers a student who could not do it on their phone (online only; Website controls can
   * switch it off). The same IDs as the students' own phones (CSE-2001…), the entry fee due: the desk
   * then collects it (or verifies the student's UTR) like anyone else's.
   */
  async register(actor: Actor, body: unknown) {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The registration could not be read.');
    const department = await this.workDepartment(actor, body.dept);
    if (!department.active) throw new ApiError(400, 'INVALID', `${deptShort(department.code)} is not taking registrations.`);
    const dept = department.code;
    if (registrationPhase(this.deps.schedule, this.deps.now()) === 'closed') throw new ApiError(403, 'ONSITE_CLOSED', this.closedMessage());
    await this.requireSwitch(actor, 'deskRegistration', 'Registering for a student is switched off by the web assist team. Students register on their phones.');
    const submissionId = text(body.submissionId, 80);
    if (!SUBMISSION.test(submissionId)) throw new ApiError(400, 'INVALID', 'The registration could not be read. Please try again.');
    const participant = readParticipant(body.participant);
    const problems = selfRegistrationProblems(participant);
    if (Object.keys(problems).length) throw new ApiError(400, 'INVALID', Object.values(problems)[0]!, undefined, undefined, problems as Record<string, string>);
    const created = await this.createSelf(dept, participant, submissionId, this.stamp(actor), '');
    if (!created.replayed) this.deps.log('Fest registration at a desk', { id: created.registration.id, dept, by: actor.username, ...(created.registration.test && { test: true }) });
    return { success: true as const, registration: created.registration, replayed: created.replayed };
  }

  /**
   * A new registration with the next ID students' phones use (CSE-2001…), the entry fee due, and no
   * events: a student joins each event at its venue, where its coordinator adds them (events a page
   * sends are not used). A retry of the same submission returns the first one; a mobile number
   * registered in the department already is refused.
   */
  private async createSelf(dept: string, participant: FestParticipant, submissionId: string, stamp: FestStamp, txn: string): Promise<{ registration: FestRegistration; replayed: boolean }> {
    const replay = await this.deps.store.findSubmission(dept, submissionId);
    if (replay) return { registration: await this.required(dept, replay), replayed: true };
    const catalog = await this.catalog();
    const mark = await this.deps.testMark();
    const duplicate = (existingId: string | null) => {
      // A student is never told whose ID it is; a desk is (it then opens that registration).
      const desk = stamp.by !== STUDENT;
      return new ApiError(
        409,
        'DUPLICATE_PHONE',
        desk
          ? `This mobile number is already registered in ${deptShort(dept)} as ${showId(existingId ?? '')}. Open that registration instead.`
          : `This mobile number is already registered in ${deptShort(dept)}. Open "My registration ID", or go to a ${deptShort(dept)} registration desk.`,
        undefined,
        undefined,
        desk ? { existingId: existingId ?? '' } : undefined,
      );
    };
    // Checked before an ID is taken, so a refused number leaves no gap in the IDs.
    const holder = await this.deps.store.findPhone(dept, participant.phone);
    if (holder) throw duplicate(holder);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const number = await this.deps.store.takeNumbers(dept, 'SELF', 1);
      if (number > ID_RANGES.SELF.last) throw new ApiError(409, 'IDS_EXHAUSTED', `${deptShort(dept)} has used every registration ID. Ask the web assist team.`);
      const registration: FestRegistration = {
        id: formatFestId(dept, number),
        dept,
        source: 'SELF',
        ...participant,
        entry: txn ? { status: 'DUE', claim: { txn, amount: catalog.entryFee, at: stamp.at } } : { status: 'DUE' },
        events: [],
        created: stamp,
        sid: submissionId,
        ...(mark.test ? { test: true } : {}),
        v: 1,
        u: this.iso(),
      };
      const created = await this.deps.store.createRegistration(registration, submissionId);
      if (created.created) return { registration, replayed: false };
      if (created.reason === 'submission') return { registration: await this.required(dept, created.existingId!), replayed: true };
      if (created.reason === 'phone') throw duplicate(created.existingId ?? null);
      // 'id': that number is taken (e.g. after test data was cleared): take the next one.
    }
    throw new ApiError(409, 'BUSY', 'Registration is busy. Please try again.');
  }

  /** Claims a UPI payment's transaction ID for this registration (refused when another one has it). */
  private async claimPayment(payment: FestPayment | undefined, id: string) {
    if (payment?.method !== 'UPI' || !payment.txn) return;
    const holder = await this.deps.store.claimTxn(TXN_SCOPE, payment.txn, id);
    if (holder && holder !== id) throw new ApiError(409, 'TXN_USED', `This UPI transaction ID was already accepted for ${showId(holder)}.`, undefined, undefined, { existingId: holder });
  }

  private async releasePayment(payment: FestPayment | undefined, id: string) {
    if (payment?.method === 'UPI' && payment.txn) await this.deps.store.releaseTxn(TXN_SCOPE, payment.txn, id);
  }

  /**
   * Releases a claim this call made, unless the registration's saved payment carries that UTR (a
   * repeated request: the first one's claim must stay).
   */
  private async releaseUnlessKept(payment: FestPayment, registration: FestRegistration) {
    const kept = registration.entry.status === 'PAID' && sameUtr(registration.entry.payment?.txn, payment.txn);
    if (!kept) await this.releasePayment(payment, registration.id);
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
        if (holder && holder !== id) throw new ApiError(409, 'DUPLICATE_PHONE', `That phone number is already registered in ${deptShort(dept)} as ${showId(holder)}.`, undefined, undefined, { existingId: holder });
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

  /** The entry fee (collect or verify), check-in, UTR corrections, details, events, cancel, delete and restore. */
  async act(actor: Actor, rawId: string, body: unknown) {
    const { id, dept } = this.target(rawId);
    const action = isObject(body) ? body.action : null;
    const needs: Record<string, Permission> = {
      collect: 'fest.register',
      checkin: 'fest.register',
      entry: 'fest.register',
      verify: 'fest.register',
      reject: 'fest.register',
      utr: 'fest.register',
      edit: 'fest.edit',
      events: 'fest.edit',
      cancel: 'fest.cancel',
      uncancel: 'fest.cancel',
      delete: 'fest.delete',
      restore: 'fest.delete',
    };
    if (typeof action !== 'string' || !needs[action]) throw new ApiError(400, 'INVALID', 'Choose what to do.');
    requirePermission(actor, needs[action]);
    // A UTR that clashes may be another department's student's: either desk may correct it.
    if (action === 'utr') await this.utrScope(actor, dept, id);
    else await this.workDepartment(actor, dept);
    const input = body as Record<string, unknown>;
    const catalog = await this.catalog();
    const stamp = this.stamp(actor);
    const reason = text(input.reason, 200);
    const desk = actor.deskNumber ?? undefined;
    const arrived = (registration: FestRegistration) => registration.checkedIn ?? { ...stamp, ...(desk && { desk }) };
    const live = (registration: FestRegistration) => {
      if (registration.deleted) throw new ApiError(409, 'DELETED', 'This registration was deleted.');
      if (registration.cancelled) throw new ApiError(409, 'CANCELLED', 'This registration was cancelled.');
    };

    if (action === 'events') return this.changeEvents(catalog, dept, id, input, stamp);

    if (action === 'collect' || action === 'checkin' || action === 'entry') {
      // The entry fee taken at the desk: cash, or UPI with its UTR (accepted once across the fest).
      // Anyone whose fee is due can pay, checked in or not (e.g. after their UTR was found to be
      // someone else's); 'entry' takes the fee without checking them in.
      const current = await this.required(dept, id);
      live(current);
      if (current.entry.status === 'PAID') {
        // Paid already (online, or at another desk): arriving only checks them in.
        if (action === 'entry' || current.checkedIn) return { success: true as const, registration: current, changed: false };
        return this.mutate(dept, id, (registration) => {
          live(registration);
          return registration.checkedIn ? null : { next: { checkedIn: arrived(registration) } };
        });
      }
      const payment = this.readPayment(actor, input.payment, catalog.entryFee);
      await this.claimPayment(payment, id);
      try {
        const result = await this.mutate(dept, id, (registration) => {
          live(registration);
          if (registration.entry.status === 'PAID') return null;
          // A UTR the student sent earlier stays on record (it was not the payment taken).
          const entry = { status: 'PAID' as const, payment, ...(registration.entry.claim && { claim: registration.entry.claim }) };
          return { next: action === 'entry' ? { entry } : { entry, checkedIn: arrived(registration) } };
        });
        if (!result.changed) await this.releaseUnlessKept(payment, result.registration);
        if (result.changed) this.deps.log('Fest entry fee collected', { id, method: payment.method, by: actor.username });
        return result;
      } catch (error) {
        await this.releaseAfterFailure(payment, dept, id);
        throw error;
      }
    }

    if (action === 'verify') {
      // The student paid on their phone and sent the UTR: the desk types the UTR it sees on the
      // payment. It must be the one the student sent, or (ticked) the student typed theirs wrong.
      const current = await this.required(dept, id);
      live(current);
      if (current.entry.status === 'PAID') return { success: true as const, registration: current, changed: false };
      const claim = current.entry.claim;
      if (!claim) throw new ApiError(409, 'NO_CLAIM', 'They have not sent a UTR: collect the fee instead (cash, or UPI with its UTR).');
      const txn = tidyUtr(text(input.txn, 40)).toUpperCase();
      if (!TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Type the UTR from the payment (12 digits).');
      const typo = !sameUtr(txn, claim.txn);
      if (typo && input.correct !== true) {
        throw new ApiError(
          409,
          'TXN_MISMATCH',
          `That UTR does not match the one ${showId(id)} sent (it ends ${claim.txn.slice(-4)}). Check the digits; if the student typed theirs wrong, tick that the UTR you typed is the right one.`,
        );
      }
      if (input.confirmed !== true) throw new ApiError(400, 'INVALID', `Tick that you have seen ₹${claim.amount} received with this UTR.`);
      const payment: FestPayment = { method: 'UPI', amount: claim.amount, txn, ...stamp, ...(desk && { desk }) };
      await this.claimPayment(payment, id);
      try {
        const result = await this.mutate(dept, id, (registration) => {
          live(registration);
          if (registration.entry.status === 'PAID' || !registration.entry.claim) return null;
          const sent = registration.entry.claim;
          const utrLog = sameUtr(txn, sent.txn) ? registration.utrLog : [...(registration.utrLog ?? []), { ...stamp, from: sent.txn, to: txn, reason: 'The student typed it wrong; corrected at the desk when verifying' }];
          return { next: { entry: { status: 'PAID', payment, claim: sent }, checkedIn: arrived(registration), ...(utrLog && { utrLog }) } };
        });
        if (!result.changed) await this.releaseUnlessKept(payment, result.registration);
        if (result.changed) this.deps.log('Fest UTR verified', { id, utr: txn.slice(-4), corrected: typo, by: actor.username });
        return result;
      } catch (error) {
        await this.releaseAfterFailure(payment, dept, id);
        throw error;
      }
    }

    if (action === 'utr') return this.changeUtr(dept, id, input, stamp, live);

    if (action === 'uncancel' || action === 'restore') {
      // Brought back: its UPI payment is claimed again (refused if another student has the UTR now).
      const current = await this.required(dept, id);
      const payment = current.entry.status === 'PAID' ? current.entry.payment : undefined;
      if (payment && !payment.voided) await this.claimPayment(payment, id);
    }

    const result = await this.mutate(dept, id, (registration) => {
      switch (action) {
        case 'edit': {
          live(registration);
          const participant = readParticipant({ ...pick(registration), ...(isObject(input.participant) ? input.participant : {}) });
          const problems = participantProblems(participant);
          if (Object.keys(problems).length) throw new ApiError(400, 'INVALID', Object.values(problems)[0]!, undefined, undefined, problems as Record<string, string>);
          if (Object.entries(participant).every(([key, value]) => (registration[key as keyof FestParticipant] ?? '') === value)) return null;
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
          // The money was not found: the student sees why on their page and can send the right UTR.
          live(registration);
          if (registration.entry.status === 'PAID' || !registration.entry.claim) return null;
          if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say what is wrong (e.g. not received, wrong amount).');
          return { next: { entry: { ...registration.entry, rejected: { ...stamp, reason } } } };
        default:
          return null;
      }
    });
    // Cancelled or deleted: its UTR is free again (e.g. registered under the wrong department).
    if (result.changed && (action === 'cancel' || action === 'delete')) await this.releasePayment(result.registration.entry.payment, id);
    return result;
  }

  /**
   * Corrects a student's UTR (a typo, or one that clashed with another student's), with the
   * reason kept in the registration's UTR log. A verified payment's new UTR is accepted once
   * across the fest like any other; a UTR the student sent (not checked yet) waits for the desk.
   */
  private async changeUtr(dept: string, id: string, input: Record<string, unknown>, stamp: FestStamp, live: (registration: FestRegistration) => void) {
    const to = tidyUtr(text(input.txn, 40)).toUpperCase();
    if (!TXN.test(to)) throw new ApiError(400, 'INVALID', 'Type the right UTR (the 12 digits of the payment).');
    const reason = text(input.reason, 200);
    if (reason.length < 3) throw new ApiError(400, 'INVALID', 'Say why the UTR is changed (e.g. typed wrong, belongs to the other student).');
    const current = await this.required(dept, id);
    live(current);
    const paid = current.entry.status === 'PAID' && current.entry.payment?.method === 'UPI' && Boolean(current.entry.payment.txn);
    const from = paid ? current.entry.payment!.txn! : current.entry.status === 'DUE' ? current.entry.claim?.txn : undefined;
    if (!from) throw new ApiError(409, 'NO_UTR', `${showId(id)} has no UTR to change.`);
    if (sameUtr(from, to)) return { success: true as const, registration: current, changed: false };
    const change: UtrChange = { ...stamp, from, to, reason };
    if (paid) {
      const holder = await this.deps.store.claimTxn(TXN_SCOPE, to, id);
      if (holder && holder !== id) throw new ApiError(409, 'TXN_USED', `This UTR is already accepted for ${showId(holder)}.`, undefined, undefined, { existingId: holder });
      try {
        const result = await this.mutate(dept, id, (registration) => {
          const payment = registration.entry.payment;
          if (registration.entry.status !== 'PAID' || payment?.method !== 'UPI' || !sameUtr(payment.txn, from)) {
            throw new ApiError(409, 'BUSY', 'This payment was changed meanwhile. Look at it again.');
          }
          return { next: { entry: { ...registration.entry, payment: { ...payment, txn: to } }, utrLog: [...(registration.utrLog ?? []), change] } };
        });
        await this.deps.store.releaseTxn(TXN_SCOPE, from, id);
        this.deps.log('Fest UTR changed', { id, from: from.slice(-4), to: to.slice(-4), by: stamp.by });
        return result;
      } catch (error) {
        await this.deps.store.releaseTxn(TXN_SCOPE, to, id);
        throw error;
      }
    }
    const accepted = await this.deps.store.findTxn(TXN_SCOPE, to);
    if (accepted && accepted !== id) throw new ApiError(409, 'TXN_USED', `This UTR is already accepted for ${showId(accepted)}.`, undefined, undefined, { existingId: accepted });
    const result = await this.mutate(dept, id, (registration) => {
      const claim = registration.entry.claim;
      if (registration.entry.status !== 'DUE' || !claim || !sameUtr(claim.txn, from)) throw new ApiError(409, 'BUSY', 'This payment was changed meanwhile. Look at it again.');
      // A corrected UTR is checked afresh (a "not found" mark goes).
      return { next: { entry: { status: 'DUE', claim: { ...claim, txn: to } }, utrLog: [...(registration.utrLog ?? []), change] } };
    });
    this.deps.log('Fest UTR changed', { id, from: from.slice(-4), to: to.slice(-4), by: stamp.by });
    return result;
  }

  /**
   * Who may correct this student's UTR: their own department's desks (and the web assist team), and
   * another department's desk only when the UTR clashes with one of its own students'.
   */
  private async utrScope(actor: Actor, dept: string, id: string) {
    if (!DEPARTMENT_ROLES.includes(actor.role) || actor.department === dept) {
      await this.workDepartment(actor, dept);
      return;
    }
    const own = this.ownDepartment(actor);
    const target = await this.required(dept, id);
    const txn = target.entry.status === 'PAID' ? target.entry.payment?.txn : target.entry.claim?.txn;
    if (txn) {
      const { holders } = await this.utrHolders(tidyUtr(txn).toUpperCase());
      if (holders.some((item) => item.dept === own && item.id !== id && isActive(item))) return;
    }
    throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${deptShort(own)}: another department's UTR is changed only when it clashes with one of yours.`);
  }

  /** After a failed save: releases the claim unless the registration (as saved now) carries it. */
  private async releaseAfterFailure(payment: FestPayment, dept: string, id: string) {
    const now = await this.deps.store.getRegistration(dept, id).catch(() => null);
    if (now) await this.releaseUnlessKept(payment, now);
    else await this.releasePayment(payment, id);
  }

  // -----------------------------------------------------------------------------------------
  // Who does a UTR belong to? (desks, when a UTR is sent twice or already used)

  /** Every registration with this UPI transaction ID, in every department. */
  private async utrHolders(txn: string): Promise<{ accepted: string | null; holders: FestRegistration[] }> {
    const catalog = await this.catalog();
    const [accepted, parts] = await Promise.all([this.deps.store.findTxn(TXN_SCOPE, txn), Promise.all(catalog.departments.map((dept) => this.deps.store.changes(dept.code, '')))]);
    const same = (value: string | undefined) => tidyUtr(value ?? '').toUpperCase() === txn;
    const holders = parts
      .flatMap((part) => part.registrations)
      .filter((registration) => !registration.deleted && (registration.id === accepted || same(registration.entry.payment?.txn) || same(registration.entry.claim?.txn)));
    return { accepted, holders };
  }

  private readUtr(body: unknown) {
    const txn = tidyUtr(text(isObject(body) ? body.txn : '', 40)).toUpperCase();
    if (!TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Type the UTR (the 12 digits of the payment).');
    return txn;
  }

  /** "Who does this UTR belong to?": the student it was accepted for and everyone who sent it. */
  async utrLookup(_actor: Actor, body: unknown) {
    const txn = this.readUtr(body);
    const { accepted, holders } = await this.utrHolders(txn);
    const view = (registration: FestRegistration) => {
      const paid = tidyUtr(registration.entry.payment?.txn ?? '').toUpperCase() === txn && registration.entry.status === 'PAID';
      const state: 'accepted' | 'sent' | 'notFound' = paid || registration.id === accepted ? 'accepted' : registration.entry.rejected ? 'notFound' : 'sent';
      return {
        id: registration.id,
        dept: registration.dept,
        name: registration.name,
        college: registration.college,
        phone: registration.phone,
        state,
        at: state === 'accepted' ? (registration.entry.payment?.at ?? registration.created.at) : (registration.entry.claim?.at ?? registration.created.at),
        by: state === 'accepted' ? (registration.entry.payment?.by ?? null) : null,
      };
    };
    const order = { accepted: 0, sent: 1, notFound: 2 } as const;
    const list = holders.map(view).sort((a, b) => order[a.state] - order[b.state] || a.at.localeCompare(b.at));
    return { success: true as const, txn, holders: list };
  }

  /** Adds and removes events (a fee paid or attendance marked keeps an event). */
  private async changeEvents(catalog: FestCatalog, dept: string, id: string, input: Record<string, unknown>, stamp: FestStamp) {
    const add = await this.readEventIds(catalog, dept, input.add);
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
    const portal = await this.portal();
    return {
      success: true as const,
      open: registrationPhase(this.deps.schedule, this.deps.now()) !== 'closed',
      /** Registration on phones (off: the page sends students to a desk). */
      selfRegistration: portal.selfRegistration,
      /** Finding a registration by mobile number and email. */
      lookup: portal.studentLookup,
      /** Paying on the website by UPI (the QR code comes from /api/fest/payment when it is needed). */
      onlinePayment: portal.onlinePayment && Boolean(portal.upiId || portal.qrAt),
      closesAt: this.deps.schedule.onsiteClosesAt ?? null,
      entryFee: catalog.entryFee,
      departments: departments.map((dept) => ({ code: dept.code, name: dept.name })),
      events: catalog.events
        .filter((event) => event.active && open.has(event.dept))
        .map(({ id, dept, name, subtitle, venue, time, fee, teamMin, teamMax }) => ({ id, dept, name, subtitle, venue, time, fee, teamMin, teamMax })),
    };
  }

  /**
   * A student registers themselves for a department: an ID of that department (CSE-2001…), the entry
   * fee due; they pay it by UPI at that department's desk, which records it. Its event coordinators
   * take them in. (A transaction ID sent by an older copy of the page is still kept for the desk.)
   */
  async selfRegister(body: unknown) {
    if (!isObject(body)) throw new ApiError(400, 'INVALID', 'The registration could not be read.');
    if (registrationPhase(this.deps.schedule, this.deps.now()) === 'closed') throw new ApiError(403, 'ONSITE_CLOSED', this.closedMessage());
    await this.requireSwitch(null, 'selfRegistration', 'Registration on phones is paused. Please register at your department’s registration desk.');
    const catalog = await this.catalog();
    const department = departmentOf(catalog, text(body.dept, 6).toUpperCase());
    if (!department || !department.active) throw new ApiError(400, 'INVALID', 'Choose your department.', undefined, undefined, { dept: 'Choose your department.' });
    const dept = department.code;
    // The phone's submission id is also the private key of the student's page (only that phone has it).
    const submissionId = text(body.submissionId, 80);
    if (!STUDENT_KEY.test(submissionId)) throw new ApiError(400, 'INVALID', 'The registration could not be read. Please try again.');
    const replay = await this.deps.store.findSubmission(dept, submissionId);
    if (replay) return { success: true as const, registration: toStudentView(await this.required(dept, replay), true), replayed: true };

    const participant = readParticipant(body.participant);
    const problems = selfRegistrationProblems(participant);
    // The students' own form asks for their college code too.
    if (!participant.collegeCode) problems.collegeCode = 'Enter your college code.';
    if (Object.keys(problems).length) throw new ApiError(400, 'INVALID', Object.values(problems)[0]!, undefined, undefined, problems as Record<string, string>);
    const txn = text(body.txn, 40).replace(/\s/g, '');
    if (txn && !TXN.test(txn)) throw new ApiError(400, 'INVALID', 'Check the UPI transaction ID (UTR).', undefined, undefined, { txn: 'Check the UPI transaction ID (UTR).' });
    const created = await this.createSelf(dept, participant, submissionId, { at: this.iso(), by: STUDENT }, txn);
    if (!created.replayed) this.deps.log('Fest self-registration', { id: created.registration.id, events: created.registration.events.length, ...(created.registration.test && { test: true }) });
    return { success: true as const, registration: toStudentView(created.registration, true), replayed: created.replayed };
  }

  /**
   * The student's own registration. With the private key (the phone that registered keeps it) it
   * may be changed; with only the ID and the mobile number it is shown, never changed.
   */
  private async ownRegistration(body: unknown, change: boolean): Promise<{ registration: FestRegistration; keyed: boolean }> {
    const id = normaliseFestId(text(isObject(body) ? body.id : '', 20));
    const rawKey = isObject(body) ? body.key : undefined;
    const parsed = parseFestId(id);
    const registration = parsed ? await this.deps.store.getRegistration(parsed.dept, id) : null;
    // Any key sent must be a real one: a malformed key never falls back to the mobile number.
    if (rawKey !== undefined && rawKey !== null && rawKey !== '') {
      if (!isStudentKey(rawKey) || !registration || registration.deleted || registration.source !== 'SELF' || !registration.sid || !sameSecret(registration.sid, rawKey)) {
        throw new ApiError(404, 'NOT_FOUND', 'This registration could not be found on this phone. Open "Already registered?" with your ID and mobile number.');
      }
      return { registration, keyed: true };
    }
    // (Here, no key was sent.)
    await this.requireSwitch(null, 'studentLookup', 'Looking up a registration is switched off. Please ask at a registration desk.');
    const phone = readParticipant({ phone: isObject(body) ? body.phone : '' }).phone;
    if (!registration || registration.deleted || registration.phone !== phone) throw new ApiError(404, 'NOT_FOUND', 'No registration has that ID with that mobile number.');
    if (change) throw new ApiError(403, 'KEY_NEEDED', 'Change your events or transaction ID on the phone you registered with, or ask at a registration desk.');
    return { registration, keyed: false };
  }

  async studentView(body: unknown) {
    const { registration, keyed } = await this.ownRegistration(body, false);
    return { success: true as const, registration: toStudentView(registration, keyed) };
  }

  /**
   * "My registration ID" on a phone that did not register: the mobile number and the email the
   * student registered with find their registrations (shown, never changed), in every department.
   */
  async findOwn(body: unknown) {
    await this.requireSwitch(null, 'studentLookup', 'Looking up a registration is switched off. Please ask at a registration desk.');
    const phone = readParticipant({ phone: isObject(body) ? body.phone : '' }).phone;
    const email = text(isObject(body) ? body.email : '', 120).toLowerCase();
    const notFound = new ApiError(404, 'NOT_FOUND', 'No registration has that mobile number with that email. Check both, or ask at a registration desk.');
    if (!/^\d{10}$/.test(phone) || !email.includes('@')) throw notFound;
    const catalog = await this.catalog();
    const found: FestRegistration[] = [];
    await Promise.all(
      catalog.departments.map(async ({ code }) => {
        const id = await this.deps.store.findPhone(code, phone);
        const registration = id ? await this.deps.store.getRegistration(code, id) : null;
        if (registration && !registration.deleted && registration.email.trim().toLowerCase() === email) found.push(registration);
      }),
    );
    if (!found.length) throw notFound;
    found.sort((a, b) => a.created.at.localeCompare(b.created.at));
    return { success: true as const, registrations: found.map((registration) => toStudentView(registration, false)) };
  }

  /** Students do not pick events on their phones: each event's coordinator adds them at its venue. */
  async studentEvents(): Promise<never> {
    throw new ApiError(403, 'EVENTS_AT_VENUE', 'You join each event at its venue: show your registration ID to its coordinator.');
  }

  /** The student sends the right transaction ID after a desk did not find the payment (from the phone that registered). */
  async studentPayment(body: unknown) {
    const { registration: found } = await this.ownRegistration(body, true);
    if (!(await this.portal()).onlinePayment) throw new ApiError(403, 'SWITCHED_OFF', `Online payment is switched off. Pay at the ${deptShort(found.dept)} registration desk.`);
    const txn = tidyUtr(text(isObject(body) ? body.txn : '', 40));
    if (!UTR.test(txn)) throw new ApiError(400, 'INVALID', 'Type the 12-digit UPI reference number (UTR) from your payment.', undefined, undefined, { txn: 'Type the 12 digits of the UTR.' });
    // A payment accepted for someone else cannot be used again.
    const holder = await this.deps.store.findTxn(TXN_SCOPE, txn);
    if (holder && holder !== found.id) throw new ApiError(409, 'TXN_USED', 'This UTR was already used for another registration. Check it in your UPI app.', undefined, undefined, { txn: 'Already used for another registration.' });
    const catalog = await this.catalog();
    const result = await this.mutate(found.dept, found.id, (registration) => {
      if (!isActive(registration)) throw new ApiError(409, 'CANCELLED', 'This registration was cancelled.');
      if (registration.entry.status === 'PAID') return null;
      return { next: { entry: { status: 'DUE', claim: { txn, amount: catalog.entryFee, at: this.iso() } } } };
    });
    return { success: true as const, registration: toStudentView(result.registration, true) };
  }

  private eventAccess(actor: Actor, event: FestEvent) {
    if (actor.role === 'COORDINATOR') {
      if (actor.department !== event.dept || !actor.eventIds.includes(event.id)) throw new ApiError(403, 'EVENT_NOT_ASSIGNED', 'This event is not assigned to your account.');
    } else if (DEPARTMENT_ROLES.includes(actor.role)) {
      if (actor.department !== event.dept) throw new ApiError(403, 'OTHER_DEPARTMENT', `Your account is for ${actor.department ? deptShort(actor.department) : 'another department'}.`);
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
    const action = isObject(body) ? body.action : null;
    if (!['add', 'fee', 'present', 'absent', 'void-fee'].includes(String(action))) throw new ApiError(400, 'INVALID', 'Choose what to do.');
    requirePermission(actor, action === 'void-fee' ? 'fest.correct' : 'fest.event');
    if (action !== 'void-fee') this.eventAccess(actor, event);
    // A student takes part only in their own department's events.
    if (action === 'add' && !canJoin({ dept }, event)) {
      throw new ApiError(400, 'OTHER_DEPARTMENT', `${showId(id)} is registered under ${deptShort(dept)}: they take part in ${deptShort(dept)} events only.`);
    }
    if (action !== 'void-fee') await this.requireSwitch(actor, 'eventEntry', 'Event entry is switched off by the web assist team.');
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
      if (!entry) throw new ApiError(409, 'NOT_IN_EVENT', `${showId(id)} is not registered for ${event.name}. Add them first.`);
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
    if (action !== 'reopen') await this.requireSwitch(actor, 'results', 'Results entry is switched off by the web assist team.');
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
        const registration = owner ? await this.deps.store.getRegistration(owner.dept, id) : null;
        const entry = registration && isActive(registration) ? entryOf(registration, event.id) : null;
        if (!entry) throw new ApiError(400, 'INVALID', `${showId(id)} is not registered for ${event.name}.`);
        if (!entry.present) throw new ApiError(400, 'INVALID', `${showId(id)} is not marked present at ${event.name}.`);
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
      if (first + ready.length - 1 > ID_RANGES.ONLINE.last) throw new ApiError(409, 'IDS_EXHAUSTED', `${deptShort(dept)} has used every online ID.`);
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
    const codes = catalog.departments.map((dept) => dept.code);
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
        const sources: FestSource[] = ['DESK', 'SELF', 'ONLINE', 'PAPER'];
        await Promise.all(sources.map((source) => this.deps.store.resetCounter(part.dept, source)));
        restarted.push(part.dept);
      }
      await this.deps.settings.putSetting(RESET_SETTING, this.iso());
      this.resetCached = null;
    }
    this.deps.log('Fest test data deleted', { registrations: batch.length, remaining, results, restarted, by: actor.username });
    return { success: true as const, cleared: batch.length, remaining, results, restarted };
  }

  /**
   * The load test: mock participants (most from the colleges around Salem), marked TEST and spread
   * over the departments, at most MAX_TEST_PARTICIPANTS test registrations in all. Adds a batch per
   * call; the dashboard calls again until `remaining` is 0. "Delete the test data" removes them.
   */
  async seedTest(actor: Actor, body: unknown) {
    const catalog = await this.catalog();
    const departments = catalog.departments.filter((dept) => dept.active);
    if (!departments.length) throw new ApiError(400, 'INVALID', 'No department is taking registrations.');
    const target = Math.min(Math.max(int(isObject(body) ? body.count : undefined, MAX_TEST_PARTICIPANTS), 1), MAX_TEST_PARTICIPANTS);
    const everything = await Promise.all(catalog.departments.map((dept) => this.deps.store.changes(dept.code, '')));
    const existing = everything.flatMap((part) => part.registrations).filter((registration) => registration.test).length;
    const batch = Math.max(0, Math.min(target - existing, SEED_BATCH));
    if (!batch) return { success: true as const, added: 0, total: existing, remaining: 0, cap: MAX_TEST_PARTICIPANTS };

    // Spread over the departments, continuing where earlier calls stopped.
    const counts = new Map<string, number>();
    for (let index = 0; index < batch; index += 1) {
      const code = departments[(existing + index) % departments.length]!.code;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const random = Math.random;
    const now = this.deps.now();
    const by = `load-test (${actor.username})`;
    const phoneBase = Math.floor(random() * 900_000_000);
    const planned: { dept: string; number: number }[] = [];
    for (const [dept, count] of counts) {
      const first = await this.deps.store.takeNumbers(dept, 'SELF', count);
      for (let number = first; number < first + count && number <= ID_RANGES.SELF.last; number += 1) planned.push({ dept, number });
    }
    let added = 0;
    const create = async ({ dept, number }: { dept: string; number: number }, index: number) => {
      const events = catalog.events.filter((event) => event.dept === dept && event.active);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const sid = `loadtest-${now.toString(36)}-${index}-${attempt}-${Math.floor(random() * 1e9).toString(36)}`;
        const registration = mockRegistration(random, {
          id: formatFestId(dept, number),
          dept,
          participant: mockParticipant(random, index * 7 + attempt * 3_001, phoneBase),
          events,
          entryFee: catalog.entryFee,
          by,
          now,
          sid,
        });
        const payment = registration.entry.payment;
        await this.claimPayment(payment, registration.id).catch(() => undefined);
        const created = await this.deps.store.createRegistration(registration, sid);
        if (created.created) {
          added += 1;
          return;
        }
        await this.releasePayment(payment, registration.id);
        if (created.reason !== 'phone') return; // the ID is taken: skip it
      }
    };
    for (let index = 0; index < planned.length; index += PURGE_PARALLEL) {
      await Promise.all(planned.slice(index, index + PURGE_PARALLEL).map((item, offset) => create(item, existing + index + offset)));
    }
    const total = existing + added;
    this.deps.log('Fest load test participants added', { added, total, by: actor.username });
    return { success: true as const, added, total, remaining: added ? Math.max(0, target - total) : 0, cap: MAX_TEST_PARTICIPANTS };
  }

  /** Every department's registrations and results, as they are now (for the backups). */
  async snapshot(): Promise<FestSnapshot> {
    const catalog = await this.catalog();
    const parts = await Promise.all(catalog.departments.map((dept) => this.deps.store.changes(dept.code, '')));
    return { at: this.iso(), catalog, registrations: parts.flatMap((part) => part.registrations), results: parts.flatMap((part) => part.results) };
  }

  /** "Back up now" (web assist team): the same copies the schedule makes, with how they went. */
  async backupNow(actor: Actor) {
    const saved = await this.backup();
    this.deps.log('Fest backup made by hand', { by: actor.username, ...saved });
    return { success: true as const, ...saved, backup: await this.backupStatus() };
  }

  /**
   * Run by the schedule (every 10 minutes): every department's data to a private file (S3 keeps
   * each earlier version), and to the Google Sheet's fest tabs when anything changed. Each copy is
   * tried even if the other fails.
   */
  async backup() {
    const data = await this.snapshot();
    let file: 'saved' | 'failed' = 'saved';
    try {
      await this.deps.files.put('backups/fest/all.json', new TextEncoder().encode(JSON.stringify(data)), 'application/json');
    } catch (error) {
      file = 'failed';
      this.deps.log('Fest backup file failed', { error: describeError(error) });
    }
    let sheet: 'written' | 'unchanged' | 'failed' | 'off' = 'off';
    let sheetError: string | null = null;
    if (this.deps.sheet) {
      try {
        sheet = (await this.deps.sheet.save(data)).written ? 'written' : 'unchanged';
      } catch (error) {
        // Nothing is lost: the live data stays in the database and the private copy; the next
        // run (10 minutes later) writes the whole Sheet copy again.
        sheet = 'failed';
        sheetError = describeError(error).slice(0, 300);
        this.deps.log('Fest sheet backup failed', { error: sheetError });
      }
    }
    // Kept for Website controls, so a failing copy is seen without opening the AWS logs.
    const last = await this.backupStatus();
    const status: BackupStatus = {
      at: data.at,
      file,
      sheet,
      sheetError,
      lastFileAt: file === 'saved' ? data.at : (last?.lastFileAt ?? null),
      lastSheetAt: sheet === 'written' || sheet === 'unchanged' ? data.at : (last?.lastSheetAt ?? null),
    };
    try {
      await this.deps.settings.putSetting(BACKUP_SETTING, JSON.stringify(status));
    } catch {
      // Only the status: the copies themselves are done.
    }
    return { registrations: data.registrations.length, results: data.results.length, file, sheet };
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
  collegeCode: registration.collegeCode ?? '',
  branch: registration.branch,
  year: registration.year,
  team: registration.team,
});

/** The same UTR, however it was typed (spaces, dashes, case). */
const sameUtr = (a: string | undefined, b: string | undefined) => Boolean(a && b) && tidyUtr(a!).toUpperCase() === tidyUtr(b!).toUpperCase();

/** The switches that are off, for the log. */
const offSwitches = (portal: PortalSettings) => [
  ...(['selfRegistration', 'onlinePayment', 'studentLookup', 'deskRegistration', 'eventEntry', 'results', 'downloads'] as const).filter((name) => !portal[name]),
  ...Object.entries(portal.logins)
    .filter(([, on]) => !on)
    .map(([role]) => `login:${role}`),
];

/** The picture's first bytes say what its data: URL says (a PNG, JPEG or WebP, nothing else). */
function looksLikeImage(dataUrl: string) {
  const [head = '', data = ''] = dataUrl.split(',');
  const bytes = Buffer.from(data, 'base64');
  if (head.includes('image/png')) return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (head.includes('image/jpeg')) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
}
