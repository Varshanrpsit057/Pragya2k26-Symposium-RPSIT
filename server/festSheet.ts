/**
 * The fest's backup in the Google Sheet, every 10 minutes (the schedule): every department's
 * registrations (with a group of columns for each event: fee, the UTR its coordinator typed,
 * present or absent), every student's events one row each, and the event results, each in its
 * own tab ("Fest registrations", "Fest event participation", "Fest results"). The private bucket
 * keeps the full JSON copy as well (FestService.backup).
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
import {
  deptShort,
  entryOf,
  eventColumnCells,
  eventColumnHeads,
  eventLabel,
  eventOf,
  feePaid,
  methodLabel,
  placeTeam,
  regNoOf,
  showId,
  teamsText,
  type FestCatalog,
  type FestRegistration,
  type FestResult,
  type FestSource,
} from '../src/lib/fest';
import { GoogleApiError, type GoogleClient } from './google';
import type { Store } from './store';

export const FEST_TABS = { registrations: 'Fest registrations', results: 'Fest results', participation: 'Fest event participation' } as const;
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
  rows: { registrations: number; results: number; participation?: number };
  /** Columns of the registrations tab (one group per event), so a narrower copy blanks the rest. */
  cols?: number;
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
  'Register number',
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
  'Online UTR verified by',
  'Desk',
  'Checked in at (IST)',
  'Events',
  'Status',
  'Test data',
  'Last changed (IST)',
];
/** Where each event's columns go in the registrations tab: after 'Events'. */
const EVENTS_AT = REGISTRATION_HEADER.indexOf('Events') + 1;

/** The registrations tab's header: the columns above, with every event's group after 'Events'. */
export const registrationHeader = (catalog: FestCatalog) => [
  ...REGISTRATION_HEADER.slice(0, EVENTS_AT),
  ...catalog.events.flatMap((event) => eventColumnHeads(event, true)),
  ...REGISTRATION_HEADER.slice(EVENTS_AT),
];

export const PARTICIPATION_HEADER = [
  'Department',
  'Event',
  'Registration ID',
  'Name',
  'Mobile',
  'College',
  'College code',
  'Fee',
  'Paid by (cash / UPI)',
  'Amount',
  'UTR (typed at the event)',
  'Fee taken by',
  'Fee taken at (IST)',
  'Present / absent',
  'Marked present by',
  'Marked present at (IST)',
  'Team',
  'Status',
  'Test data',
];

/**
 * Every student in every event they joined, one row each (by event, then ID): the fee as the
 * event's coordinator recorded it (cash or UPI, the UTR typed at the venue, by whom, when),
 * present or absent, the team.
 */
export function participationRows(catalog: FestCatalog, registrations: readonly FestRegistration[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const event of catalog.events) {
    for (const item of registrations.filter((registration) => entryOf(registration, event.id)).sort((a, b) => a.id.localeCompare(b.id))) {
      const entry = entryOf(item, event.id)!;
      const fee = feePaid(entry) ? entry.fee! : null;
      rows.push([
        deptShort(event.dept),
        eventLabel(event),
        showId(item.id),
        item.name,
        item.phone,
        item.college,
        item.collegeCode ?? '',
        fee ? 'Paid' : entry.fee?.voided ? `Cancelled: ${entry.fee.voided.reason}` : event.fee ? 'Due' : 'No fee',
        fee ? methodLabel(fee.method) : '',
        fee ? fee.amount : '',
        fee?.txn ?? '',
        fee?.by ?? '',
        ist(fee?.at),
        entry.present ? 'Present' : 'Absent',
        entry.present?.by ?? '',
        ist(entry.present?.at),
        entry.team ?? '',
        item.deleted ? 'Deleted' : item.cancelled ? 'Cancelled' : 'Active',
        item.test ? 'Yes' : '',
      ]);
    }
  }
  return rows;
}

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
        regNoOf(item),
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
        payment?.method === 'ONLINE' ? (payment.checked ? `${payment.checked.by}${payment.checked.desk ? ` (desk ${payment.checked.desk})` : ''} · ${ist(payment.checked.at)}` : 'Not verified yet') : '',
        payment?.desk ?? item.checkedIn?.desk ?? item.desk ?? '',
        ist(item.checkedIn?.at),
        names(item.events.map((event) => event.eventId)),
        ...catalog.events.flatMap((event) => eventColumnCells(item, event)),
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

  /** Writes the snapshot to the three tabs, unless it is the same as the last copy. */
  async save(snapshot: FestSnapshot): Promise<{ written: boolean; registrations: number; results: number }> {
    const registrations = [registrationHeader(snapshot.catalog), ...registrationRows(snapshot.catalog, snapshot.registrations)];
    const participation = [PARTICIPATION_HEADER, ...participationRows(snapshot.catalog, snapshot.registrations)];
    const results = [RESULT_HEADER, ...resultRows(snapshot.catalog, snapshot.results, snapshot.registrations)];
    const hash = createHash('sha256').update(JSON.stringify([registrations, participation, results])).digest('hex');
    const last = await this.state();
    const counts = { registrations: registrations.length - 1, results: results.length - 1 };
    if (last?.hash === hash) return { written: false, ...counts };

    const data = [
      { range: this.range(FEST_TABS.registrations), values: padded(registrations, last?.rows.registrations ?? 0, last?.cols ?? 0) },
      { range: this.range(FEST_TABS.participation), values: padded(participation, last?.rows.participation ?? 0) },
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
    const state: BackupState = {
      hash,
      rows: { registrations: registrations.length, results: results.length, participation: participation.length },
      cols: registrations[0]?.length ?? 0,
      at: snapshot.at,
    };
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

/**
 * The rows, then blank rows down to where the last copy ended, and blank cells out to where its
 * columns ended (RAW '' empties a cell), so nothing of an older, longer or wider copy is left.
 */
function padded(rows: Cell[][], lastCount: number, lastCols = 0): Cell[][] {
  const width = Math.max(rows[0]?.length ?? 1, lastCols);
  const wide = width > (rows[0]?.length ?? 1) ? rows.map((row) => [...row, ...Array<Cell>(width - row.length).fill('')]) : rows;
  if (lastCount <= wide.length) return wide;
  return [...wide, ...Array.from({ length: lastCount - wide.length }, () => Array<Cell>(width).fill(''))];
}
