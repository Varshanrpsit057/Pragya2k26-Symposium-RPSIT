/**
 * Results and certificates: every event's participants, attendance and winners, with when
 * each coordinator submitted them, downloaded as one Excel workbook. The lists of a submitted event are
 * exactly what its coordinator submitted; an event not yet submitted exports its live lists,
 * marked as not final. Opening an event shows, for the certificate writers, everyone who
 * took part (present first) and then the three prizes, with each student's details.
 */
import { useCallback, useState } from 'react';
import { PLACES, PLACE_LABELS, type EventRoster, type EventSummary, type Place } from '../lib/admin';
import type { SessionInfo } from '../lib/staff';
import { XLSX_TYPE } from '../lib/xlsx';
import { SignedOut, eventRoster, listEvents } from './adminApi';
import { Badge, ErrorNote, LiveStatus, saveFile, useLiveData, when } from './ui';
import { resultsWorkbook, type ExportEvent, type ExportParticipant } from './workbooks';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

/** The lists for export: the submitted ones when there are, otherwise the live ones. */
function exportEvent(summary: EventSummary, roster: EventRoster | null): ExportEvent {
  const { submission } = summary.result;
  if (submission) {
    return { name: summary.name, participants: submission.participants, winners: submission.winners, submittedAt: submission.submittedAt, submittedBy: submission.submittedBy };
  }
  const participants = (roster?.participants ?? [])
    .filter((item) => item.status === 'APPROVED')
    .map((item) => ({ ...item, feePaid: item.fee.status === 'PAID', present: item.attendance?.present === true }));
  const winnerOf = (id: string) => {
    const person = participants.find((item) => item.registrationId === id);
    return { registrationId: id, name: person?.name ?? '', college: person?.college ?? '', team: person?.team ?? null };
  };
  return {
    name: summary.name,
    participants,
    winners: { first: summary.result.winners.first.map(winnerOf), second: summary.result.winners.second.map(winnerOf), third: summary.result.winners.third.map(winnerOf) },
    submittedAt: null,
    submittedBy: null,
  };
}

export function ResultsPanel({ token, session, onSignedOut }: PanelProps) {
  const load = useCallback(() => listEvents(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const events = live.data ?? [];

  const downloadResults = async () => {
    setBusy(true);
    setError(null);
    try {
      const rosters = await Promise.all(events.map((event) => (event.result.submission ? null : eventRoster(token, event.eventId))));
      const lists = events.map((event, index) => exportEvent(event, rosters[index]));
      const file = resultsWorkbook(lists, session.displayName, Date.now());
      saveFile(file.name, file.bytes, XLSX_TYPE);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const allSubmitted = events.length > 0 && events.every((event) => event.result.status === 'SUBMITTED');

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Results &amp; certificates</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <ErrorNote error={live.error ?? error} />
        <div className="adm-actions__row">
          <button className="adm-button adm-button--primary" type="button" disabled={busy || !events.length} onClick={() => void downloadResults()}>
            {busy ? 'Preparing…' : 'Download results (Excel)'}
          </button>
          <span className="adm-muted">One workbook: summary, participants, certificate list (marked present) and winners.</span>
        </div>
        {!allSubmitted && events.length > 0 && (
          <p className="adm-note">Some events are not submitted yet: their lists are as they stand now, and the file says NOT FINAL.</p>
        )}
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Registered</th>
                <th scope="col">Fee paid</th>
                <th scope="col">Present</th>
                <th scope="col">Results</th>
                <th scope="col">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId} className={openEvent === event.eventId ? 'is-selected' : undefined} onClick={() => setOpenEvent(openEvent === event.eventId ? null : event.eventId)}>
                  <td>
                    <button type="button" className="adm-link">
                      {event.name}
                    </button>
                  </td>
                  <td>{event.enrolled}</td>
                  <td>{event.feePaid}</td>
                  <td>{event.present}</td>
                  <td>
                    {event.result.status === 'SUBMITTED' ? (
                      <Badge tone="good">Final</Badge>
                    ) : event.result.status === 'REOPENED' ? (
                      <Badge tone="warn">Being corrected</Badge>
                    ) : (
                      <Badge tone="plain">Not submitted</Badge>
                    )}
                  </td>
                  <td>{event.result.submission ? `${when(event.result.submission.submittedAt)} by ${event.result.submission.submittedBy}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {events
        .filter((event) => event.eventId === openEvent)
        .map((event) => (
          <EventResults key={event.eventId} summary={event} token={token} onSignedOut={onSignedOut} />
        ))}
    </main>
  );
}

/** A student on a certificate: who they are, from the lists (the submitted ones when final). */
type Person = Pick<ExportParticipant, 'registrationId' | 'name' | 'college' | 'department' | 'year' | 'email' | 'team'>;

/**
 * One event for the certificate writers: everyone who took part, those marked present first
 * (their participation certificates), then the three prizes with each winner's details.
 */
function EventResults({ summary, token, onSignedOut }: { summary: EventSummary; token: string; onSignedOut: () => void }) {
  const load = useCallback(() => eventRoster(token, summary.eventId), [token, summary.eventId]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const { result } = summary;
  const final = result.submission !== null;
  const lists = exportEvent(summary, live.data);
  const participants = [...lists.participants].sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const present = participants.filter((person) => person.present);
  const absent = participants.filter((person) => !person.present);
  const showEmail = participants.some((person) => person.email);
  const showTeam = participants.some((person) => person.team);
  const detailsOf = (id: string): Person | undefined => participants.find((person) => person.registrationId === id);
  const prizes = PLACES.flatMap((place) =>
    lists.winners[place].map((winner) => ({ place, person: { ...winner, department: '', year: '', email: undefined, ...detailsOf(winner.registrationId), team: winner.team ?? detailsOf(winner.registrationId)?.team ?? null } })),
  );

  return (
    <section className="adm-card adm-pad" aria-label={`${summary.name} results`}>
      <div className="adm-toolbar">
        <h3 className="adm-h3">{summary.name}</h3>
        {final ? <Badge tone="good">Final</Badge> : <Badge tone="warn">Not final</Badge>}
      </div>
      {final ? (
        <p className="adm-muted">
          Submitted {when(result.submission!.submittedAt)} by {result.submission!.submittedBy} (submission #{result.submission!.number}): the lists below are exactly what was submitted.
        </p>
      ) : (
        <p className="adm-note">Not submitted yet by the coordinator: these lists are as they stand now and may still change.</p>
      )}
      {result.reopened && (
        <p className="adm-note">
          Reopened by {result.reopened.by} {when(result.reopened.at)}: {result.reopened.reason}. The lists below are the last submission.
        </p>
      )}
      {!final && !live.data && <p className="adm-muted">{live.error ? 'The lists could not be loaded.' : 'Loading the lists…'}</p>}
      <ErrorNote error={live.error} />

      <h4 className="adm-h4">Present: participation certificates ({present.length})</h4>
      <People people={present} showEmail={showEmail} showTeam={showTeam} empty="No one is marked present yet." />

      {absent.length > 0 && (
        <>
          <h4 className="adm-h4">Registered but not marked present ({absent.length}): no certificate</h4>
          <People people={absent} showEmail={showEmail} showTeam={showTeam} empty="" muted />
        </>
      )}

      <h4 className="adm-h4">Prizes</h4>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table--static" aria-label={`${summary.name} prizes`}>
          <thead>
            <tr>
              <th scope="col">Prize</th>
              <th scope="col">Registration ID</th>
              <th scope="col">Name</th>
              <th scope="col">College</th>
              <th scope="col">Department</th>
              <th scope="col">Year</th>
              {showEmail && <th scope="col">Email</th>}
              {showTeam && <th scope="col">Team</th>}
            </tr>
          </thead>
          <tbody>
            {PLACES.map((place: Place) => {
              const winners = prizes.filter((prize) => prize.place === place);
              if (!winners.length) {
                return (
                  <tr key={place}>
                    <th scope="row">{PLACE_LABELS[place]}</th>
                    <td colSpan={5 + Number(showEmail) + Number(showTeam)} className="adm-muted">
                      Not chosen yet
                    </td>
                  </tr>
                );
              }
              return winners.map(({ person }, index) => (
                <tr key={`${place}-${person.registrationId}`}>
                  <th scope="row">{index === 0 ? PLACE_LABELS[place] : ''}</th>
                  <td className="adm-mono">{person.registrationId}</td>
                  <td>{person.name}</td>
                  <td>{person.college}</td>
                  <td>{person.department}</td>
                  <td>{person.year}</td>
                  {showEmail && <td>{person.email ?? ''}</td>}
                  {showTeam && <td>{person.team ?? ''}</td>}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {result.previousSubmissions.length > 0 && (
        <p className="adm-muted">Earlier: {result.previousSubmissions.map((item) => `#${item.number} by ${item.submittedBy} ${when(item.submittedAt)}`).join('; ')}</p>
      )}
    </section>
  );
}

function People({ people, showEmail, showTeam, empty, muted = false }: { people: Person[]; showEmail: boolean; showTeam: boolean; empty: string; muted?: boolean }) {
  if (!people.length) return empty ? <p className="adm-muted">{empty}</p> : null;
  return (
    <div className="adm-table-wrap">
      <table className={`adm-table adm-table--static${muted ? ' adm-table--muted' : ''}`}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Registration ID</th>
            <th scope="col">Name</th>
            <th scope="col">College</th>
            <th scope="col">Department</th>
            <th scope="col">Year</th>
            {showEmail && <th scope="col">Email</th>}
            {showTeam && <th scope="col">Team</th>}
          </tr>
        </thead>
        <tbody>
          {people.map((person, index) => (
            <tr key={person.registrationId}>
              <td>{index + 1}</td>
              <td className="adm-mono">{person.registrationId}</td>
              <td>{person.name}</td>
              <td>{person.college}</td>
              <td>{person.department}</td>
              <td>{person.year}</td>
              {showEmail && <td>{person.email ?? ''}</td>}
              {showTeam && <td>{person.team ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
