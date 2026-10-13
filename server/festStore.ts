/**
 * Where the fest's registrations and results live, per department.
 *
 * On AWS: the FestRecords table (amplify/backend.ts), key pk 'D#CSE' + sk:
 *   R#CSE-0147        a registration          (has dept + u: in the "byDept" index)
 *   E#cse-hackathon   an event's results      (has dept + u: in the "byDept" index)
 *   P#9876543210      one phone, one registration per department
 *   X#<submission>    one desk submission, one registration (a retry never makes two)
 *   T#<txn>           one UPI transaction ID, one verified registration (self-registered students)
 *   C#DESK|ONLINE|PAPER|SELF  the department's ID counters (SELF: the 20001… series, in D#OPEN)
 * The "byDept" index (dept, u) gives everything changed since a moment: each screen asks only
 * for what changed since it last asked.
 *
 * In memory (tests and the local mock): the same rules.
 */
import type { FestRegistration, FestResult, FestSource } from '../src/lib/fest';
import { ID_RANGES } from '../src/lib/fest';

export type FestCreate = { created: true } | { created: false; reason: 'submission' | 'phone' | 'id'; existingId: string | null };

export interface FestChanges {
  registrations: FestRegistration[];
  results: FestResult[];
}

export interface FestStore {
  /** The department's registrations and results changed at or after `since` (everything when ''). */
  changes(dept: string, since: string): Promise<FestChanges>;
  getRegistration(dept: string, id: string): Promise<FestRegistration | null>;
  /** Stores a new registration with its phone (and submission) claim, all or nothing. */
  createRegistration(registration: FestRegistration, submissionId: string | null): Promise<FestCreate>;
  /**
   * Replaces the registration if its stored version is still `expected`. `phone` moves the
   * one-phone claim: from '' claims `to`, to '' releases `from`.
   */
  saveRegistration(registration: FestRegistration, expected: number, phone?: { from: string; to: string }): Promise<boolean>;
  findPhone(dept: string, phone: string): Promise<string | null>;
  findSubmission(dept: string, submissionId: string): Promise<string | null>;
  getResult(dept: string, eventId: string): Promise<FestResult | null>;
  /** Stores the results if their stored version is still `expected` (0: none yet). */
  saveResult(result: FestResult, expected: number): Promise<boolean>;
  /** Takes `count` numbers from the department's counter for that source; the first of them. */
  takeNumbers(dept: string, source: FestSource, count: number): Promise<number>;
  /**
   * Claims a UPI transaction ID for one registration (accepted once across the fest): null when
   * claimed now (or already this registration's), otherwise the ID of the registration holding it.
   */
  claimTxn(dept: string, txn: string, id: string): Promise<string | null>;
  /** Releases the claim, if this registration holds it (a verification that could not be saved). */
  releaseTxn(dept: string, txn: string, id: string): Promise<void>;
  /** Removes a registration and its claims for good (test data only). */
  purgeRegistration(registration: FestRegistration): Promise<void>;
  purgeResult(dept: string, eventId: string): Promise<void>;
  /** Starts a counter again at its first number (only when the department has no registrations of that source). */
  resetCounter(dept: string, source: FestSource): Promise<void>;
}

const copy = <T>(value: T): T => structuredClone(value);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export class MemoryFestStore implements FestStore {
  readonly registrations = new Map<string, FestRegistration>();
  readonly results = new Map<string, FestResult>();
  /** 'P#CSE#9876543210' / 'X#CSE#<submission>' → registration ID. */
  readonly claims = new Map<string, string>();
  readonly counters = new Map<string, number>();

  private key = (dept: string, id: string) => `${dept}#${id}`;

  async changes(dept: string, since: string): Promise<FestChanges> {
    await tick();
    return {
      registrations: [...this.registrations.values()].filter((item) => item.dept === dept && item.u >= since).map(copy),
      results: [...this.results.values()].filter((item) => item.dept === dept && item.u >= since).map(copy),
    };
  }

  async getRegistration(dept: string, id: string) {
    const found = this.registrations.get(this.key(dept, id));
    return found ? copy(found) : null;
  }

  async createRegistration(registration: FestRegistration, submissionId: string | null): Promise<FestCreate> {
    await tick();
    const { dept } = registration;
    if (submissionId && this.claims.has(`X#${dept}#${submissionId}`)) return { created: false, reason: 'submission', existingId: this.claims.get(`X#${dept}#${submissionId}`)! };
    if (this.claims.has(`P#${dept}#${registration.phone}`)) return { created: false, reason: 'phone', existingId: this.claims.get(`P#${dept}#${registration.phone}`)! };
    if (this.registrations.has(this.key(dept, registration.id))) return { created: false, reason: 'id', existingId: null };
    this.registrations.set(this.key(dept, registration.id), copy(registration));
    this.claims.set(`P#${dept}#${registration.phone}`, registration.id);
    if (submissionId) this.claims.set(`X#${dept}#${submissionId}`, registration.id);
    return { created: true };
  }

  async saveRegistration(registration: FestRegistration, expected: number, phone?: { from: string; to: string }) {
    await tick();
    const { dept, id } = registration;
    const stored = this.registrations.get(this.key(dept, id));
    if (!stored || stored.v !== expected) return false;
    if (phone?.to && phone.to !== phone.from) {
      const holder = this.claims.get(`P#${dept}#${phone.to}`);
      if (holder && holder !== id) return false;
    }
    if (phone && phone.from !== phone.to) {
      if (phone.from && this.claims.get(`P#${dept}#${phone.from}`) === id) this.claims.delete(`P#${dept}#${phone.from}`);
      if (phone.to) this.claims.set(`P#${dept}#${phone.to}`, id);
    }
    this.registrations.set(this.key(dept, id), copy(registration));
    return true;
  }

  async findPhone(dept: string, phone: string) {
    return this.claims.get(`P#${dept}#${phone}`) ?? null;
  }

  async findSubmission(dept: string, submissionId: string) {
    return this.claims.get(`X#${dept}#${submissionId}`) ?? null;
  }

  async getResult(dept: string, eventId: string) {
    const found = this.results.get(this.key(dept, eventId));
    return found ? copy(found) : null;
  }

  async saveResult(result: FestResult, expected: number) {
    await tick();
    const stored = this.results.get(this.key(result.dept, result.eventId));
    if ((stored?.v ?? 0) !== expected) return false;
    this.results.set(this.key(result.dept, result.eventId), copy(result));
    return true;
  }

  async takeNumbers(dept: string, source: FestSource, count: number) {
    const key = `${dept}#${source}`;
    const first = this.counters.get(key) ?? ID_RANGES[source].first;
    this.counters.set(key, first + count);
    return first;
  }

  async claimTxn(dept: string, txn: string, id: string) {
    await tick();
    const key = `T#${dept}#${txn.toUpperCase()}`;
    const holder = this.claims.get(key);
    if (holder && holder !== id) return holder;
    this.claims.set(key, id);
    return null;
  }

  async releaseTxn(dept: string, txn: string, id: string) {
    const key = `T#${dept}#${txn.toUpperCase()}`;
    if (this.claims.get(key) === id) this.claims.delete(key);
  }

  async purgeRegistration(registration: FestRegistration) {
    const { dept, id } = registration;
    this.registrations.delete(this.key(dept, id));
    for (const [key, holder] of this.claims) if (holder === id && key.split('#')[1] === dept) this.claims.delete(key);
  }

  async purgeResult(dept: string, eventId: string) {
    this.results.delete(this.key(dept, eventId));
  }

  async resetCounter(dept: string, source: FestSource) {
    this.counters.delete(`${dept}#${source}`);
  }
}
