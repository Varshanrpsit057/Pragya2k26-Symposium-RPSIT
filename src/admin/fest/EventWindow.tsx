/**
 * An event's window (event coordinators; department admins and the web assist team for any
 * event): the department's students (only they take part in its events), opened one at a time to
 * check them, added to the event, the fee, attendance, and the winners, submitted to the overall
 * coordinator. Its participants and the department download as Excel.
 */
import { useMemo, useState } from 'react';
import { formatIst } from '../../lib/countdown';
import { canJoin, deptShort, entryOf, eventLabel, eventOf, eventsOf, feePaid, isActive, parseIdList, rupees, showId, teamRule, totalsOf, type FestEvent, type FestRegistration } from '../../lib/fest';
import { Badge, when } from '../ui';
import { DeptPicker, useWorkDept } from './DeskView';
import { PORTAL, today } from './excel';
import { downloadStudents } from './exports';
import { useFest } from './FestData';
import { NO_PAYMENT, PaymentChoice, RegistrationCard, ShortList, Stat, matches, paymentBody, paymentReady, stampNow, type PaymentDraft } from './festUi';

/** The event an address names ('/landing/cse/admin/?event=cse-hackathon'), or ''. */
export const linkedEvent = () => new URLSearchParams(window.location.search).get('event')?.trim().toLowerCase() ?? '';

export function EventWindow() {
  const { catalog, session } = useFest();
  const [dept, setDept, canPick] = useWorkDept();
  const mine = session.role === 'COORDINATOR';
  const choices = useMemo(() => {
    if (!catalog) return [];
    if (mine) return catalog.events.filter((event) => session.eventIds.includes(event.id));
    return dept ? eventsOf(catalog, dept, { all: true }) : [];
  }, [catalog, mine, session.eventIds, dept]);
  const [chosen, setChosen] = useState(linkedEvent);
  const event = choices.find((item) => item.id === chosen) ?? choices[0] ?? null;

  if (!catalog) return <p className="adm-loading">Loading…</p>;
  return (
    <main className="adm-page fest-event">
      <div className="adm-inline adm-inline--wrap">
        {canPick && <DeptPicker value={dept} onChange={setDept} />}
        {choices.length > 1 && (
          <label className="adm-field">
            <span>Event</span>
            <select value={event?.id ?? ''} onChange={(change) => setChosen(change.target.value)}>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {eventLabel(item)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!event ? <p className="adm-note">{mine ? 'No events are assigned to your account yet. Ask the web assist team.' : 'Choose the department.'}</p> : <EventPanel key={event.id} event={event} />}
    </main>
  );
}

function EventPanel({ event }: { event: FestEvent }) {
  const { registrations, results, session, change, switches, catalog } = useFest();
  // Every student of the department: they join the event here, at its venue.
  const [scope, setScope] = useState<'event' | 'dept'>('dept');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  const result = results.get(event.id) ?? null;
  // Website controls can switch event entry off (the web assist team can still fix things).
  const entryOff = !switches.eventEntry && session.role !== 'ADMIN';
  const locked = Boolean(result?.submitted) || entryOff;
  const canDownload = switches.downloads || session.role === 'ADMIN';
  // The event's department's students: only they take part in its events.
  const inDept = useMemo(() => [...registrations.values()].filter((item) => canJoin(item, event) && isActive(item)).sort((a, b) => a.id.localeCompare(b.id)), [registrations, event]);
  const registered = useMemo(() => inDept.filter((item) => entryOf(item, event.id)), [inDept, event.id]);
  const totals = totalsOf(registered, event.id);
  const q = query.trim();
  const list = (scope === 'event' ? registered : inDept).filter((item) => matches(item, q));
  const path = (id: string) => `/api/admin/fest/registrations/${id}/events/${event.id}` as const;
  const patchEntry = (registration: FestRegistration, next: Record<string, unknown>) => ({
    ...registration,
    events: registration.events.map((item) => (item.eventId === event.id ? { ...item, ...next } : item)),
  });

  const takeFee = (registration: FestRegistration) => {
    const stamp = stampNow(session.username);
    change(registration.id, path(registration.id), { action: 'fee', payment: paymentBody(payment) }, `${event.name} fee · ${registration.id}`, (current) =>
      patchEntry(current, { fee: { method: payment.method === 'UPI' ? 'UPI' : 'CASH', amount: event.fee, ...stamp } }),
    );
    setPaying(null);
    setPayment(NO_PAYMENT);
  };
  const markPresent = (registration: FestRegistration, present: boolean) =>
    change(registration.id, path(registration.id), { action: present ? 'present' : 'absent' }, `${present ? 'Present' : 'Not present'} · ${registration.id}`, (current) =>
      patchEntry(current, { present: present ? stampNow(session.username) : undefined }),
    );
  const addToEvent = (registration: FestRegistration) =>
    change(registration.id, path(registration.id), { action: 'add' }, `Add ${registration.id} to ${event.name}`, (current) => ({
      ...current,
      events: [...current.events, { eventId: event.id, added: stampNow(session.username) }],
    }));
  const note = (what: string) => `${PORTAL} · ${eventLabel(event)} · ${what} · downloaded by ${session.displayName} ${formatIst(Date.now())}`;

  return (
    <>
      <section className="adm-card adm-pad">
        <h2 className="adm-h2">{eventLabel(event)}</h2>
        <p className="adm-muted">{[event.venue && `Venue: ${event.venue}`, event.time, teamRule(event), event.fee ? `Fee ${rupees(event.fee)}` : 'No fee'].filter(Boolean).join(' · ')}</p>
        <div className="fest-stats">
          <Stat label="Registered" value={totals.registered} />
          <Stat label="Fee paid" value={totals.feesPaid} sub={`${rupees(totals.feeCash)} cash · ${rupees(totals.feeUpi)} UPI`} />
          <Stat label="Present" value={totals.present} />
        </div>
        {canDownload && catalog && (
          <span className="adm-inline adm-inline--wrap">
            <button className="adm-button adm-button--small" type="button" disabled={!registered.length} onClick={() => downloadStudents(`techfest-${event.id}-${today()}.xlsx`, event.name, note('its participants'), registered, catalog)}>
              Download this event (Excel)
            </button>
            <button
              className="adm-button adm-button--small"
              type="button"
              disabled={!inDept.length}
              onClick={() => downloadStudents(`techfest-${event.dept.toLowerCase()}-students-${today()}.xlsx`, `${deptShort(event.dept)} students`, note(`every ${deptShort(event.dept)} student`), inDept, catalog)}
            >
              Download all {deptShort(event.dept)} students (Excel)
            </button>
          </span>
        )}
        {result?.submitted && (
          <p className="adm-note">
            Results submitted by {result.submitted.by} {when(result.submitted.at)}. The event is closed: ask the overall coordinator if something must change.
          </p>
        )}
        {entryOff && <p className="adm-note">Event entry is switched off by the web assist team: this window is read-only for now.</p>}
      </section>

      <section className="adm-card adm-pad">
        <label className="adm-field fest-find">
          <span>Find a student</span>
          <input type="search" value={query} placeholder={`Registration ID (${deptShort(event.dept)}-2001), name, phone or college`} onChange={(change_) => setQuery(change_.target.value)} />
        </label>
        <p className="adm-muted">Open the student’s ID, check them, add them to the event, take the fee and mark them present. Only {deptShort(event.dept)} students take part.</p>
        <div className="fest-chips" role="group" aria-label="Show">
          <button type="button" className={`fest-chip-button${scope === 'dept' ? ' is-on' : ''}`} aria-pressed={scope === 'dept'} onClick={() => setScope('dept')}>
            All {deptShort(event.dept)} students ({inDept.length})
          </button>
          <button type="button" className={`fest-chip-button${scope === 'event' ? ' is-on' : ''}`} aria-pressed={scope === 'event'} onClick={() => setScope('event')}>
            In this event ({registered.length})
          </button>
        </div>
        <ShortList
          items={list}
          empty={
            q
              ? `Nobody ${scope === 'event' ? 'in this event' : `registered under ${deptShort(event.dept)}`} matches. A student of another department takes part in their own department’s events.`
              : scope === 'event'
                ? `Nobody has joined this event yet: add them from All ${deptShort(event.dept)} students.`
                : `Nobody has registered under ${deptShort(event.dept)} yet.`
          }
          render={(registration) => {
            const entry = entryOf(registration, event.id);
            const paid = Boolean(entry) && (feePaid(entry!) || event.fee === 0);
            const entryPaid = registration.entry.status === 'PAID';
            return (
              <RegistrationCard key={registration.id} registration={registration} eventFocus={event} compact={open !== registration.id}>
                {open !== registration.id ? (
                  <button className="adm-button adm-button--primary" type="button" aria-label={`Open ${showId(registration.id)}`} onClick={() => setOpen(registration.id)}>
                    Open
                  </button>
                ) : (
                  <div className="fest-inline-form" role="group" aria-label={`${showId(registration.id)} details`}>
                    <dl className="fest-factgrid">
                      <div className="fest-fact">
                        <dt>Name</dt>
                        <dd>{registration.name}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>College</dt>
                        <dd>{registration.college}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>Course · year</dt>
                        <dd>{[registration.branch, registration.year].filter(Boolean).join(' · ') || '—'}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>Mobile</dt>
                        <dd>{registration.phone}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>Entry fee</dt>
                        <dd>{entryPaid ? <Badge tone="good">Paid · verified at the desk</Badge> : <Badge tone="bad">Not paid: send them to the {deptShort(registration.dept)} desk</Badge>}</dd>
                      </div>
                    </dl>
                    {!locked && !entry && (
                      <button className="adm-button adm-button--primary" type="button" disabled={!event.active} onClick={() => addToEvent(registration)}>
                        Add to {event.name}
                      </button>
                    )}
                    {!locked && entry && !paid && paying !== registration.id && (
                      <button className="adm-button adm-button--primary" type="button" onClick={() => setPaying(registration.id)}>
                        Take {rupees(event.fee)}
                      </button>
                    )}
                    {paying === registration.id && (
                      <div className="fest-inline-form">
                        <PaymentChoice amount={event.fee} value={payment} onChange={setPayment} name={`fee-${registration.id}`} />
                        <span className="adm-inline">
                          <button className="adm-button adm-button--primary" type="button" disabled={!paymentReady(payment)} onClick={() => takeFee(registration)}>
                            Save the fee
                          </button>
                          <button className="adm-button" type="button" onClick={() => setPaying(null)}>
                            Cancel
                          </button>
                        </span>
                      </div>
                    )}
                    {!locked && entry && paid && !entry.present && (
                      <button className="adm-button adm-button--approve" type="button" disabled={!entryPaid} onClick={() => markPresent(registration, true)}>
                        {entryPaid ? 'Mark present' : 'Entry fee due: send to the desk'}
                      </button>
                    )}
                    {!locked && entry?.present && (
                      <button className="adm-button adm-button--small" type="button" onClick={() => markPresent(registration, false)}>
                        Undo present
                      </button>
                    )}
                    <button className="adm-button adm-button--small" type="button" onClick={() => setOpen(null)}>
                      Close
                    </button>
                  </div>
                )}
              </RegistrationCard>
            );
          }}
        />
      </section>

      <Winners event={event} registered={registered} />
    </>
  );
}

function Winners({ event, registered }: { event: FestEvent; registered: FestRegistration[] }) {
  const { results, change, catalog, pending, switches, session } = useFest();
  const result = results.get(event.id) ?? null;
  const resultsOff = !switches.results && session.role !== 'ADMIN';
  const locked = Boolean(result?.submitted);
  const initial = () =>
    [1, 2, 3].map((place) => {
      const saved = result?.places.find((item) => item.place === place);
      return { place, ids: saved ? saved.ids.map(showId).join(', ') : '', team: saved?.team ?? '' };
    });
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState('');
  const presentIds = new Set(registered.filter((item) => entryOf(item, event.id)?.present).map((item) => item.id));
  const parsed = rows.map((row) => ({ ...row, list: parseIdList(row.ids) }));
  const problems = parsed.flatMap((row) => row.list.filter((id) => !presentIds.has(id)).map((id) => `${showId(id)} (place ${row.place}) is not marked present here`));
  const places = parsed.filter((row) => row.list.length).map((row) => ({ place: row.place, ids: row.list, ...(row.team.trim() && { team: row.team.trim() }) }));
  const send = (action: 'save' | 'submit') => {
    if (action === 'submit' && !window.confirm(`Submit the results of ${event.name}?\n\nThe event closes: no more fees, attendance or changes. The overall coordinator receives the winners.`)) return;
    change(`results:${event.id}`, `/api/admin/fest/events/${event.id}/results`, { action, places }, `${action === 'submit' ? 'Submit' : 'Save'} ${event.name} results`);
    setMessage(action === 'submit' ? 'Submitted: the overall coordinator receives the winners.' : 'Winners saved.');
  };
  const nameOf = (id: string) => registered.find((item) => item.id === id)?.name ?? '';

  return (
    <section className="adm-card adm-pad" aria-label="Winners">
      <h3 className="adm-h3">Winners</h3>
      {resultsOff && !locked ? (
        <p className="adm-note">Results entry is switched off by the web assist team.</p>
      ) : locked ? (
        <ol className="fest-winners">
          {result!.places.map((place) => (
            <li key={place.place}>
              <strong>{ordinal(place.place)}</strong> {place.team && <>Team {place.team} · </>}
              {place.ids.map((id) => `${showId(id)} ${nameOf(id)}`).join(', ')}
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p className="adm-muted">Type the Registration IDs of the winners (for a team, every member’s ID, separated by commas). Only students marked present can win.</p>
          {rows.map((row, index) => (
            <div key={row.place} className="fest-form__row">
              <label className="adm-field">
                <span>{ordinal(row.place)} place</span>
                <input value={row.ids} placeholder={`${deptShort(event.dept)}-2001`} onChange={(change_) => setRows(rows.map((item, at) => (at === index ? { ...item, ids: change_.target.value } : item)))} />
              </label>
              {event.teamMax > 1 && (
                <label className="adm-field">
                  <span>Team name</span>
                  <input value={row.team} onChange={(change_) => setRows(rows.map((item, at) => (at === index ? { ...item, team: change_.target.value } : item)))} />
                </label>
              )}
            </div>
          ))}
          {problems.length > 0 && <p className="adm-field__error">{problems.join('; ')}.</p>}
          <div className="adm-inline adm-inline--wrap">
            <button className="adm-button" type="button" disabled={problems.length > 0} onClick={() => send('save')}>
              Save winners
            </button>
            <button className="adm-button adm-button--primary" type="button" disabled={problems.length > 0 || !places.some((place) => place.place === 1)} onClick={() => send('submit')}>
              Submit results
            </button>
          </div>
        </>
      )}
      {pending.has(`results:${event.id}`) && <Badge tone="warn">Waiting to send</Badge>}
      {message && <p className="adm-note" role="status">{message}</p>}
      {catalog && result?.saved && !locked && (
        <p className="adm-muted">
          Last saved by {result.saved.by} {when(result.saved.at)} · {eventOf(catalog, event.id)?.name}
        </p>
      )}
    </section>
  );
}

export const ordinal = (place: number) => (place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`);
