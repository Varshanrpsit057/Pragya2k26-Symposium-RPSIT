/**
 * The live views (overall coordinator and web assist team: every department; department HOD
 * and admin: their own), all driven by the same filters: department, event, venue, how they
 * registered, desk, entry fee, status and search.
 *
 * - Overview: totals, then by department, by event (with venue and time) and by desk
 * - Registrations: the filtered list, each with its details and the corrections a role may make
 * - Results: every event's winners as submitted, reopened only by the overall coordinator
 * - Colleges: students per college and the 1st, 2nd and 3rd places each college won
 */
import { useMemo, useState } from 'react';
import { canJoin, collegeSummary, deptShort, eventLabel, eventOf, feePaid, isActive, participantProblems, readParticipant, rupees, showId, totalsOf, type CollegeRow, type FestCatalog, type FestEvent, type FestParticipant, type FestRegistration } from '../../lib/fest';
import { hasPermission } from '../../lib/staff';
import { Badge, when } from '../ui';
import { filterNote, saveTable, today } from './excel';
import { ordinal } from './EventWindow';
import { useFest } from './FestData';
import { FilterBar, NO_PAYMENT, PaymentChoice, ShortList, Stat, applyFilters, deptName, paymentBody, paymentReady, stampNow, type PaymentDraft } from './festUi';

const sourceLabel = { DESK: 'Desk', ONLINE: 'Online', PAPER: 'Paper', SELF: 'Own phone' } as const;

function useFiltered() {
  const { registrations, filters, catalog, session, switches } = useFest();
  const viewAll = hasPermission(session.role, 'fest.viewAll');
  const list = useMemo(() => applyFilters(registrations.values(), filters, catalog), [registrations, filters, catalog]);
  // Website controls can hide the downloads (the web assist team keeps them).
  const canDownload = switches.downloads || session.role === 'ADMIN';
  return { list, viewAll, canDownload };
}

// ------------------------------------------------------------------------------------------ Overview

export function FestOverview() {
  const { catalog, registrations, filters, results, setFilters } = useFest();
  const { list, viewAll } = useFiltered();
  const totals = totalsOf(list, filters.eventId || undefined);
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  const all = [...registrations.values()];
  const depts = catalog.departments.filter((dept) => !filters.dept || dept.code === filters.dept);
  const events = catalog.events.filter((event) => (!filters.dept || event.dept === filters.dept) && (!filters.venue || event.venue === filters.venue) && (!filters.eventId || event.id === filters.eventId));
  const deskDept = filters.dept || (depts.length === 1 ? depts[0].code : '');
  const deskCount = catalog.departments.find((dept) => dept.code === deskDept)?.desks ?? 0;

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} />
        <div className="fest-stats">
          <Stat label="Registered" value={totals.registered} sub={`${totals.self} own phone · ${totals.desk} desk · ${totals.online} online${totals.paper ? ` · ${totals.paper} paper` : ''}`} />
          {totals.awaiting > 0 && <Stat label="Payments to check" value={totals.awaiting} sub="Self-registered, waiting for a desk" />}
          <Stat label="On campus" value={totals.checkedIn} sub={totals.online ? `${totals.online - (totals.checkedIn - totals.desk - totals.paper)} online not arrived` : undefined} />
          <Stat label="Entry fees" value={rupees(totals.entryCash + totals.entryUpi + totals.entryOnline)} sub={`${rupees(totals.entryCash)} cash · ${rupees(totals.entryUpi)} UPI · ${rupees(totals.entryOnline)} online`} />
          <Stat label="Event fees" value={rupees(totals.feeCash + totals.feeUpi)} sub={`${totals.feesPaid} paid of ${totals.eventEntries} entries`} />
          <Stat label="Present at events" value={totals.present} />
        </div>
      </section>

      {viewAll && !filters.dept && (
        <section className="adm-card adm-pad">
          <h3 className="adm-h3">By department</h3>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static fest-table">
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Desk / online</th>
                  <th scope="col">Entry fees</th>
                  <th scope="col">Event fees</th>
                  <th scope="col">Present</th>
                  <th scope="col">Results</th>
                </tr>
              </thead>
              <tbody>
                {catalog.departments.map((dept) => {
                  const part = totalsOf(applyFilters(all, { ...filters, dept: dept.code }, catalog));
                  const deptEvents = catalog.events.filter((event) => event.dept === dept.code && event.active);
                  const submitted = deptEvents.filter((event) => results.get(event.id)?.submitted).length;
                  return (
                    <tr key={dept.code} className="fest-row-link" onClick={() => setFilters({ ...filters, dept: dept.code })}>
                      <th scope="row">
                        {deptShort(dept.code)} <span className="adm-muted">{dept.name}</span>
                      </th>
                      <td>{part.registered}</td>
                      <td>
                        {part.desk} / {part.online}
                      </td>
                      <td>{rupees(part.entryCash + part.entryUpi + part.entryOnline)}</td>
                      <td>{rupees(part.feeCash + part.feeUpi)}</td>
                      <td>{part.present}</td>
                      <td>
                        {submitted}/{deptEvents.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="adm-muted">Tap a department to see it alone.</p>
        </section>
      )}

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">By event and venue</h3>
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static fest-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Venue · time</th>
                <th scope="col">Registered</th>
                <th scope="col">Fee paid</th>
                <th scope="col">Present</th>
                <th scope="col">Results</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const part = totalsOf(all.filter((item) => canJoin(item, event)), event.id);
                const result = results.get(event.id);
                return (
                  <tr key={event.id} className="fest-row-link" onClick={() => setFilters({ ...filters, dept: event.dept, eventId: event.id })}>
                    <th scope="row">
                      {viewAll && <span className="adm-muted">{deptShort(event.dept)} · </span>}
                      {eventLabel(event)}
                      {!event.active && <Badge tone="plain">Closed</Badge>}
                    </th>
                    <td>{[event.venue, event.time].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{part.registered}</td>
                    <td>
                      {part.feesPaid} <span className="adm-muted">({rupees(part.feeCash + part.feeUpi)})</span>
                    </td>
                    <td>{part.present}</td>
                    <td>{result?.submitted ? <Badge tone="good">Submitted</Badge> : result?.places.length ? <Badge tone="warn">Saved</Badge> : <span className="adm-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {deskDept && deskCount > 0 && (
        <section className="adm-card adm-pad">
          <h3 className="adm-h3">{deptShort(deskDept)} desks</h3>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static fest-table">
              <thead>
                <tr>
                  <th scope="col">Desk</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Online checked in</th>
                  <th scope="col">Cash</th>
                  <th scope="col">UPI</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: deskCount }, (_, index) => index + 1).map((desk) => {
                  const inDept = all.filter((item) => item.dept === deskDept && isActive(item));
                  const made = inDept.filter((item) => item.desk === desk && item.source !== 'ONLINE').length;
                  const checked = inDept.filter((item) => item.checkedIn?.desk === desk).length;
                  let cash = 0;
                  let upi = 0;
                  for (const item of inDept) {
                    const payment = item.entry.payment;
                    if (!payment || payment.voided || payment.desk !== desk) continue;
                    if (payment.method === 'CASH') cash += payment.amount;
                    else if (payment.method === 'UPI') upi += payment.amount;
                  }
                  return (
                    <tr key={desk}>
                      <th scope="row">Desk {desk}</th>
                      <td>{made}</td>
                      <td>{checked}</td>
                      <td>{rupees(cash)}</td>
                      <td>{rupees(upi)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

// ------------------------------------------------------------------------------------------ Registrations

function exportRows(list: FestRegistration[], catalog: FestCatalog) {
  const name = (id: string) => eventOf(catalog, id)?.name ?? id;
  const rows: (string | number)[][] = [
    ['Registration ID', 'Department', 'Name', 'Phone', 'Email', 'College', 'Department / course', 'Year', 'Team', 'Registered', 'Desk', 'Entry fee', 'Paid by', 'UTR accepted', 'UTR sent by student', 'Verified by', 'Arrived', 'Events', 'Event fees paid', 'Present at', 'Registered at', 'Registered by', 'Status'],
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
      item.branch,
      item.year,
      item.team,
      sourceLabel[item.source],
      item.desk ?? '',
      item.entry.status === 'PAID' ? (payment?.amount ?? '') : item.entry.rejected ? 'NOT FOUND' : item.entry.claim ? 'TO CHECK' : 'DUE',
      payment?.method ?? '',
      payment?.txn ?? '',
      item.entry.claim?.txn ?? '',
      payment ? `${payment.by}${payment.desk ? ` (desk ${payment.desk})` : ''}` : '',
      item.source === 'ONLINE' ? (item.checkedIn ? when(item.checkedIn.at) : 'No') : 'Yes',
      item.events.map((entry) => name(entry.eventId)).join('; '),
      item.events.filter((entry) => feePaid(entry)).map((entry) => `${name(entry.eventId)} (${entry.fee!.method})`).join('; '),
      item.events.filter((entry) => entry.present).map((entry) => name(entry.eventId)).join('; '),
      when(item.created.at),
      item.created.by,
      item.deleted ? 'Deleted' : item.cancelled ? 'Cancelled' : item.test ? 'TEST' : 'Active',
    ]);
  }
  return rows;
}

export function FestRegistrations() {
  const { catalog, filters, session } = useFest();
  const { list, viewAll, canDownload } = useFiltered();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE = 50;
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = list.slice(current * PAGE, current * PAGE + PAGE);
  const name = (id: string) => eventOf(catalog, id)?.name ?? id;

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} />
        <div className="adm-toolbar">
          <strong>{list.length} registrations</strong>
          {canDownload && (
            <button
              className="adm-button adm-button--small"
              type="button"
              disabled={!list.length}
              onClick={() => saveTable(`techfest-registrations-${filters.dept || 'all'}-${today()}.xlsx`, 'Registrations', filterNote(filters, session.displayName), exportRows(list, catalog))}
            >
              Download these (Excel)
            </button>
          )}
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table fest-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Name</th>
                <th scope="col">Phone</th>
                <th scope="col">College</th>
                <th scope="col">Events</th>
                <th scope="col">Registered</th>
                <th scope="col">Entry</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((item) => (
                <tr key={item.id} className={`fest-row-link${isActive(item) ? '' : ' is-inactive'}`} onClick={() => setOpen(item.id)}>
                  <th scope="row" className="adm-mono">
                    {showId(item.id)}
                  </th>
                  <td>
                    {item.name}
                    {item.team && <span className="adm-muted"> · {item.team}</span>}
                  </td>
                  <td>{item.phone}</td>
                  <td>{item.college}</td>
                  <td>{item.events.map((entry) => name(entry.eventId)).join(', ') || '—'}</td>
                  <td>
                    {sourceLabel[item.source]}
                    {item.desk ? ` · desk ${item.desk}` : ''}
                    {item.source === 'ONLINE' && (item.checkedIn ? ' · arrived' : ' · not arrived')}
                  </td>
                  <td>
                    {item.deleted ? <Badge tone="bad">Deleted</Badge> : item.cancelled ? <Badge tone="bad">Cancelled</Badge> : item.entry.status === 'DUE' ? <Badge tone="warn">Due</Badge> : <Badge tone="good">{item.entry.payment?.method === 'ONLINE' ? 'Online' : item.entry.payment?.method === 'UPI' ? 'UPI' : 'Cash'}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p className="adm-muted adm-empty">No registrations match these filters.</p>}
        </div>
        {pages > 1 && (
          <div className="adm-inline">
            <button className="adm-button adm-button--small" type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <span className="adm-muted">
              Page {current + 1} of {pages}
            </span>
            <button className="adm-button adm-button--small" type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
      {open && <RegistrationDetail id={open} onClose={() => setOpen(null)} />}
    </main>
  );
}

function RegistrationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { registrations, catalog, session, change } = useFest();
  const registration = registrations.get(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FestParticipant | null>(null);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState(false);
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  if (!registration || !catalog) return null;
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(session.role, permission);
  const path = `/api/admin/fest/registrations/${registration.id}` as const;
  const act = (action: string, extra: Record<string, unknown> = {}, label = action) => change(registration.id, path, { action, ...extra }, `${label} · ${registration.id}`);
  const form = draft ?? { name: registration.name, phone: registration.phone, email: registration.email, college: registration.college, branch: registration.branch, year: registration.year, team: registration.team };
  const problems = participantProblems(readParticipant(form));

  return (
    <div className="fest-drawer" role="dialog" aria-modal="true" aria-label={`Registration ${registration.id}`}>
      <div className="fest-drawer__panel">
        <header className="adm-toolbar">
          <h2 className="adm-h2">
            {showId(registration.id)} · {registration.name}
          </h2>
          <button className="adm-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <dl className="fest-facts">
          <dt>Department</dt>
          <dd>
            {deptShort(registration.dept)} · {deptName(catalog, registration.dept)}
          </dd>
          <dt>Phone · email</dt>
          <dd>
            {registration.phone}
            {registration.email && ` · ${registration.email}`}
          </dd>
          <dt>College</dt>
          <dd>{[registration.college, registration.branch, registration.year].filter(Boolean).join(' · ')}</dd>
          {registration.team && (
            <>
              <dt>Team</dt>
              <dd>{registration.team}</dd>
            </>
          )}
          <dt>Registered</dt>
          <dd>
            {sourceLabel[registration.source]}
            {registration.desk ? ` · desk ${registration.desk}` : ''} · {registration.created.by} {when(registration.created.at)}
            {registration.ref && ` · ref ${registration.ref}`}
          </dd>
          <dt>Entry fee</dt>
          <dd>
            {registration.entry.status === 'PAID' && registration.entry.payment
              ? `${rupees(registration.entry.payment.amount)} · ${registration.entry.payment.method}${registration.entry.payment.txn ? ` ${registration.entry.payment.txn}` : ''} · ${registration.entry.payment.by}`
              : 'Due'}
          </dd>
          {registration.source === 'ONLINE' && (
            <>
              <dt>Arrived</dt>
              <dd>{registration.checkedIn ? `${registration.checkedIn.by} ${when(registration.checkedIn.at)}` : 'Not yet'}</dd>
            </>
          )}
          {registration.cancelled && (
            <>
              <dt>Cancelled</dt>
              <dd>
                {registration.cancelled.reason} · {registration.cancelled.by} {when(registration.cancelled.at)}
              </dd>
            </>
          )}
          {registration.deleted && (
            <>
              <dt>Deleted</dt>
              <dd>
                {registration.deleted.reason} · {registration.deleted.by} {when(registration.deleted.at)}
              </dd>
            </>
          )}
        </dl>

        <h3 className="adm-h3">Events</h3>
        {registration.events.length === 0 && <p className="adm-muted">None.</p>}
        <ul className="fest-entries">
          {registration.events.map((entry) => {
            const event: FestEvent | null = eventOf(catalog, entry.eventId);
            return (
              <li key={entry.eventId}>
                <strong>{event ? eventLabel(event) : entry.eventId}</strong>{' '}
                <Badge tone={feePaid(entry) ? 'good' : 'warn'}>{feePaid(entry) ? `Fee ${entry.fee!.method} · ${entry.fee!.by}` : entry.fee?.voided ? `Fee cancelled: ${entry.fee.voided.reason}` : 'Fee due'}</Badge>{' '}
                <Badge tone={entry.present ? 'good' : 'plain'}>{entry.present ? 'Present' : 'Not present'}</Badge>
                {can('fest.correct') && feePaid(entry) && !entry.present && (
                  <button
                    className="adm-button adm-button--small adm-button--danger-outline"
                    type="button"
                    onClick={() => {
                      const why = window.prompt('Why is this fee cancelled? (e.g. recorded twice)');
                      if (why && why.trim().length >= 3) change(registration.id, `${path}/events/${entry.eventId}`, { action: 'void-fee', reason: why.trim() }, `Cancel fee · ${registration.id}`);
                    }}
                  >
                    Cancel this fee
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {can('fest.register') && isActive(registration) && registration.entry.status === 'DUE' && (
          <section>
            {paying ? (
              <>
                <PaymentChoice amount={catalog.entryFee} value={payment} onChange={setPayment} name="detail-entry" forId={registration.id} />
                <button
                  className="adm-button adm-button--primary"
                  type="button"
                  disabled={!paymentReady(payment)}
                  onClick={() => {
                    act('entry', { payment: paymentBody(payment) }, 'Entry fee');
                    setPaying(false);
                  }}
                >
                  Save the entry fee
                </button>
              </>
            ) : (
              <button className="adm-button adm-button--primary" type="button" onClick={() => setPaying(true)}>
                Collect the entry fee
              </button>
            )}
          </section>
        )}
        {can('fest.register') && isActive(registration) && registration.source === 'ONLINE' && !registration.checkedIn && registration.entry.status === 'PAID' && (
          <button
            className="adm-button adm-button--approve"
            type="button"
            onClick={() =>
              change(registration.id, path, { action: 'checkin' }, `Check in · ${registration.id}`, (current) => ({ ...current, checkedIn: stampNow(session.username) }))
            }
          >
            Mark arrived
          </button>
        )}

        {can('fest.edit') && isActive(registration) && (
          <section>
            {editing ? (
              <div className="fest-form">
                {(['name', 'phone', 'email', 'college', 'branch', 'year', 'team'] as const).map((field) => (
                  <label key={field} className="adm-field">
                    <span>{field[0].toUpperCase() + field.slice(1)}</span>
                    <input value={form[field]} onChange={(event) => setDraft({ ...form, [field]: event.target.value })} />
                    {problems[field] && <span className="adm-field__error">{problems[field]}</span>}
                  </label>
                ))}
                <div className="adm-inline">
                  <button
                    className="adm-button adm-button--primary"
                    type="button"
                    disabled={Object.keys(problems).length > 0}
                    onClick={() => {
                      act('edit', { participant: readParticipant(form) }, 'Correct details');
                      setEditing(false);
                      setDraft(null);
                    }}
                  >
                    Save details
                  </button>
                  <button className="adm-button" type="button" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="adm-button" type="button" onClick={() => setEditing(true)}>
                Correct details
              </button>
            )}
          </section>
        )}

        {(can('fest.cancel') || can('fest.delete')) && (
          <section className="fest-danger">
            <label className="adm-field">
              <span>Reason (for cancelling or deleting)</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="adm-inline adm-inline--wrap">
              {can('fest.cancel') && !registration.deleted && (registration.cancelled ? (
                <button className="adm-button" type="button" onClick={() => act('uncancel', {}, 'Undo cancel')}>
                  Undo the cancellation
                </button>
              ) : (
                <button className="adm-button adm-button--danger-outline" type="button" disabled={reason.trim().length < 3} onClick={() => act('cancel', { reason: reason.trim() }, 'Cancel')}>
                  Cancel registration
                </button>
              ))}
              {can('fest.delete') && (registration.deleted ? (
                <button className="adm-button" type="button" onClick={() => act('restore', {}, 'Restore')}>
                  Restore
                </button>
              ) : (
                <button className="adm-button adm-button--danger-outline" type="button" disabled={reason.trim().length < 3} onClick={() => act('delete', { reason: reason.trim() }, 'Delete')}>
                  Delete
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ Colleges

const COLLEGE_COLUMNS: { key: keyof CollegeRow; label: string }[] = [
  { key: 'name', label: 'College' },
  { key: 'students', label: 'Students' },
  { key: 'first', label: '1st' },
  { key: 'second', label: '2nd' },
  { key: 'third', label: '3rd' },
  { key: 'places', label: 'Places won' },
];

/** College-wise: how many students each college sent, and how many 1st, 2nd and 3rd places they won. */
export function FestColleges() {
  const { catalog, results, filters, setFilters, session } = useFest();
  const { list, viewAll, canDownload } = useFiltered();
  const [sort, setSort] = useState<{ key: keyof CollegeRow; down: boolean }>({ key: 'places', down: true });
  const rows = useMemo(() => {
    // Places count for the events the filters show (all events when none is chosen).
    const shown = catalog ? new Set(catalog.events.filter((event) => (!filters.dept || event.dept === filters.dept) && (!filters.eventId || event.id === filters.eventId)).map((event) => event.id)) : new Set<string>();
    const summary = collegeSummary(list, [...results.values()].filter((result) => shown.has(result.eventId)));
    const { key, down } = sort;
    return [...summary].sort((a, b) => {
      const order = typeof a[key] === 'number' ? (a[key] as number) - (b[key] as number) : String(a[key]).localeCompare(String(b[key]));
      return (down ? -order : order) || a.name.localeCompare(b.name);
    });
  }, [catalog, list, results, filters, sort]);
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  const totals = rows.reduce((sum, row) => ({ students: sum.students + row.students, first: sum.first + row.first, second: sum.second + row.second, third: sum.third + row.third }), { students: 0, first: 0, second: 0, third: 0 });
  const download = () => {
    const table: (string | number)[][] = [['College', 'Students', '1st places', '2nd places', '3rd places', 'Places won'], ...rows.map((row) => [row.name, row.students, row.first, row.second, row.third, row.places])];
    saveTable(`techfest-colleges-${filters.dept || 'all'}-${today()}.xlsx`, 'Colleges', filterNote(filters, session.displayName), table);
  };
  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} />
        <div className="fest-stats">
          <Stat label="Colleges" value={rows.length} />
          <Stat label="Students" value={totals.students} />
          <Stat label="1st places" value={totals.first} />
          <Stat label="2nd places" value={totals.second} />
          <Stat label="3rd places" value={totals.third} />
        </div>
      </section>
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h3 className="adm-h3">By college</h3>
          {canDownload && (
            <button className="adm-button adm-button--small" type="button" disabled={!rows.length} onClick={download}>
              Download (Excel)
            </button>
          )}
        </div>
        <p className="adm-muted">Places from submitted results only; a team counts once for its college. Tap a heading to sort, a college to see its students.</p>
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static fest-table">
            <thead>
              <tr>
                {COLLEGE_COLUMNS.map((column) => (
                  <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.down ? 'descending' : 'ascending') : undefined}>
                    <button className="fest-sort" type="button" onClick={() => setSort((current) => ({ key: column.key, down: current.key === column.key ? !current.down : column.key !== 'name' }))}>
                      {column.label}
                      {sort.key === column.key ? (sort.down ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="fest-row-link" onClick={() => setFilters({ ...filters, college: row.key })}>
                  <th scope="row">{row.name}</th>
                  <td>{row.students}</td>
                  <td>{row.first}</td>
                  <td>{row.second}</td>
                  <td>{row.third}</td>
                  <td>{row.places}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="adm-muted">No students match these filters.</p>}
      </section>
    </main>
  );
}

// ------------------------------------------------------------------------------------------ Results

export function FestResults() {
  const { catalog, results, registrations, filters, session, change } = useFest();
  const { viewAll, canDownload } = useFiltered();
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  const events = catalog.events.filter((event) => (!filters.dept || event.dept === filters.dept) && (!filters.eventId || event.id === filters.eventId) && (!filters.venue || event.venue === filters.venue));
  const submitted = events.filter((event) => results.get(event.id)?.submitted);
  const person = (id: string) => registrations.get(id);
  const canReopen = hasPermission(session.role, 'fest.correct');

  const download = () => {
    const rows: (string | number)[][] = [['Department', 'Event', 'Venue', 'Place', 'Team', 'Registration ID', 'Name', 'College', 'Phone', 'Email', 'Submitted by', 'Submitted at']];
    for (const event of events) {
      const result = results.get(event.id);
      if (!result?.submitted) continue;
      for (const place of result.places) {
        for (const id of place.ids) {
          const who = person(id);
          rows.push([deptShort(event.dept), eventLabel(event), event.venue, ordinal(place.place), place.team ?? '', showId(id), who?.name ?? '', who?.college ?? '', who?.phone ?? '', who?.email ?? '', result.submitted.by, when(result.submitted.at)]);
        }
      }
    }
    saveTable(`techfest-winners-${filters.dept || 'all'}-${today()}.xlsx`, 'Winners', filterNote(filters, session.displayName), rows);
  };

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} />
        <div className="adm-toolbar">
          <strong>
            {submitted.length} of {events.length} events submitted
          </strong>
          {canDownload && (
            <button className="adm-button adm-button--small" type="button" disabled={!submitted.length} onClick={download}>
              Download winners (Excel)
            </button>
          )}
        </div>
      </section>
      <ShortList
        items={events}
        empty="No events match these filters."
        render={(event) => {
          const result = results.get(event.id);
          const part = totalsOf([...registrations.values()].filter((item) => canJoin(item, event)), event.id);
          return (
            <section key={event.id} className="adm-card adm-pad fest-result">
              <header className="adm-toolbar">
                <h3 className="adm-h3">
                  {viewAll && <span className="adm-muted">{deptShort(event.dept)} · </span>}
                  {eventLabel(event)}
                </h3>
                {result?.submitted ? <Badge tone="good">Submitted {when(result.submitted.at)}</Badge> : result?.places.length ? <Badge tone="warn">Saved, not submitted</Badge> : <Badge tone="plain">No winners yet</Badge>}
              </header>
              <p className="adm-muted">
                {[event.venue, event.time].filter(Boolean).join(' · ')} · {part.registered} registered · {part.present} present
              </p>
              {result && result.places.length > 0 && (
                <ol className="fest-winners">
                  {result.places.map((place) => (
                    <li key={place.place}>
                      <strong>{ordinal(place.place)}</strong> {place.team && <>Team {place.team} · </>}
                      {place.ids.map((id) => `${person(id)?.name ?? showId(id)} (${showId(id)}, ${person(id)?.college ?? ''})`).join('; ')}
                    </li>
                  ))}
                </ol>
              )}
              {result?.submitted && <p className="adm-muted">Submitted by {result.submitted.by}.</p>}
              {canReopen && result?.submitted && (
                <button
                  className="adm-button adm-button--small"
                  type="button"
                  onClick={() => {
                    const why = window.prompt(`Why reopen the results of ${event.name}?`);
                    if (why && why.trim().length >= 3) change(`results:${event.id}`, `/api/admin/fest/events/${event.id}/results`, { action: 'reopen', reason: why.trim() }, `Reopen ${event.name} results`);
                  }}
                >
                  Reopen
                </button>
              )}
              {result?.reopened?.map((item) => (
                <p key={item.at} className="adm-muted">
                  Reopened by {item.by} {when(item.at)}: {item.reason}
                </p>
              ))}
            </section>
          );
        }}
      />
    </main>
  );
}
