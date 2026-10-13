/**
 * The dashboard's downloads as Excel files (src/lib/xlsx.ts): one table per file, with a title,
 * a line saying what it shows (the filters, who downloaded it and when), a bold header row kept in
 * view, and Excel's filters on every column.
 */
import { formatIst } from '../../lib/countdown';
import { deptShort } from '../../lib/fest';
import { buildXlsx, XLSX_TYPE, type Cell, type Sheet } from '../../lib/xlsx';
import { saveFile } from '../ui';
import type { FestFilters } from './FestData';

export const PORTAL = 'INFINITE TECHFEST’26 · On-site Registration Portal';

/** Saves the rows (the first one is the header) as an .xlsx file. */
export function saveTable(fileName: string, heading: string, note: string, rows: readonly (readonly (string | number)[])[]) {
  const [columns = [], ...body] = rows;
  const sheetRows: Cell[][] = [[{ value: heading, style: 'title' }], [{ value: note, style: 'muted' }], columns.map((value) => ({ value, style: 'header' as const })), ...body.map((row) => [...row])];
  const widths = columns.map((column, index) => Math.min(48, Math.max(String(column).length + 2, ...body.slice(0, 400).map((row) => String(row[index] ?? '').length + 2))));
  const sheet: Sheet = { name: heading, rows: sheetRows, widths, freezeRows: 3, filter: { headerRow: 3, columns: columns.length, lastRow: sheetRows.length } };
  saveFile(fileName, buildXlsx([sheet]), XLSX_TYPE);
}

const LABELS: Partial<Record<keyof FestFilters, string>> = { eventId: 'event', venue: 'venue', source: 'registered', desk: 'desk', entry: 'entry fee', status: 'status', college: 'college', q: 'search' };

/** 'CSE · event cse-hackathon · status active · downloaded by hod 17 Oct, 10:30 AM' */
export function filterNote(filters: FestFilters, by: string) {
  const parts = [filters.dept ? deptShort(filters.dept) : 'All departments'];
  for (const [key, label] of Object.entries(LABELS) as [keyof FestFilters, string][]) {
    const value = filters[key];
    if (value && !(key === 'status' && value === 'active')) parts.push(`${label}: ${value}`);
  }
  parts.push(`downloaded by ${by} ${formatIst(Date.now())}`);
  return `${PORTAL} · ${parts.join(' · ')}`;
}

/** '2026-10-17' for file names. */
export const today = () => new Date().toISOString().slice(0, 10);
