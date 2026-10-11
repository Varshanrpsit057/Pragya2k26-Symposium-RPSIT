/**
 * The Store in memory, with the same all-or-nothing and conditional rules as DynamoDB.
 * Used by the tests; the deployed API always uses DynamoStore.
 */
import { randomUUID } from 'node:crypto';
import {
  claimsOf,
  type AdminSession,
  type AuditEntry,
  type ClaimKind,
  type CounterName,
  type CreateResult,
  type EventResult,
  type Expectation,
  type HelpRequest,
  type Registration,
  type RegistrationChanges,
  type RegistrationStatus,
  type StaffAccount,
  type Store,
} from './store';

const copy = <T>(value: T): T => structuredClone(value);

/** Lets other requests run between two steps, as a network round trip would. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export class MemoryStore implements Store {
  readonly registrations = new Map<string, Registration>();
  readonly claims = new Map<string, string>();
  readonly sessions = new Map<string, AdminSession>();
  readonly hits = new Map<string, number>();
  readonly settings = new Map<string, string>();
  readonly staff = new Map<string, StaffAccount>();
  readonly results = new Map<string, EventResult>();
  readonly counters = new Map<CounterName, number>();
  readonly help = new Map<string, HelpRequest>();
  readonly audit: AuditEntry[] = [];

  /** The online counter (261NNN; earlier PRG26-NNNN), as before the on-site desk existed. */
  get counter(): number | null {
    return this.counters.get('registration') ?? null;
  }

  set counter(value: number | null) {
    if (value === null) this.counters.delete('registration');
    else this.counters.set('registration', value);
  }

  async getRegistration(registrationId: string) {
    const found = this.registrations.get(registrationId);
    return found ? copy(found) : null;
  }

  async listRegistrations(status: RegistrationStatus) {
    return [...this.registrations.values()]
      .filter((registration) => registration.status === status)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(copy);
  }

  async findClaim(kind: ClaimKind, key: string) {
    return this.claims.get(`${kind}#${key}`) ?? null;
  }

  async nextRegistrationNumber(seed: () => Promise<number>, counter: CounterName = 'registration') {
    await this.ensureCounter(seed, counter);
    const next = this.counters.get(counter)! + 1;
    this.counters.set(counter, next);
    return next;
  }

  async ensureCounter(seed: () => Promise<number>, counter: CounterName = 'registration') {
    if (this.counters.has(counter)) return;
    const start = await seed();
    if (!this.counters.has(counter)) this.counters.set(counter, start);
  }

  async createRegistration(registration: Registration): Promise<CreateResult> {
    await tick();
    const claims = claimsOf(registration);
    const conflicts = claims.filter(([kind, key]) => this.claims.has(`${kind}#${key}`)).map(([kind]) => kind);
    if (conflicts.length || this.registrations.has(registration.registrationId)) return { ok: false, conflicts };
    this.registrations.set(registration.registrationId, copy(registration));
    for (const [kind, key] of claims) this.claims.set(`${kind}#${key}`, registration.registrationId);
    return { ok: true };
  }

  async updateRegistration(
    registrationId: string,
    changes: RegistrationChanges,
    { expect = {}, bump = true }: { expect?: Expectation; bump?: boolean } = {},
  ) {
    await tick();
    const current = this.registrations.get(registrationId);
    if (!current) return null;
    for (const [key, value] of Object.entries(expect)) {
      if (current[key as keyof Expectation] !== value) return null;
    }
    const next = { ...current } as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = copy(value);
    }
    if (bump) next.version = current.version + 1;
    this.registrations.set(registrationId, next as unknown as Registration);
    return copy(next as unknown as Registration);
  }

  async acquireLease(registrationId: string, until: number, now: number) {
    const current = this.registrations.get(registrationId);
    if (!current || (current.leaseUntil !== undefined && current.leaseUntil >= now)) return null;
    const leaseId = randomUUID();
    current.leaseUntil = until;
    current.leaseId = leaseId;
    return leaseId;
  }

  async releaseLease(registrationId: string, leaseId: string) {
    const current = this.registrations.get(registrationId);
    if (current?.leaseId === leaseId) {
      delete current.leaseUntil;
      delete current.leaseId;
    }
  }

  async releaseClaim(kind: ClaimKind, key: string, registrationId: string) {
    if (this.claims.get(`${kind}#${key}`) === registrationId) this.claims.delete(`${kind}#${key}`);
  }

  async claim(kind: ClaimKind, key: string, registrationId: string) {
    const holder = this.claims.get(`${kind}#${key}`);
    if (holder && holder !== registrationId) return false;
    this.claims.set(`${kind}#${key}`, registrationId);
    return true;
  }

  async deleteRegistration(registrationId: string, version: number) {
    await tick();
    if (this.registrations.get(registrationId)?.version !== version) return false;
    this.registrations.delete(registrationId);
    return true;
  }

  async putSession(tokenHash: string, session: AdminSession) {
    this.sessions.set(tokenHash, copy(session));
  }

  async getSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash);
    return session ? copy(session) : null;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async listSessions() {
    return [...this.sessions.values()].map(copy);
  }

  async getStaff(username: string) {
    const account = this.staff.get(username);
    return account ? copy(account) : null;
  }

  async listStaff() {
    return [...this.staff.values()].sort((a, b) => a.username.localeCompare(b.username)).map(copy);
  }

  async saveStaff(account: StaffAccount, expectedRevision: number) {
    await tick();
    const stored = this.staff.get(account.username);
    if ((stored?.revision ?? 0) !== expectedRevision || (expectedRevision === 0 && stored)) return false;
    this.staff.set(account.username, copy(account));
    return true;
  }

  async getEventResult(eventId: string) {
    const result = this.results.get(eventId);
    return result ? copy(result) : null;
  }

  async saveEventResult(result: EventResult, expectedRevision: number) {
    await tick();
    const stored = this.results.get(result.eventId);
    if ((stored?.revision ?? 0) !== expectedRevision || (expectedRevision === 0 && stored)) return false;
    this.results.set(result.eventId, copy(result));
    return true;
  }

  async hit(key: string, windowMs: number, now: number) {
    const bucket = `${key}#${Math.floor(now / windowMs)}`;
    const count = (this.hits.get(bucket) ?? 0) + 1;
    this.hits.set(bucket, count);
    return count;
  }

  async getSetting(name: string) {
    return this.settings.get(name) ?? null;
  }

  async putSetting(name: string, value: string) {
    this.settings.set(name, value);
  }

  async getHelpRequest(id: string) {
    const found = this.help.get(id);
    return found ? copy(found) : null;
  }

  async listHelpRequests() {
    return [...this.help.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(copy);
  }

  async saveHelpRequest(request: HelpRequest) {
    this.help.set(request.id, copy(request));
  }

  async addAuditEntry(entry: AuditEntry) {
    this.audit.push(copy(entry));
  }

  async listAuditEntries() {
    return [...this.audit].sort((a, b) => b.at.localeCompare(a.at)).map(copy);
  }
}
