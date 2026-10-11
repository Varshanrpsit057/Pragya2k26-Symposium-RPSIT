/**
 * Test sessions on the live website (Testing in the dashboard, admins only):
 *
 *   the timeline   a test schedule that replaces the real one (src/content/site.ts) until it is
 *                  set back: e.g. "on-site registration open now". The API and the website
 *                  follow it within seconds; while it is on, online registration follows it too.
 *   the session    while one is on, every registration made (desk or online) and every help
 *                  request is marked TEST.
 *   the clean-up   deletes the TEST records only, after saving them to a backup file; real
 *                  students' registrations are never touched. A record marked by mistake can be
 *                  kept ("a real student") first.
 *
 * Both settings live in the Control table, so every server instance reads the same ones.
 *
 * Also here, because it is the same schedule: the registration times an admin changes for real
 * (Registration times in the dashboard), e.g. on-site registration reopened until 2 PM. That
 * change becomes the real schedule; a test timeline still replaces it while one is on.
 */
import { eventCatalog } from '../src/content/eventCatalog';
import { parseEventStart } from '../src/lib/countdown';
import { registrationPhase, scheduleProblem, type RegistrationSchedule } from '../src/lib/schedule';
import {
  CLEAR_PHRASE,
  type ClearResult,
  NOTICE_MAX,
  type RegistrationWindowView,
  type SiteNoticeView,
  type TestRecordView,
  type TestSessionView,
  type TestingState,
  type TimelineMode,
  type TimelineView,
} from '../src/lib/testTools';
import type { DriveStore } from './drive';
import { ApiError } from './errors';
import type { FileStore } from './files';
import { previewKey } from './preview';
import { describeError } from './google';
import { sourceOf } from './participation';
import type { Actor } from './roles';
import type { SheetRow, SheetsStore } from './sheets';
import { claimsOf, type Registration, type RegistrationStatus, type Store } from './store';

export const TIMELINE_SETTING = 'timeline';
export const TEST_SESSION_SETTING = 'test-session';
export const WINDOW_SETTING = 'registration-window';
export const NOTICE_SETTING = 'site-notice';
/** How long a server instance trusts the settings it read (a change reaches all within this). */
const SETTINGS_TTL_MS = 10_000;
/** One clean-up call works for this long (the API answers within 29 s), then says what is left. */
const CLEAR_BUDGET_MS = 15_000;
const CLEAR_BATCH = 40;
const STATUSES: readonly RegistrationStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const encoder = new TextEncoder();

/** '2026-10-12T09:30:00': a moment in IST, written as the schedule writes times. */
export const istLocal = (ms: number) => new Date(ms + 5.5 * HOUR).toISOString().slice(0, 19);

interface StoredTimeline {
  mode: TimelineMode;
  schedule: RegistrationSchedule;
  setBy: string;
  setAt: string;
}

/** The admin's change to the registration times. */
interface StoredWindow {
  schedule: RegistrationSchedule;
  setBy: string;
  setAt: string;
}

/** The notice on the website. */
interface StoredNotice {
  text: string;
  setBy: string;
  setAt: string;
}

export interface TestToolsDeps {
  store: Store;
  files: FileStore;
  drive: Pick<DriveStore, 'trash'>;
  sheets: Pick<SheetsStore, 'ready' | 'update'>;
  now: () => number;
  log: (message: string, details?: Record<string, unknown>) => void;
  /** The planned schedule (src/content/site.ts). */
  standard: RegistrationSchedule;
  /** The schedule the whole API follows: changed in place, so every part sees the change. */
  schedule: RegistrationSchedule;
  sheetRow: (registration: Registration) => SheetRow;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Runs a clean-up step, ignoring any failure (thrown or rejected). */
async function quietly(step: () => Promise<unknown>) {
  try {
    await step();
  } catch {
    // Left as it is: the record itself is gone, and the backup has everything.
  }
}

function parse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** A time typed in the dashboard ('2026-10-12T09:30' or with seconds), in IST; null when unreadable. */
function typedTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const text = value.length === 16 ? `${value}:00` : value;
  return parseEventStart(text) === null ? null : text;
}

export class TestTools {
  private loadedAt = Number.NEGATIVE_INFINITY;
  private timelineSetting: StoredTimeline | null = null;
  private windowSetting: StoredWindow | null = null;
  private noticeSetting: StoredNotice | null = null;
  private session: TestSessionView | null = null;

  constructor(private readonly deps: TestToolsDeps) {}

  private iso() {
    return new Date(this.deps.now()).toISOString();
  }

  /**
   * Reads the timeline and the session (at most every few seconds per server instance) and
   * applies the timeline. If the read fails, the last ones read stay in force.
   */
  async sync(force = false) {
    const now = this.deps.now();
    if (!force && now - this.loadedAt < SETTINGS_TTL_MS) return;
    try {
      const [timeline, session, window, notice] = await Promise.all([
        this.deps.store.getSetting(TIMELINE_SETTING),
        this.deps.store.getSetting(TEST_SESSION_SETTING),
        this.deps.store.getSetting(WINDOW_SETTING),
        this.deps.store.getSetting(NOTICE_SETTING),
      ]);
      this.timelineSetting = parse<StoredTimeline>(timeline);
      this.session = parse<TestSessionView>(session);
      this.windowSetting = parse<StoredWindow>(window);
      this.noticeSetting = parse<StoredNotice>(notice);
      this.loadedAt = now;
    } catch (error) {
      this.deps.log('Could not read the test settings', { error: describeError(error) });
    }
    Object.assign(this.deps.schedule, this.timelineSetting?.schedule ?? this.real());
  }

  /** The real schedule: as planned, or as an admin changed it. */
  private real(): RegistrationSchedule {
    return this.windowSetting?.schedule ?? this.deps.standard;
  }

  timeline(): TimelineView {
    const now = this.deps.now();
    const setting = this.timelineSetting;
    return {
      schedule: { ...this.deps.schedule },
      standard: { ...this.real() },
      override: setting ? { mode: setting.mode, setBy: setting.setBy, setAt: setting.setAt } : null,
      phase: registrationPhase(this.deps.schedule, now),
      serverTime: new Date(now).toISOString(),
    };
  }

  /** For every signed-in staff member: is a test session or a test timeline on, have the registration times been changed? */
  status() {
    const window = this.windowSetting;
    return {
      session: this.session?.label ?? null,
      timeline: this.timelineSetting !== null,
      window: window ? { setBy: window.setBy, setAt: window.setAt } : null,
      notice: this.noticeSetting?.text ?? null,
    };
  }

  /** The notice on the website (admins). */
  async noticeState(): Promise<SiteNoticeView> {
    await this.sync(true);
    return { success: true, notice: this.noticeSetting ? { ...this.noticeSetting } : null };
  }

  /** Posts the notice on the website and the student page, or (empty text) takes it down. */
  async setNotice(actor: Actor, body: unknown): Promise<SiteNoticeView> {
    const raw = isObject(body) && typeof body.text === 'string' ? body.text : '';
    // Plain text on one line: no control characters, spaces tidied.
    const text = Array.from(raw, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      await this.deps.store.putSetting(NOTICE_SETTING, '');
      this.deps.log('Website notice taken down', { by: actor.username });
      return this.noticeState();
    }
    if (text.length > NOTICE_MAX) throw new ApiError(400, 'INVALID', `Keep the notice to ${NOTICE_MAX} characters (it has ${text.length}).`);
    const stored: StoredNotice = { text, setBy: actor.username, setAt: this.iso() };
    await this.deps.store.putSetting(NOTICE_SETTING, JSON.stringify(stored));
    this.deps.log('Website notice posted', { by: actor.username, length: text.length });
    return this.noticeState();
  }

  /** Registration times (admins): as planned, as changed, and what is in force now. */
  async windowState(): Promise<RegistrationWindowView> {
    await this.sync(true);
    const now = this.deps.now();
    const window = this.windowSetting;
    return {
      success: true,
      planned: { ...this.deps.standard },
      real: { ...this.real() },
      inForce: { ...this.deps.schedule },
      changed: window ? { setBy: window.setBy, setAt: window.setAt } : null,
      testTimeline: this.timelineSetting !== null,
      phase: registrationPhase(this.deps.schedule, now),
      serverTime: new Date(now).toISOString(),
    };
  }

  /**
   * Changes the registration times for real (admins): on-site registration open until a time
   * (reopened, extended or shortened; opened now if it was not open yet), every registration
   * closed now, three times given, or back to the planned schedule. The API, the desks and the
   * website follow within seconds.
   */
  async setWindow(actor: Actor, body: unknown): Promise<RegistrationWindowView> {
    const action = isObject(body) ? body.action : null;
    const now = this.deps.now();
    const base = this.real();
    const earliest = (a: string, b: string) => ((parseEventStart(a) ?? 0) <= (parseEventStart(b) ?? 0) ? a : b);
    let schedule: RegistrationSchedule;
    switch (action) {
      case 'planned':
        await this.deps.store.putSetting(WINDOW_SETTING, '');
        this.deps.log('Registration times back to the plan', { by: actor.username });
        return this.windowState();
      case 'onsite-until': {
        const until = typedTime(isObject(body) ? body.onsiteClosesAt : null);
        if (!until) throw new ApiError(400, 'INVALID', 'Give the time on-site registration closes.');
        if ((parseEventStart(until) ?? 0) <= now) throw new ApiError(400, 'INVALID', 'Choose a closing time later than now (to close now, use Close registration now).');
        // Not open yet (e.g. a day early): it opens now, and online registration closes.
        const opens = base.onsiteOpensAt && (parseEventStart(base.onsiteOpensAt) ?? 0) <= now ? base.onsiteOpensAt : istLocal(now - MINUTE);
        const onlineCloses = base.onlineClosesAt ? earliest(base.onlineClosesAt, opens) : opens;
        schedule = { onlineClosesAt: onlineCloses, onsiteOpensAt: opens, onsiteClosesAt: until };
        break;
      }
      case 'close-now': {
        const closes = istLocal(now);
        const opens = base.onsiteOpensAt ? earliest(base.onsiteOpensAt, istLocal(now - MINUTE)) : istLocal(now - MINUTE);
        schedule = { onlineClosesAt: base.onlineClosesAt ? earliest(base.onlineClosesAt, opens) : opens, onsiteOpensAt: opens, onsiteClosesAt: closes };
        break;
      }
      case 'custom': {
        const given = isObject(body) && isObject(body.schedule) ? body.schedule : {};
        const custom = { onlineClosesAt: typedTime(given.onlineClosesAt), onsiteOpensAt: typedTime(given.onsiteOpensAt), onsiteClosesAt: typedTime(given.onsiteClosesAt) };
        if (!custom.onlineClosesAt || !custom.onsiteOpensAt || !custom.onsiteClosesAt) throw new ApiError(400, 'INVALID', 'Give all three times: online closes, on-site opens and on-site closes.');
        schedule = custom as RegistrationSchedule;
        break;
      }
      default:
        throw new ApiError(400, 'INVALID', 'Choose what to change.');
    }
    const problem = scheduleProblem(schedule);
    if (problem) throw new ApiError(400, 'INVALID', `Those times do not work: ${problem}.`);
    const stored: StoredWindow = { schedule, setBy: actor.username, setAt: this.iso() };
    await this.deps.store.putSetting(WINDOW_SETTING, JSON.stringify(stored));
    this.deps.log('Registration times changed', { action, ...schedule, by: actor.username });
    return this.windowState();
  }

  /** The schedule and the notice for the public website (no names). */
  publicSchedule() {
    const notice = this.noticeSetting;
    return { success: true as const, schedule: { ...this.deps.schedule }, test: this.timelineSetting !== null, notice: notice ? { text: notice.text, setAt: notice.setAt } : null };
  }

  /** Sets a test timeline, or ('standard') goes back to the real schedule. */
  async setTimeline(actor: Actor, body: unknown) {
    const mode = (isObject(body) ? body.mode : null) as TimelineMode | null;
    const now = this.deps.now();
    const hours = Math.min(Math.max(Math.round(Number(isObject(body) ? body.hours : NaN)) || 12, 1), 72);
    let schedule: RegistrationSchedule;
    switch (mode) {
      case 'standard':
        await this.deps.store.putSetting(TIMELINE_SETTING, '');
        this.deps.log('Test timeline cleared', { by: actor.username });
        await this.sync(true);
        return { success: true as const, timeline: this.timeline() };
      case 'onsite-now':
        schedule = { onlineClosesAt: istLocal(now - 2 * MINUTE), onsiteOpensAt: istLocal(now - MINUTE), onsiteClosesAt: istLocal(now + hours * HOUR) };
        break;
      case 'online-now':
        schedule = { onlineClosesAt: istLocal(now + hours * HOUR), onsiteOpensAt: istLocal(now + hours * HOUR), onsiteClosesAt: istLocal(now + (hours + 24) * HOUR) };
        break;
      case 'closed':
        // After the event: the event day was yesterday, and on-site registration has closed.
        schedule = { onlineClosesAt: istLocal(now - 26 * HOUR), onsiteOpensAt: istLocal(now - 25 * HOUR), onsiteClosesAt: istLocal(now - MINUTE) };
        break;
      case 'custom': {
        const given = isObject(body) && isObject(body.schedule) ? body.schedule : {};
        const custom = { onlineClosesAt: typedTime(given.onlineClosesAt), onsiteOpensAt: typedTime(given.onsiteOpensAt), onsiteClosesAt: typedTime(given.onsiteClosesAt) };
        if (!custom.onlineClosesAt || !custom.onsiteOpensAt || !custom.onsiteClosesAt) throw new ApiError(400, 'INVALID', 'Give all three times: online closes, on-site opens and on-site closes.');
        schedule = custom as RegistrationSchedule;
        break;
      }
      default:
        throw new ApiError(400, 'INVALID', 'Choose a timeline.');
    }
    const problem = scheduleProblem(schedule);
    if (problem) throw new ApiError(400, 'INVALID', `That timeline does not work: ${problem}.`);
    const stored: StoredTimeline = { mode, schedule, setBy: actor.username, setAt: this.iso() };
    await this.deps.store.putSetting(TIMELINE_SETTING, JSON.stringify(stored));
    this.deps.log('Test timeline set', { mode, by: actor.username });
    await this.sync(true);
    return { success: true as const, timeline: this.timeline() };
  }

  /** The session on now, read fresh, so a registration made right after one starts is marked. */
  async activeSession(): Promise<TestSessionView | null> {
    try {
      return parse<TestSessionView>(await this.deps.store.getSetting(TEST_SESSION_SETTING));
    } catch {
      return this.session;
    }
  }

  /** The mark for a record made now, or nothing when no session is on. */
  async markNow(): Promise<{ test?: { session: string; at: string } }> {
    const session = await this.activeSession();
    return session ? { test: { session: session.id, at: this.iso() } } : {};
  }

  async startSession(actor: Actor, body: unknown) {
    const current = await this.activeSession();
    if (current) return { success: true as const, session: current };
    const now = this.deps.now();
    const typed = isObject(body) && typeof body.label === 'string' ? body.label.replace(/\p{Cc}+/gu, ' ').trim().slice(0, 60) : '';
    const session: TestSessionView = { id: `t${now.toString(36)}`, label: typed || `Test ${istLocal(now).replace('T', ' ').slice(0, 16)}`, startedAt: this.iso(), startedBy: actor.username };
    await this.deps.store.putSetting(TEST_SESSION_SETTING, JSON.stringify(session));
    this.deps.log('Test session started', { id: session.id, by: actor.username });
    await this.sync(true);
    return { success: true as const, session };
  }

  async stopSession(actor: Actor) {
    await this.deps.store.putSetting(TEST_SESSION_SETTING, '');
    this.deps.log('Test session ended', { by: actor.username });
    await this.sync(true);
    return { success: true as const };
  }

  private async all(): Promise<Registration[]> {
    return (await Promise.all(STATUSES.map((status) => this.deps.store.listRegistrations(status)))).flat();
  }

  private view(registration: Registration): TestRecordView {
    const { participant } = registration.record;
    return {
      registrationId: registration.registrationId,
      name: participant.name,
      phone: participant.phone ?? '',
      college: participant.college,
      source: sourceOf(registration),
      status: registration.status,
      submittedAt: registration.submittedAt,
      createdBy: registration.createdBy ?? null,
      session: registration.test?.session ?? '',
    };
  }

  async state(): Promise<TestingState> {
    await this.sync(true);
    const all = await this.all();
    const [help, results] = await Promise.all([
      this.deps.store.listHelpRequests(),
      Promise.all(eventCatalog.map(async (event) => ((await this.deps.store.getEventResult(event.id)) ? event.id : null))),
    ]);
    return {
      success: true,
      timeline: this.timeline(),
      session: this.session,
      records: all
        .filter((registration) => registration.test)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((registration) => this.view(registration)),
      helpRequests: help.filter((request) => request.test).length,
      results: results.filter((id): id is string => id !== null),
      realOnsite: all.filter((registration) => sourceOf(registration) === 'ONSITE' && !registration.test).length,
    };
  }

  /** Marks a record as test data (made before the session started), or ('keep') takes the mark off: a real student. */
  async setMark(actor: Actor, registrationId: string, test: boolean) {
    const registration = await this.deps.store.getRegistration(registrationId);
    if (!registration) throw new ApiError(404, 'NOT_FOUND', `No registration ${registrationId}.`);
    const updated = await this.deps.store.updateRegistration(registrationId, { test: test ? { session: '', at: this.iso() } : null }, { bump: false });
    if (!updated) throw new ApiError(409, 'BUSY', 'This registration was changed at the same moment. Please try again.');
    this.deps.log(test ? 'Marked as test data' : 'Test mark removed', { registrationId, by: actor.username });
    return { success: true as const, registrationId, test };
  }

  /**
   * Deletes the TEST records: each batch is saved to a backup file first (nothing is deleted
   * without one), then each record, its claims (so the phone and email can be used again), its
   * files (S3, and Drive to the trash) go, and its Sheet row is marked. When none are left:
   * optionally event results, test help requests, and desk IDs back to 262001.
   */
  async clear(actor: Actor, body: unknown): Promise<ClearResult> {
    if (!isObject(body) || body.confirm !== CLEAR_PHRASE) throw new ApiError(400, 'INVALID', `Type ${CLEAR_PHRASE} to delete the test data.`);
    const deadline = this.deps.now() + CLEAR_BUDGET_MS;
    const tests = (await this.all()).filter((registration) => registration.test);
    const batch = tests.slice(0, CLEAR_BATCH);
    let backup: string | null = null;
    if (batch.length) {
      backup = `backups/test-data-${istLocal(this.deps.now()).replace(/[:T]/g, '-')}-${Math.random().toString(36).slice(2, 7)}.json`;
      const content = JSON.stringify({ deletedAt: this.iso(), deletedBy: actor.username, registrations: batch }, null, 1);
      await this.deps.files.put(backup, encoder.encode(content), 'application/json');
    }
    let cleared = 0;
    let sheetReady = false;
    for (const registration of batch) {
      if (this.deps.now() > deadline) break;
      if (!(await this.deleteOne(registration))) continue;
      cleared += 1;
      if (registration.sheetRow) {
        try {
          if (!sheetReady) await this.deps.sheets.ready();
          sheetReady = true;
          await this.deps.sheets.update(registration.registrationId, { ...this.deps.sheetRow(registration), status: 'TEST CLEARED', notes: `Test data, deleted by ${actor.username}` });
        } catch (error) {
          this.deps.log('Could not mark a test row in the sheet', { registrationId: registration.registrationId, error: describeError(error) });
        }
      }
    }
    const remaining = (await this.all()).filter((registration) => registration.test).length;
    let results = 0;
    let helpRequests = 0;
    let deskIdsRestarted = false;
    if (remaining === 0) {
      if (body.helpRequests === true) {
        for (const request of (await this.deps.store.listHelpRequests()).filter((item) => item.test)) {
          await this.deps.store.deleteHelpRequest(request.id);
          helpRequests += 1;
        }
      }
      if (body.results === true) {
        for (const event of eventCatalog) {
          if (await this.deps.store.getEventResult(event.id)) {
            await this.deps.store.deleteEventResult(event.id);
            results += 1;
          }
        }
      }
      if (body.restartDeskIds === true && !(await this.all()).some((registration) => sourceOf(registration) === 'ONSITE')) {
        await this.deps.store.setCounter('onsite', 0);
        deskIdsRestarted = true;
      }
    }
    if (cleared || results || helpRequests || deskIdsRestarted) {
      await this.deps.store.addAuditEntry({
        at: this.iso(),
        action: 'TEST_CLEARED',
        registrationId: '-',
        name: `${cleared} test record${cleared === 1 ? '' : 's'}`,
        by: actor.username,
        reason: [backup && `backup ${backup}`, results && `${results} event results`, helpRequests && `${helpRequests} help requests`, deskIdsRestarted && 'desk IDs restarted'].filter(Boolean).join(', ') || 'test data',
      });
    }
    this.deps.log('Test data cleared', { cleared, remaining, results, helpRequests, deskIdsRestarted, by: actor.username });
    return { success: true, cleared, remaining, backup, results, helpRequests, deskIdsRestarted };
  }

  private async deleteOne(registration: Registration): Promise<boolean> {
    const { store, files, drive } = this.deps;
    const id = registration.registrationId;
    let current: Registration | null = registration;
    let deleted = false;
    for (let attempt = 0; attempt < 2 && current && !deleted; attempt += 1) {
      deleted = await store.deleteRegistration(id, current.version);
      if (!deleted) current = await store.getRegistration(id);
    }
    if (!deleted) {
      // Gone already (another clean-up), or still changing: left for the next call.
      return current === null;
    }
    const record = current ?? registration;
    for (const [kind, key] of claimsOf(record)) await quietly(() => store.releaseClaim(kind, key, id));
    const screenshots = [record.screenshot?.key, ...(record.proofs ?? []).map((proof) => proof.key)].filter((key): key is string => Boolean(key));
    const keys = [...screenshots, ...screenshots.map(previewKey), ...(record.pdfKey ? [record.pdfKey] : [])];
    // Best effort: a file that cannot be removed now never stops the clean-up.
    await Promise.all(keys.map((key) => quietly(() => files.delete(key))));
    const driveIds = [record.paymentDriveFileId, record.passDriveFileId, record.recordFileId, ...(record.proofs ?? []).map((proof) => proof.driveFileId)].filter(
      (fileId): fileId is string => Boolean(fileId),
    );
    await Promise.all(driveIds.map((fileId) => quietly(() => drive.trash(fileId))));
    return true;
  }
}
