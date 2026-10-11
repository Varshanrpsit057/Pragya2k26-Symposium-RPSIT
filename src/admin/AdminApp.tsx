import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminRegistration } from '../lib/admin';
import { formatIst, parseEventStart } from '../lib/countdown';
import type { RegistrationStatus } from '../lib/registration';
import { ROLE_INFO, hasPermission, type Permission, type SessionInfo } from '../lib/staff';
import type { StudentPortalState } from '../lib/student';
import { SignedOut, currentAdmin, listHelp, listRegistrations, myHelp, savedToken, setDeskNumber, setStudentPortal, signIn, signOut, studentPortal } from './adminApi';
import { DeletedPanel } from './DeletedPanel';
import { DeskPanel } from './DeskPanel';
import { EventsPanel } from './EventsPanel';
import { HelpDialog, repliesSeenAt, type HelpContext } from './HelpDialog';
import { HelpPanel } from './HelpPanel';
import { MapEditor } from './MapEditor';
import { RegistrationDialog } from './RegistrationDialog';
import { RegistrationWindowPanel } from './RegistrationWindowPanel';
import { ReportsPanel } from './ReportsPanel';
import { ResultsPanel } from './ResultsPanel';
import { RolesPanel } from './RolesPanel';
import { StaffPanel } from './StaffPanel';
import { SystemPanel } from './SystemPanel';
import { TestingPanel } from './TestingPanel';
import { Badge, ErrorNote, HELP_EVENT, LiveStatus, StatusBadge, messageOf, useLiveData, when } from './ui';

type Filter = RegistrationStatus | 'ALL';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'PENDING', label: 'GPay to verify' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
];

type TabId = 'review' | 'desk' | 'window' | 'events' | 'results' | 'help' | 'system' | 'deleted' | 'map' | 'staff' | 'reports' | 'testing' | 'roles';

/** The dashboard's sections, each shown only to the roles it is for (the server checks again). */
const TABS: { id: TabId; label: (session: SessionInfo) => string; show: (session: SessionInfo) => boolean }[] = [
  { id: 'desk', label: (session) => (can(session, 'registrations.onsite') ? 'Registration desk' : 'Registrations'), show: (session) => can(session, 'registrations.list') },
  { id: 'review', label: () => 'Online payments', show: (session) => session.role === 'ADMIN' },
  { id: 'window', label: () => 'Event-day controls', show: (session) => can(session, 'registration.window') || can(session, 'site.notice') },
  { id: 'events', label: () => 'Events', show: (session) => can(session, 'events.operate') },
  { id: 'results', label: () => 'Results & certificates', show: (session) => can(session, 'results.view') },
  { id: 'help', label: () => 'Help requests', show: (session) => can(session, 'help.manage') },
  { id: 'system', label: () => 'System status', show: (session) => can(session, 'system.view') },
  { id: 'deleted', label: () => 'Deleted', show: (session) => can(session, 'registrations.delete') },
  { id: 'map', label: () => 'Campus map', show: (session) => can(session, 'map.edit') },
  { id: 'staff', label: () => 'Student coordinators', show: (session) => can(session, 'staff.manage') },
  { id: 'reports', label: () => 'Reports', show: (session) => can(session, 'reports.view') },
  { id: 'testing', label: () => 'Testing', show: (session) => can(session, 'system.testing') },
  { id: 'roles', label: () => 'Roles', show: () => true },
];

const can = (session: SessionInfo, permission: Permission) => hasPermission(session.role, permission);

const PHASE_LABEL: Record<SessionInfo['phase'], string> = {
  online: 'Online registration open',
  between: 'Online closed · desk opens at midnight',
  onsite: 'On-site registration open',
  closed: 'Registration closed',
};

export function AdminApp() {
  const [token, setToken] = useState<string | null>(savedToken);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notice, setNotice] = useState('');

  const signedOut = useCallback((message = '') => {
    setToken(null);
    setSession(null);
    setNotice(message);
  }, []);

  // A saved session is checked with the server before anything is shown, then every minute
  // (a changed role, a deactivated account or the registration phase show up on their own).
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    if (!token) return;
    let active = true;
    currentAdmin(token)
      .then((info) => active && setSession(info))
      .catch((error: unknown) => active && signedOut(error instanceof SignedOut ? 'Your session has ended. Please sign in again.' : messageOf(error)));
    return () => {
      active = false;
    };
  }, [token, signedOut, checks]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => setChecks((count) => count + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [token]);

  if (!token) {
    return (
      <LoginForm
        notice={notice}
        onSignedIn={(newToken) => {
          setToken(newToken);
          setNotice('');
        }}
      />
    );
  }
  if (!session) return <p className="adm-loading">Checking your session…</p>;
  return (
    <Shell
      token={token}
      session={session}
      onSession={setSession}
      onSignOut={() => {
        void signOut(token);
        signedOut('You have signed out.');
      }}
      onSignedOut={() => signedOut('Your session has ended. Please sign in again.')}
    />
  );
}

function LoginForm({ notice, onSignedIn }: { notice: string; onSignedIn: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [desk, setDesk] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const typeUsername = (value: string) => {
    setUsername(value);
    // "desk2" is at desk 2.
    const guess = /^desk[-_ ]?(\d{1,2})$/i.exec(value.trim())?.[1];
    if (guess && Number(guess) >= 1 && Number(guess) <= DESK_CHOICES) setDesk(String(Number(guess)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const token = await signIn(username.trim(), password, desk ? Number(desk) : null);
      setPassword('');
      onSignedIn(token);
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };

  return (
    <main className="adm-login">
      <form className="adm-card adm-login__card" onSubmit={submit}>
        <h1 className="adm-login__title">PRAGYA 2026 · Student coordinators</h1>
        <p className="adm-muted">Sign in with your own student coordinator account.</p>
        {notice && <p className="adm-note">{notice}</p>}
        <label className="adm-field">
          <span>Username</span>
          <input value={username} onChange={(event) => typeUsername(event.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label className="adm-field">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        <label className="adm-field">
          <span>Desk number (registration desk only)</span>
          <select value={desk} onChange={(event) => setDesk(event.target.value)}>
            <option value="">Not at a registration desk</option>
            {Array.from({ length: DESK_CHOICES }, (_, index) => index + 1).map((number) => (
              <option key={number} value={number}>
                Desk {number}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="adm-error" role="alert">
            {error}
          </p>
        )}
        <button className="adm-button adm-button--primary adm-button--big" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="adm-button adm-button--help" type="button" onClick={() => setHelp(true)}>
          Problem signing in? Contact admin
        </button>
      </form>
      {help && <HelpDialog token={null} context={{ page: 'Sign-in page', category: 'SIGN_IN', ...(error && { error }) }} onClose={() => setHelp(false)} />}
    </main>
  );
}

/** Desk numbers offered at sign-in and in the header. */
const DESK_CHOICES = 8;

interface ShellProps {
  token: string;
  session: SessionInfo;
  /** The session changed here (e.g. a desk number chosen). */
  onSession: (session: SessionInfo) => void;
  onSignOut: () => void;
  onSignedOut: () => void;
}

function Shell({ token, session, onSession, onSignOut, onSignedOut }: ShellProps) {
  const tabs = TABS.filter((tab) => tab.show(session));
  const [tab, setTab] = useState<TabId>(tabs[0].id);
  const current = tabs.some((item) => item.id === tab) ? tab : tabs[0].id;
  const currentLabel = tabs.find((item) => item.id === current)?.label(session) ?? '';
  const panel = { token, session, onSignedOut };
  const [help, setHelp] = useState<HelpContext | null>(null);

  // "Contact admin" next to any error in the dashboard opens the form with that error.
  useEffect(() => {
    const open = (event: Event) => setHelp({ page: currentLabel, ...(event as CustomEvent<HelpContext>).detail });
    window.addEventListener(HELP_EVENT, open);
    return () => window.removeEventListener(HELP_EVENT, open);
  }, [currentLabel]);

  return (
    <div className="adm">
      <header className="adm-bar">
        <div>
          <h1 className="adm-bar__title">PRAGYA 2026 · Student coordinators</h1>
          <p className="adm-muted adm-bar__phase">
            <Badge tone={session.phase === 'closed' ? 'bad' : session.phase === 'between' ? 'warn' : 'good'}>{PHASE_LABEL[session.phase]}</Badge>
            {session.phase === 'online' && session.schedule.onlineClosesAt && <> until {formatIst(parseEventStart(session.schedule.onlineClosesAt)!)}</>}
            {session.phase === 'onsite' && session.schedule.onsiteClosesAt && <> until {formatIst(parseEventStart(session.schedule.onsiteClosesAt)!)}</>}
          </p>
        </div>
        <div className="adm-bar__side">
          <span className="adm-muted">
            {session.displayName} · {ROLE_INFO[session.role].label}
          </span>
          {session.role === 'DESK' && session.deskNumber && <DeskChip token={token} deskNumber={session.deskNumber} onSession={onSession} onSignedOut={onSignedOut} />}
          <button className="adm-button adm-button--help" type="button" onClick={() => setHelp({ page: currentLabel })}>
            Contact admin
            {!help && <NewReplies token={token} username={session.username} onSignedOut={onSignedOut} />}
          </button>
          <button className="adm-button" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      {(session.testing?.session || session.testing?.timeline) && (
        <p className="adm-test-banner" role="status">
          {session.testing.session && (
            <>
              <strong>Test session on: {session.testing.session}.</strong> Everything registered now is test data, deleted after testing.{' '}
            </>
          )}
          {session.testing.timeline && <strong>The website is following a test timeline.</strong>}
        </p>
      )}
      {session.testing?.notice && (
        <p className="adm-note" role="status">
          <strong>Notice on the website:</strong> {session.testing.notice}
        </p>
      )}
      {session.testing?.window && !session.testing.timeline && (
        <p className="adm-note adm-window-banner" role="status">
          <strong>Registration times changed</strong> by {session.testing.window.setBy} {when(session.testing.window.setAt)}: on-site registration{' '}
          {session.schedule.onsiteClosesAt ? `closes ${formatIst(parseEventStart(session.schedule.onsiteClosesAt)!)}` : 'has no closing time'}.
        </p>
      )}
      {can(session, 'portal.manage') && <StudentPortalSwitch token={token} onSignedOut={onSignedOut} />}
      {session.role === 'DESK' && !session.deskNumber && <DeskChooser token={token} onSession={onSession} onSignedOut={onSignedOut} />}

      <nav className="adm-nav" aria-label="Sections">
        {tabs.map((item) => (
          <button key={item.id} type="button" className="adm-nav__tab" aria-current={item.id === current ? 'page' : undefined} onClick={() => setTab(item.id)}>
            {item.label(session)}
            {item.id === 'help' && <OpenHelpCount token={token} onSignedOut={onSignedOut} />}
          </button>
        ))}
      </nav>

      {current === 'review' && <Dashboard {...panel} />}
      {current === 'desk' && <DeskPanel {...panel} />}
      {current === 'window' && <RegistrationWindowPanel {...panel} onSession={onSession} />}
      {current === 'events' && <EventsPanel {...panel} />}
      {current === 'results' && <ResultsPanel {...panel} />}
      {current === 'help' && <HelpPanel {...panel} />}
      {current === 'system' && <SystemPanel {...panel} />}
      {current === 'deleted' && <DeletedPanel {...panel} />}
      {current === 'testing' && <TestingPanel {...panel} onSession={onSession} />}
      {current === 'map' && <MapEditor />}
      {current === 'staff' && <StaffPanel {...panel} />}
      {current === 'reports' && <ReportsPanel {...panel} />}
      {current === 'roles' && <RolesPanel session={session} />}

      {help && <HelpDialog token={token} signedInAs={session.displayName} username={session.username} context={help} onClose={() => setHelp(null)} />}
    </div>
  );
}

interface DeskProps {
  token: string;
  onSession: (session: SessionInfo) => void;
  onSignedOut: () => void;
}

/** A desk account that did not say which desk it is at chooses it here (the admin sees it). */
function DeskChooser({ token, onSession, onSignedOut, onDone }: DeskProps & { onDone?: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const choose = async (number: number) => {
    setBusy(number);
    setError(null);
    try {
      onSession(await setDeskNumber(token, number));
      onDone?.();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="adm-note adm-desk-choose" aria-label="Choose your desk">
      <strong>Which registration desk are you at?</strong>
      <span className="adm-inline adm-inline--wrap">
        {Array.from({ length: DESK_CHOICES }, (_, index) => index + 1).map((number) => (
          <button key={number} type="button" className="adm-button adm-button--small" disabled={busy !== null} onClick={() => void choose(number)}>
            {busy === number ? 'Saving…' : `Desk ${number}`}
          </button>
        ))}
      </span>
      <ErrorNote error={error} />
    </section>
  );
}

/** The desk this sign-in is at, in the header, with a way to move to another desk. */
function DeskChip({ token, deskNumber, onSession, onSignedOut }: DeskProps & { deskNumber: number }) {
  const [changing, setChanging] = useState(false);
  return (
    <>
      <button type="button" className="adm-button adm-button--small" title="Change desk" onClick={() => setChanging(!changing)}>
        <Badge tone="good">Desk {deskNumber}</Badge>
      </button>
      {changing && (
        <div className="adm-desk-popover">
          <DeskChooser token={token} onSession={onSession} onSignedOut={onSignedOut} onDone={() => setChanging(false)} />
        </div>
      )}
    </>
  );
}

/** Replies to this coordinator's help requests they have not opened yet, on the Contact admin button. */
function NewReplies({ token, username, onSignedOut }: { token: string; username: string; onSignedOut: () => void }) {
  const load = useCallback(() => myHelp(token), [token]);
  const live = useLiveData(load, onSignedOut, 60_000);
  const seen = repliesSeenAt(username);
  const fresh = (live.data ?? []).flatMap((request) => request.replies ?? []).filter((reply) => reply.at > seen).length;
  return fresh ? <span className="adm-nav__count" aria-label={`${fresh} new repl${fresh === 1 ? 'y' : 'ies'}`}>{fresh}</span> : null;
}

/** The number of open help requests, on the Help requests tab (refreshed every 30 seconds). */
function OpenHelpCount({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const load = useCallback(() => listHelp(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const open = live.data?.filter((request) => request.status === 'OPEN').length ?? 0;
  return open ? <span className="adm-nav__count">{open}</span> : null;
}

/**
 * Admins and the web assistant team: the event-day student page (pass, events, timings) on or
 * off. Off by default: turn it on once the desks have network to spare, pause it if the
 * pages of the student coordinators get slow.
 */
function StudentPortalSwitch({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const [state, setState] = useState<StudentPortalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    studentPortal(token).then(
      (value) => {
        if (active) setState(value);
      },
      (failure: unknown) => {
        if (!active) return;
        if (failure instanceof SignedOut) onSignedOut();
        else setError(messageOf(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [token, onSignedOut]);

  const toggle = async () => {
    if (!state) return;
    const enabled = !state.enabled;
    const question = enabled
      ? 'Turn on Student login on the website?\n\nStudents can then sign in with their Registration ID and phone number to download their pass and see their event timings.'
      : 'Pause Student login?\n\nStudents will see a short message instead, until you turn it on again.';
    if (!window.confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      setState(await setStudentPortal(token, enabled));
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adm-portal" aria-label="Student login on the website">
      <span className="adm-portal__label">Student login on the website</span>
      {state ? <Badge tone={state.enabled ? 'good' : 'warn'}>{state.enabled ? 'On' : 'Paused'}</Badge> : <span className="adm-muted">…</span>}
      {state?.changedBy && (
        <span className="adm-muted">
          by {state.changedBy} {when(state.changedAt)}
        </span>
      )}
      <button className="adm-button adm-button--small" type="button" disabled={!state || busy} onClick={() => void toggle()}>
        {busy ? 'Saving…' : state?.enabled ? 'Pause' : 'Turn on'}
      </button>
      <small className="adm-muted adm-portal__hint">Turn it on once the desks have network to spare; pause it if the pages of the student coordinators get slow.</small>
      {error && <span className="adm-error">{error}</span>}
    </section>
  );
}

interface DashboardProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

/** Admins: every registration by status, GPay payments to verify first; each opens in a pop-up. */
function Dashboard({ token, session, onSignedOut }: DashboardProps) {
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const load = useCallback(() => listRegistrations(token), [token]);
  const live = useLiveData(load, onSignedOut);
  const registrations = live.data;

  const counts = useMemo(() => {
    const all = registrations ?? [];
    return {
      PENDING: all.filter((item) => item.status === 'PENDING').length,
      APPROVED: all.filter((item) => item.status === 'APPROVED').length,
      REJECTED: all.filter((item) => item.status === 'REJECTED').length,
      CANCELLED: all.filter((item) => item.status === 'CANCELLED').length,
      ALL: all.length,
    };
  }, [registrations]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (registrations ?? []).filter((item) => {
      if (filter !== 'ALL' && item.status !== filter) return false;
      if (!needle) return true;
      const { participant, payment } = item;
      return [item.registrationId, participant.name, participant.email, participant.phone, participant.college, payment.transactionId].some((value) => value.toLowerCase().includes(needle));
    });
  }, [registrations, filter, query]);

  const selected = registrations?.find((item) => item.registrationId === selectedId) ?? null;
  const replace = (updated: AdminRegistration) => live.setData((current) => current?.map((item) => (item.registrationId === updated.registrationId ? updated : item)) ?? null);

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad" aria-label="Registrations">
        <div className="adm-toolbar">
          <div className="adm-tabs" role="tablist" aria-label="Filter by status">
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className="adm-tab" onClick={() => setFilter(value)}>
                {label} <span className="adm-tab__count">{counts[value]}</span>
              </button>
            ))}
          </div>
          <input
            className="adm-search"
            type="search"
            placeholder="Search ID, name, email, phone, transaction ID"
            aria-label="Search registrations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>

        <ErrorNote error={live.error} />

        {registrations === null ? (
          <p className="adm-muted adm-empty">{live.loading ? 'Loading registrations…' : 'Registrations could not be loaded.'}</p>
        ) : shown.length === 0 ? (
          <p className="adm-muted adm-empty">No registrations here.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Registration ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">College</th>
                  <th scope="col">Transaction ID</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.registrationId} onClick={() => setSelectedId(item.registrationId)}>
                    <td>
                      <button type="button" className="adm-link" onClick={() => setSelectedId(item.registrationId)}>
                        {item.registrationId}
                      </button>
                    </td>
                    <td>{item.participant.name}</td>
                    <td>{item.participant.college}</td>
                    <td className="adm-mono">{item.source === 'ONSITE' ? 'Paid at desk' : item.payment.transactionId}</td>
                    <td>{when(item.submittedAt)}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <RegistrationDialog
          key={selected.registrationId}
          registration={selected}
          token={token}
          session={session}
          onChange={replace}
          onDeleted={(registrationId) => {
            setSelectedId(null);
            live.setData((current) => current?.filter((item) => item.registrationId !== registrationId) ?? null);
          }}
          onClose={() => setSelectedId(null)}
          onSignedOut={onSignedOut}
        />
      )}
    </main>
  );
}
