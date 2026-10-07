/**
 * The Store in memory, with the same all-or-nothing and conditional rules as DynamoDB.
 * Used by the tests; the deployed API always uses DynamoStore.
 */
import { randomUUID } from 'node:crypto';
import type {
  AdminSession,
  ClaimKind,
  CreateResult,
  Expectation,
  Registration,
  RegistrationChanges,
  RegistrationStatus,
  Store,
} from './store';

const copy = <T>(value: T): T => structuredClone(value);

export class MemoryStore implements Store {
  readonly registrations = new Map<string, Registration>();
  readonly claims = new Map<string, string>();
  readonly sessions = new Map<string, AdminSession>();
  readonly hits = new Map<string, number>();
  readonly settings = new Map<string, string>();
  counter: number | null = null;

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

  async nextRegistrationNumber(seed: () => Promise<number>) {
    await this.ensureCounter(seed);
    this.counter! += 1;
    return this.counter!;
  }

  async ensureCounter(seed: () => Promise<number>) {
    if (this.counter !== null) return;
    const start = await seed();
    this.counter ??= start;
  }

  async createRegistration(registration: Registration): Promise<CreateResult> {
    const claims: [ClaimKind, string][] = [
      ['submission', registration.submissionHash],
      ['email', registration.emailKey],
      ['transaction', registration.transactionKey],
    ];
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
}
