/**
 * The Google Sheet: one row per registration, for the organisers' records and reports.
 * (The approval workflow itself is kept in DynamoDB; each row mirrors it.)
 *
 * Columns are found by their header, so organisers may reorder them or add their own
 * (e.g. "Checked in"); missing ones are added at the end. Values are written RAW, so
 * nothing a participant types can ever run as a formula. Rows are found by their
 * Registration ID, so a row is never added twice.
 *
 * Writes are batched: while one write is on its way to Google, others wait and go
 * together in the next one, well inside Google's 60 writes a minute per account.
 */
import { GoogleApiError, type GoogleClient } from './google';

export const COLUMNS = {
  id: 'Registration ID',
  registeredAt: 'Registration Timestamp (IST)',
  name: 'Student Name',
  college: 'College Name',
  department: 'Department',
  year: 'Year',
  email: 'Email',
  phone: 'Phone',
  technicalEvents: 'Technical Events',
  nonTechnicalEvents: 'Non-Technical Events',
  eventCount: 'Events Selected',
  feePerEvent: 'Fee per Event (On-site)',
  eventFee: 'Amount Payable at Venue',
  amountPaid: 'Payment Amount (Gate Pass)',
  transactionId: 'Transaction ID',
  paymentFileId: 'Payment File ID',
  paymentFileName: 'Payment File Name',
  paymentLink: 'Payment Screenshot Link',
  status: 'Registration Status',
  reviewedAt: 'Reviewed At (IST)',
  reviewedBy: 'Reviewed By',
  passStatus: 'Pass Status',
  passFileId: 'Pass File ID',
  passFileName: 'Pass File Name',
  passLink: 'Pass PDF Link',
  emailStatus: 'Email Status',
  emailSentAt: 'Email Sent At (IST)',
  emailAttempts: 'Email Attempts',
  notes: 'Notes',
} as const;

export type ColumnKey = keyof typeof COLUMNS;
export type SheetRow = Partial<Record<ColumnKey, string | number>>;

const COLUMN_KEYS = Object.keys(COLUMNS) as ColumnKey[];

/** The row to update is not in the sheet (e.g. an organiser deleted it). */
export class RowNotFoundError extends Error {}
const MAX_ROWS_PER_APPEND = 100;
/** Organisers may move or add columns: the header is read again after this long. */
const HEADER_FRESH_MS = 5 * 60_000;

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

interface Deferred {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingAppend extends Deferred {
  row: SheetRow;
}

interface StoreOptions {
  /** Minimum gap between two writes (Google allows 60 a minute per account). */
  minWriteIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SheetsStore {
  private header: string[] = [];
  private positions = new Map<ColumnKey, number>();
  private headerReadAt = 0;
  private reading: Promise<void> | null = null;
  private readonly appends: PendingAppend[] = [];
  private readonly updates = new Map<string, { fields: SheetRow; waiters: Deferred[] }>();
  private draining: Promise<void> | null = null;
  private lastWriteAt = 0;
  private readonly minWriteIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly google: GoogleClient,
    private readonly spreadsheetId: string,
    private readonly tab: string,
    options: StoreOptions = {},
  ) {
    this.minWriteIntervalMs = options.minWriteIntervalMs ?? 1100;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private get base() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}`;
  }

  /** 'Registrations'!A1 — the tab name quoted, as Sheets requires for names with spaces. */
  private range(cells: string) {
    return `'${this.tab.replace(/'/g, "''")}'!${cells}`;
  }

  private valuesUrl(range: string, query = '') {
    return `${this.base}/values/${encodeURIComponent(range)}${query}`;
  }

  /**
   * Makes sure the tab and its header exist and learns where each column is. Reads only
   * the header row; called before writing, at most every few minutes.
   */
  async ready(): Promise<void> {
    if (this.positions.size && this.now() - this.headerReadAt < HEADER_FRESH_MS) return;
    this.reading ??= this.readHeader().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async readHeader(): Promise<void> {
    let values: string[][];
    try {
      values = await this.readValues(this.range('A1:ZZ1'));
    } catch (error) {
      // The tab does not exist yet: create it with the header frozen.
      if (!(error instanceof GoogleApiError) || error.status !== 400) throw error;
      await this.google.request(
        `${this.base}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ addSheet: { properties: { title: this.tab, gridProperties: { frozenRowCount: 1 } } } }],
          }),
        },
        { label: 'Sheets: create tab', idempotent: false },
      );
      values = [];
    }

    let header = (values[0] ?? []).map((cell) => String(cell ?? '').trim());
    const missing = COLUMN_KEYS.filter((key) => !header.includes(COLUMNS[key]));
    if (missing.length) {
      header = [...header, ...missing.map((key) => COLUMNS[key])];
      await this.google.request(
        this.valuesUrl(this.range('A1'), '?valueInputOption=RAW'),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [header] }) },
        { label: 'Sheets: write header', idempotent: true },
      );
      this.lastWriteAt = this.now();
    }
    this.header = header;
    this.positions = new Map(COLUMN_KEYS.map((key) => [key, header.indexOf(COLUMNS[key])]));
    this.headerReadAt = this.now();
  }

  /**
   * One-time setup (npm run google:setup): the Registrations tab — an empty "Sheet1" is
   * renamed rather than left behind — with its header, and formatting for the organisers:
   * a frozen, coloured header, column widths, a filter, plain-text phone and transaction
   * columns, and green/red status colours. Safe to run again.
   */
  async prepare(): Promise<{ title: string; renamed: boolean }> {
    type SheetMeta = { properties: { sheetId: number; title: string }; conditionalFormats?: unknown[] };
    const readMeta = () =>
      this.google.request<{ sheets: SheetMeta[] }>(
        `${this.base}?fields=sheets(properties(sheetId,title),conditionalFormats)`,
        { method: 'GET' },
        { label: 'Sheets: read tabs', idempotent: true },
      );
    const batch = (requests: unknown[]) =>
      this.google.request(
        `${this.base}:batchUpdate`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) },
        { label: 'Sheets: format', idempotent: true },
      );

    let renamed = false;
    let { sheets } = await readMeta();
    if (!sheets.some((sheet) => sheet.properties.title === this.tab) && sheets.length === 1) {
      const only = sheets[0].properties;
      const range = `'${only.title.replace(/'/g, "''")}'!A1:Z20`;
      if ((await this.readValues(range)).length === 0) {
        await batch([{ updateSheetProperties: { properties: { sheetId: only.sheetId, title: this.tab }, fields: 'title' } }]);
        renamed = true;
      }
    }

    this.headerReadAt = 0;
    await this.ready();
    ({ sheets } = await readMeta());
    const sheet = sheets.find((item) => item.properties.title === this.tab)!;
    const sheetId = sheet.properties.sheetId;
    const at = (key: ColumnKey) => this.positions.get(key)!;
    const columns = (key: ColumnKey) => ({ sheetId, startColumnIndex: at(key), endColumnIndex: at(key) + 1 });
    const rgb = (hex: string) => ({
      red: parseInt(hex.slice(1, 3), 16) / 255,
      green: parseInt(hex.slice(3, 5), 16) / 255,
      blue: parseInt(hex.slice(5, 7), 16) / 255,
    });

    const widths: Partial<Record<ColumnKey, number>> = {
      id: 110, registeredAt: 165, name: 180, college: 280, department: 280, year: 85, email: 240, phone: 115,
      technicalEvents: 230, nonTechnicalEvents: 230, eventCount: 90, feePerEvent: 105, eventFee: 120, amountPaid: 120,
      transactionId: 160, paymentFileId: 150, paymentFileName: 190, paymentLink: 260, status: 125, reviewedAt: 165,
      reviewedBy: 110, passStatus: 100, passFileId: 150, passFileName: 215, passLink: 260, emailStatus: 100,
      emailSentAt: 165, emailAttempts: 90, notes: 360,
    };
    const statusColours: [ColumnKey, string, string][] = [
      ['status', 'APPROVED', '#d9f2e3'],
      ['status', 'REJECTED', '#fbd9d9'],
      ['status', 'PENDING', '#fff1cc'],
      ['passStatus', 'GENERATED', '#d9f2e3'],
      ['passStatus', 'FAILED', '#fbd9d9'],
      ['emailStatus', 'SENT', '#d9f2e3'],
      ['emailStatus', 'FAILED', '#fbd9d9'],
      ['emailStatus', 'UNKNOWN', '#fff1cc'],
    ];

    await batch([
      // Old status colours first, so running setup again does not stack them.
      ...(sheet.conditionalFormats ?? []).map(() => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 }, tabColorStyle: { rgbColor: rgb('#5a3dd6') } },
          fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount,tabColorStyle',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColorStyle: { rgbColor: rgb('#2a2170') },
              textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb('#ffffff') } },
              wrapStrategy: 'WRAP',
              verticalAlignment: 'MIDDLE',
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(backgroundColorStyle,textFormat,wrapStrategy,verticalAlignment,horizontalAlignment)',
        },
      },
      { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
      ...(Object.entries(widths) as [ColumnKey, number][]).map(([key, pixelSize]) => ({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: at(key), endIndex: at(key) + 1 },
          properties: { pixelSize },
          fields: 'pixelSize',
        },
      })),
      // Phone numbers and transaction IDs stay exactly as typed (no 9.34E+09, no lost zeros).
      ...(['phone', 'transactionId'] as ColumnKey[]).map((key) => ({
        repeatCell: {
          range: { ...columns(key), startRowIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
      // The Registration ID stands out.
      {
        repeatCell: {
          range: { ...columns('id'), startRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb('#3b27a8') } } } },
          fields: 'userEnteredFormat.textFormat',
        },
      },
      // A filter on the header: organisers can sort and filter without moving rows around.
      { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: this.header.length } } } },
      ...statusColours.map(([key, value, colour]) => ({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [{ ...columns(key), startRowIndex: 1 }],
            booleanRule: {
              condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
              format: { backgroundColorStyle: { rgbColor: rgb(colour) } },
            },
          },
        },
      })),
    ]);
    return { title: this.tab, renamed };
  }

  private async readValues(range: string): Promise<string[][]> {
    const body = await this.google.request<{ values?: string[][] }>(
      this.valuesUrl(range, '?valueRenderOption=FORMATTED_VALUE'),
      { method: 'GET' },
      { label: 'Sheets: read', idempotent: true },
    );
    return body.values ?? [];
  }

  private toCells(row: SheetRow): (string | number)[] {
    const cells: (string | number)[] = this.header.map(() => '');
    for (const [key, value] of Object.entries(row) as [ColumnKey, string | number][]) {
      const index = this.positions.get(key);
      if (index !== undefined && index >= 0) cells[index] = value;
    }
    return cells;
  }

  /** Resolves once Google confirms the row is in the sheet. */
  append(row: SheetRow): Promise<void> {
    if (!this.positions.size) return Promise.reject(new Error('Sheets store used before ready()'));
    return new Promise((resolve, reject) => {
      this.appends.push({ row, resolve, reject });
      this.drain();
    });
  }

  /** Updates cells of an existing row, found by its Registration ID (rows may have been sorted). */
  update(registrationId: string, fields: SheetRow): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = this.updates.get(registrationId) ?? { fields: {}, waiters: [] };
      pending.fields = { ...pending.fields, ...fields };
      pending.waiters.push({ resolve, reject });
      this.updates.set(registrationId, pending);
      this.drain();
    });
  }

  /** Waits for everything queued so far to be written. */
  async flush(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private drain() {
    if (this.draining) return;
    this.draining = this.writeAll().finally(() => {
      this.draining = null;
      if (this.appends.length || this.updates.size) this.drain();
    });
  }

  private async writeAll() {
    while (this.appends.length || this.updates.size) {
      const wait = this.lastWriteAt + this.minWriteIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastWriteAt = this.now();
      // New registrations go first: someone is waiting on the page for them.
      if (this.appends.length) await this.writeAppends(this.appends.splice(0, MAX_ROWS_PER_APPEND));
      else await this.writeUpdates();
    }
  }

  private async writeAppends(batch: PendingAppend[]) {
    try {
      await this.appendRows(batch.map((item) => this.toCells(item.row)));
      for (const item of batch) item.resolve();
    } catch (error) {
      if (!(error instanceof GoogleApiError) || !error.ambiguous) {
        for (const item of batch) item.reject(error);
        return;
      }
      // No clear answer from Google: look for the rows before writing them again, so a
      // registration is never stored twice.
      let stored: Set<string>;
      try {
        stored = new Set(await this.readIds());
      } catch {
        // Could not look either: whether the rows are in the sheet stays unknown, which the
        // first (unclear) error says, so callers do not treat them as surely missing.
        for (const item of batch) item.reject(error);
        return;
      }
      const missing = batch.filter((item) => !stored.has(String(item.row.id)));
      for (const item of batch) if (!missing.includes(item)) item.resolve();
      if (!missing.length) return;
      try {
        await this.appendRows(missing.map((item) => this.toCells(item.row)));
        for (const item of missing) item.resolve();
      } catch (retryError) {
        for (const item of missing) item.reject(retryError);
      }
    }
  }

  private async appendRows(rows: (string | number)[][]) {
    const result = await this.google.request<{ updates?: { updatedRows?: number } }>(
      this.valuesUrl(this.range('A1'), ':append?valueInputOption=RAW'),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: rows }) },
      { label: 'Sheets: add registrations', idempotent: false },
    );
    // Google's answer is the confirmation: it reports how many rows it stored.
    const stored = result.updates?.updatedRows ?? 0;
    if (stored !== rows.length) {
      throw new GoogleApiError(`Sheets: stored ${stored} of ${rows.length} rows`, 500, 'partial', true, true);
    }
  }

  /** Every Registration ID in the sheet, in row order. */
  async ids(): Promise<string[]> {
    await this.ready();
    return this.readIds();
  }

  private async readIds(): Promise<string[]> {
    const column = columnLetter(this.positions.get('id')!);
    const values = await this.readValues(this.range(`${column}2:${column}`));
    return values.map((cells) => String(cells[0] ?? '').trim());
  }

  private async writeUpdates() {
    const pending = new Map(this.updates);
    this.updates.clear();
    try {
      const ids = await this.readIds();
      const data: { range: string; values: (string | number)[][] }[] = [];
      const notFound: string[] = [];
      for (const [registrationId, { fields }] of pending) {
        const index = ids.indexOf(registrationId);
        if (index < 0) {
          notFound.push(registrationId);
          continue;
        }
        const rowNumber = index + 2;
        for (const [key, value] of Object.entries(fields) as [ColumnKey, string | number][]) {
          const column = this.positions.get(key);
          if (column === undefined || column < 0) continue;
          data.push({ range: this.range(`${columnLetter(column)}${rowNumber}`), values: [[value]] });
        }
      }
      if (data.length) {
        await this.google.request(
          `${this.base}/values:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ valueInputOption: 'RAW', data }),
          },
          { label: 'Sheets: update rows', idempotent: true },
        );
      }
      for (const [registrationId, { waiters }] of pending) {
        const error = notFound.includes(registrationId) ? new RowNotFoundError(`Row ${registrationId} not found in the sheet`) : null;
        for (const waiter of waiters) {
          if (error) waiter.reject(error);
          else waiter.resolve();
        }
      }
    } catch (error) {
      for (const { waiters } of pending.values()) for (const waiter of waiters) waiter.reject(error);
    }
  }
}
