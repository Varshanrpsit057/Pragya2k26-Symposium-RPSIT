/**
 * The Excel downloads, each with the columns its readers need (the UTR of every UPI or online
 * payment in each of them):
 *
 *   desk       a desk's list (Students, Online registered): the student, the gate pass (entry fee)
 *              and its UTR, who collected or verified it, arrived
 *   list       the Students view (department admins, the overall coordinator, the web assist team):
 *              the same with the email and their events, and a group of columns for each event of
 *              the department (or the event) the filters show
 *   event      an event window: its participants as on the event registration form (S.No, ID,
 *              name, register number, college code and name, department and year, mobile, team,
 *              the event fee by cash or UPI with its UTR, present or absent, a column to sign)
 *   master     the web assist team's one file with everything (downloadMaster)
 */
import { formatIst } from '../../lib/countdown';
import {
  DESKS,
  collegeSummary,
  deptShort,
  entryOf,
  eventColumnCells,
  eventColumnHeads,
  eventLabel,
  eventOf,
  eventsOf,
  feePaid,
  isActive,
  medalOrder,
  methodLabel,
  placeTeam,
  regNoOf,
  showId,
  teamOf,
  teamsText,
  totalsOf,
  type CollegeRow,
  type FestCatalog,
  type FestEvent,
  type FestRegistration,
  type FestResult,
} from '../../lib/fest';
import { when } from '../ui';
import { PORTAL, saveTable, saveWorkbook, tableSheet, today } from './excel';

export const sourceLabel = { DESK: 'Desk', ONLINE: 'Online', PAPER: 'Paper', SELF: 'Own phone' } as const;

/** How they registered: on their own phone, or a desk did it for them (same IDs), online or older ways. */
export const howRegistered = (item: FestRegistration) => (item.source === 'SELF' && item.created.by !== 'student' ? 'Desk (for them)' : sourceLabel[item.source]);

/** Whether they reached a desk: online and own-phone students check in there; desk ones were there. */
const arrived = (item: FestRegistration) => (item.source === 'ONLINE' || item.source === 'SELF' ? (item.checkedIn ? when(item.checkedIn.at) : 'No') : 'Yes');

/** The gate pass (entry fee) in words. */
export function gatePassText(item: FestRegistration) {
  const { entry } = item;
  if (entry.status === 'PAID') return entry.payment?.method === 'ONLINE' ? (entry.payment.checked ? 'Paid online · UTR verified' : 'Paid online · UTR not verified') : 'Paid';
  if (entry.rejected) return 'Payment not found';
  return entry.claim ? 'UTR sent · to verify' : 'Due';
}

/** Who took the gate pass fee or verified its UTR: 'cse-desk1 (desk 1)'; an online payment not verified yet says so. */
function takenBy(item: FestRegistration) {
  const payment = item.entry.status === 'PAID' ? item.entry.payment : undefined;
  if (!payment) return '';
  const who = payment.method === 'ONLINE' ? payment.checked : payment;
  if (!who) return 'Not verified yet';
  const desk = 'desk' in who && who.desk ? ` (desk ${who.desk})` : '';
  return `${who.by}${desk}`;
}

const statusText = (item: FestRegistration) => (item.deleted ? 'Deleted' : item.cancelled ? 'Cancelled' : item.test ? 'TEST' : 'Active');

type Cell = string | number;
type Detail = 'desk' | 'list' | 'master';
interface Column {
  head: string;
  cell: (item: FestRegistration, name: (id: string) => string) => Cell;
  /** The downloads that have it. */
  in: readonly Detail[];
}
const ALL: readonly Detail[] = ['desk', 'list', 'master'];
const WIDE: readonly Detail[] = ['list', 'master'];

/** The student columns, in order; each event's group goes after 'Events'. */
const STUDENT_COLUMNS: Column[] = [
  { head: 'Registration ID', cell: (item) => showId(item.id), in: ALL },
  { head: 'Department', cell: (item) => deptShort(item.dept), in: WIDE },
  { head: 'Name', cell: (item) => item.name, in: ALL },
  { head: 'Register number', cell: regNoOf, in: ALL },
  { head: 'Phone', cell: (item) => item.phone, in: ALL },
  { head: 'Email', cell: (item) => item.email, in: WIDE },
  { head: 'College', cell: (item) => item.college, in: ALL },
  { head: 'College code', cell: (item) => item.collegeCode ?? '', in: ALL },
  { head: 'Department / course', cell: (item) => item.branch, in: ALL },
  { head: 'Year', cell: (item) => item.year, in: ALL },
  { head: 'Registered', cell: howRegistered, in: ALL },
  { head: 'Gate pass', cell: gatePassText, in: ALL },
  { head: 'Paid by (cash / UPI / online)', cell: (item) => (item.entry.status === 'PAID' && item.entry.payment ? methodLabel(item.entry.payment.method) : ''), in: ALL },
  { head: 'Amount', cell: (item) => (item.entry.status === 'PAID' ? (item.entry.payment?.amount ?? '') : (item.entry.claim?.amount ?? '')), in: ALL },
  // The payment's UTR (UPI or online), or the one the student sent that a desk has not verified yet.
  { head: 'UTR', cell: (item) => (item.entry.status === 'PAID' ? (item.entry.payment?.txn ?? '') : (item.entry.claim?.txn ?? '')), in: ALL },
  { head: 'Collected / verified by', cell: takenBy, in: ALL },
  { head: 'Paid at', cell: (item) => (item.entry.status === 'PAID' && item.entry.payment ? when(item.entry.payment.checked?.at ?? item.entry.payment.at) : ''), in: ALL },
  { head: 'Arrived', cell: arrived, in: ALL },
  { head: 'Events', cell: (item, name) => item.events.map((entry) => name(entry.eventId)).join('; '), in: WIDE },
  { head: 'Team (typed when registering)', cell: (item, name) => teamsText(item, name), in: ['master'] },
  { head: 'UTR the student sent', cell: (item) => item.entry.claim?.txn ?? '', in: ['master'] },
  { head: 'UTR changes', cell: (item) => (item.utrLog ?? []).map((change) => `${change.from} → ${change.to} (${change.reason}; ${change.by}, ${when(change.at)})`).join('; '), in: ['master'] },
  { head: 'Registered at', cell: (item) => when(item.created.at), in: ['master'] },
  { head: 'Registered by', cell: (item) => item.created.by, in: ['master'] },
  { head: 'Online form ref', cell: (item) => item.ref ?? '', in: ['master'] },
  { head: 'Status', cell: statusText, in: ALL },
];

/**
 * The students' rows (the first is the header): the columns `detail` needs, with a group of columns
 * for each of `events` (the fee, the UTR its coordinator typed, present or absent) after 'Events'.
 */
export function exportRows(list: FestRegistration[], catalog: FestCatalog, { detail = 'list', events = [] }: { detail?: Detail; events?: FestEvent[] } = {}) {
  const name = (id: string) => eventOf(catalog, id)?.name ?? id;
  const withDept = new Set(events.map((event) => event.dept)).size > 1;
  const columns = STUDENT_COLUMNS.filter((column) => column.in.includes(detail));
  const at = columns.findIndex((column) => column.head === 'Events') + 1 || columns.length - 1;
  const rows: Cell[][] = [[...columns.slice(0, at).map((column) => column.head), ...events.flatMap((event) => eventColumnHeads(event, withDept)), ...columns.slice(at).map((column) => column.head)]];
  for (const item of list) {
    const cells = columns.map((column) => column.cell(item, name));
    rows.push([...cells.slice(0, at), ...events.flatMap((event) => eventColumnCells(item, event)), ...cells.slice(at)]);
  }
  return rows;
}

/** Saves the students as an Excel file (one row each; see exportRows). */
export function downloadStudents(fileName: string, heading: string, note: string, list: FestRegistration[], catalog: FestCatalog, options: { detail?: Detail; events?: FestEvent[] } = {}) {
  saveTable(fileName, heading, note, exportRows([...list].sort((a, b) => a.id.localeCompare(b.id)), catalog, options));
}

/**
 * One event's participants (an event window's download), as on the event registration form: S.No,
 * their ID, name, register number, college code and name, department and year, mobile, team, the
 * event fee (cash or UPI, with the UTR typed at the venue, by whom), present or absent, and an empty
 * column for their signature on a printout. Cancelled and deleted registrations are left out.
 */
export function eventRows(list: FestRegistration[], event: FestEvent) {
  const rows: Cell[][] = [
    [
      'S.No',
      'Student ID',
      'Student name',
      'Register number',
      'College code',
      'College name',
      'Department / course',
      'Year',
      'Mobile',
      'Team name',
      'Gate pass',
      'Event fee',
      'Paid by (cash / UPI)',
      'Amount',
      'UTR (UPI, typed at the event)',
      'Fee taken by',
      'Present / absent',
      'Signature',
    ],
  ];
  const joined = [...list].filter((item) => isActive(item) && entryOf(item, event.id)).sort((a, b) => a.id.localeCompare(b.id));
  for (const [index, item] of joined.entries()) {
    const entry = entryOf(item, event.id)!;
    const fee = feePaid(entry) ? entry.fee! : null;
    rows.push([
      index + 1,
      showId(item.id),
      item.name,
      regNoOf(item),
      item.collegeCode ?? '',
      item.college,
      item.branch,
      item.year,
      item.phone,
      entry.team ?? '',
      gatePassText(item),
      fee ? 'Paid' : entry.fee?.voided ? `Cancelled: ${entry.fee.voided.reason}` : event.fee ? 'Due' : 'No fee',
      fee ? methodLabel(fee.method) : '',
      fee ? fee.amount : '',
      fee?.txn ?? '',
      fee ? `${fee.by} · ${when(fee.at)}` : '',
      entry.present ? 'Present' : 'Absent',
      '',
    ]);
  }
  return rows;
}

/**
 * Every student in every event they joined, one row each: the fee as the event's coordinator
 * recorded it (cash or UPI, the UTR typed at the venue, by whom and when), present or absent, the team.
 */
export function participationRows(list: FestRegistration[], catalog: FestCatalog) {
  const rows: Cell[][] = [
    ['Department', 'Event', 'Registration ID', 'Name', 'Register number', 'Phone', 'College', 'College code', 'Fee', 'Paid by (cash / UPI)', 'Amount', 'UTR (typed at the event)', 'Fee taken by', 'Fee taken at', 'Present / absent', 'Marked present by', 'Marked present at', 'Team', 'Status'],
  ];
  for (const event of catalog.events) {
    for (const item of list.filter((registration) => entryOf(registration, event.id)).sort((a, b) => a.id.localeCompare(b.id))) {
      const entry = entryOf(item, event.id)!;
      const fee = feePaid(entry) ? entry.fee! : null;
      rows.push([
        deptShort(event.dept),
        eventLabel(event),
        showId(item.id),
        item.name,
        regNoOf(item),
        item.phone,
        item.college,
        item.collegeCode ?? '',
        fee ? 'Paid' : entry.fee?.voided ? `Cancelled: ${entry.fee.voided.reason}` : event.fee ? 'Due' : 'No fee',
        fee ? methodLabel(fee.method) : '',
        fee ? fee.amount : '',
        fee?.txn ?? '',
        fee?.by ?? '',
        fee ? when(fee.at) : '',
        entry.present ? 'Present' : 'Absent',
        entry.present?.by ?? '',
        entry.present ? when(entry.present.at) : '',
        entry.team ?? '',
        statusText(item),
      ]);
    }
  }
  return rows;
}

const ordinalOf = (place: number) => (place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`);

/** Every submitted event's winners, one row per student. */
export function winnerRows(catalog: FestCatalog, events: readonly { id: string }[], results: ReadonlyMap<string, FestResult>, registrations: ReadonlyMap<string, FestRegistration>) {
  const rows: Cell[][] = [['Department', 'Event', 'Venue', 'Place', 'Team', 'Registration ID', 'Name', 'College', 'Phone', 'Email', 'Submitted by', 'Submitted at']];
  for (const { id } of events) {
    const event = eventOf(catalog, id);
    const result = results.get(id);
    if (!event || !result?.submitted) continue;
    for (const place of result.places) {
      for (const person of place.ids) {
        const who = registrations.get(person);
        rows.push([deptShort(event.dept), eventLabel(event), event.venue, ordinalOf(place.place), placeTeam(place), showId(person), who?.name ?? '', who?.college ?? '', who?.phone ?? '', who?.email ?? '', result.submitted.by, when(result.submitted.at)]);
      }
    }
  }
  return rows;
}

/**
 * The certificate list: every student marked present at each event, its winners first (1st, 2nd,
 * 3rd, a row per team member), then the participants, with what goes on the certificate.
 */
export function certificateRows(catalog: FestCatalog, events: readonly { id: string }[], results: ReadonlyMap<string, FestResult>, registrations: ReadonlyMap<string, FestRegistration>) {
  const rows: Cell[][] = [['Event', 'Department', 'Certificate', 'Place', 'Team', 'Registration ID', 'Name', 'Register number', 'College', 'College code', 'Department / course', 'Year']];
  const everyone = [...registrations.values()].filter(isActive);
  for (const { id } of events) {
    const event = eventOf(catalog, id);
    if (!event) continue;
    const places = new Map<string, { place: number; team: string }>();
    for (const place of results.get(id)?.places ?? []) for (const person of place.ids) places.set(person, { place: place.place, team: placeTeam(place) });
    const present = everyone
      .filter((item) => item.events.some((entry) => entry.eventId === id && entry.present))
      .sort((a, b) => (places.get(a.id)?.place ?? 9) - (places.get(b.id)?.place ?? 9) || a.id.localeCompare(b.id));
    for (const item of present) {
      const won = places.get(item.id);
      rows.push([eventLabel(event), deptShort(event.dept), won ? 'Winner' : 'Participation', won ? ordinalOf(won.place) : '', won ? won.team : teamOf(item, id), showId(item.id), item.name, regNoOf(item), item.college, item.collegeCode ?? '', item.branch, item.year]);
    }
  }
  return rows;
}

/**
 * The college results (the overall coordinator's sheet), in the order given: each college's
 * participants (students), participations (events its students attended), and 1st, 2nd and 3rd places.
 */
export function rankingRows(rows: CollegeRow[]) {
  return [
    ['Rank', 'College', 'College code', 'Total participants (students)', 'Participations (events attended)', 'First places', 'Second places', 'Third places', 'Total prizes', 'Event registrations'],
    ...rows.map((row, index) => [index + 1, row.name, row.code, row.students, row.participations, row.first, row.second, row.third, row.places, row.registrations]),
  ];
}

/** Money by department and by desk (active registrations only). */
function moneyRows(catalog: FestCatalog, list: FestRegistration[]) {
  const rows: Cell[][] = [['Department', 'Desk', 'Students', 'Paid', 'Entry fees cash', 'Entry fees UPI', 'Entry fees online', 'Online UTRs verified', 'Event fees cash', 'Event fees UPI', 'Total collected']];
  for (const dept of catalog.departments) {
    const mine = list.filter((item) => item.dept === dept.code);
    const part = totalsOf(mine);
    const verified = mine.filter((item) => item.entry.status === 'PAID' && item.entry.payment?.method === 'ONLINE' && item.entry.payment.checked).length;
    rows.push([deptShort(dept.code), 'All', part.registered, part.registered - part.entryDue, part.entryCash, part.entryUpi, part.entryOnline, verified, part.feeCash, part.feeUpi, part.entryCash + part.entryUpi + part.entryOnline + part.feeCash + part.feeUpi]);
    for (let desk = 1; desk <= DESKS; desk += 1) {
      let count = 0;
      let cash = 0;
      let upi = 0;
      for (const item of mine) {
        const payment = item.entry.payment;
        if (!isActive(item) || !payment || payment.voided || payment.desk !== desk) continue;
        count += 1;
        if (payment.method === 'CASH') cash += payment.amount;
        else if (payment.method === 'UPI') upi += payment.amount;
      }
      const checked = mine.filter((item) => isActive(item) && item.entry.payment?.method === 'ONLINE' && item.entry.payment.checked?.desk === desk).length;
      rows.push([deptShort(dept.code), `Desk ${desk}`, '', count, cash, upi, '', checked, '', '', cash + upi]);
    }
  }
  return rows;
}

/**
 * The master Excel file (the web assist team, the overall coordinator): everything at once, a copy
 * to keep whatever happens to the server. Every student (with every detail), each department's
 * students with its events' columns, the online registrations, every event participation, the
 * winners, the certificate list, the college results and the money.
 */
export function downloadMaster(catalog: FestCatalog, registrations: ReadonlyMap<string, FestRegistration>, results: ReadonlyMap<string, FestResult>, by: string) {
  const note = `${PORTAL} · master copy, every department · downloaded by ${by} ${formatIst(Date.now())}`;
  const list = [...registrations.values()].sort((a, b) => a.id.localeCompare(b.id));
  const active = list.filter(isActive);
  const ranking = collegeSummary(active, [...results.values()]).sort(medalOrder);
  saveWorkbook(`techfest-master-${today()}.xlsx`, [
    tableSheet('All students', note, exportRows(list, catalog, { detail: 'master' })),
    ...catalog.departments.map((dept) =>
      tableSheet(`${deptShort(dept.code)} students`, `${note} · ${deptShort(dept.code)}: a group of columns for each event`, exportRows(list.filter((item) => item.dept === dept.code), catalog, { events: eventsOf(catalog, dept.code, { all: true }) })),
    ),
    tableSheet('Online registrations', note, exportRows(list.filter((item) => item.source === 'ONLINE'), catalog, { detail: 'master' })),
    tableSheet('Event participation', note, participationRows(list, catalog)),
    tableSheet('Winners', note, winnerRows(catalog, catalog.events, results, registrations)),
    tableSheet('Certificates', note, certificateRows(catalog, catalog.events, results, registrations)),
    tableSheet('College results', note, rankingRows(ranking)),
    tableSheet('Money', note, moneyRows(catalog, active)),
  ]);
}
