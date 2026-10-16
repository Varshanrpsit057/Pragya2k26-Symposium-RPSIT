/**
 * The fest's backup in the Google Sheet, every 10 minutes (the schedule): every department's
 * registrations and the event results, each in its own tab ("Fest registrations", "Fest
 * results"). The private bucket keeps the full JSON copy as well (FestService.backup).
 *
 * Few requests to Google:
 *   - none at all when nothing changed since the last copy (a fingerprint of the rows is kept);
 *   - otherwise one request writes both tabs (values:batchUpdate), blanking any rows left over
 *     from a longer earlier copy (e.g. after test data was deleted);
 *   - once, when a tab is missing: one read of the tab names and one request to add them.
 *
 * Values are written RAW, so nothing a student types can ever run as a formula. The tabs are
 * rewritten whole each time: they are a copy to read and download, not to edit. The phone's
 * private key (sid) is never written.
 */
import { createHash } from 'node:crypto';
import { formatIst } from '../src/lib/countdown';
import { deptShort, eventLabel, eventOf, feePaid, placeTeam, showId, teamsText, type FestCatalog, type FestRegistration, type FestResult, type FestSource } from '../src/lib/fest';
import { GoogleApiError, type GoogleClient } from './google';
import type { Store } from './store';

export const FEST_TABS = { registrations: 'Fest registrations', results: 'Fest results' } as const;
/** The last copy's fingerprint and row counts (kept with the other settings). */
const STATE_SETTING = 'festSheetBackup';

/** Every department's data at one moment (FestService.snapshot). */
export interface FestSnapshot {
  at: string;
  catalog: FestCatalog;
  registrations: FestRegistration[];
  results: FestResult[];
}

interface BackupState {
  hash: string;
  /** Rows written, the header included, so a shorter copy blanks the rest. */
  rows: { registrations: number; results: number };
  at: string;
}

type Cell = string | number;

export const REGISTRATION_HEADER = [
  'Registration ID',
  'Department',
  'Registered via',
  'Registered at (IST)',
  'Recorded by',
  'Name',
  'Mobile',
  'Email',
  'College',
  'College code',
  'Department / course',
  'Year',
  'Team',
  'Entry fee',
  'Paid by',
  'Amount',
  'Transaction ID',
  'Transaction ID typed by student',
  'Fee taken by',
  'Fee taken at (IST)',
  'Desk',
  'Checked in at (IST)',
  'Events',
  'Event fees paid (cash / UPI, UTR typed at the event)',
  'Present at',
  'Status',
  'Test data',
  'Last changed (IST)',
];

export const RESULT_HEADER = ['Event', 'Department', 'Place', 'Registration IDs', 'Names', 'Team', 'Status', 'Submitted by', 'Submitted at (IST)'];

const SOURCE_LABEL: Record<FestSource, string> = { DESK: 'Desk', SELF: 'Student (phone)', ONLINE: 'Online form', PAPER: 'Paper slip' };
const METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', ONLINE: 'Online' } as const;
const PLACE_LABEL: Record<number, string> = { 1: 'First', 2: 'Second', 3: 'Third' };

const ist = (iso: string | null | undefined) => (iso ? formatIst(Date.parse(iso)) : '');

/** One row per registration, by department and ID. */
export function registrationRows(catalog: FestCatalog, registrations: readonly FestRegistration[]): Cell[][] {
  const eventName = (eventId: string) => {
    const event = eventOf(catalog, eventId);
    return event ? `${deptShort(event.dept)} · ${eventLabel(event)}` : eventId;
  };
  const names = (ids: string[]) => ids.map(eventName).join('; ');
  return [...registrations]
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.id.localeCompare(b.id))
    .map((item) => {
      const { entry } = item;
      const payment = entry.payment && !entry.payment.voided ? entry.payment : undefined;
      const fee = entry.status === 'PAID' ? 'Paid' : entry.rejected ? `Due · payment not found: ${entry.rejected.reason}` : 'Due';
      const status = item.deleted ? `Deleted: ${item.deleted.reason}` : item.cancelled ? `Cancelled: ${item.cancelled.reason}` : 'Active';
      return [
        showId(item.id),
        deptShort(item.dept),
        SOURCE_LABEL[item.source] ?? item.source,
        ist(item.created.at),
        item.created.by,
        item.name,
        item.phone,
        item.email,
        item.college,
        item.collegeCode ?? '',
        item.branch,
        item.year,
        teamsText(item, (eventId) => eventOf(catalog, eventId)?.name ?? eventId),
        fee,
        payment ? METHOD_LABEL[payment.method] : '',
        payment?.amount ?? '',
        payment?.txn ?? '',
        entry.claim?.txn ?? '',
        payment?.by ?? '',
        ist(payment?.at),
        payment?.desk ?? item.checkedIn?.desk ?? item.desk ?? '',
        ist(item.checkedIn?.at),
        names(item.events.map((event) => event.eventId)),
        item.events
          .filter((event) => feePaid(event))
          .map((event) => `${eventName(event.eventId)} (${METHOD_LABEL[event.fee!.method]} ₹${event.fee!.amount}${event.fee!.txn ? ` · UTR ${event.fee!.txn}` : ''})`)
          .join('; '),
        names(item.events.filter((event) => event.present).map((event) => event.eventId)),
        status,
        item.test ? 'Yes' : '',
        ist(item.u),
      ];
    });
}

/** One row per place of each event's results (the names looked up from the registrations). */
export function resultRows(catalog: FestCatalog, results: readonly FestResult[], registrations: readonly FestRegistration[]): Cell[][] {
  const byId = new Map(registrations.map((item) => [item.id, item]));
  const rows: Cell[][] = [];
  const sorted = [...results].sort((a, b) => a.dept.localeCompare(b.dept) || a.eventId.localeCompare(b.eventId));
  for (const result of sorted) {
    const event = eventOf(catalog, result.eventId);
    const status = result.submitted ? 'Submitted' : 'Not submitted yet';
    for (const place of [...result.places].sort((a, b) => a.place - b.place)) {
      rows.push([
        event ? eventLabel(event) : result.eventId,
        deptShort(result.dept),
        PLACE_LABEL[place.place] ?? `Place ${place.place}`,
        place.ids.map(showId).join(', '),
        place.ids.map((id) => byId.get(id)?.name ?? '').join(', '),
        placeTeam(place),
        status,
        result.submitted?.by ?? '',
        ist(result.submitted?.at),
      ]);
    }
  }
  return rows;
}

export class FestSheetBackup {
  constructor(
    private readonly google: GoogleClient,
    private readonly spreadsheetId: string,
    private readonly settings: Pick<Store, 'getSetting' | 'putSetting'>,
  ) {}

  private get base() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}`;
  }

  /** Writes the snapshot to the two tabs, unless it is the same as the last copy. */
  async save(snapshot: FestSnapshot): Promise<{ written: boolean; registrations: number; results: number }> {
    const registrations = [REGISTRATION_HEADER, ...registrationRows(snapshot.catalog, snapshot.registrations)];
    const results = [RESULT_HEADER, ...resultRows(snapshot.catalog, snapshot.results, snapshot.registrations)];
    const hash = createHash('sha256').update(JSON.stringify([registrations, results])).digest('hex');
    const last = await this.state();
    const counts = { registrations: registrations.length - 1, results: results.length - 1 };
    if (last?.hash === hash) return { written: false, ...counts };

    const data = [
      { range: this.range(FEST_TABS.registrations), values: padded(registrations, last?.rows.registrations ?? 0) },
      { range: this.range(FEST_TABS.results), values: padded(results, last?.rows.results ?? 0) },
    ];
    try {
      await this.write(data);
    } catch (error) {
      // A tab that is not there yet ("Unable to parse range"): add the missing tabs once, then write.
      if (!(error instanceof GoogleApiError) || error.status !== 400) throw error;
      await this.addMissingTabs();
      await this.write(data);
    }
    const state: BackupState = { hash, rows: { registrations: registrations.length, results: results.length }, at: snapshot.at };
    await this.settings.putSetting(STATE_SETTING, JSON.stringify(state));
    return { written: true, ...counts };
  }

  private async state(): Promise<BackupState | null> {
    try {
      const raw = await this.settings.getSetting(STATE_SETTING);
      return raw ? (JSON.parse(raw) as BackupState) : null;
    } catch {
      return null;
    }
  }

  /** 'Fest registrations'!A1 — the tab name quoted, as Sheets requires for names with spaces. */
  private range(tab: string) {
    return `'${tab.replace(/'/g, "''")}'!A1`;
  }

  private write(data: { range: string; values: Cell[][] }[]) {
    return this.google.request(
      `${this.base}/values:batchUpdate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data }) },
      // Fixed ranges, so a repeat is harmless; few attempts and a short wait, as the next run is 10 minutes away.
      { label: 'Sheets: fest backup', idempotent: true, parse: 'none', timeoutMs: 10_000, attempts: 2 },
    );
  }

  private async addMissingTabs() {
    const { sheets = [] } = await this.google.request<{ sheets?: { properties: { title: string } }[] }>(
      `${this.base}?fields=sheets.properties.title`,
      { method: 'GET' },
      { label: 'Sheets: read tabs', idempotent: true, timeoutMs: 10_000, attempts: 2 },
    );
    const titles = new Set(sheets.map((sheet) => sheet.properties.title));
    const missing = Object.values(FEST_TABS).filter((tab) => !titles.has(tab));
    if (!missing.length) return;
    await this.google.request(
      `${this.base}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }),
      },
      { label: 'Sheets: add fest tabs', idempotent: false, parse: 'none', timeoutMs: 10_000, attempts: 2 },
    );
  }
}

/** The rows, then blank rows down to where the last copy ended (RAW '' empties a cell). */
function padded(rows: Cell[][], lastCount: number): Cell[][] {
  if (lastCount <= rows.length) return rows;
  const width = rows[0]?.length ?? 1;
  return [...rows, ...Array.from({ length: lastCount - rows.length }, () => Array<Cell>(width).fill(''))];
}
