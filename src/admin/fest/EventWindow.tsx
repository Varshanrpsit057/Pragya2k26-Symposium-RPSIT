/**
 * An event's window (event coordinators; department admins and the web assist team for any
 * event): the department's students (only they take part in its events), opened one at a time to
 * check them, added to the event, the fee, attendance, its teams (team events), and the winners,
 * submitted to the overall coordinator. Its participants and the department download as Excel.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatIst } from '../../lib/countdown';
import {
  canJoin,
  deptShort,
  entryOf,
  eventFeeText,
  eventLabel,
  eventsOf,
  feePaid,
  isActive,
  placeTeam,
  rupees,
  showId,
  teamKey,
  teamOf,
  teamRule,
  teamsOf,
  tidyTeamName,
  totalsOf,
  TEAM_NAME_MAX,
  type FestEvent,
  type FestPlace,
  type FestRegistration,
  type FestTeam,
} from '../../lib/fest';
import { Badge, when } from '../ui';
import { DeptPicker, useWorkDept } from './DeskView';
import { PORTAL, saveTable, today } from './excel';
import { certificateRows, downloadStudents, eventRows } from './exports';
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
  // The student just marked present: the card closes and the search waits for the next ID.
  const [finished, setFinished] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (finished) search.current?.focus();
  }, [finished]);
  const result = results.get(event.id) ?? null;
  // Website controls can switch event entry off (the web assist team can still fix things).
  const entryOff = !switches.eventEntry && session.role !== 'ADMIN';
  const locked = Boolean(result?.submitted) || entryOff;
  const canDownload = switches.downloads || session.role === 'ADMIN' || session.role === 'OVERALL';
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
      patchEntry(current, {
        fee: { method: payment.method === 'UPI' ? 'UPI' : 'CASH', amount: event.fee, ...(payment.method === 'UPI' && { txn: payment.txn.replace(/\s/g, '') }), ...stamp },
      }),
    );
    setPaying(null);
    setPayment(NO_PAYMENT);
  };
  const markPresent = (registration: FestRegistration, present: boolean) => {
    change(registration.id, path(registration.id), { action: present ? 'present' : 'absent' }, `${present ? 'Present' : 'Not present'} · ${registration.id}`, (current) =>
      patchEntry(current, { present: present ? stampNow(session.username) : undefined }),
    );
    // Marked present: this student is done; the next one is found by their ID.
    if (present) {
      setOpen(null);
      setQuery('');
      setFinished(`${showId(registration.id)} ${registration.name} is marked present at ${event.name}.`);
    }
  };
  const addToEvent = (registration: FestRegistration) => {
    change(registration.id, path(registration.id), { action: 'add' }, `Add ${registration.id} to ${event.name}`, (current) => ({
      ...current,
      events: [...current.events, { eventId: event.id, added: stampNow(session.username) }],
    }));
    // Added: the fee comes next (when there is one).
    if (event.fee > 0) {
      setPayment(NO_PAYMENT);
      setPaying(registration.id);
    }
  };
  const openCard = (id: string | null) => {
    setFinished('');
    setOpen(id);
  };
  const removeFromEvent = (registration: FestRegistration) =>
    change(registration.id, path(registration.id), { action: 'remove' }, `Remove ${registration.id} from ${event.name}`, (current) => ({
      ...current,
      events: current.events.filter((item) => item.eventId !== event.id),
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
            <button
              className="adm-button adm-button--small"
              type="button"
              disabled={!registered.length}
              onClick={() => {
                // As on the event registration form: the department, the venue and the staff coordinator above the list.
                const dept = catalog.departments.find((item) => item.code === event.dept);
                const about = [`Department of ${dept?.name ?? deptShort(event.dept)}`, event.venue && `Venue: ${event.venue}`, event.time, event.fee ? `Fee ${rupees(event.fee)}` : 'No fee', dept?.staffCoordinator?.name && `Staff coordinator: ${dept.staffCoordinator.name}`];
                saveTable(`techfest-${event.id}-registration-form-${today()}.xlsx`, `${eventLabel(event)} · event registration form`, note(about.filter(Boolean).join(' · ')), eventRows(registered, event));
              }}
            >
              Download this event (Excel)
            </button>
            <button
              className="adm-button adm-button--small"
              type="button"
              disabled={!inDept.length}
              onClick={() => downloadStudents(`techfest-${event.dept.toLowerCase()}-students-${today()}.xlsx`, `${deptShort(event.dept)} students`, note(`every ${deptShort(event.dept)} student`), inDept, catalog, { events: eventsOf(catalog, event.dept, { all: true }) })}
            >
              Download all {deptShort(event.dept)} students (Excel)
            </button>
            <button
              className="adm-button adm-button--small"
              type="button"
              disabled={!totals.present}
              onClick={() => saveTable(`techfest-${event.id}-certificates-${today()}.xlsx`, `${event.name} certificates`, note('certificates: winners, then everyone present'), certificateRows(catalog, [event], results, registrations))}
            >
              Certificate list (Excel)
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
        {finished && (
          <p className="fest-match is-good fest-finished" role="status">
            <span>✓ {finished} Next student: type their ID.</span>
            <button className="adm-button adm-button--small" type="button" onClick={() => setFinished('')}>
              OK
            </button>
          </p>
        )}
        <label className="adm-field fest-find">
          <span>Find a student</span>
          <input ref={search} type="search" value={query} placeholder={`Registration ID (${deptShort(event.dept)}-2001), name, phone or college`} onChange={(change_) => setQuery(change_.target.value)} />
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
                  <button className="adm-button adm-button--primary" type="button" aria-label={`Open ${showId(registration.id)}`} onClick={() => openCard(registration.id)}>
                    Open
                  </button>
                ) : (
                  <div className="fest-inline-form fest-event-card" role="group" aria-label={`${showId(registration.id)} details`}>
                    {/* First what decides the next step (seen without scrolling on a phone), then the buttons. */}
                    <dl className="fest-factgrid fest-factgrid--tight">
                      <div className="fest-fact">
                        <dt>Gate pass (entry fee)</dt>
                        <dd>{entryPaid ? <Badge tone="good">Paid · verified at the desk</Badge> : <Badge tone="bad">Not paid: send them to the {deptShort(registration.dept)} desk</Badge>}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>{event.name} fee</dt>
                        <dd>
                          {!entry ? (
                            <span className="adm-muted">Not added to {event.name} yet</span>
                          ) : feePaid(entry) ? (
                            <>
                              {eventFeeText(entry)}
                              <div className="adm-muted">
                                by {entry.fee!.by} · {when(entry.fee!.at)}
                              </div>
                            </>
                          ) : event.fee ? (
                            <Badge tone="warn">Due {rupees(event.fee)}</Badge>
                          ) : (
                            'No fee'
                          )}
                        </dd>
                      </div>
                      {entry && (
                        <div className="fest-fact">
                          <dt>Attendance</dt>
                          <dd>
                            {entry.present ? (
                              <>
                                Present
                                <div className="adm-muted">
                                  by {entry.present.by} · {when(entry.present.at)}
                                </div>
                              </>
                            ) : (
                              <span className="adm-muted">Not marked present</span>
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="fest-event-card__actions">
                      {!locked && !entry && (
                        <button className="adm-button adm-button--primary adm-button--big" type="button" disabled={!event.active} onClick={() => addToEvent(registration)}>
                          Add to {event.name}
                        </button>
                      )}
                      {!locked && entry && !paid && paying !== registration.id && (
                        <button className="adm-button adm-button--primary adm-button--big" type="button" onClick={() => setPaying(registration.id)}>
                          Take {rupees(event.fee)}
                        </button>
                      )}
                      {paying === registration.id && (
                        <div className="fest-inline-form">
                          <PaymentChoice amount={event.fee} value={payment} onChange={setPayment} name={`fee-${registration.id}`} />
                          <span className="adm-inline adm-inline--wrap">
                            <button className="adm-button adm-button--primary adm-button--big" type="button" disabled={!paymentReady(payment)} onClick={() => takeFee(registration)}>
                              Save the fee
                            </button>
                            <button className="adm-button" type="button" onClick={() => setPaying(null)}>
                              Cancel
                            </button>
                          </span>
                        </div>
                      )}
                      {!locked && entry && paid && !entry.present && (
                        <button className="adm-button adm-button--approve adm-button--big" type="button" disabled={!entryPaid} onClick={() => markPresent(registration, true)}>
                          {entryPaid ? 'Mark present' : 'Entry fee due: send to the desk'}
                        </button>
                      )}
                      {!locked && entry?.present && (
                        <button className="adm-button" type="button" onClick={() => markPresent(registration, false)}>
                          Undo present
                        </button>
                      )}
                      {!locked && entry && !entry.present && !feePaid(entry) && (
                        <button className="adm-button adm-button--danger-outline" type="button" onClick={() => removeFromEvent(registration)}>
                          Remove from {event.name}
                        </button>
                      )}
                      <button className="adm-button" type="button" onClick={() => openCard(null)}>
                        Close
                      </button>
                    </div>
                    <dl className="fest-factgrid fest-factgrid--tight">
                      <div className="fest-fact">
                        <dt>College</dt>
                        <dd>{registration.college}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>College code</dt>
                        <dd>{registration.collegeCode || '—'}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>Course · year</dt>
                        <dd>{[registration.branch, registration.year].filter(Boolean).join(' · ') || '—'}</dd>
                      </div>
                      <div className="fest-fact">
                        <dt>Mobile</dt>
                        <dd>
                          <a href={`tel:${registration.phone}`}>{registration.phone}</a>
                        </dd>
                      </div>
                      {event.teamMax > 1 && entry && (
                        <div className="fest-fact">
                          <dt>Team</dt>
                          <dd>{entry.team || <span className="adm-muted">Not in a team (Teams, below)</span>}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}
              </RegistrationCard>
            );
          }}
        />
      </section>

      {event.teamMax > 1 && <Teams event={event} registered={registered} locked={locked} />}
      <Winners event={event} registered={registered} />
    </>
  );
}

/** Finds a student in a list by Registration ID or name, a button each (up to 6). */
function FindStudent({ label, people, empty, placeholder, onPick }: { label: string; people: FestRegistration[]; empty: string; placeholder: string; onPick: (registration: FestRegistration) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const found = q ? people.filter((item) => matches(item, q)).slice(0, 6) : [];
  return (
    <>
      <label className="adm-field">
        <span>{label}</span>
        <input type="search" value={query} placeholder={placeholder} autoComplete="off" onChange={(change_) => setQuery(change_.target.value)} />
      </label>
      {q && (
        <div className="fest-place__found" role="group" aria-label={`Found: ${label}`}>
          {found.length ? (
            found.map((item) => (
              <button
                key={item.id}
                className="adm-button adm-button--small"
                type="button"
                onClick={() => {
                  onPick(item);
                  setQuery('');
                }}
              >
                {showId(item.id)} {item.name}
              </button>
            ))
          ) : (
            <span className="adm-muted">{empty}</span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The teams of a team event: each made once here, its name and its members (this event's
 * participants, one team each). Winners then finds a team by its name and adds every member.
 */
function Teams({ event, registered, locked }: { event: FestEvent; registered: FestRegistration[]; locked: boolean }) {
  const { change } = useFest();
  const teams = useMemo(() => teamsOf(registered, event.id), [registered, event.id]);
  const loose = registered.filter((item) => !teamOf(item, event.id));
  const [message, setMessage] = useState('');
  const setTeam = (registration: FestRegistration, team: string) =>
    change(
      registration.id,
      `/api/admin/fest/registrations/${registration.id}/events/${event.id}`,
      { action: 'team', team },
      team ? `${showId(registration.id)} in team ${team}` : `${showId(registration.id)} out of their team`,
      (current) => ({ ...current, events: current.events.map((item) => (item.eventId === event.id ? { ...item, team: team || undefined } : item)) }),
    );
  const placeholder = `ID (${deptShort(event.dept)}-2001) or name`;

  return (
    <section className="adm-card adm-pad" aria-label="Teams">
      <h3 className="adm-h3">Teams</h3>
      <p className="adm-muted">
        {teamRule(event)}. Teams are optional and for this event only: a student not in a team takes part on their own. Fees and attendance stay for each student. Make each team once:
        its name and its members, from this event’s participants; in Winners, typing the team’s name adds every member. {teams.length} team{teams.length === 1 ? '' : 's'} ·{' '}
        {loose.length} participant{loose.length === 1 ? '' : 's'} on their own.
      </p>
      {!locked && (
        <NewTeam
          event={event}
          teams={teams}
          loose={loose}
          placeholder={placeholder}
          onMake={(name, members) => {
            for (const member of members) setTeam(member, name);
            setMessage(`Team ${name} made: ${members.map((member) => showId(member.id)).join(', ')}.`);
          }}
        />
      )}
      {message && (
        <p className="adm-note" role="status">
          {message}
        </p>
      )}
      {teams.length > 0 && (
        <div className="fest-teams">
          {teams.map((team) => (
            <TeamCard key={team.key} event={event} team={team} teams={teams} loose={loose} locked={locked} placeholder={placeholder} setTeam={setTeam} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A new team: its name, then its members (participants not in a team yet). */
function NewTeam({ event, teams, loose, placeholder, onMake }: { event: FestEvent; teams: FestTeam[]; loose: FestRegistration[]; placeholder: string; onMake: (name: string, members: FestRegistration[]) => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<FestRegistration[]>([]);
  const tidy = tidyTeamName(name);
  const key = teamKey(name);
  const taken = key ? teams.find((team) => team.key === key) : undefined;
  const pickedIds = new Set(picked.map((item) => item.id));
  const room = event.teamMax - picked.length;
  const free = loose.filter((item) => !pickedIds.has(item.id));
  // The team name they typed when registering, if it matches: added in one tap.
  const said = key && !taken && room > 0 ? free.filter((item) => teamKey(item.team) === key).slice(0, room) : [];
  // A team has at least 2 members: a student on their own needs no team.
  const ready = tidy.length >= 2 && picked.length >= 2 && !taken;

  return (
    <form
      className="fest-place"
      aria-label="Make a team"
      onSubmit={(submit) => {
        submit.preventDefault();
        if (!ready) return;
        onMake(tidy, picked);
        setName('');
        setPicked([]);
      }}
    >
      <strong>Make a team</strong>
      <label className="adm-field">
        <span>Team name</span>
        <input value={name} maxLength={TEAM_NAME_MAX} autoComplete="off" onChange={(change_) => setName(change_.target.value)} />
      </label>
      {taken && <p className="adm-field__error">Team {taken.name} already exists: add members to it below.</p>}
      {picked.length > 0 && (
        <ul className="fest-place__list">
          {picked.map((item) => (
            <li key={item.id}>
              <span className="fest-card__id">{showId(item.id)}</span> <strong>{item.name}</strong>
              <button className="adm-button adm-button--small" type="button" aria-label={`Take ${showId(item.id)} out of the new team`} onClick={() => setPicked(picked.filter((other) => other.id !== item.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {said.length > 0 && (
        <button className="adm-button adm-button--small" type="button" onClick={() => setPicked([...picked, ...said])}>
          Typed team {tidy} when registering: add {said.map((item) => showId(item.id)).join(', ')}
        </button>
      )}
      {room > 0 ? (
        <FindStudent
          label={picked.length ? 'Add another member' : 'Add a member'}
          people={free}
          placeholder={placeholder}
          empty="Nobody in this event matches who is not in a team already (add them to the event first)."
          onPick={(item) => setPicked([...picked, item])}
        />
      ) : (
        <p className="adm-muted">The team is full: {event.teamMax} members.</p>
      )}
      {picked.length === 1 && <p className="adm-muted">Add at least one more member: a student on their own needs no team.</p>}
      {picked.length >= 2 && picked.length < event.teamMin && <p className="adm-muted">A team needs at least {event.teamMin}: you can add the rest later.</p>}
      <span>
        <button className="adm-button adm-button--primary" type="submit" disabled={!ready}>
          {picked.length ? `Make team${tidy ? ` ${tidy}` : ''} (${picked.length})` : 'Make team'}
        </button>
      </span>
    </form>
  );
}

/** A team: its members (take one out, add one), and its name (rename it). */
function TeamCard({
  event,
  team,
  teams,
  loose,
  locked,
  placeholder,
  setTeam,
}: {
  event: FestEvent;
  team: FestTeam;
  teams: FestTeam[];
  loose: FestRegistration[];
  locked: boolean;
  placeholder: string;
  setTeam: (registration: FestRegistration, team: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const tidy = tidyTeamName(name);
  const clash = teams.find((other) => other.key !== team.key && other.key === teamKey(name));
  // Names match whatever their capitals, so 'NOVA' for 'Nova' changes nothing.
  const unchanged = teamKey(name) === team.key;
  const size = team.members.length;
  const short = size < event.teamMin;
  return (
    <article className="fest-place" aria-label={`Team ${team.name}`}>
      <span className="adm-inline adm-inline--wrap">
        <strong>Team {team.name}</strong>
        <Badge tone={short ? 'warn' : 'plain'}>{short ? `${size} · needs at least ${event.teamMin}` : `${size} of up to ${event.teamMax}`}</Badge>
        {!locked && !renaming && (
          <button className="adm-button adm-button--small" type="button" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
      </span>
      {renaming && (
        <span className="adm-inline adm-inline--wrap">
          <label className="adm-field">
            <span>New name for team {team.name}</span>
            <input value={name} maxLength={TEAM_NAME_MAX} autoComplete="off" onChange={(change_) => setName(change_.target.value)} />
          </label>
          <button
            className="adm-button adm-button--primary adm-button--small"
            type="button"
            disabled={tidy.length < 2 || Boolean(clash) || unchanged}
            onClick={() => {
              for (const member of team.members) setTeam(member, tidy);
              setRenaming(false);
            }}
          >
            Save name
          </button>
          <button
            className="adm-button adm-button--small"
            type="button"
            onClick={() => {
              setName(team.name);
              setRenaming(false);
            }}
          >
            Cancel
          </button>
          {clash && <span className="adm-field__error">Another team is called {clash.name}.</span>}
        </span>
      )}
      <ul className="fest-place__list">
        {team.members.map((member) => (
          <li key={member.id}>
            <span className="fest-card__id">{showId(member.id)}</span> <strong>{member.name}</strong>
            <span className="adm-muted"> · {entryOf(member, event.id)?.present ? 'present' : 'not marked present'}</span>
            {!locked && (
              <button className="adm-button adm-button--small" type="button" aria-label={`Take ${showId(member.id)} out of team ${team.name}`} onClick={() => setTeam(member, '')}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!locked && size < event.teamMax && (
        <FindStudent
          label={`Add a member to team ${team.name}`}
          people={loose}
          placeholder={placeholder}
          empty="Nobody in this event matches who is not in a team already."
          onPick={(item) => setTeam(item, team.name)}
        />
      )}
    </article>
  );
}

interface PlaceDraft {
  place: number;
  ids: string[];
  team: string;
}

/**
 * The winners: 1st, 2nd and 3rd, each a student (or, for a team event, a team: its name and a row
 * for each member). Students are found in this event's own participants marked present, by ID or
 * name, so the certificates carry the right names.
 */
function Winners({ event, registered }: { event: FestEvent; registered: FestRegistration[] }) {
  const { results, change, pending, switches, session } = useFest();
  const result = results.get(event.id) ?? null;
  const resultsOff = !switches.results && session.role !== 'ADMIN';
  const locked = Boolean(result?.submitted);
  const isTeam = event.teamMax > 1;
  const teams = useMemo(() => (isTeam ? teamsOf(registered, event.id) : []), [isTeam, registered, event.id]);
  const initial = (): PlaceDraft[] =>
    [1, 2, 3].map((place) => {
      const saved = result?.places.find((item) => item.place === place);
      return { place, ids: saved ? [...saved.ids] : [], team: saved?.team ?? '' };
    });
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState('');
  const byId = new Map(registered.map((item) => [item.id, item]));
  const present = registered.filter((item) => entryOf(item, event.id)?.present);
  const presentIds = new Set(present.map((item) => item.id));
  const placed = new Set(rows.flatMap((row) => row.ids));
  // A winner whose attendance was undone since: they cannot win until marked present again.
  const problems = rows.flatMap((row) => row.ids.filter((id) => !presentIds.has(id)).map((id) => `${showId(id)} (${ordinal(row.place)}) is no longer marked present`));
  const places = rows.filter((row) => row.ids.length).map((row) => ({ place: row.place, ids: row.ids, ...(row.team.trim() && { team: row.team.trim() }) }));
  const setRow = (place: number, next: Partial<PlaceDraft>) => setRows((current) => current.map((row) => (row.place === place ? { ...row, ...next } : row)));
  const send = (action: 'save' | 'submit') => {
    if (action === 'submit' && !window.confirm(`Submit the results of ${event.name}?\n\nThe event closes: no more fees, attendance or changes. The overall coordinator receives the winners.`)) return;
    change(`results:${event.id}`, `/api/admin/fest/events/${event.id}/results`, { action, places }, `${action === 'submit' ? 'Submit' : 'Save'} ${event.name} results`);
    setMessage(action === 'submit' ? 'Submitted: the overall coordinator receives the winners.' : 'Winners saved.');
  };

  return (
    <section className="adm-card adm-pad" aria-label="Winners">
      <h3 className="adm-h3">Winners</h3>
      {resultsOff && !locked ? (
        <p className="adm-note">Results entry is switched off by the web assist team.</p>
      ) : locked ? (
        <WinnerTable places={result!.places} byId={byId} />
      ) : (
        <>
          <p className="adm-muted">
            Find each winner in this event’s participants marked present ({present.length}), by Registration ID or name.
            {isTeam
              ? ' For a team, type the team’s name: every member marked present is added, each with a row and a certificate. A student not in a team wins on their own: add just them, with no team name.'
              : ''}
          </p>
          {isTeam && !teams.length && <p className="adm-note">No teams are made yet for this event: make them in Teams above. A student on their own is found here by ID or name.</p>}
          {rows.map((row) => (
            <PlaceEditor key={row.place} row={row} event={event} present={present} placed={placed} byId={byId} teams={teams} onChange={(next) => setRow(row.place, next)} />
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
      {message && (
        <p className="adm-note" role="status">
          {message}
        </p>
      )}
      {result?.saved && !locked && (
        <p className="adm-muted">
          Last saved by {result.saved.by} {when(result.saved.at)}
        </p>
      )}
    </section>
  );
}

/**
 * One place: a row per student, and the search that adds one. In a team event, typing a team's
 * name adds all its members marked present; its name goes on the certificates.
 */
function PlaceEditor({
  row,
  event,
  present,
  placed,
  byId,
  teams,
  onChange,
}: {
  row: PlaceDraft;
  event: FestEvent;
  present: FestRegistration[];
  placed: Set<string>;
  byId: Map<string, FestRegistration>;
  teams: FestTeam[];
  onChange: (next: Partial<PlaceDraft>) => void;
}) {
  const [query, setQuery] = useState('');
  const isTeam = event.teamMax > 1;
  const room = event.teamMax - row.ids.length;
  const full = room <= 0;
  const q = query.trim();
  const presentIds = new Set(present.map((item) => item.id));
  const free = (item: FestRegistration) => presentIds.has(item.id) && !placed.has(item.id);
  const found = q ? present.filter((item) => !placed.has(item.id) && matches(item, q)).slice(0, 6) : [];
  // Teams whose name matches, with a member still to place.
  const teamsFound = isTeam && q ? teams.filter((team) => team.key.includes(teamKey(q)) && team.members.some(free)).slice(0, 4) : [];
  // Their team in this event (made in Teams); none: they win on their own.
  const teamName = (who: FestRegistration | undefined) => (who ? teamOf(who, event.id) : '');
  const add = (id: string) => {
    onChange({ ids: [...row.ids, id], team: row.team || (isTeam ? teamName(byId.get(id)) : '') });
    setQuery('');
  };
  const addTeam = (team: FestTeam) => {
    onChange({ ids: [...row.ids, ...team.members.filter(free).map((item) => item.id)].slice(0, event.teamMax), team: row.team || team.name });
    setQuery('');
  };
  // Their teammates (same team, present, not placed yet): added in one tap.
  const key = teamKey(row.team);
  const mates = isTeam && key && !full ? present.filter((item) => !placed.has(item.id) && teamKey(teamName(item)) === key).slice(0, room) : [];
  const label = `${ordinal(row.place)} place`;

  return (
    <fieldset className="fest-place">
      <legend>{label}</legend>
      {row.ids.length > 0 && (
        <ul className="fest-place__list">
          {row.ids.map((id) => {
            const who = byId.get(id);
            return (
              <li key={id}>
                <span className="fest-card__id">{showId(id)}</span> <strong>{who?.name ?? ''}</strong>
                <span className="adm-muted">
                  {' '}
                  · {who?.college ?? ''}
                  {who?.collegeCode ? ` (${who.collegeCode})` : ''}
                </span>
                <button className="adm-button adm-button--small" type="button" aria-label={`Remove ${showId(id)} from the ${label}`} onClick={() => onChange({ ids: row.ids.filter((item) => item !== id) })}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {isTeam && row.ids.length > 0 && (
        <label className="adm-field">
          <span>Team name (optional, on the certificates)</span>
          <input value={row.team} maxLength={TEAM_NAME_MAX} placeholder="None: a student on their own" onChange={(change_) => onChange({ team: change_.target.value })} />
        </label>
      )}
      {mates.length > 0 && (
        <button className="adm-button adm-button--small" type="button" onClick={() => onChange({ ids: [...row.ids, ...mates.map((item) => item.id)] })}>
          Add the rest of team {row.team.trim()}: {mates.map((item) => showId(item.id)).join(', ')}
        </button>
      )}
      {!full && (
        <label className="adm-field">
          <span>{row.ids.length ? `Add a teammate to the ${label} (a team only)` : `Find the ${label} winner`}</span>
          <input
            type="search"
            value={query}
            placeholder={isTeam ? `Team name, or ID (${deptShort(event.dept)}-2001) or name` : `ID (${deptShort(event.dept)}-2001) or name`}
            autoComplete="off"
            onChange={(change_) => setQuery(change_.target.value)}
          />
        </label>
      )}
      {q && !full && (
        <div className="fest-place__found" role="group" aria-label={`Participants found for the ${label}`}>
          {teamsFound.map((team) => {
            const absent = team.members.filter((item) => !presentIds.has(item.id));
            return (
              <button key={team.key} className="fest-team-pick" type="button" aria-label={`Team ${team.name}: add its members`} onClick={() => addTeam(team)}>
                <strong>Team {team.name}</strong>
                <span>
                  {team.members
                    .filter(free)
                    .map((item) => `${showId(item.id)} ${item.name}`)
                    .join(' · ')}
                </span>
                {absent.length > 0 && <span className="fest-team-pick__left">Not marked present, left out: {absent.map((item) => `${showId(item.id)} ${item.name}`).join(' · ')}</span>}
              </button>
            );
          })}
          {found.map((item) => (
            <button key={item.id} className="adm-button adm-button--small" type="button" onClick={() => add(item.id)}>
              {showId(item.id)} {item.name}
            </button>
          ))}
          {!found.length && !teamsFound.length && (
            <span className="adm-muted">Nobody present in this event matches{isTeam ? ', and no team has that name' : ''} (a winner must be marked present, and in one place only).</span>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** The submitted winners: a row per student, the team's name on each of its rows. */
export function WinnerTable({ places, byId }: { places: FestPlace[]; byId: ReadonlyMap<string, FestRegistration> }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-table--static fest-table">
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Team</th>
            <th scope="col">Registration ID</th>
            <th scope="col">Name</th>
            <th scope="col">College</th>
          </tr>
        </thead>
        <tbody>
          {places.flatMap((place) =>
            place.ids.map((id) => {
              const who = byId.get(id);
              return (
                <tr key={`${place.place}-${id}`}>
                  <th scope="row">{ordinal(place.place)}</th>
                  <td>{placeTeam(place) || '—'}</td>
                  <td className="adm-mono">{showId(id)}</td>
                  <td>{who?.name ?? ''}</td>
                  <td>
                    {who?.college ?? ''}
                    {who?.collegeCode ? ` (${who.collegeCode})` : ''}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

export const ordinal = (place: number) => (place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`);
