/**
 * Event-day controls (admins): the notice on the website, and the registration times.
 *
 * The notice: one line every open page of the website and the student page shows within two
 * minutes (e.g. "COGNIX has moved to LH-05"), until taken down.
 *
 * Registration times: the planned schedule and any change to it. Reopen or extend
 * on-site registration (e.g. the desks stay open until 2 PM), close every registration now, or
 * set all three times; or go back to the plan. The API, the desks, Student login and the
 * website follow within seconds.
 */
import { useCallback, useState } from 'react';
import { formatIst, parseEventStart } from '../lib/countdown';
import type { RegistrationSchedule } from '../lib/schedule';
import type { SessionInfo } from '../lib/staff';
import { NOTICE_MAX, type RegistrationWindowView } from '../lib/testTools';
import { SignedOut, currentAdmin, registrationWindow, setRegistrationWindow, setSiteNotice, siteNotice, type WindowRequest } from './adminApi';
import { Badge, ErrorNote, LiveStatus, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
  /** The header follows at once (other coordinators see the change within a minute). */
  onSession?: (session: SessionInfo) => void;
}

const MINUTE = 60_000;
const PHASE: Record<RegistrationWindowView['phase'], string> = {
  online: 'Online registration open',
  between: 'Between online and on-site registration',
  onsite: 'On-site registration open',
  closed: 'Registration closed',
};
const TIMES = [
  ['onlineClosesAt', 'Online registration closes'],
  ['onsiteOpensAt', 'On-site registration opens'],
  ['onsiteClosesAt', 'On-site registration closes'],
] as const;

const shown = (value: string | null) => (value ? formatIst(parseEventStart(value)!) : 'not set');
/** A moment as a datetime-local value in IST ('2026-10-17T14:00'), whatever the laptop's time zone. */
const istInput = (ms: number) => new Date(ms + 330 * MINUTE).toISOString().slice(0, 16);
const inputValue = (value: string | null) => (value ? value.slice(0, 16) : '');
/** Now plus `minutes`, rounded up to the next 5 minutes. */
const fromNow = (now: number, minutes: number) => Math.ceil((now + minutes * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;

export function RegistrationWindowPanel({ token, onSignedOut, onSession }: PanelProps) {
  const load = useCallback(() => registrationWindow(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const state = live.data;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const [custom, setCustom] = useState<Record<keyof RegistrationSchedule, string> | null>(null);

  const run = async (what: string, change: WindowRequest, question: string, done: string) => {
    if (!window.confirm(question)) return;
    setBusy(what);
    setError(null);
    setNote('');
    try {
      live.setData(await setRegistrationWindow(token, change));
      setNote(done);
      setCustom(null);
      if (onSession) void currentAdmin(token).then(onSession, () => undefined);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy('');
    }
  };

  if (!state) {
    return (
      <main className="adm-page">
        <NoticeCard token={token} onSignedOut={onSignedOut} onSession={onSession} />
        <section className="adm-card adm-pad">
          <h2 className="adm-h2">Registration times</h2>
          <ErrorNote error={live.error} />
          {!live.error && <p className="adm-muted">Loading…</p>}
        </section>
      </main>
    );
  }

  const now = Date.parse(state.serverTime);
  const untilValue = until || istInput(fromNow(now, 60));
  const untilShown = shown(`${untilValue}:00`);
  const editing = custom ?? { onlineClosesAt: inputValue(state.real.onlineClosesAt), onsiteOpensAt: inputValue(state.real.onsiteOpensAt), onsiteClosesAt: inputValue(state.real.onsiteClosesAt) };
  const notOpenYet = !state.real.onsiteOpensAt || (parseEventStart(state.real.onsiteOpensAt) ?? 0) > now;

  return (
    <main className="adm-page">
      <NoticeCard token={token} onSignedOut={onSignedOut} onSession={onSession} />
      <section className="adm-card adm-pad" aria-label="Registration times">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Registration times</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p>
          <Badge tone={state.phase === 'closed' ? 'bad' : state.phase === 'between' ? 'warn' : 'good'}>{PHASE[state.phase]}</Badge>{' '}
          <Badge tone={state.changed ? 'warn' : 'plain'}>{state.changed ? 'Changed by an admin' : 'As planned'}</Badge>
        </p>
        {state.changed && (
          <p className="adm-muted">
            Changed by {state.changed.setBy} {when(state.changed.setAt)}.
          </p>
        )}
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Now</th>
                <th scope="col">Planned</th>
              </tr>
            </thead>
            <tbody>
              {TIMES.map(([name, title]) => (
                <tr key={name}>
                  <th scope="row">{title}</th>
                  <td>{shown(state.real[name])}</td>
                  <td className="adm-muted">{shown(state.planned[name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-muted">The website, the registration desks, Student login and the API all follow these times within seconds.</p>
        {state.testTimeline && (
          <p className="adm-note">
            A test timeline is on (Testing): the website follows it instead until it is set back to the real schedule. Changes made here apply from then on.
          </p>
        )}
        {note && (
          <p className="adm-note" role="status">
            {note}
          </p>
        )}
        <ErrorNote error={error} />
      </section>

      <section className="adm-card adm-pad" aria-label="Reopen or extend on-site registration">
        <h3 className="adm-h3">Reopen or extend on-site registration</h3>
        <p className="adm-muted">
          The desks can register students until the time you set{notOpenYet ? '. On-site registration has not opened yet: it opens now, and online registration closes.' : '.'}
        </p>
        <div className="adm-inline adm-inline--wrap">
          {[
            [30, '+30 minutes'],
            [60, '+1 hour'],
            [120, '+2 hours'],
          ].map(([minutes, label]) => (
            <button key={label} className="adm-button adm-button--small" type="button" onClick={() => setUntil(istInput(fromNow(now, minutes as number)))}>
              {label}
            </button>
          ))}
        </div>
        <div className="adm-inline adm-inline--wrap">
          <label className="adm-field">
            <span>Open until (IST)</span>
            <input type="datetime-local" value={untilValue} onChange={(event) => setUntil(event.target.value)} />
          </label>
          <button
            className="adm-button adm-button--primary"
            type="button"
            disabled={busy !== '' || !untilValue}
            onClick={() =>
              void run(
                'until',
                { action: 'onsite-until', onsiteClosesAt: untilValue },
                `Open on-site registration until ${untilShown}?\n\nThe desks can register students until then.${notOpenYet ? ' Online registration closes now.' : ''}`,
                `On-site registration is open until ${untilShown}.`,
              )
            }
          >
            {busy === 'until' ? 'Saving…' : `Open until ${untilShown}`}
          </button>
        </div>
      </section>

      <section className="adm-card adm-pad" aria-label="Close registration now">
        <h3 className="adm-h3">Close registration now</h3>
        <p className="adm-muted">Stops online and desk registration at once. GPay approvals, corrections, events and Student login go on.</p>
        <button
          className="adm-button adm-button--danger-outline"
          type="button"
          disabled={busy !== '' || state.phase === 'closed'}
          onClick={() => void run('close', { action: 'close-now' }, 'Close every registration now?\n\nThe desks and the website stop registering students at once.', 'Registration is closed.')}
        >
          {busy === 'close' ? 'Saving…' : 'Close registration now'}
        </button>
      </section>

      <section className="adm-card adm-pad" aria-label="Set all three times">
        <h3 className="adm-h3">Set all three times</h3>
        <div className="adm-inline adm-inline--wrap">
          {TIMES.map(([name, title]) => (
            <label key={name} className="adm-field">
              <span>{title} (IST)</span>
              <input type="datetime-local" value={editing[name]} onChange={(event) => setCustom({ ...editing, [name]: event.target.value })} />
            </label>
          ))}
          <button
            className="adm-button adm-button--primary"
            type="button"
            disabled={busy !== '' || !editing.onlineClosesAt || !editing.onsiteOpensAt || !editing.onsiteClosesAt}
            onClick={() => void run('custom', { action: 'custom', schedule: editing }, 'Use these registration times?', 'The registration times are set.')}
          >
            {busy === 'custom' ? 'Saving…' : 'Use these times'}
          </button>
        </div>
        <button
          className="adm-button adm-button--approve"
          type="button"
          disabled={busy !== '' || !state.changed}
          onClick={() => void run('planned', { action: 'planned' }, 'Go back to the planned registration times?', 'Back to the planned times.')}
        >
          {busy === 'planned' ? 'Saving…' : 'Back to the planned times'}
        </button>
      </section>
    </main>
  );
}

/** The notice on the website and the student page: post, change or take down. */
function NoticeCard({ token, onSignedOut, onSession }: { token: string; onSignedOut: () => void; onSession?: (session: SessionInfo) => void }) {
  const load = useCallback(() => siteNotice(token), [token]);
  const live = useLiveData(load, onSignedOut, 60_000);
  const notice = live.data;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const text = draft ?? notice?.text ?? '';

  const save = async (next: string) => {
    const question = next ? `Show this notice on the website and the student page?\n\n${next}` : 'Take the notice down from the website?';
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    setNote('');
    try {
      live.setData(await setSiteNotice(token, next));
      setDraft(null);
      setNote(next ? 'The notice is up: open pages show it within two minutes.' : 'The notice is down.');
      if (onSession) void currentAdmin(token).then(onSession, () => undefined);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adm-card adm-pad" aria-label="Notice on the website">
      <div className="adm-toolbar">
        <h2 className="adm-h2">Notice on the website</h2>
        <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
      </div>
      <p className="adm-muted">
        One line at the top of the website and the student page, e.g. a venue or time change. Every open page shows it within two minutes, until you take it
        down.
      </p>
      {notice ? (
        <p>
          <Badge tone="warn">Showing now</Badge> <strong>{notice.text}</strong>{' '}
          <span className="adm-muted">
            · by {notice.setBy} {when(notice.setAt)}
          </span>
        </p>
      ) : (
        <p>
          <Badge tone="plain">No notice</Badge>
        </p>
      )}
      <label className="adm-field">
        <span>
          Notice ({text.length}/{NOTICE_MAX})
        </span>
        <textarea rows={2} maxLength={NOTICE_MAX} value={text} placeholder="e.g. COGNIX Round 2 has moved to LH-05 at 12:15 PM." onChange={(event) => setDraft(event.target.value)} />
      </label>
      <div className="adm-inline adm-inline--wrap">
        <button className="adm-button adm-button--primary" type="button" disabled={busy || !text.trim() || text.trim() === notice?.text} onClick={() => void save(text.trim())}>
          {busy ? 'Saving…' : notice ? 'Update the notice' : 'Show the notice'}
        </button>
        <button className="adm-button adm-button--danger-outline" type="button" disabled={busy || !notice} onClick={() => void save('')}>
          Take it down
        </button>
      </div>
      {note && (
        <p className="adm-note" role="status">
          {note}
        </p>
      )}
      <ErrorNote error={live.error ?? error} />
    </section>
  );
}
