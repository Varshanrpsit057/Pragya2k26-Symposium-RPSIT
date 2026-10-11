import { describe, expect, it } from 'vitest';
import { reportSheets, resultsSheets, reportWorkbook, fileStamp } from '../admin/workbooks';
import type { AdminRegistration, ReportSummary } from './admin';
import { buildXlsx, columnName, crc32 } from './xlsx';

/** Reads a stored zip back: name → text, checking every CRC. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const localName = view.getUint16(offset + 26, true);
    const data = bytes.subarray(offset + 30 + localName, offset + 30 + localName + size);
    expect(crc32(data), name).toBe(crc);
    files.set(name, decoder.decode(data));
    at += 46 + nameLength;
  }
  return files;
}

const wellFormed = (text: string) => new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('parsererror').length === 0;

describe('Excel writer', () => {
  it('writes a real .xlsx: the parts Excel needs, well-formed, with text kept as text', () => {
    const bytes = buildXlsx([
      { name: 'Summary', rows: [[{ value: 'Title & more', style: 'title' }], ['Cash', 100, true], ['=SUM(A1)', null, '<script>']], widths: [20, 10], merges: ['A1:C1'] },
      { name: 'A/B:C*D?', rows: [['ID'], ['262001']], freezeRows: 1, filter: { headerRow: 1, columns: 1, lastRow: 2 } },
    ]);
    const files = unzip(bytes);
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    for (const [name, text] of files) expect(wellFormed(text), name).toBe(true);
    const sheet1 = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet1).toContain('<c r="B2"><v>100</v></c>');
    expect(sheet1).toContain('<t xml:space="preserve">Yes</t>');
    // A leading "=" stays text: never a formula.
    expect(sheet1).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t></is></c>');
    expect(sheet1).not.toContain('<f>');
    expect(sheet1).toContain('&lt;script&gt;');
    expect(sheet1).toContain('<mergeCell ref="A1:C1"/>');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="A-B-C-D-" sheetId="2" r:id="rId2"/>');
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(files.get('xl/worksheets/sheet2.xml')).toContain('<autoFilter ref="A1:A2"/>');
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(701)).toBe('ZZ');
  });
});

const fee = (status: 'PAID' | 'UNPAID', method: 'CASH' | 'UPI' | null = null) => ({ status, method, amount: 50, reference: null, verifiedBy: status === 'PAID' ? 'vizcraft-lead' : null, verifiedAt: null, voided: null });

const registration = (id: string, name: string, source: 'ONLINE' | 'ONSITE', method: 'ONLINE_UPI' | 'CASH' | 'UPI', paid: boolean): AdminRegistration =>
  ({
    registrationId: id,
    source,
    status: 'APPROVED',
    submittedAt: '2026-10-17T04:00:00.000Z',
    participant: { name, department: 'CSE', college: 'Sona College of Technology, Salem', year: '2nd Year', phone: '9840000001', email: `${id}@example.com` },
    teamName: null,
    technicalEvents: ['VIZ CRAFT'],
    gatePass: { status: 'VERIFIED', method, amount: 100, reference: null, verifiedBy: 'desk1', verifiedAt: null },
    events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', addedBy: null, addedAt: null, team: null, fee: fee(paid ? 'PAID' : 'UNPAID', paid ? 'CASH' : null), attendance: paid ? { present: true, markedBy: 'x', markedAt: 'y' } : null }],
  }) as unknown as AdminRegistration;

const report: ReportSummary = {
  generatedAt: '2026-10-17T10:00:00.000Z',
  registrations: { total: 2, online: 1, onsite: 1, pending: 0, approved: 2, rejected: 0, cancelled: 0 },
  gatePass: { onlineVerified: { count: 1, amount: 100 }, deskCash: { count: 1, amount: 100 }, deskUpi: { count: 0, amount: 0 } },
  events: [{ eventId: 'viz-craft', name: 'VIZ CRAFT', enrolled: 2, feesPaid: 1, cash: 1, upi: 0, cashAmount: 50, upiAmount: 0, amount: 50, present: 1, resultStatus: 'DRAFT' }],
  collectedBy: [{ username: 'desk1', cash: 100, upi: 0, count: 1 }, { username: 'vizcraft-lead', cash: 50, upi: 0, count: 1 }],
  desks: [{ desk: 1, registrations: 1, cashCount: 1, cash: 100, upiCount: 0, upi: 0 }],
};

describe('the Excel report', () => {
  const now = Date.parse('2026-10-17T15:30:00+05:30');
  const sheets = reportSheets({ report, registrations: [registration('262001', 'Nila R', 'ONSITE', 'CASH', true), registration('261001', 'Varshan C', 'ONLINE', 'ONLINE_UPI', false)], generatedBy: 'Owner', now });

  it('starts with a summary: when it was made, by whom, and cash and GPay totals', () => {
    const [summary] = sheets;
    expect(summary.name).toBe('Summary');
    const text = (row: number) => summary.rows[row].map((cell) => (cell && typeof cell === 'object' ? cell.value : cell));
    expect(text(1)[0]).toBe('Generated 17 October 2026 · 3:30 PM IST by Owner. Figures as recorded in the dashboard at that moment.');
    const rowOf = (label: string) => summary.rows.map((_, index) => text(index)).find((row) => row[0] === label);
    expect(rowOf('Gate pass: GPay online (verified screenshots)')).toEqual(['Gate pass: GPay online (verified screenshots)', 1, 100]);
    expect(rowOf('Total in cash')).toEqual(['Total in cash', 2, 150]);
    expect(rowOf('Total by GPay / UPI')).toEqual(['Total by GPay / UPI', 1, 100]);
    expect(rowOf('Grand total')).toEqual(['Grand total', 3, 250]);
    expect(rowOf('vizcraft-lead')).toEqual(['vizcraft-lead', 1, 50, 0, 50]);
  });

  it('lists the registered students with only the columns that matter, in ID order', () => {
    const students = sheets[1];
    const rows = students.rows.slice(3).map((row) => row.map((cell) => (cell && typeof cell === 'object' ? cell.value : cell)));
    expect(rows.map((row) => row[0])).toEqual(['261001', '262001']);
    expect(rows[1]).toEqual([
      '262001',
      'Nila R',
      'Sona College of Technology, Salem',
      'CSE',
      '2nd Year',
      '9840000001',
      'At the desk',
      'Desk',
      'Approved',
      '',
      'VIZ CRAFT',
      'Cash at desk',
      'VIZ CRAFT (cash)',
      '17 October 2026 · 9:30 AM IST',
    ]);
    // No email or internal columns in the student list.
    expect(students.rows[2].map((cell) => (cell && typeof cell === 'object' ? cell.value : cell))).not.toContain('Email');
    expect(students.freezeRows).toBe(3);
  });

  it('is named with the time it was made, and opens as a workbook of three sheets', () => {
    expect(fileStamp(now)).toBe('17-Oct-2026-0330PM');
    const file = reportWorkbook({ report, registrations: [], generatedBy: 'Owner', now });
    expect(file.name).toBe('PRAGYA-2026-Report-17-Oct-2026-0330PM.xlsx');
    expect(unzip(file.bytes).get('xl/workbook.xml')).toMatch(/Summary.*Registered students.*Event participants/);
  });

  it('builds the results workbook, marking lists that are not final', () => {
    const results = resultsSheets(
      [{ name: 'VIZ CRAFT', participants: [{ registrationId: '262001', name: 'Nila R', college: 'Sona', department: 'CSE', year: '2nd Year', feePaid: true, present: true }], winners: { first: [{ registrationId: '262001', name: 'Nila R', college: 'Sona' }], second: [], third: [] }, submittedAt: null, submittedBy: null }],
      'cert-team',
      now,
    );
    expect(results.map((sheet) => sheet.name)).toEqual(['Summary', 'Participants', 'Certificates (present)', 'Winners']);
    const note = results[0].rows[1][0];
    expect(note && typeof note === 'object' ? note.value : note).toMatch(/NOT FINAL/);
    expect(results[3].rows[3]).toEqual(['VIZ CRAFT', 'First place', '262001', 'Nila R', 'Sona', '']);
  });
});
