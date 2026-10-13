/**
 * Departments and events (web assist team): names, HODs, contacts, desks, and each event's
 * venue, time, fee, team size and whether it takes registrations. Saved for everyone at once;
 * every phone picks the change up within seconds.
 */
import { useState } from 'react';
import { catalogProblem, deptShort, type FestCatalog, type FestDepartment, type FestEvent } from '../../lib/fest';
import { SignedOut } from '../adminApi';
import { Badge, when } from '../ui';
import { saveFestCatalog } from './festApi';
import { useFest } from './FestData';

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

export function CatalogEditor({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const { catalog, refresh, registrations } = useFest();
  const [draft, setDraft] = useState<FestCatalog | null>(null);
  const [open, setOpen] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  if (!catalog) return <p className="adm-loading">Loading…</p>;
  const value = draft ?? catalog;
  const problem = catalogProblem(value);
  const changed = draft !== null;
  const used = new Set([...registrations.values()].flatMap((item) => item.events.map((entry) => entry.eventId)));

  const setDept = (code: string, change: Partial<FestDepartment>) => setDraft({ ...value, departments: value.departments.map((dept) => (dept.code === code ? { ...dept, ...change } : dept)) });
  const setEvent = (at: number, change: Partial<FestEvent>) => setDraft({ ...value, events: value.events.map((event, index) => (index === at ? { ...event, ...change } : event)) });
  const addEvent = (dept: string) => {
    let id = `${dept.toLowerCase()}-new-event`;
    for (let n = 2; value.events.some((event) => event.id === id); n += 1) id = `${dept.toLowerCase()}-new-event-${n}`;
    setDraft({ ...value, events: [...value.events, { id, dept, name: 'New event', subtitle: '', venue: '', time: '', fee: 50, teamMin: 1, teamMax: 1, active: true }] });
  };
  const save = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await saveFestCatalog(token, value, catalog.revision);
      setDraft(null);
      setNote('Saved. Every phone picks up the change within seconds.');
      refresh();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure instanceof Error ? failure.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad fest-catalog__bar">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Departments and events</h2>
          <span className="adm-muted">{catalog.updatedBy ? `Last saved by ${catalog.updatedBy} ${when(catalog.updatedAt)}` : 'As on the poster (not changed yet)'}</span>
        </div>
        <label className="adm-field fest-narrow">
          <span>Entry fee (₹)</span>
          <input type="number" min={0} value={value.entryFee} onChange={(event) => setDraft({ ...value, entryFee: Number(event.target.value) })} />
        </label>
        <p className="adm-muted">The UPI account and the QR code students pay with are in Website controls.</p>
        {problem && <p className="adm-field__error">{problem}</p>}
        {error && <p className="adm-error">{error}</p>}
        {note && <p className="adm-note">{note}</p>}
        <div className="adm-inline">
          <button className="adm-button adm-button--primary" type="button" disabled={!changed || Boolean(problem) || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button className="adm-button" type="button" disabled={!changed || busy} onClick={() => setDraft(null)}>
            Discard changes
          </button>
          {changed && <Badge tone="warn">Not saved yet</Badge>}
        </div>
      </section>

      {value.departments.map((dept) => {
        const events = value.events.map((event, at) => ({ event, at })).filter(({ event }) => event.dept === dept.code);
        const isOpen = open === dept.code;
        return (
          <section key={dept.code} className="adm-card adm-pad">
            <button className="fest-catalog__head" type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : dept.code)}>
              <strong>{deptShort(dept.code)}</strong> {dept.name} <span className="adm-muted">· {events.length} events · {dept.desks} desks</span> {!dept.active && <Badge tone="bad">Off</Badge>}
            </button>
            {isOpen && (
              <>
                <div className="fest-columns">
                  <label className="adm-field">
                    <span>Name</span>
                    <input value={dept.name} onChange={(event) => setDept(dept.code, { name: event.target.value })} />
                  </label>
                  <label className="adm-field">
                    <span>HOD</span>
                    <input value={dept.hod} onChange={(event) => setDept(dept.code, { hod: event.target.value })} />
                  </label>
                  <label className="adm-field">
                    <span>Staff coordinator</span>
                    <input value={dept.staffCoordinator?.name ?? ''} onChange={(event) => setDept(dept.code, { staffCoordinator: { name: event.target.value, phone: dept.staffCoordinator?.phone ?? '' } })} />
                  </label>
                  <label className="adm-field">
                    <span>Staff coordinator phone</span>
                    <input value={dept.staffCoordinator?.phone ?? ''} onChange={(event) => setDept(dept.code, { staffCoordinator: { name: dept.staffCoordinator?.name ?? '', phone: event.target.value } })} />
                  </label>
                  <label className="adm-field">
                    <span>Student coordinator</span>
                    <input value={dept.studentCoordinator?.name ?? ''} onChange={(event) => setDept(dept.code, { studentCoordinator: { name: event.target.value, phone: dept.studentCoordinator?.phone ?? '' } })} />
                  </label>
                  <label className="adm-field">
                    <span>Student coordinator phone</span>
                    <input value={dept.studentCoordinator?.phone ?? ''} onChange={(event) => setDept(dept.code, { studentCoordinator: { name: dept.studentCoordinator?.name ?? '', phone: event.target.value } })} />
                  </label>
                  <label className="adm-field">
                    <span>Registration desks</span>
                    <input type="number" min={1} max={20} value={dept.desks} onChange={(event) => setDept(dept.code, { desks: Number(event.target.value) })} />
                  </label>
                  <label className="adm-check">
                    <input type="checkbox" checked={dept.active} onChange={(event) => setDept(dept.code, { active: event.target.checked })} />
                    <span>Taking registrations</span>
                  </label>
                </div>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--static fest-table fest-catalog__events">
                    <thead>
                      <tr>
                        <th scope="col">Event</th>
                        <th scope="col">Subtitle</th>
                        <th scope="col">Venue</th>
                        <th scope="col">Time</th>
                        <th scope="col">Fee ₹</th>
                        <th scope="col">Team size</th>
                        <th scope="col">Open</th>
                        <th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {events.map(({ event, at }) => {
                        const isNew = !catalog.events.some((item) => item.id === event.id);
                        return (
                          <tr key={at}>
                            <td>
                              <input value={event.name} aria-label="Event name" onChange={(change) => setEvent(at, { name: change.target.value })} />
                              {isNew ? (
                                <input
                                  className="adm-mono fest-id-input"
                                  value={event.id}
                                  aria-label="Event id (lower-case, used inside the system)"
                                  onChange={(change) => setEvent(at, { id: slug(change.target.value) })}
                                  onBlur={() => event.id === `${dept.code.toLowerCase()}-new-event` && setEvent(at, { id: `${dept.code.toLowerCase()}-${slug(event.name) || 'event'}` })}
                                />
                              ) : (
                                <small className="adm-muted adm-mono">{event.id}</small>
                              )}
                            </td>
                            <td>
                              <input value={event.subtitle} aria-label="Subtitle" onChange={(change) => setEvent(at, { subtitle: change.target.value })} />
                            </td>
                            <td>
                              <input value={event.venue} aria-label="Venue" placeholder="e.g. Delta Lab" onChange={(change) => setEvent(at, { venue: change.target.value })} />
                            </td>
                            <td>
                              <input value={event.time} aria-label="Time" placeholder="10:30 AM – 12:30 PM" onChange={(change) => setEvent(at, { time: change.target.value })} />
                            </td>
                            <td>
                              <input type="number" min={0} className="fest-num" value={event.fee} aria-label="Fee" onChange={(change) => setEvent(at, { fee: Number(change.target.value) })} />
                            </td>
                            <td className="fest-nowrap">
                              <input type="number" min={1} className="fest-num" value={event.teamMin} aria-label="Smallest team" onChange={(change) => setEvent(at, { teamMin: Number(change.target.value) })} /> –{' '}
                              <input type="number" min={1} className="fest-num" value={event.teamMax} aria-label="Largest team" onChange={(change) => setEvent(at, { teamMax: Number(change.target.value) })} />
                            </td>
                            <td>
                              <input type="checkbox" checked={event.active} aria-label="Taking registrations" onChange={(change) => setEvent(at, { active: change.target.checked })} />
                            </td>
                            <td>
                              <button
                                className="adm-button adm-button--small adm-button--danger-outline"
                                type="button"
                                disabled={used.has(event.id)}
                                title={used.has(event.id) ? 'Students are registered for it: untick Open instead' : 'Remove this event'}
                                onClick={() => setDraft({ ...value, events: value.events.filter((_, index) => index !== at) })}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button className="adm-button adm-button--small" type="button" onClick={() => addEvent(dept.code)}>
                  + Add an event
                </button>
              </>
            )}
          </section>
        );
      })}
    </main>
  );
}
