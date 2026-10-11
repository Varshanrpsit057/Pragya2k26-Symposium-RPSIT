/**
 * Testing (admins): rehearse the event on the live website before the day.
 *
 * - The timeline: make the website and the API behave as if it were the event day (or before
 *   or after it) right now, or at the times you set, then go back to the real schedule.
 * - The test session: while it is on, everything registered (desk or online) and every help
 *   request is marked TEST.
 * - Deleting test data: only the TEST records go (saved to a backup file first). A record
 *   marked by mistake can be kept first: real students' registrations are never deleted here.
 */
import { useCallback, useState } from 'react';
import { formatIst, parseEventStart } from '../lib/countdown';
import type { SessionInfo } from '../lib/staff';
import { CLEAR_PHRASE, type ClearResult, type TimelineMode } from '../lib/testTools';
import { SignedOut, clearTestData, currentAdmin, markTest, setTimeline, startTestSession, stopTestSession, testingState, type TimelineRequest } from './adminApi';
import { Badge, ErrorNote, LiveStatus, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
  /** The banner at the top follows at once (other coordinators see it within a minute). */
  onSession?: (session: SessionInfo) => void;
}

const PHASE: Record<string, string> = {
  online: 'Online registration open',
  between: 'Between online and on-site',
  onsite: 'On-site registration (event day)',
  closed: 'Registration closed (from 11:59 AM on the event day)',
};

const MODE: Record<TimelineMode, string> = {
  standard: 'Real schedule',
  'onsite-now': 'On-site registration open now',
  'online-now': 'Online registration open now',
  closed: 'Closed (after the event)',
  custom: 'Custom times',
};

const HOURS = [2, 4, 8, 12, 24];

const shown = (value: string | null) => (value ? formatIst(parseEventStart(value)!) : 'not set');

/** '2026-10-12T09:30' for a datetime-local input, from a schedule time. */
const inputValue = (value: string | null) => (value ? value.slice(0, 16) : '');

export function TestingPanel({ token, onSignedOut, onSession }: PanelProps) {
  const load = useCallback(() => testingState(token), [token]);
  const live = useLiveData(load, onSignedOut, 15_000);
  const state = live.data;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [hours, setHours] = useState(12);
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState<{ onlineClosesAt: string; onsiteOpensAt: string; onsiteClosesAt: string } | null>(null);
  const [markId, setMarkId] = useState('');
  const [options, setOptions] = useState({ results: true, helpRequests: true, restartDeskIds: true, finish: true });
  const [phrase, setPhrase] = useState('');
  const [cleared, setCleared] = useState<ClearResult[] | null>(null);

  const run = async (what: string, task: () => Promise<unknown>, done: string) => {
    setBusy(what);
    setError(null);
    setNote('');
    try {
      await task();
      setNote(done);
      live.refresh();
      if (onSession) void currentAdmin(token).then(onSession, () => undefined);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy('');
    }
  };

  const timeline = (change: TimelineRequest, done: string) => run('timeline', () => setTimeline(token, change), done);

  const clear = () =>
    run(
      'clear',
      async () => {
        const rounds: ClearResult[] = [];
        // Each call works for a few seconds; go on until nothing is left (or nothing moves).
        for (let round = 0; round < 25; round += 1) {
          const result = await clearTestData(token, { results: options.results, helpRequests: options.helpRequests, restartDeskIds: options.restartDeskIds && state?.realOnsite === 0 });
          rounds.push(result);
          if (result.remaining === 0 || result.cleared === 0) break;
        }
        setCleared(rounds);
        if (options.finish) {
          await stopTestSession(token);
          await setTimeline(token, { mode: 'standard' });
        }
        setPhrase('');
      },
      options.finish ? 'Test data deleted, the test session ended and the website is back on the real schedule.' : 'Test data deleted.',
    );

  if (!state) {
    return (
      <main className="adm-page">
        <section className="adm-card adm-pad">
          <h2 className="adm-h2">Testing</h2>
          <ErrorNote error={live.error} />
          {!live.error && <p className="adm-muted">Loading…</p>}
        </section>
      </main>
    );
  }

  const { timeline: now, session, records } = state;
  const editing = custom ?? { onlineClosesAt: inputValue(now.schedule.onlineClosesAt), onsiteOpensAt: inputValue(now.schedule.onsiteOpensAt), onsiteClosesAt: inputValue(now.schedule.onsiteClosesAt) };
  const total = cleared?.reduce((sum, round) => sum + round.cleared, 0) ?? 0;

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad" aria-label="Testing">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Testing</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p className="adm-muted">
          Rehearse the event on the live website: start a test session, set the timeline, test the desk, the events and Student login, then delete the test data. Real students' registrations are never deleted here.
        </p>
        <ErrorNote error={error} />
        {note && (
          <p className="adm-note" role="status">
            {note}
          </p>
        )}

        <h3 className="adm-h3">Quick start</h3>
        <div className="adm-inline">
          <label className="adm-field">
            <span>Session name (optional)</span>
            <input value={label} maxLength={60} placeholder="e.g. Rehearsal with the desk team" onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="adm-field">
            <span>On-site open for</span>
            <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
              {HOURS.map((value) => (
                <option key={value} value={value}>
                  {value} hours
                </option>
              ))}
            </select>
          </label>
          <button
            className="adm-button adm-button--primary adm-button--big"
            type="button"
            disabled={busy !== ''}
            onClick={() =>
              void run(
                'start',
                async () => {
                  await startTestSession(token, label);
                  await setTimeline(token, { mode: 'onsite-now', hours });
                },
                `Event-day test started: the website is in on-site mode for ${hours} hours and everything registered now is marked TEST.`,
              )
            }
          >
            Start an event-day test
          </button>
        </div>
      </section>

      <section className="adm-card adm-pad" aria-label="Timeline">
        <h3 className="adm-h3">Timeline</h3>
        <p>
          <Badge tone={now.override ? 'warn' : 'good'}>{now.override ? `Test timeline: ${MODE[now.override.mode]}` : 'Real schedule'}</Badge> <Badge tone="plain">{PHASE[now.phase]}</Badge>
        </p>
        {now.override && (
          <p className="adm-muted">
            Set by {now.override.setBy} {when(now.override.setAt)}.
          </p>
        )}
        <ul className="adm-muted">
          <li>Online registration closes: {shown(now.schedule.onlineClosesAt)}</li>
          <li>On-site registration opens: {shown(now.schedule.onsiteOpensAt)}</li>
          <li>On-site registration closes: {shown(now.schedule.onsiteClosesAt)}</li>
        </ul>
        <p className="adm-note">
          The live website follows the timeline within seconds, for everyone: while a test timeline is on, online registration opens or closes with it. Go back to the real schedule when you finish.
        </p>
        <div className="adm-inline">
          <button className="adm-button" type="button" disabled={busy !== ''} onClick={() => void timeline({ mode: 'onsite-now', hours }, `On-site registration is open now, for ${hours} hours.`)}>
            On-site open now ({hours} h)
          </button>
          <button className="adm-button" type="button" disabled={busy !== ''} onClick={() => void timeline({ mode: 'online-now', hours }, `Online registration is open now, for ${hours} hours.`)}>
            Online open now ({hours} h)
          </button>
          <button className="adm-button" type="button" disabled={busy !== ''} onClick={() => void timeline({ mode: 'closed' }, 'Registration is closed now (as after the event).')}>
            Closed (after the event)
          </button>
          <button className="adm-button adm-button--approve" type="button" disabled={busy !== '' || !now.override} onClick={() => void timeline({ mode: 'standard' }, 'Back on the real schedule.')}>
            Back to the real schedule
          </button>
        </div>
        <details className="adm-details">
          <summary>Set your own day and times</summary>
          <div className="adm-inline">
            {(
              [
                ['onlineClosesAt', 'Online registration closes'],
                ['onsiteOpensAt', 'On-site registration opens'],
                ['onsiteClosesAt', 'On-site registration closes'],
              ] as const
            ).map(([name, title]) => (
              <label key={name} className="adm-field">
                <span>{title} (IST)</span>
                <input type="datetime-local" value={editing[name]} onChange={(event) => setCustom({ ...editing, [name]: event.target.value })} />
              </label>
            ))}
            <button
              className="adm-button adm-button--primary"
              type="button"
              disabled={busy !== '' || !editing.onlineClosesAt || !editing.onsiteOpensAt || !editing.onsiteClosesAt}
              onClick={() => void timeline({ mode: 'custom', schedule: editing }, 'Your timeline is set.').then(() => setCustom(null))}
            >
              Use these times
            </button>
          </div>
        </details>
      </section>

      <section className="adm-card adm-pad" aria-label="Test session">
        <h3 className="adm-h3">Test session</h3>
        {session ? (
          <>
            <p>
              <Badge tone="warn">On</Badge> <strong>{session.label}</strong> · started by {session.startedBy} {when(session.startedAt)}
            </p>
            <p className="adm-muted">Everything registered now, at the desk or online, and every help request is marked TEST.</p>
            <button className="adm-button" type="button" disabled={busy !== ''} onClick={() => void run('stop', () => stopTestSession(token), 'Test session ended: nothing new is marked TEST.')}>
              End the test session
            </button>
          </>
        ) : (
          <>
            <p className="adm-muted">No test session. Start one so that what you register while testing is marked TEST and can be deleted afterwards.</p>
            <button className="adm-button adm-button--primary" type="button" disabled={busy !== ''} onClick={() => void run('start', () => startTestSession(token, label), 'Test session started.')}>
              Start a test session
            </button>
          </>
        )}
      </section>

      <section className="adm-card adm-pad" aria-label="Test data">
        <h3 className="adm-h3">Test data ({records.length})</h3>
        <p className="adm-muted">
          {state.helpRequests} test help request{state.helpRequests === 1 ? '' : 's'} · event results stored for {state.results.length ? state.results.join(', ') : 'no event'}
        </p>
        {records.length === 0 ? (
          <p className="adm-muted">No registrations are marked TEST.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Made</th>
                  <th>Status</th>
                  <th>
                    <span className="adm-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.registrationId}>
                    <td className="adm-mono">{record.registrationId}</td>
                    <td>
                      {record.name}
                      <div className="adm-muted">{record.college}</div>
                    </td>
                    <td className="adm-mono">{record.phone}</td>
                    <td>
                      {record.source === 'ONSITE' ? `Desk${record.createdBy ? ` (${record.createdBy})` : ''}` : 'Online'}
                      <div className="adm-muted">{when(record.submittedAt)}</div>
                    </td>
                    <td>{record.status}</td>
                    <td>
                      <button
                        className="adm-button adm-button--small"
                        type="button"
                        disabled={busy !== ''}
                        onClick={() => void run('keep', () => markTest(token, record.registrationId, false), `${record.registrationId} is kept: not test data.`)}
                      >
                        Keep: a real student
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="adm-inline"
          onSubmit={(event) => {
            event.preventDefault();
            const id = markId.trim().toUpperCase();
            if (id) void run('mark', () => markTest(token, id, true), `${id} is marked TEST.`).then(() => setMarkId(''));
          }}
        >
          <label className="adm-field">
            <span>Mark a record made before the session as TEST</span>
            <input value={markId} maxLength={20} placeholder="Registration ID, e.g. 262003" onChange={(event) => setMarkId(event.target.value)} />
          </label>
          <button className="adm-button" type="submit" disabled={busy !== '' || !markId.trim()}>
            Mark as test
          </button>
        </form>
      </section>

      <section className="adm-card adm-pad" aria-label="Delete test data">
        <h3 className="adm-h3">Delete test data</h3>
        <p className="adm-muted">
          Deletes the {records.length} TEST registration{records.length === 1 ? '' : 's'} above with their payments, attendance and files. They are saved to a private backup file first, their Google Sheet rows
          are marked TEST CLEARED, and their phone numbers and emails can be used again.
        </p>
        <div className="adm-form">
          <label className="adm-check">
            <input type="checkbox" checked={options.results} onChange={(event) => setOptions({ ...options, results: event.target.checked })} />
            <span>Also clear every event's winners and submitted results (before the event day only)</span>
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={options.helpRequests} onChange={(event) => setOptions({ ...options, helpRequests: event.target.checked })} />
            <span>Also delete the test help requests ({state.helpRequests})</span>
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={options.restartDeskIds && state.realOnsite === 0} disabled={state.realOnsite > 0} onChange={(event) => setOptions({ ...options, restartDeskIds: event.target.checked })} />
            <span>
              Start desk IDs again at 262001
              {state.realOnsite > 0 && ` (not possible: ${state.realOnsite} desk registration${state.realOnsite === 1 ? ' is' : 's are'} not test data)`}
            </span>
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={options.finish} onChange={(event) => setOptions({ ...options, finish: event.target.checked })} />
            <span>Then end the test session and go back to the real schedule (the website goes live as planned)</span>
          </label>
          <label className="adm-field">
            <span>
              Type <strong className="adm-mono">{CLEAR_PHRASE}</strong> to confirm
            </span>
            <input value={phrase} autoComplete="off" onChange={(event) => setPhrase(event.target.value)} />
          </label>
        </div>
        <button className="adm-button adm-button--danger adm-button--big" type="button" disabled={busy !== '' || phrase.trim() !== CLEAR_PHRASE} onClick={() => void clear()}>
          {busy === 'clear' ? 'Deleting…' : `Delete the test data (${records.length})`}
        </button>
        {cleared && (
          <p className="adm-note" role="status">
            Deleted {total} test record{total === 1 ? '' : 's'}
            {cleared.some((round) => round.results) && `, ${cleared.reduce((sum, round) => sum + round.results, 0)} event results`}
            {cleared.some((round) => round.helpRequests) && `, ${cleared.reduce((sum, round) => sum + round.helpRequests, 0)} help requests`}
            {cleared.some((round) => round.deskIdsRestarted) && '; desk IDs start again at 262001'}
            {cleared.some((round) => round.backup) && (
              <>
                . Backup: <span className="adm-mono">{cleared.map((round) => round.backup).filter(Boolean).join(', ')}</span>
              </>
            )}
            {cleared[cleared.length - 1].remaining > 0 && `. ${cleared[cleared.length - 1].remaining} could not be deleted yet: try again.`}
          </p>
        )}
      </section>
    </main>
  );
}
