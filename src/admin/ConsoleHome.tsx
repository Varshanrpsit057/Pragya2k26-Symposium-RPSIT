/**
 * Home (web assist team): the whole portal at a glance, like a cloud console's home page.
 *
 * - Health: is the server answering, the registration phase, the backups, help requests, who is
 *   signed in, this device's connection
 * - Switched off right now: every part of the portal that is off, each turned on again in one tap
 * - Needs attention: payments waiting for a desk, failed sign-ins, test data, events without results
 * - Emergency controls: pause or resume everything, keep registration open longer or close it,
 *   the website notice, back up now and the full Excel copy
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatIst, parseEventStart } from '../lib/countdown';
import { awaitingCheck, isActive } from '../lib/fest';
import { LOGIN_LABELS, LOGIN_ROLES, SWITCH_INFO, type BackupStatus, type PortalSettings, type SwitchName } from '../lib/portal';
import { NOTICE_MAX } from '../lib/testTools';
import type { SessionInfo } from '../lib/staff';
import { SignedOut, currentAdmin, listHelp, setRegistrationWindow, setSiteNotice, signedInNow, staffSignInFailures, type WindowRequest } from './adminApi';
import { NO_FILTERS, useFest } from './fest/FestData';
import { fetchPortal, savePortal, type PortalView } from './fest/festApi';
import { istInput } from './RegistrationWindowPanel';
import { BackupButtons, BackupLines, CHECKS, check, checkLabel, checkTone, type Check } from './SystemPanel';
import { ErrorNote, useLiveData, when } from './ui';

interface HomeProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
  onSession: (session: SessionInfo) => void;
  /** Opens another section. */
  onGo: (section: string) => void;
}

/** The parts "Pause everything" switches off (sign-in and downloads stay as they are). */
const PAUSABLE: SwitchName[] = ['selfRegistration', 'onlinePayment', 'studentLookup', 'deskRegistration', 'eventEntry', 'results'];
const SWITCHES = Object.keys(SWITCH_INFO) as SwitchName[];
const MINUTE = 60_000;
/** Who is signed in, in a few words: [one, several]. */
const WHO: Record<string, [string, string]> = {
  ADMIN: ['web assist', 'web assist'],
  OVERALL: ['overall coordinator', 'overall coordinators'],
  DEPT_ADMIN: ['department admin', 'department admins'],
  DESK: ['desk', 'desks'],
  COORDINATOR: ['event coordinator', 'event coordinators'],
};
const PHASE: Record<SessionInfo['phase'], string> = {
  online: 'Online registration open',
  between: 'Between online and on-site',
  onsite: 'On-site registration open',
  closed: 'Registration closed',
};

export function ConsoleHome({ token, session, onSignedOut, onSession, onGo }: HomeProps) {
  const { registrations, results, catalog, online, outbox, setFilters } = useFest();
  const portal = useLiveData(useCallback(() => fetchPortal(token), [token]), onSignedOut, 30_000);
  const help = useLiveData(useCallback(() => listHelp(token), [token]), onSignedOut, 30_000);
  const people = useLiveData(useCallback(() => signedInNow(token), [token]), onSignedOut, 30_000);
  const failures = useLiveData(useCallback(() => staffSignInFailures(token), [token]), onSignedOut, 60_000);
  const [server, setServer] = useState<Omit<Check, 'name' | 'url'> | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const ping = useCallback(async () => {
    setServer({ state: 'waiting', ms: null, note: 'Checking…' });
    setServer(await check(CHECKS[CHECKS.length - 1].url));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void ping(), 0);
    return () => window.clearTimeout(timer);
  }, [ping]);

  /** Runs a change after a yes, then refreshes what it touches. */
  const run = async (key: string, question: string, work: () => Promise<unknown>, done: string) => {
    if (question && !window.confirm(question)) return;
    setBusy(key);
    setError(null);
    setNote('');
    try {
      const answer = await work();
      if (answer && typeof answer === 'object' && 'portal' in answer) portal.setData(answer as PortalView);
      setNote(done);
      void currentAdmin(token).then(onSession, () => undefined);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy('');
    }
  };

  const settings = portal.data?.portal;
  const off = settings ? SWITCHES.filter((name) => !settings[name]) : [];
  const loginsOff = settings ? LOGIN_ROLES.filter((role) => !settings.logins[role]) : [];
  const paused = settings ? PAUSABLE.every((name) => !settings[name]) : false;
  const allOn = settings ? PAUSABLE.every((name) => settings[name]) : true;

  // The server's time with the session (checked every minute): no clock read while drawing.
  const now = Date.parse(session.serverTime);
  const closesAt = session.schedule.onsiteClosesAt ? parseEventStart(session.schedule.onsiteClosesAt) : null;
  const longer = Math.ceil((Math.max(now, closesAt ?? now) + 60 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE;
  const window_ = (change: WindowRequest) => () => setRegistrationWindow(token, change);

  const active = [...registrations.values()].filter(isActive);
  const waiting = active.filter(awaitingCheck);
  const openHelp = help.data?.filter((request) => request.status === 'OPEN').length ?? 0;
  const lastHour = failures.data?.filter((item) => now - Date.parse(item.at) < 60 * MINUTE) ?? [];
  const activeEvents = catalog?.events.filter((event) => event.active) ?? [];
  const submitted = activeEvents.filter((event) => results.get(event.id)?.submitted).length;
  const byRole = new Map<string, number>();
  for (const person of people.data ?? []) byRole.set(person.role, (byRole.get(person.role) ?? 0) + 1);
  const noticeText = notice ?? session.testing?.notice ?? '';
  const lastBackup = backup !== undefined ? backup : portal.data?.backup;

  return (
    <main className="adm-page adm-home">
      <section className="adm-card adm-pad" aria-label="Health">
        <h2 className="adm-h2">Health</h2>
        <div className="adm-tiles">
          <Tile title="Server" tone={server ? checkTone(server.state) : 'plain'} value={server ? checkLabel(server.state) : '…'} sub={server ? `${server.note}${server.ms !== null ? ` · ${server.ms} ms` : ''}` : ''}>
            <button className="adm-button adm-button--small" type="button" onClick={() => void ping()}>
              Check again
            </button>
          </Tile>
          <Tile
            title="Registration"
            tone={session.phase === 'closed' ? 'bad' : session.phase === 'between' ? 'warn' : 'good'}
            value={PHASE[session.phase]}
            sub={session.phase === 'onsite' && closesAt ? `until ${formatIst(closesAt)}` : session.phase === 'online' && session.schedule.onlineClosesAt ? `until ${formatIst(parseEventStart(session.schedule.onlineClosesAt)!)}` : ''}
          >
            <button className="adm-button adm-button--small" type="button" onClick={() => onGo('window')}>
              Times & notice
            </button>
          </Tile>
          <Tile title="Backups" tone={!lastBackup ? 'warn' : lastBackup.file === 'failed' || lastBackup.sheet === 'failed' ? 'bad' : 'good'} value={lastBackup ? `Last ${when(lastBackup.at)}` : 'None yet'} sub="Every 10 minutes">
            <button className="adm-button adm-button--small" type="button" onClick={() => onGo('system')}>
              Health & backups
            </button>
          </Tile>
          <Tile title="Help requests" tone={openHelp ? 'warn' : 'good'} value={openHelp ? `${openHelp} open` : 'None open'}>
            <button className="adm-button adm-button--small" type="button" onClick={() => onGo('help')}>
              Answer
            </button>
          </Tile>
          <Tile
            title="Signed in now"
            tone="plain"
            value={String(people.data?.length ?? '…')}
            sub={[...byRole.entries()].map(([role, count]) => `${count} ${(WHO[role] ?? [role, role])[count === 1 ? 0 : 1]}`).join(' · ')}
          >
            <button className="adm-button adm-button--small" type="button" onClick={() => onGo('staff')}>
              Accounts
            </button>
          </Tile>
          <Tile title="This device" tone={online ? (outbox.length ? 'warn' : 'good') : 'bad'} value={online ? 'Connected' : 'No connection'} sub={outbox.length ? `${outbox.length} change(s) waiting to send` : 'Nothing waiting to send'} />
        </div>
      </section>

      <section className="adm-card adm-pad" aria-label="Switched off right now">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Switched off right now</h2>
          <button className="adm-button adm-button--small" type="button" onClick={() => onGo('controls')}>
            All switches
          </button>
        </div>
        {!settings ? (
          <p className="adm-muted">Loading…</p>
        ) : off.length + loginsOff.length === 0 ? (
          <p className="fest-match is-good">✓ Every part of the portal is on, and every role can sign in.</p>
        ) : (
          <ul className="adm-offlist">
            {off.map((name) => (
              <li key={name}>
                <div>
                  <strong>{SWITCH_INFO[name].label}</strong>
                  <span className="adm-muted">{SWITCH_INFO[name].off}</span>
                </div>
                <button className="adm-button adm-button--small adm-button--approve" type="button" disabled={busy !== ''} onClick={() => void run(name, '', () => savePortal(token, { [name]: true }), `${SWITCH_INFO[name].label}: on.`)}>
                  Turn on
                </button>
              </li>
            ))}
            {loginsOff.map((role) => (
              <li key={role}>
                <div>
                  <strong>Sign-in: {LOGIN_LABELS[role]}</strong>
                  <span className="adm-muted">They cannot sign in.</span>
                </div>
                <button
                  className="adm-button adm-button--small adm-button--approve"
                  type="button"
                  disabled={busy !== ''}
                  onClick={() => void run(`login-${role}`, '', () => savePortal(token, { logins: { [role]: true } as PortalSettings['logins'] }), `${LOGIN_LABELS[role]} can sign in again.`)}
                >
                  Turn on
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="adm-card adm-pad" aria-label="Needs attention">
        <h2 className="adm-h2">Needs attention</h2>
        <ul className="adm-offlist">
          <Attention
            count={waiting.length}
            label={`${waiting.length} payment${waiting.length === 1 ? '' : 's'} sent by students, waiting for a desk to check`}
            button="See them"
            onClick={() => {
              setFilters({ ...NO_FILTERS, entry: 'WAITING' });
              onGo('registrations');
            }}
          />
          <Attention count={lastHour.length} label={`${lastHour.length} failed sign-in${lastHour.length === 1 ? '' : 's'} in the last hour (${[...new Set(lastHour.map((item) => item.username))].slice(0, 4).join(', ')})`} button="Sign-in problems" onClick={() => onGo('staff')} />
          <Attention count={session.testing?.session ? 1 : 0} label={`A test session is on (${session.testing?.session ?? ''}): new registrations are marked TEST`} button="Testing" onClick={() => onGo('testing')} />
          <Attention count={session.phase === 'closed' && submitted < activeEvents.length ? activeEvents.length - submitted : 0} label={`${activeEvents.length - submitted} event${activeEvents.length - submitted === 1 ? '' : 's'} without submitted results`} button="Results" onClick={() => onGo('results')} />
        </ul>
        {waiting.length + lastHour.length === 0 && !session.testing?.session && <p className="fest-match is-good">✓ Nothing needs attention.</p>}
      </section>

      <section className="adm-card adm-pad" aria-label="Emergency controls">
        <h2 className="adm-h2">Emergency controls</h2>
        {note && (
          <p className="adm-note" role="status">
            {note}
          </p>
        )}
        <ErrorNote error={error ?? portal.error} />

        <div className="adm-emergency">
          <div>
            <h3 className="adm-h3">The whole portal</h3>
            <p className="adm-muted">Pause stops student registration, payment, lookups, desk registration, event entry and results at once. Sign-in and downloads stay on.</p>
            <span className="adm-inline adm-inline--wrap">
              <button
                className="adm-button adm-button--danger-outline"
                type="button"
                disabled={busy !== '' || !settings || paused}
                onClick={() =>
                  void run('pause', 'Pause everything?\n\nStudents cannot register, pay or look up their ID; desks cannot register; coordinators cannot enter students or results, until you resume.', () => savePortal(token, Object.fromEntries(PAUSABLE.map((name) => [name, false])) as Partial<PortalSettings>), 'Everything is paused.')
                }
              >
                {busy === 'pause' ? 'Pausing…' : 'Pause everything'}
              </button>
              <button className="adm-button adm-button--approve" type="button" disabled={busy !== '' || !settings || allOn} onClick={() => void run('resume', 'Turn every part back on?', () => savePortal(token, Object.fromEntries(PAUSABLE.map((name) => [name, true])) as Partial<PortalSettings>), 'Everything is on again.')}>
                {busy === 'resume' ? 'Resuming…' : 'Resume everything'}
              </button>
            </span>
          </div>

          <div>
            <h3 className="adm-h3">Registration time</h3>
            <p className="adm-muted">{session.phase === 'onsite' && closesAt ? `On-site registration closes ${formatIst(closesAt)}.` : `${PHASE[session.phase]}.`}</p>
            <span className="adm-inline adm-inline--wrap">
              <button
                className="adm-button adm-button--primary"
                type="button"
                disabled={busy !== ''}
                onClick={() => void run('longer', `Keep on-site registration open until ${formatIst(longer)}?`, window_({ action: 'onsite-until', onsiteClosesAt: istInput(longer) }), `On-site registration is open until ${formatIst(longer)}.`)}
              >
                {busy === 'longer' ? 'Saving…' : `Open until ${formatIst(longer)}`}
              </button>
              <button
                className="adm-button adm-button--danger-outline"
                type="button"
                disabled={busy !== '' || session.phase === 'closed'}
                onClick={() => void run('close', 'Close every registration now?\n\nThe desks and the website stop registering students at once.', window_({ action: 'close-now' }), 'Registration is closed.')}
              >
                {busy === 'close' ? 'Saving…' : 'Close registration now'}
              </button>
            </span>
          </div>

          <div>
            <h3 className="adm-h3">Notice on the website</h3>
            <label className="adm-field">
              <span>
                One line on every page ({noticeText.length}/{NOTICE_MAX})
              </span>
              <input value={noticeText} maxLength={NOTICE_MAX} placeholder="e.g. Hackathon has moved to LH-05 at 12:15 PM." onChange={(event) => setNotice(event.target.value)} />
            </label>
            <span className="adm-inline adm-inline--wrap">
              <button
                className="adm-button adm-button--primary"
                type="button"
                disabled={busy !== '' || !noticeText.trim() || noticeText.trim() === session.testing?.notice}
                onClick={() => void run('notice', `Show this notice on every page?\n\n${noticeText.trim()}`, () => setSiteNotice(token, noticeText.trim()), 'The notice is up: open pages show it within two minutes.')}
              >
                {session.testing?.notice ? 'Update the notice' : 'Show the notice'}
              </button>
              <button
                className="adm-button adm-button--danger-outline"
                type="button"
                disabled={busy !== '' || !session.testing?.notice}
                onClick={() =>
                  void run('notice', 'Take the notice down?', () => setSiteNotice(token, ''), 'The notice is down.').then(() => setNotice(null))
                }
              >
                Take it down
              </button>
            </span>
          </div>

          <div>
            <h3 className="adm-h3">Backups</h3>
            <BackupLines status={lastBackup} />
            <BackupButtons token={token} onSignedOut={onSignedOut} onBackup={setBackup} />
          </div>
        </div>
      </section>
    </main>
  );
}

function Tile({ title, value, sub, tone, children }: { title: string; value: string; sub?: string; tone: 'good' | 'bad' | 'warn' | 'plain'; children?: ReactNode }) {
  return (
    <div className={`adm-tile is-${tone}`}>
      <span className="adm-tile__title">{title}</span>
      <strong className="adm-tile__value">{value}</strong>
      {sub && <span className="adm-tile__sub">{sub}</span>}
      {children && <span className="adm-tile__action">{children}</span>}
    </div>
  );
}

function Attention({ count, label, button, onClick }: { count: number; label: string; button: string; onClick: () => void }) {
  if (!count) return null;
  return (
    <li>
      <div>
        <strong>{label}</strong>
      </div>
      <button className="adm-button adm-button--small" type="button" onClick={onClick}>
        {button}
      </button>
    </li>
  );
}
