/**
 * The live views (overall coordinator and web assist team: every department; department HOD
 * and admin: their own). Each screen shows only the filters it needs.
 *
 * - Overview: headline numbers, money and results by department, and what each of the two desks took
 * - Students: the list (department, payment, college, event, search, show cancelled), each with its
 *   details and the corrections a role may make
 * - Results: every event's winners as submitted (reopened only by the overall coordinator), or the
 *   college ranking (medal table) filtered by participations and prizes
 */
import { useMemo, useState } from 'react';
import { DESKS, awaitingCheck, collegeSummary, deskMoney, deptShort, eventLabel, eventOf, feePaid, isActive, medalOrder, participantProblems, readParticipant, rupees, showId, teamsText, totalsOf, type CollegeRow, type FestEvent, type FestParticipant, type FestRegistration } from '../../lib/fest';
import { hasPermission } from '../../lib/staff';
import { Badge, messageOf, when } from '../ui';
import { filterNote, saveTable, today } from './excel';
import { certificateRows, exportRows, howRegistered, rankingRows, winnerRows } from './exports';
import { WinnerTable } from './EventWindow';
import { NO_FILTERS, useFest, type FestFilters } from './FestData';
import { FilterBar, NO_PAYMENT, PaymentChoice, ShortList, Stat, applyFilters, deptName, handOverGap, latestHandOvers, paymentBody, paymentReady, stampNow, useHandOvers, type PaymentDraft } from './festUi';


/** The detail drawer's labels for each field a correction may change. */
const FIELD_LABEL: Record<keyof FestParticipant, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  college: 'College',
  collegeCode: 'College code',
  branch: 'Department / course',
  year: 'Year',
  team: 'Team (typed when registering)',
};

function useFiltered() {
  const { registrations, filters, catalog, session, switches } = useFest();
  const viewAll = hasPermission(session.role, 'fest.viewAll');
  const list = useMemo(() => applyFilters(registrations.values(), filters, catalog), [registrations, filters, catalog]);
  // Website controls can hide the downloads (the web assist team keeps them).
  const canDownload = switches.downloads || session.role === 'ADMIN';
  return { list, viewAll, canDownload };
}

// ------------------------------------------------------------------------------------------ Overview

/** One department's events: how many joined, paid and came, and whether the results are in. */
function EventProgress({ dept }: { dept: string }) {
  const { catalog, registrations, results } = useFest();
  if (!catalog) return null;
  const all = [...registrations.values()];
  return (
    <section className="adm-card adm-pad">
      <h3 className="adm-h3">{deptName(catalog, dept)}: events</h3>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table--static fest-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Registered</th>
              <th scope="col">Fee paid</th>
              <th scope="col">Present</th>
              <th scope="col">Results</th>
            </tr>
          </thead>
          <tbody>
            {catalog.events
              .filter((event) => event.dept === dept)
              .map((event) => {
                const part = totalsOf(all, event.id);
                const result = results.get(event.id);
                return (
                  <tr key={event.id}>
                    <th scope="row">
                      {eventLabel(event)}
                      {!event.active && <Badge tone="plain">Closed</Badge>}
                    </th>
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
  );
}

/** The live numbers: how many came, what was collected, how far the events are, what each desk took. */
export function FestOverview() {
  const { catalog, registrations, filters, results, setFilters } = useFest();
  const { viewAll } = useFiltered();
  const all = useMemo(() => [...registrations.values()], [registrations]);
  const handOvers = useHandOvers();
  const latest = latestHandOvers(handOvers.list);
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  // Only the department narrows the overview (the Students list's filters do not).
  const inScope = (dept: string) => applyFilters(all, { ...NO_FILTERS, dept }, catalog);
  const totals = totalsOf(inScope(filters.dept));
  const depts = catalog.departments.filter((dept) => !filters.dept || dept.code === filters.dept);
  const paid = totals.registered - totals.entryDue;
  const notPaid = totals.entryDue - totals.awaiting;
  const entryFees = totals.entryCash + totals.entryUpi + totals.entryOnline;
  const eventFees = totals.feeCash + totals.feeUpi;
  const activeEvents = catalog.events.filter((event) => event.active && (!filters.dept || event.dept === filters.dept));
  const submitted = activeEvents.filter((event) => results.get(event.id)?.submitted).length;

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} />
        <div className="fest-stats">
          <Stat label="Students registered" value={totals.registered} sub={`${totals.checkedIn} on campus`} />
          <Stat label="Paid" value={paid} />
          <Stat label="Payment to check" value={totals.awaiting} sub="Sent a transaction ID; a desk verifies it" />
          <Stat label="Not paid yet" value={notPaid} />
          <Stat label="Total collected" value={rupees(entryFees + eventFees)} sub={`Entry ${rupees(entryFees)} · events ${rupees(eventFees)}`} />
          <Stat label="Results submitted" value={`${submitted} of ${activeEvents.length}`} sub={`${totals.present} present at events`} />
        </div>
      </section>

      {depts.length > 1 ? (
        <section className="adm-card adm-pad">
          <h3 className="adm-h3">By department</h3>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static fest-table">
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Students</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Entry fees (cash · UPI)</th>
                  <th scope="col">Event fees</th>
                  <th scope="col">Total collected</th>
                  <th scope="col">Results</th>
                  <th scope="col">Present</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((dept) => {
                  const part = totalsOf(inScope(dept.code));
                  const deptEvents = catalog.events.filter((event) => event.dept === dept.code && event.active);
                  const done = deptEvents.filter((event) => results.get(event.id)?.submitted).length;
                  const entry = part.entryCash + part.entryUpi + part.entryOnline;
                  const events = part.feeCash + part.feeUpi;
                  return (
                    <tr key={dept.code} className={viewAll ? 'fest-row-link' : undefined} onClick={viewAll ? () => setFilters({ ...filters, dept: dept.code }) : undefined}>
                      <th scope="row">
                        {deptShort(dept.code)} <span className="adm-muted">{dept.name}</span>
                      </th>
                      <td>{part.registered}</td>
                      <td>{part.registered - part.entryDue}</td>
                      <td>
                        {rupees(entry)}{' '}
                        <span className="adm-muted">
                          ({rupees(part.entryCash)} · {rupees(part.entryUpi)})
                        </span>
                      </td>
                      <td>{rupees(events)}</td>
                      <td>
                        <strong>{rupees(entry + events)}</strong>
                      </td>
                      <td>
                        {done}/{deptEvents.length}
                      </td>
                      <td>{part.present}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {viewAll && <p className="adm-muted">Tap a department to see it alone.</p>}
        </section>
      ) : (
        depts[0] && <EventProgress dept={depts[0].code} />
      )}

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Desk totals</h3>
        <p className="adm-muted">Entry fees each desk took, and the cash each desk counted when it handed over (with any difference from the system’s figure then).</p>
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static fest-table">
            <thead>
              <tr>
                <th scope="col">Desk</th>
                <th scope="col">Fees taken</th>
                <th scope="col">Cash</th>
                <th scope="col">UPI</th>
                <th scope="col">Total</th>
                <th scope="col">Last hand-over</th>
              </tr>
            </thead>
            <tbody>
              {depts.flatMap((dept) =>
                // The department's desks, then what was taken away from them (a department admin or the web assist team), if anything.
                [...Array.from({ length: DESKS }, (_, index): number | null => index + 1), null].map((desk) => {
                  const { count, cash, upi } = deskMoney(all, dept.code, desk);
                  if (desk === null && !count) return null;
                  const last = desk === null ? undefined : latest.get(`${dept.code}-${desk}`);
                  return (
                    <tr key={`${dept.code}-${desk ?? 'other'}`}>
                      <th scope="row">
                        {deptShort(dept.code)} · {desk === null ? 'Not at a desk' : `Desk ${desk}`}
                      </th>
                      <td>{count}</td>
                      <td>{rupees(cash)}</td>
                      <td>{rupees(upi)}</td>
                      <td>
                        <strong>{rupees(cash + upi)}</strong>
                      </td>
                      <td>
                        {last ? (
                          <>
                            {rupees(last.counted)} <Badge tone={last.counted === last.system ? 'good' : 'bad'}>{handOverGap(last)}</Badge>
                            <span className="adm-muted"> · {when(last.at)}</span>
                          </>
                        ) : (
                          <span className="adm-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// ------------------------------------------------------------------------------------------ Registrations

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
        <FilterBar showDept={viewAll} fields={['payment', 'college', 'event', 'search', 'cancelled']} />
        <div className="adm-toolbar">
          <strong>
            {list.length} student{list.length === 1 ? '' : 's'}
          </strong>
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
                <th scope="col">Payment</th>
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
                    {teamsText(item, name) && <span className="adm-muted"> · {teamsText(item, name)}</span>}
                  </td>
                  <td>{item.phone}</td>
                  <td>
                    {item.college}
                    {item.collegeCode && <span className="adm-muted"> · {item.collegeCode}</span>}
                  </td>
                  <td>{item.events.map((entry) => name(entry.eventId)).join(', ') || '—'}</td>
                  <td>
                    {item.deleted ? (
                      <Badge tone="bad">Deleted</Badge>
                    ) : item.cancelled ? (
                      <Badge tone="bad">Cancelled</Badge>
                    ) : item.entry.status === 'PAID' ? (
                      <Badge tone="good">Paid · {item.entry.payment?.method === 'ONLINE' ? 'online' : item.entry.payment?.method === 'UPI' ? 'UPI' : 'cash'}</Badge>
                    ) : awaitingCheck(item) ? (
                      <Badge tone="warn">To check</Badge>
                    ) : (
                      <Badge tone="plain">Not paid</Badge>
                    )}
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

/** The entry fee as it stands: paid (how, when, by whom), sent and waiting for the desk, or not paid. */
function EntryStatus({ registration }: { registration: FestRegistration }) {
  const { entry } = registration;
  if (entry.status === 'PAID' && entry.payment) {
    const payment = entry.payment;
    const how = payment.method === 'CASH' ? 'cash' : payment.method === 'UPI' ? `UPI · UTR ${payment.txn ?? ''}` : `with the online form${payment.txn ? ` · UTR ${payment.txn}` : ''}`;
    return (
      <>
        <Badge tone="good">{payment.method === 'ONLINE' ? 'Paid online' : 'Paid and verified'}</Badge> {rupees(payment.amount)} · {how} · {payment.by}
        {payment.desk ? ` (desk ${payment.desk})` : ''} · {when(payment.at)}
      </>
    );
  }
  if (entry.claim && entry.rejected)
    return (
      <>
        <Badge tone="bad">Payment not found</Badge> UTR ending {entry.claim.txn.slice(-4)}: {entry.rejected.reason} ({entry.rejected.by})
      </>
    );
  if (entry.claim)
    return (
      <>
        <Badge tone="warn">Sent, not verified yet</Badge> {rupees(entry.claim.amount)} · UTR ending {entry.claim.txn.slice(-4)} · {when(entry.claim.at)}: waiting for the {deptShort(registration.dept)} desk
      </>
    );
  return <Badge tone="plain">Not paid</Badge>;
}

function RegistrationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { registrations, catalog, session, change, send } = useFest();
  const registration = registrations.get(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FestParticipant | null>(null);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState(false);
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  const [moneyBusy, setMoneyBusy] = useState(false);
  const [moneyError, setMoneyError] = useState('');
  if (!registration || !catalog) return null;
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(session.role, permission);
  const path = `/api/admin/fest/registrations/${registration.id}` as const;
  const act = (action: string, extra: Record<string, unknown> = {}, label = action) => change(registration.id, path, { action, ...extra }, `${label} · ${registration.id}`);
  const form: FestParticipant = draft ?? {
    name: registration.name,
    phone: registration.phone,
    email: registration.email,
    college: registration.college,
    collegeCode: registration.collegeCode ?? '',
    branch: registration.branch,
    year: registration.year,
    team: registration.team,
  };
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
          <dd>{[registration.college, registration.collegeCode && `code ${registration.collegeCode}`, registration.branch, registration.year].filter(Boolean).join(' · ')}</dd>
          {registration.team && (
            <>
              <dt>Team typed when registering</dt>
              <dd>{registration.team}</dd>
            </>
          )}
          <dt>Registered</dt>
          <dd>
            {howRegistered(registration)}
            {registration.desk ? ` · desk ${registration.desk}` : ''} · {registration.created.by} {when(registration.created.at)}
            {registration.ref && ` · ref ${registration.ref}`}
          </dd>
          <dt>Entry fee</dt>
          <dd>
            <EntryStatus registration={registration} />
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
                {entry.team && (
                  <>
                    {' '}
                    <Badge tone="plain">Team {entry.team}</Badge>
                  </>
                )}
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
            {awaitingCheck(registration) ? (
              <p className="adm-note">They sent a UPI transaction ID: verify it on the Desk screen, which checks it against the payment.</p>
            ) : paying ? (
              <>
                <PaymentChoice amount={catalog.entryFee} value={payment} onChange={setPayment} name="detail-entry" forId={registration.id} />
                <button
                  className="adm-button adm-button--primary"
                  type="button"
                  disabled={!paymentReady(payment) || moneyBusy}
                  onClick={async () => {
                    setMoneyBusy(true);
                    setMoneyError('');
                    try {
                      await send(path, { action: 'entry', payment: paymentBody(payment) });
                      setPaying(false);
                      setPayment(NO_PAYMENT);
                    } catch (failure) {
                      setMoneyError(`${messageOf(failure)} Nothing was saved.`);
                    } finally {
                      setMoneyBusy(false);
                    }
                  }}
                >
                  {moneyBusy ? 'Saving…' : 'Save the entry fee'}
                </button>
                {moneyError && (
                  <p className="adm-error" role="alert">
                    {moneyError}
                  </p>
                )}
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
                {(['name', 'phone', 'email', 'college', 'collegeCode', 'branch', 'year', 'team'] as const).map((field) => (
                  <label key={field} className="adm-field">
                    <span>{FIELD_LABEL[field]}</span>
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
  { key: 'code', label: 'Code' },
  { key: 'students', label: 'Students' },
  { key: 'participations', label: 'Event participations' },
  { key: 'first', label: '1st' },
  { key: 'second', label: '2nd' },
  { key: 'third', label: '3rd' },
  { key: 'places', label: 'Total prizes' },
];

/** The default order: the medal table (1st, 2nd, 3rd, then participations, then students). */
const MEDALS = 'medals' as const;

/**
 * The college ranking: each college's students, their event participations (attended) and the
 * prizes they won, in medal-table order, filtered by college, participations and prizes; downloaded
 * as Excel in the order shown.
 */
export function FestColleges() {
  const { catalog, results, filters, setFilters, session } = useFest();
  const { viewAll, canDownload } = useFiltered();
  const { registrations } = useFest();
  const scope = useMemo<FestFilters>(() => ({ ...NO_FILTERS, dept: filters.dept, college: filters.college }), [filters.dept, filters.college]);
  const list = useMemo(() => applyFilters(registrations.values(), scope, catalog), [registrations, scope, catalog]);
  const [sort, setSort] = useState<{ key: keyof CollegeRow | typeof MEDALS; down: boolean }>({ key: MEDALS, down: true });
  const [minEvents, setMinEvents] = useState(0);
  const [minPrizes, setMinPrizes] = useState(0);
  const rows = useMemo(() => {
    // Places count for the events the filters show (all events when none is chosen).
    const shown = catalog ? new Set(catalog.events.filter((event) => !filters.dept || event.dept === filters.dept).map((event) => event.id)) : new Set<string>();
    const summary = collegeSummary(list, [...results.values()].filter((result) => shown.has(result.eventId))).filter((row) => row.participations >= minEvents && row.places >= minPrizes);
    const { key, down } = sort;
    if (key === MEDALS) return summary.sort(medalOrder);
    return [...summary].sort((a, b) => {
      const order = typeof a[key] === 'number' ? (a[key] as number) - (b[key] as number) : String(a[key]).localeCompare(String(b[key]));
      return (down ? -order : order) || medalOrder(a, b);
    });
  }, [catalog, list, results, filters, sort, minEvents, minPrizes]);
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  const totals = rows.reduce(
    (sum, row) => ({ students: sum.students + row.students, participations: sum.participations + row.participations, first: sum.first + row.first, second: sum.second + row.second, third: sum.third + row.third }),
    { students: 0, participations: 0, first: 0, second: 0, third: 0 },
  );
  const limits = [minEvents && `at least ${minEvents} participations`, minPrizes && `at least ${minPrizes} prizes`].filter(Boolean).join(' · ');
  const download = () => saveTable(`techfest-college-ranking-${filters.dept || 'all'}-${today()}.xlsx`, 'College ranking', `${filterNote(scope, session.displayName)}${limits ? ` · ${limits}` : ''}`, rankingRows(rows));
  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} fields={['college']} />
        <div className="fest-filters" role="group" aria-label="Ranking filters">
          <label className="adm-field">
            <span>Event participations (at least)</span>
            <input type="number" min={0} inputMode="numeric" value={minEvents} onChange={(event) => setMinEvents(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label className="adm-field">
            <span>Prizes won (at least)</span>
            <input type="number" min={0} inputMode="numeric" value={minPrizes} onChange={(event) => setMinPrizes(Math.max(0, Number(event.target.value) || 0))} />
          </label>
        </div>
        <div className="fest-stats">
          <Stat label="Colleges" value={rows.length} />
          <Stat label="Students" value={totals.students} />
          <Stat label="Event participations" value={totals.participations} />
          <Stat label="1st places" value={totals.first} />
          <Stat label="2nd places" value={totals.second} />
          <Stat label="3rd places" value={totals.third} />
        </div>
      </section>
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h3 className="adm-h3">College ranking</h3>
          <span className="adm-inline">
            {sort.key !== MEDALS && (
              <button className="adm-button adm-button--small" type="button" onClick={() => setSort({ key: MEDALS, down: true })}>
                Back to the medal order
              </button>
            )}
            {canDownload && (
              <button className="adm-button adm-button--small" type="button" disabled={!rows.length} onClick={download}>
                Download (Excel)
              </button>
            )}
          </span>
        </div>
        <p className="adm-muted">
          Medal order: most 1st prizes first, then 2nd, then 3rd, then event participations, then students. Participations are the events its students attended; prizes come from submitted
          results (a team counts once for its college). Tap a heading to sort by it, a college to see its students.
        </p>
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static fest-table">
            <thead>
              <tr>
                <th scope="col">#</th>
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
              {rows.map((row, index) => (
                <tr key={row.key} className="fest-row-link" onClick={() => setFilters({ ...filters, college: row.key })}>
                  <td>{index + 1}</td>
                  <th scope="row">{row.name}</th>
                  <td>{row.code}</td>
                  <td>{row.students}</td>
                  <td>{row.participations}</td>
                  <td>{row.first}</td>
                  <td>{row.second}</td>
                  <td>{row.third}</td>
                  <td>{row.places}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="adm-muted">No college matches these filters.</p>}
      </section>
    </main>
  );
}

// ------------------------------------------------------------------------------------------ Results

/** Results: every event's winners, or the college ranking built from them. */
export function FestResults() {
  const [view, setView] = useState<'winners' | 'ranking'>('winners');
  return (
    <>
      <div className="adm-page fest-subnav">
        <div className="fest-chips" role="group" aria-label="Results">
          <button type="button" className={`fest-chip-button${view === 'winners' ? ' is-on' : ''}`} aria-pressed={view === 'winners'} onClick={() => setView('winners')}>
            Event winners
          </button>
          <button type="button" className={`fest-chip-button${view === 'ranking' ? ' is-on' : ''}`} aria-pressed={view === 'ranking'} onClick={() => setView('ranking')}>
            College ranking
          </button>
        </div>
      </div>
      {view === 'winners' ? <EventWinners /> : <FestColleges />}
    </>
  );
}

function EventWinners() {
  const { catalog, results, registrations, filters, session, change } = useFest();
  const { viewAll, canDownload } = useFiltered();
  if (!catalog) return <p className="adm-loading">Loading the live data…</p>;
  const events = catalog.events.filter((event) => (!filters.dept || event.dept === filters.dept) && (!filters.eventId || event.id === filters.eventId) && (!filters.venue || event.venue === filters.venue));
  const submitted = events.filter((event) => event.active && results.get(event.id)?.submitted);
  const open = events.filter((event) => event.active);
  const canReopen = hasPermission(session.role, 'fest.correct');

  const download = () => saveTable(`techfest-winners-${filters.dept || 'all'}-${today()}.xlsx`, 'Winners', filterNote(filters, session.displayName), winnerRows(catalog, events, results, registrations));
  const certificates = () => saveTable(`techfest-certificates-${filters.dept || 'all'}-${today()}.xlsx`, 'Certificates', filterNote(filters, session.displayName), certificateRows(catalog, events, results, registrations));

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <FilterBar showDept={viewAll} fields={['event']} />
        <div className="adm-toolbar">
          <strong>
            {submitted.length} of {open.length} events submitted
          </strong>
          {canDownload && (
            <span className="adm-inline adm-inline--wrap">
              <button className="adm-button adm-button--small" type="button" disabled={!submitted.length} onClick={download}>
                Download winners (Excel)
              </button>
              <button className="adm-button adm-button--small" type="button" onClick={certificates}>
                Certificate list (Excel)
              </button>
            </span>
          )}
        </div>
      </section>
      <ShortList
        items={events}
        empty="No events match these filters."
        render={(event) => {
          const result = results.get(event.id);
          const part = totalsOf(registrations.values(), event.id);
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
                {[event.venue, event.time, `${part.registered} registered`, `${part.present} present`].filter(Boolean).join(' · ')}
              </p>
              {result && result.places.length > 0 && <WinnerTable places={result.places} byId={registrations} />}
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
