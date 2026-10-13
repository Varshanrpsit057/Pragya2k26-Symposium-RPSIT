/**
 * An event's window (event coordinators; department admins and the web assist team for any
 * event): the students registered for it, the fee, attendance, adding a student who came
 * straight to the venue, and the winners, submitted to the overall coordinator.
 */
import { useMemo, useState } from 'react';
import {
  canJoin,
  entryOf,
  eventLabel,
  eventOf,
  eventsOf,
  feePaid,
  isActive,
  parseIdList,
  rupees,
  teamRule,
  totalsOf,
  type FestEvent,
  type FestRegistration,
} from '../../lib/fest';
import { Badge, when } from '../ui';
import { DeptPicker, useWorkDept } from './DeskView';
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
  const { registrations, results, session, change } = useFest();
  const [query, setQuery] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  const result = results.get(event.id) ?? null;
  const locked = Boolean(result?.submitted);
  // The department's own students, and anyone who registered themselves (they may join any event).
  const inDept = useMemo(() => [...registrations.values()].filter((item) => canJoin(item, event) && isActive(item)), [registrations, event]);
  const registered = useMemo(() => inDept.filter((item) => entryOf(item, event.id)).sort((a, b) => a.id.localeCompare(b.id)), [inDept, event.id]);
  const totals = totalsOf(registered, event.id);
  const q = query.trim();
  const shown = q ? registered.filter((item) => matches(item, q)) : registered;
  const others = q.length >= 2 ? inDept.filter((item) => !entryOf(item, event.id) && matches(item, q)) : [];
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
        {locked && (
          <p className="adm-note">
            Results submitted by {result!.submitted!.by} {when(result!.submitted!.at)}. The event is closed: ask the overall coordinator if something must change.
          </p>
        )}
      </section>

      <section className="adm-card adm-pad">
        <label className="adm-field">
          <span>Find a student</span>
          <input type="search" value={query} placeholder="Registration ID, name, phone or college" onChange={(change_) => setQuery(change_.target.value)} />
        </label>
        <ShortList
          items={shown}
          empty={q ? 'Nobody registered for this event matches.' : 'Nobody has registered for this event yet.'}
          render={(registration) => {
            const entry = entryOf(registration, event.id)!;
            const paid = feePaid(entry) || event.fee === 0;
            return (
              <RegistrationCard key={registration.id} registration={registration} eventFocus={event}>
                {!locked && !paid && paying !== registration.id && (
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
                {!locked && paid && !entry.present && (
                  <button className="adm-button adm-button--approve" type="button" disabled={registration.entry.status !== 'PAID'} onClick={() => markPresent(registration, true)}>
                    {registration.entry.status === 'PAID' ? 'Mark present' : 'Entry fee due: send to the desk'}
                  </button>
                )}
                {!locked && entry.present && (
                  <button className="adm-button adm-button--small" type="button" onClick={() => markPresent(registration, false)}>
                    Undo present
                  </button>
                )}
              </RegistrationCard>
            );
          }}
        />
        {others.length > 0 && !locked && (
          <>
            <h3 className="adm-h3">In the department but not in this event</h3>
            <ShortList
              items={others}
              empty=""
              render={(registration) => (
                <RegistrationCard key={registration.id} registration={registration}>
                  <button className="adm-button adm-button--primary" type="button" disabled={!event.active} onClick={() => addToEvent(registration)}>
                    Add to {event.name}
                  </button>
                </RegistrationCard>
              )}
            />
          </>
        )}
        {q.length >= 2 && !shown.length && !others.length && <p className="adm-muted">Not registered in {event.dept}: send them to a {event.dept} registration desk first.</p>}
      </section>

      <Winners event={event} registered={registered} />
    </>
  );
}

function Winners({ event, registered }: { event: FestEvent; registered: FestRegistration[] }) {
  const { results, change, catalog, pending } = useFest();
  const result = results.get(event.id) ?? null;
  const locked = Boolean(result?.submitted);
  const initial = () =>
    [1, 2, 3].map((place) => {
      const saved = result?.places.find((item) => item.place === place);
      return { place, ids: saved ? saved.ids.join(', ') : '', team: saved?.team ?? '' };
    });
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState('');
  const presentIds = new Set(registered.filter((item) => entryOf(item, event.id)?.present).map((item) => item.id));
  const parsed = rows.map((row) => ({ ...row, list: parseIdList(row.ids) }));
  const problems = parsed.flatMap((row) => row.list.filter((id) => !presentIds.has(id)).map((id) => `${id} (place ${row.place}) is not marked present here`));
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
      {locked ? (
        <ol className="fest-winners">
          {result!.places.map((place) => (
            <li key={place.place}>
              <strong>{ordinal(place.place)}</strong> {place.team && <>Team {place.team} · </>}
              {place.ids.map((id) => `${id} ${nameOf(id)}`).join(', ')}
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
                <input value={row.ids} placeholder={`${event.dept}-0001`} onChange={(change_) => setRows(rows.map((item, at) => (at === index ? { ...item, ids: change_.target.value } : item)))} />
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
