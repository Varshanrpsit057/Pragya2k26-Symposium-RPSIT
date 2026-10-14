/**
 * The students' Excel list, the same for every account: a desk or department admin downloads its
 * department, a coordinator their events, the overall coordinator and web assist team everyone;
 * and the full copy (every sheet at once) the web assist team keeps as a backup.
 */
import { formatIst } from '../../lib/countdown';
import { DESKS, collegeSummary, deptShort, eventLabel, eventOf, feePaid, isActive, medalOrder, showId, totalsOf, type CollegeRow, type FestCatalog, type FestRegistration, type FestResult } from '../../lib/fest';
import { when } from '../ui';
import { PORTAL, saveTable, saveWorkbook, tableSheet, today } from './excel';

export const sourceLabel = { DESK: 'Desk', ONLINE: 'Online', PAPER: 'Paper', SELF: 'Own phone' } as const;

/** How they registered: on their own phone, or a desk did it for them (same IDs), online or older ways. */
export const howRegistered = (item: FestRegistration) => (item.source === 'SELF' && item.created.by !== 'student' ? 'Desk (for them)' : sourceLabel[item.source]);

/** Whether they reached a desk: online and own-phone students check in there; desk ones were there. */
const arrived = (item: FestRegistration) => (item.source === 'ONLINE' || item.source === 'SELF' ? (item.checkedIn ? when(item.checkedIn.at) : 'No') : 'Yes');

export function exportRows(list: FestRegistration[], catalog: FestCatalog) {
  const name = (id: string) => eventOf(catalog, id)?.name ?? id;
  const rows: (string | number)[][] = [
    [
      'Registration ID',
      'Department',
      'Name',
      'Phone',
      'Email',
      'College',
      'College code',
      'Department / course',
      'Year',
      'Team',
      'Registered',
      'Desk',
      'Entry fee',
      'Paid by',
      'Paid at',
      'UTR accepted',
      'UTR sent by student',
      'UTR changes',
      'Verified by',
      'Arrived',
      'Events',
      'Event fees paid',
      'Present at',
      'Registered at',
      'Registered by',
      'Status',
    ],
  ];
  for (const item of list) {
    const payment = item.entry.payment;
    rows.push([
      showId(item.id),
      deptShort(item.dept),
      item.name,
      item.phone,
      item.email,
      item.college,
      item.collegeCode ?? '',
      item.branch,
      item.year,
      item.team,
      howRegistered(item),
      payment?.desk ?? item.checkedIn?.desk ?? item.desk ?? '',
      item.entry.status === 'PAID' ? (payment?.amount ?? '') : item.entry.rejected ? 'NOT FOUND' : item.entry.claim ? 'TO CHECK' : 'DUE',
      payment?.method ?? '',
      payment ? when(payment.at) : '',
      payment?.txn ?? '',
      item.entry.claim?.txn ?? '',
      (item.utrLog ?? []).map((change) => `${change.from} → ${change.to} (${change.reason}; ${change.by}, ${when(change.at)})`).join('; '),
      payment ? `${payment.by}${payment.desk ? ` (desk ${payment.desk})` : ''}` : '',
      arrived(item),
      item.events.map((entry) => name(entry.eventId)).join('; '),
      item.events.filter((entry) => feePaid(entry)).map((entry) => `${name(entry.eventId)} (${entry.fee!.method} ₹${entry.fee!.amount})`).join('; '),
      item.events.filter((entry) => entry.present).map((entry) => name(entry.eventId)).join('; '),
      when(item.created.at),
      item.created.by,
      item.deleted ? 'Deleted' : item.cancelled ? 'Cancelled' : item.test ? 'TEST' : 'Active',
    ]);
  }
  return rows;
}

/** Saves the students as an Excel file (one row each, the columns above). */
export function downloadStudents(fileName: string, heading: string, note: string, list: FestRegistration[], catalog: FestCatalog) {
  saveTable(fileName, heading, note, exportRows([...list].sort((a, b) => a.id.localeCompare(b.id)), catalog));
}

const ordinalOf = (place: number) => (place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`);

/** Every submitted event's winners, one row per student. */
export function winnerRows(catalog: FestCatalog, events: readonly { id: string }[], results: ReadonlyMap<string, FestResult>, registrations: ReadonlyMap<string, FestRegistration>) {
  const rows: (string | number)[][] = [['Department', 'Event', 'Venue', 'Place', 'Team', 'Registration ID', 'Name', 'College', 'Phone', 'Email', 'Submitted by', 'Submitted at']];
  for (const { id } of events) {
    const event = eventOf(catalog, id);
    const result = results.get(id);
    if (!event || !result?.submitted) continue;
    for (const place of result.places) {
      for (const person of place.ids) {
        const who = registrations.get(person);
        rows.push([deptShort(event.dept), eventLabel(event), event.venue, ordinalOf(place.place), place.team ?? '', showId(person), who?.name ?? '', who?.college ?? '', who?.phone ?? '', who?.email ?? '', result.submitted.by, when(result.submitted.at)]);
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
  const rows: (string | number)[][] = [['Event', 'Department', 'Certificate', 'Place', 'Team', 'Registration ID', 'Name', 'College', 'College code', 'Department / course', 'Year']];
  const everyone = [...registrations.values()].filter(isActive);
  for (const { id } of events) {
    const event = eventOf(catalog, id);
    if (!event) continue;
    const places = new Map<string, { place: number; team: string }>();
    for (const place of results.get(id)?.places ?? []) for (const person of place.ids) places.set(person, { place: place.place, team: place.team ?? '' });
    const present = everyone
      .filter((item) => item.events.some((entry) => entry.eventId === id && entry.present))
      .sort((a, b) => (places.get(a.id)?.place ?? 9) - (places.get(b.id)?.place ?? 9) || a.id.localeCompare(b.id));
    for (const item of present) {
      const won = places.get(item.id);
      rows.push([eventLabel(event), deptShort(event.dept), won ? 'Winner' : 'Participation', won ? ordinalOf(won.place) : '', won?.team || item.team, showId(item.id), item.name, item.college, item.collegeCode ?? '', item.branch, item.year]);
    }
  }
  return rows;
}

/** The college ranking (medal table), in the order given. */
export function rankingRows(rows: CollegeRow[]) {
  return [
    ['Rank', 'College', 'College code', 'Students', 'Event participations', 'Event registrations', '1st prizes', '2nd prizes', '3rd prizes', 'Total prizes'],
    ...rows.map((row, index) => [index + 1, row.name, row.code, row.students, row.participations, row.registrations, row.first, row.second, row.third, row.places]),
  ];
}

/** Money by department and by desk (active registrations only). */
function moneyRows(catalog: FestCatalog, list: FestRegistration[]) {
  const rows: (string | number)[][] = [['Department', 'Desk', 'Students', 'Paid', 'Entry fees cash', 'Entry fees UPI', 'Entry fees online', 'Event fees cash', 'Event fees UPI', 'Total collected']];
  for (const dept of catalog.departments) {
    const mine = list.filter((item) => item.dept === dept.code);
    const part = totalsOf(mine);
    rows.push([deptShort(dept.code), 'All', part.registered, part.registered - part.entryDue, part.entryCash, part.entryUpi, part.entryOnline, part.feeCash, part.feeUpi, part.entryCash + part.entryUpi + part.entryOnline + part.feeCash + part.feeUpi]);
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
      rows.push([deptShort(dept.code), `Desk ${desk}`, '', count, cash, upi, '', '', '', cash + upi]);
    }
  }
  return rows;
}

/** Everything in one Excel file (students, winners, college ranking, money): a copy to keep, whatever happens to the server. */
export function downloadFullCopy(catalog: FestCatalog, registrations: ReadonlyMap<string, FestRegistration>, results: ReadonlyMap<string, FestResult>, by: string) {
  const note = `${PORTAL} · full copy, every department · downloaded by ${by} ${formatIst(Date.now())}`;
  const list = [...registrations.values()].sort((a, b) => a.id.localeCompare(b.id));
  const active = list.filter(isActive);
  const ranking = collegeSummary(active, [...results.values()]).sort(medalOrder);
  saveWorkbook(`techfest-full-copy-${today()}.xlsx`, [
    tableSheet('Students', note, exportRows(list, catalog)),
    tableSheet('Winners', note, winnerRows(catalog, catalog.events, results, registrations)),
    tableSheet('College ranking', note, rankingRows(ranking)),
    tableSheet('Money', note, moneyRows(catalog, active)),
  ]);
}
