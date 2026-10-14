/**
 * The students' Excel list, the same for every account: a desk or department admin downloads its
 * department, a coordinator their events, the overall coordinator and web assist team everyone.
 */
import { deptShort, eventOf, feePaid, showId, type FestCatalog, type FestRegistration } from '../../lib/fest';
import { when } from '../ui';
import { saveTable } from './excel';

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
