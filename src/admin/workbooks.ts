/**
 * The Excel downloads (src/lib/xlsx.ts): the report, with when it was made and by whom, the
 * money collected by cash and GPay/UPI, and the registered students with only the columns that
 * matter; and the results, with the participant, certificate and winner lists of every event.
 */
import { site } from '../content/site';
import { PLACES, PLACE_LABELS, type AdminRegistration, type EventRoster, type PaymentRecordView, type ReportSummary, type WinnerEntry, type Place } from '../lib/admin';
import { formatIst } from '../lib/countdown';
import { buildXlsx, type Cell, type Sheet } from '../lib/xlsx';

const ist = (iso: string | null | undefined) => (iso ? formatIst(Date.parse(iso)) : '');
const title = (value: string): Cell => ({ value, style: 'title' });
const subtitle = (value: string): Cell => ({ value, style: 'subtitle' });
const header = (values: string[]): Cell[] => values.map((value) => ({ value, style: 'header' }));
const money = (value: number): Cell => ({ value, style: 'money' });
const total = (value: number): Cell => ({ value, style: 'moneyTotal' });
const bold = (value: string | number): Cell => ({ value, style: 'bold' });
const muted = (value: string): Cell => ({ value, style: 'muted' });

/** 'PRAGYA-2026-Report-17-Oct-2026-0330PM.xlsx' */
export function fileStamp(now: number): string {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')}-${part('hour')}${part('minute')}${part('dayPeriod').toUpperCase()}`;
}

const GATE_PASS: Record<AdminRegistration['gatePass']['method'], string> = { ONLINE_UPI: 'GPay (online)', CASH: 'Cash at desk', UPI: 'GPay at desk' };
const deskLabel = (item: Pick<AdminRegistration, 'deskNumber' | 'source'>) => (item.deskNumber ? `Desk ${item.deskNumber}` : item.source === 'ONSITE' ? 'Desk' : 'Online');
const METHOD: Record<NonNullable<PaymentRecordView['method']>, string> = { ONLINE_UPI: 'GPay online', UPI: 'GPay / UPI', CASH: 'Cash' };
const PAYMENT_STATUS: Record<PaymentRecordView['status'], string> = { PAID: 'Paid', WAITING: 'Screenshot waiting', UNPAID: 'Not paid', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const sameId = (a: string | null, b: string | null) => (a && b ? (a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase() ? 'Yes' : 'NO: differs') : '');
/** A table sheet: a title, the note, a header row, frozen and filtered. */
const tableSheet = (name: string, heading: string, note: Cell, columns: string[], rows: Cell[][], widths: number[]): Sheet => {
  const all = [[title(heading)], [note], header(columns), ...rows];
  return { name, rows: all, widths, freezeRows: 3, filter: { headerRow: 3, columns: columns.length, lastRow: all.length } };
};
const STATUS: Record<AdminRegistration['status'], string> = { PENDING: 'Payment to verify', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

export interface ReportInput {
  report: ReportSummary;
  registrations: readonly AdminRegistration[];
  generatedBy: string;
  now: number;
}

/** The report workbook: Summary, Registered students and Event participants. */
export function reportSheets({ report, registrations, generatedBy, now }: ReportInput): Sheet[] {
  const { gatePass, events, collectedBy } = report;
  const eventCash = events.reduce((sum, event) => sum + event.cash, 0);
  const eventUpi = events.reduce((sum, event) => sum + event.upi, 0);
  const eventCashAmount = events.reduce((sum, event) => sum + event.cashAmount, 0);
  const eventUpiAmount = events.reduce((sum, event) => sum + event.upiAmount, 0);
  const cashTotal = gatePass.deskCash.amount + eventCashAmount;
  const upiTotal = gatePass.onlineVerified.amount + gatePass.deskUpi.amount + eventUpiAmount;
  const r = report.registrations;

  const summary: Cell[][] = [
    [title(`${site.name} ${site.year}: registrations and money collected`)],
    [muted(`Generated ${formatIst(now)} by ${generatedBy}. Figures as recorded in the dashboard at that moment.`)],
    [],
    [subtitle('Registrations')],
    header(['', 'Count']),
    ['Total registrations', r.total],
    ['Registered online', r.online],
    ['Registered at the desk', r.onsite],
    ['Approved (gate pass verified)', r.approved],
    ['Payment to verify', r.pending],
    ['Rejected', r.rejected],
    ['Cancelled', r.cancelled],
    [],
    [subtitle('Money collected')],
    header(['', 'Payments', 'Amount']),
    ['Gate pass: GPay online (verified screenshots)', gatePass.onlineVerified.count, money(gatePass.onlineVerified.amount)],
    ['Gate pass: cash at the desk', gatePass.deskCash.count, money(gatePass.deskCash.amount)],
    ['Gate pass: GPay at the desk', gatePass.deskUpi.count, money(gatePass.deskUpi.amount)],
    ['Event fees: cash at the venues', eventCash, money(eventCashAmount)],
    ['Event fees: GPay at the venues', eventUpi, money(eventUpiAmount)],
    [bold('Total in cash'), bold(gatePass.deskCash.count + eventCash), total(cashTotal)],
    [bold('Total by GPay / UPI'), bold(gatePass.onlineVerified.count + gatePass.deskUpi.count + eventUpi), total(upiTotal)],
    [bold('Grand total'), bold(gatePass.onlineVerified.count + gatePass.deskCash.count + gatePass.deskUpi.count + eventCash + eventUpi), total(cashTotal + upiTotal)],
    [],
    [subtitle('Collected by each student coordinator (desk gate passes and event fees)')],
    header(['Student coordinator', 'Payments', 'Cash', 'GPay / UPI', 'Total']),
    ...collectedBy.map((person) => [person.username, person.count, money(person.cash), money(person.upi), total(person.cash + person.upi)]),
    ...(collectedBy.length ? [] : [[muted('No money recorded at the desk or the venues yet.')]]),
    [],
    [subtitle('Registration desks (students registered there, gate passes received there)')],
    header(['Desk', 'Students registered', 'Cash gate passes', 'Cash', 'GPay gate passes', 'GPay / UPI', 'Total']),
    ...report.desks.map((row) => [`Desk ${row.desk}`, row.registrations, row.cashCount, money(row.cash), row.upiCount, money(row.upi), total(row.cash + row.upi)]),
    ...(report.desks.length ? [] : [[muted('No desk registrations yet.')]]),
    [],
    [subtitle('Events')],
    header(['Event', 'Registered', 'Fees paid', 'Cash', 'GPay / UPI', 'Amount', 'Present', 'Results']),
    ...events.map((event) => [
      event.name,
      event.enrolled,
      event.feesPaid,
      event.cash,
      event.upi,
      money(event.amount),
      event.present,
      event.resultStatus === 'SUBMITTED' ? 'Submitted' : event.resultStatus === 'REOPENED' ? 'Being corrected' : 'Not submitted',
    ]),
  ];

  const sorted = [...registrations].sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const studentHeader = ['Registration ID', 'Name', 'College', 'Department', 'Year', 'Phone', 'Registered', 'Desk', 'Status', 'Team', 'Events', 'Gate pass paid by', 'Event fees paid', 'Registered at'];
  const students: Cell[][] = [
    [title(`${site.name} ${site.year}: registered students`)],
    [muted(`Generated ${formatIst(now)} by ${generatedBy}. ${sorted.length} registrations.`)],
    header(studentHeader),
    ...sorted.map((item) => [
      item.registrationId,
      item.participant.name,
      item.participant.college,
      item.participant.department,
      item.participant.year,
      item.participant.phone,
      item.source === 'ONSITE' ? 'At the desk' : 'Online',
      deskLabel(item),
      STATUS[item.status],
      item.teamName ?? '',
      item.technicalEvents.join(', '),
      item.status === 'APPROVED' ? GATE_PASS[item.gatePass.method] : '',
      item.events
        .filter((event) => event.fee.status === 'PAID')
        .map((event) => `${event.name} (${event.fee.method === 'CASH' ? 'cash' : 'GPay'})`)
        .join(', '),
      ist(item.submittedAt),
    ]),
  ];

  const participantRows = sorted.flatMap((item) =>
    item.status === 'APPROVED'
      ? item.events.map((event) => [
          event.name,
          item.registrationId,
          item.participant.name,
          item.participant.college,
          event.team ?? '',
          event.fee.status === 'PAID' ? `Paid (${event.fee.method === 'CASH' ? 'cash' : 'GPay'})` : 'Not paid',
          event.attendance?.present ? 'Present' : '',
        ])
      : [],
  );
  participantRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  const participants: Cell[][] = [
    [title(`${site.name} ${site.year}: event participants`)],
    [muted(`Generated ${formatIst(now)} by ${generatedBy}. Approved students only.`)],
    header(['Event', 'Registration ID', 'Name', 'College', 'Team', 'Event fee', 'Attendance']),
    ...participantRows,
  ];

  return [
    { name: 'Summary', rows: summary, widths: [46, 14, 14, 14, 14, 12, 10, 16], merges: ['A1:H1', 'A2:H2'] },
    {
      name: 'Registered students',
      rows: students,
      widths: [15, 26, 38, 32, 10, 13, 12, 9, 18, 18, 40, 16, 34, 22],
      freezeRows: 3,
      filter: { headerRow: 3, columns: studentHeader.length, lastRow: students.length },
      merges: ['A1:N1', 'A2:N2'],
    },
    { name: 'Event participants', rows: participants, widths: [22, 15, 26, 38, 18, 16, 12], freezeRows: 3, filter: { headerRow: 3, columns: 7, lastRow: participants.length }, merges: ['A1:G1', 'A2:G2'] },
  ];
}

export const reportWorkbook = (input: ReportInput) => ({
  name: `${site.name}-${site.year}-Report-${fileStamp(input.now)}.xlsx`,
  bytes: buildXlsx(reportSheets(input), new Date(input.now)),
});

// --- Results and certificates ------------------------------------------------------------------

/** A participant as the results need them (from a roster or a submitted result). */
export interface ExportParticipant {
  registrationId: string;
  name: string;
  college: string;
  department: string;
  year: string;
  email?: string;
  /** The team entered with; empty for an individual entry. */
  team?: string | null;
  feePaid: boolean;
  present: boolean;
}

export interface ExportEvent {
  name: string;
  participants: readonly ExportParticipant[];
  winners: Record<Place, readonly WinnerEntry[]>;
  /** The coordinator's submission, if the lists are final. */
  submittedAt: string | null;
  submittedBy: string | null;
}

const PARTICIPANT_HEADER = ['Event', 'Registration ID', 'Name', 'College', 'Department', 'Year', 'Team', 'Email', 'Event fee paid', 'Present'];

const participantRow = (event: ExportEvent, person: ExportParticipant): Cell[] => [
  event.name,
  person.registrationId,
  person.name,
  person.college,
  person.department,
  person.year,
  person.team ?? '',
  person.email ?? '',
  person.feePaid,
  person.present,
];

/** The results workbook: Summary, Participants, Certificates (present only) and Winners. */
export function resultsSheets(events: readonly ExportEvent[], generatedBy: string, now: number): Sheet[] {
  const final = events.every((event) => event.submittedAt);
  const note = muted(`Generated ${formatIst(now)} by ${generatedBy}.${final ? ' Every event is submitted: these lists are final.' : ' Some events are not submitted yet: their lists are as they stand now (NOT FINAL).'}`);
  const summary: Cell[][] = [
    [title(`${site.name} ${site.year}: results and certificates`)],
    [note],
    [],
    header(['Event', 'Status', 'Submitted at', 'Submitted by', 'Participants', 'Present', 'First place', 'Second place', 'Third place']),
    ...events.map((event) => [
      event.name,
      event.submittedAt ? 'Final' : 'NOT FINAL',
      ist(event.submittedAt),
      event.submittedBy ?? '',
      event.participants.length,
      event.participants.filter((person) => person.present).length,
      ...PLACES.map((place) => event.winners[place].map((winner) => winner.name).join(', ')),
    ]),
  ];
  const everyone = events.flatMap((event) => event.participants.map((person) => participantRow(event, person)));
  const present = events.flatMap((event) => event.participants.filter((person) => person.present).map((person) => participantRow(event, person)));
  const winners = events.flatMap((event) =>
    PLACES.flatMap((place) => event.winners[place].map((winner) => [event.name, PLACE_LABELS[place], winner.registrationId, winner.name, winner.college, winner.team ?? ''])),
  );
  const table = (name: string, heading: string, columns: string[], rows: Cell[][], widths: number[]): Sheet => {
    const all = [[title(heading)], [note], header(columns), ...rows];
    return { name, rows: all, widths, freezeRows: 3, filter: { headerRow: 3, columns: columns.length, lastRow: all.length } };
  };
  const widths = [22, 15, 26, 38, 32, 10, 18, 30, 14, 10];
  return [
    { name: 'Summary', rows: summary, widths: [22, 12, 22, 16, 13, 10, 24, 24, 24] },
    table('Participants', `${site.name} ${site.year}: participants`, PARTICIPANT_HEADER, everyone, widths),
    table('Certificates (present)', `${site.name} ${site.year}: participation certificates (marked present)`, PARTICIPANT_HEADER, present, widths),
    table('Winners', `${site.name} ${site.year}: winners`, ['Event', 'Place', 'Registration ID', 'Name', 'College', 'Team'], winners, [22, 14, 15, 26, 38, 18]),
  ];
}

export const resultsWorkbook = (events: readonly ExportEvent[], generatedBy: string, now: number) => ({
  name: `${site.name}-${site.year}-Results-${events.every((event) => event.submittedAt) ? '' : 'NOT-FINAL-'}${fileStamp(now)}.xlsx`,
  bytes: buildXlsx(resultsSheets(events, generatedBy, now), new Date(now)),
});

// --- Everything, for the admin ------------------------------------------------------------------

export interface DeletedRecord {
  at: string;
  registrationId: string;
  name: string;
  by: string;
  reason: string;
}

export interface AllDataInput {
  registrations: readonly AdminRegistration[];
  deleted: readonly DeletedRecord[];
  generatedBy: string;
  now: number;
}

/**
 * Every registration with all its details, every payment with its evidence (screenshot, the
 * transaction ID the student typed and the one entered, who approved it at which desk), every
 * event entry with fee and attendance, and the deleted records: the admin's complete copy.
 */
export function allDataSheets({ registrations, deleted, generatedBy, now }: AllDataInput): Sheet[] {
  const sorted = [...registrations].sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const note = muted(`Generated ${formatIst(now)} by ${generatedBy}. Everything recorded in the dashboard at that moment.`);
  const registrationColumns = [
    'Registration ID', 'Status', 'Registered', 'Desk', 'Registered by', 'Registered at', 'Name', 'College', 'Department', 'Year', 'Phone', 'Email', 'Team',
    'Events', 'Events attended', 'Gate pass', 'Gate pass txn (typed by student)', 'Gate pass txn (entered)', 'Gate pass approved by', 'Approved at', 'Reason (rejected / cancelled)',
  ];
  const registrationRows = sorted.map((item) => {
    const gate = item.payments.find((record) => record.kind === 'GATE_PASS');
    return [
      item.registrationId,
      STATUS[item.status],
      item.source === 'ONSITE' ? 'At the desk' : 'Online',
      deskLabel(item),
      item.createdBy ?? '',
      ist(item.submittedAt),
      item.participant.name,
      item.participant.college,
      item.participant.department,
      item.participant.year,
      item.participant.phone,
      item.participant.email,
      item.teamName ?? '',
      item.technicalEvents.join(', '),
      item.events.filter((event) => event.attendance?.present).map((event) => event.name).join(', '),
      gate ? `${PAYMENT_STATUS[gate.status]}${gate.method ? ` (${METHOD[gate.method]})` : ''}` : '',
      gate?.studentTransactionId ?? '',
      gate?.approvedTransactionId ?? '',
      gate?.approvedBy ? `${gate.approvedBy}${gate.approvedAtDesk ? ` (desk ${gate.approvedAtDesk})` : ''}` : '',
      ist(gate?.approvedAt),
      item.rejectionReason ?? item.cancelled?.reason ?? '',
    ];
  });
  const paymentColumns = ['Registration ID', 'Name', 'Payment', 'Amount', 'Status', 'Method', 'Screenshot', 'Txn typed by student', 'Txn entered when approving', 'Same?', 'Approved / received by', 'Desk', 'At'];
  const paymentRows = sorted.flatMap((item) =>
    item.payments.map((record) => [
      item.registrationId,
      item.participant.name,
      record.label,
      money(record.amount),
      PAYMENT_STATUS[record.status],
      record.method ? METHOD[record.method] : '',
      record.screenshot ? `${record.screenshot.source === 'ONLINE_FORM' ? 'Online form' : 'Student login'}, ${ist(record.screenshot.uploadedAt)}` : '',
      record.studentTransactionId ?? '',
      record.approvedTransactionId ?? '',
      sameId(record.studentTransactionId, record.approvedTransactionId),
      record.approvedBy ?? '',
      record.approvedAtDesk ? `Desk ${record.approvedAtDesk}` : '',
      ist(record.approvedAt),
    ]),
  );
  const attendanceColumns = ['Event', 'Registration ID', 'Name', 'College', 'Team', 'Event fee', 'Present', 'Marked by', 'Marked at'];
  const attendanceRows = sorted
    .flatMap((item) =>
      item.events.map((event) => [
        event.name,
        item.registrationId,
        item.participant.name,
        item.participant.college,
        event.team ?? '',
        event.fee.status === 'PAID' ? `Paid (${event.fee.method === 'CASH' ? 'cash' : 'GPay'})` : 'Not paid',
        event.attendance?.present ? 'Present' : '',
        event.attendance?.markedBy ?? '',
        ist(event.attendance?.markedAt),
      ]),
    )
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  const deletedRows = deleted.map((entry) => [ist(entry.at), entry.registrationId, entry.name, entry.by, entry.reason]);
  return [
    tableSheet('All registrations', `${site.name} ${site.year}: all registrations`, note, registrationColumns, registrationRows, [15, 16, 12, 9, 14, 22, 26, 38, 32, 10, 13, 30, 18, 40, 30, 26, 24, 24, 22, 22, 30]),
    tableSheet('Payments', `${site.name} ${site.year}: every payment with its evidence`, note, paymentColumns, paymentRows, [15, 26, 18, 10, 18, 13, 30, 22, 24, 12, 18, 9, 22]),
    tableSheet('Events and attendance', `${site.name} ${site.year}: event entries, fees and attendance`, note, attendanceColumns, attendanceRows, [22, 15, 26, 38, 18, 16, 10, 16, 22]),
    tableSheet('Deleted records', `${site.name} ${site.year}: deleted records (the data is kept on the server)`, note, ['Deleted at', 'Registration ID', 'Name', 'Deleted by', 'Reason'], deletedRows, [22, 15, 26, 18, 40]),
  ];
}

export const allDataWorkbook = (input: AllDataInput) => ({
  name: `${site.name}-${site.year}-All-data-${fileStamp(input.now)}.xlsx`,
  bytes: buildXlsx(allDataSheets(input), new Date(input.now)),
});

// --- One event, for its coordinator --------------------------------------------------------------

/**
 * One event's workbook for its coordinator (or an admin): a summary, every participant with the
 * fee (how it was paid, the transaction IDs, who approved it) and attendance, and the winners.
 */
export function eventSheets(roster: EventRoster, generatedBy: string, now: number): Sheet[] {
  const { event, result } = roster;
  const people = [...roster.participants].sort((a, b) => Number(b.attendance?.present === true) - Number(a.attendance?.present === true) || a.registrationId.localeCompare(b.registrationId));
  const submitted = result.submission;
  const note = muted(`Generated ${formatIst(now)} by ${generatedBy}. ${submitted ? `Results submitted ${ist(submitted.submittedAt)} by ${submitted.submittedBy}.` : 'Results not submitted yet: NOT FINAL.'}`);
  const paid = people.filter((person) => person.fee.status === 'PAID');
  const cash = paid.filter((person) => person.fee.method === 'CASH');
  const upi = paid.filter((person) => person.fee.method !== 'CASH');
  const summary: Cell[][] = [
    [title(`${site.name} ${site.year}: ${event.name}`)],
    [note],
    [],
    header(['', 'Count', 'Amount']),
    ['Participants', people.length, ''],
    ['Fees paid in cash', cash.length, money(cash.reduce((sum, person) => sum + person.fee.amount, 0))],
    ['Fees paid by GPay / UPI', upi.length, money(upi.reduce((sum, person) => sum + person.fee.amount, 0))],
    [bold('Fees paid'), bold(paid.length), total(paid.reduce((sum, person) => sum + person.fee.amount, 0))],
    ['Present', people.filter((person) => person.attendance?.present).length, ''],
  ];
  const columns = [
    'Registration ID', 'Name', 'College', 'Department', 'Year', 'Phone', 'Team', 'Gate pass', 'Event fee', 'Method',
    'Txn typed by student', 'Txn entered', 'Fee approved by', 'Fee at', 'Present', 'Marked by', 'Marked at',
  ];
  const rows = people.map((person) => [
    person.registrationId,
    person.name,
    person.college,
    person.department,
    person.year,
    person.phone ?? '',
    person.team ?? '',
    person.gatePassVerified ? 'Verified' : 'Not verified',
    person.fee.status === 'PAID' ? 'Paid' : person.feeProof ? 'Screenshot to check' : 'Not paid',
    person.fee.method ? (person.fee.method === 'CASH' ? 'Cash' : 'GPay / UPI') : '',
    person.feePayment?.studentTransactionId ?? person.feeProof?.transactionId ?? '',
    person.feePayment?.approvedTransactionId ?? person.fee.reference ?? '',
    person.fee.verifiedBy ?? '',
    ist(person.fee.verifiedAt),
    person.attendance?.present ? 'Present' : '',
    person.attendance?.markedBy ?? '',
    ist(person.attendance?.markedAt),
  ]);
  const winnersOf = (place: Place) => (submitted ? submitted.winners[place].map((winner) => winner.registrationId) : result.winners[place]);
  const winners = PLACES.flatMap((place) =>
    winnersOf(place).map((id) => {
      const person = people.find((item) => item.registrationId === id);
      return [PLACE_LABELS[place], id, person?.name ?? '', person?.college ?? '', person?.department ?? '', person?.year ?? '', person?.team ?? ''];
    }),
  );
  return [
    { name: 'Summary', rows: summary, widths: [30, 12, 14], merges: ['A1:C1', 'A2:C2'] },
    tableSheet('Participants', `${site.name} ${site.year}: ${event.name} participants (present first)`, note, columns, rows, [15, 26, 38, 32, 10, 13, 18, 12, 18, 12, 22, 22, 16, 22, 10, 16, 22]),
    tableSheet('Winners', `${site.name} ${site.year}: ${event.name} winners`, note, ['Place', 'Registration ID', 'Name', 'College', 'Department', 'Year', 'Team'], winners, [14, 15, 26, 38, 32, 10, 18]),
  ];
}

export const eventWorkbook = (roster: EventRoster, generatedBy: string, now: number) => ({
  name: `${site.name}-${site.year}-${roster.event.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${fileStamp(now)}.xlsx`,
  bytes: buildXlsx(eventSheets(roster, generatedBy, now), new Date(now)),
});
