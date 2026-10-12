import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatIst, parseEventStart } from '../lib/countdown';
import { DEFAULT_CATALOG } from '../lib/fest';
import { ROLE_INFO, hasPermission, type Permission, type SessionInfo } from '../lib/staff';
import { SignedOut, currentAdmin, listHelp, myHelp, savedToken, setDeskNumber, signIn, signOut } from './adminApi';
import { CatalogEditor } from './fest/CatalogEditor';
import { DeskView } from './fest/DeskView';
import { EventWindow } from './fest/EventWindow';
import { FestProvider } from './fest/FestData';
import { SyncBar } from './fest/festUi';
import { ImportView } from './fest/ImportView';
import { FestOverview, FestRegistrations, FestResults } from './fest/OverviewViews';
import { HelpDialog, repliesSeenAt, type HelpContext } from './HelpDialog';
import { HelpPanel } from './HelpPanel';
import { RegistrationWindowPanel } from './RegistrationWindowPanel';
import { RolesPanel } from './RolesPanel';
import { StaffPanel } from './StaffPanel';
import { SystemPanel } from './SystemPanel';
import { TestingPanel } from './TestingPanel';
import { Badge, ErrorNote, HELP_EVENT, messageOf, useLiveData, when } from './ui';

type TabId = 'overview' | 'registrations' | 'results' | 'desk' | 'event' | 'import' | 'catalog' | 'window' | 'help' | 'system' | 'staff' | 'testing' | 'roles';

/** Roles that watch (every department, or their own) rather than work at a desk or an event. */
const watches = (session: SessionInfo) => can(session, 'fest.viewAll') || session.role === 'HOD' || session.role === 'DEPT_ADMIN';

/** The dashboard's sections, each shown only to the roles it is for (the server checks again). */
const TABS: { id: TabId; label: (session: SessionInfo) => string; show: (session: SessionInfo) => boolean }[] = [
  { id: 'overview', label: () => 'Overview', show: watches },
  { id: 'registrations', label: () => 'Registrations', show: watches },
  { id: 'results', label: () => 'Results', show: watches },
  { id: 'desk', label: (session) => (session.role === 'DESK' ? 'Registration desk' : 'Register'), show: (session) => can(session, 'fest.register') },
  { id: 'event', label: (session) => (session.role === 'COORDINATOR' ? 'My events' : 'Event windows'), show: (session) => can(session, 'fest.event') },
  { id: 'import', label: () => 'Online & paper', show: (session) => can(session, 'fest.import') },
  { id: 'catalog', label: () => 'Departments & events', show: (session) => can(session, 'fest.catalog') },
  { id: 'staff', label: () => 'Accounts', show: (session) => can(session, 'staff.manage') },
  { id: 'window', label: () => 'Event-day controls', show: (session) => can(session, 'registration.window') || can(session, 'site.notice') },
  { id: 'help', label: () => 'Help requests', show: (session) => can(session, 'help.manage') },
  { id: 'system', label: () => 'System status', show: (session) => can(session, 'system.view') },
  { id: 'testing', label: () => 'Testing', show: (session) => can(session, 'system.testing') },
  { id: 'roles', label: () => 'Roles', show: () => true },
];

/** '/landing/cse/admin/' → 'CSE' (each department's own address); null on /landing/admin/. */
export const pageDepartment = (path: string) => {
  const code = /\/landing\/([a-z]{2,6})\/admin/i.exec(path)?.[1]?.toUpperCase() ?? null;
  return code && code !== 'ADMIN' ? code : null;
};
const deptTitle = (code: string | null) => (code ? `${code} · ${DEFAULT_CATALOG.departments.find((dept) => dept.code === code)?.name ?? ''}` : '');

const can = (session: SessionInfo, permission: Permission) => hasPermission(session.role, permission);

const PHASE_LABEL: Record<SessionInfo['phase'], string> = {
  online: 'Online registration open',
  between: 'Online closed · desk opens at midnight',
  onsite: 'On-site registration open',
  closed: 'Registration closed',
};

const LAST_SESSION = 'pragya-admin-last-session';
/** The session as last confirmed by the server, for opening the dashboard with no signal. */
function rememberSession(info: SessionInfo) {
  try {
    sessionStorage.setItem(LAST_SESSION, JSON.stringify(info));
  } catch {
    // Storage blocked: only the online check is used.
  }
}
function lastSession(): SessionInfo | null {
  try {
    const saved = sessionStorage.getItem(LAST_SESSION);
    return saved ? (JSON.parse(saved) as SessionInfo) : null;
  } catch {
    return null;
  }
}

export function AdminApp() {
  const [token, setToken] = useState<string | null>(savedToken);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notice, setNotice] = useState('');

  const signedOut = useCallback((message = '') => {
    try {
      sessionStorage.removeItem(LAST_SESSION);
    } catch {
      // Nothing saved.
    }
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
      .then((info) => {
        if (!active) return;
        setSession(info);
        rememberSession(info);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // No signal: carry on with the session last confirmed on this phone (the server still checks every change).
        const last = error instanceof SignedOut ? null : lastSession();
        if (last) setSession((current) => current ?? last);
        else signedOut(error instanceof SignedOut ? 'Your session has ended. Please sign in again.' : messageOf(error));
      });
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
  const pageDept = pageDepartment(window.location.pathname);
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
        {pageDept && <p className="adm-login__dept">{deptTitle(pageDept)}</p>}
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
          <span>Desk number (only if your account does not have one)</span>
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

function Shell(props: ShellProps) {
  if (!can(props.session, 'fest.view')) return <ShellBody {...props} />;
  return (
    <FestProvider token={props.token} session={{ ...props.session, department: props.session.department ?? null }} pageDept={pageDepartment(window.location.pathname)} onSignedOut={props.onSignedOut}>
      <ShellBody {...props} />
    </FestProvider>
  );
}

function ShellBody({ token, session, onSession, onSignOut, onSignedOut }: ShellProps) {
  const tabs = TABS.filter((tab) => tab.show(session));
  const pageDept = pageDepartment(window.location.pathname);
  const wrongPage = Boolean(session.department && pageDept && session.department !== pageDept);
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
          <h1 className="adm-bar__title">PRAGYA 2026 · {session.department ? deptTitle(session.department) : 'All departments'}</h1>
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
          {session.role === 'DESK' &&
            session.deskNumber &&
            // A department's desk account is that desk for good; older desk accounts choose it.
            (session.department ? <Badge tone="good">Desk {session.deskNumber}</Badge> : <DeskChip token={token} deskNumber={session.deskNumber} onSession={onSession} onSignedOut={onSignedOut} />)}
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
      {wrongPage && (
        <p className="adm-note" role="status">
          This page is for {pageDept}; your account is for {session.department}. Use <a href={`/landing/${session.department!.toLowerCase()}/admin/`}>the {session.department} page</a>.
        </p>
      )}
      {session.role === 'DESK' && !session.deskNumber && !session.department && <DeskChooser token={token} onSession={onSession} onSignedOut={onSignedOut} />}
      {can(session, 'fest.view') && <SyncBar />}

      <nav className="adm-nav" aria-label="Sections">
        {tabs.map((item) => (
          <button key={item.id} type="button" className="adm-nav__tab" aria-current={item.id === current ? 'page' : undefined} onClick={() => setTab(item.id)}>
            {item.label(session)}
            {item.id === 'help' && <OpenHelpCount token={token} onSignedOut={onSignedOut} />}
          </button>
        ))}
      </nav>

      {current === 'overview' && <FestOverview />}
      {current === 'registrations' && <FestRegistrations />}
      {current === 'results' && <FestResults />}
      {current === 'desk' && <DeskView />}
      {current === 'event' && <EventWindow />}
      {current === 'import' && <ImportView token={token} onSignedOut={onSignedOut} />}
      {current === 'catalog' && <CatalogEditor token={token} onSignedOut={onSignedOut} />}
      {current === 'window' && <RegistrationWindowPanel {...panel} onSession={onSession} />}
      {current === 'help' && <HelpPanel {...panel} />}
      {current === 'system' && <SystemPanel {...panel} />}
      {current === 'testing' && <TestingPanel {...panel} onSession={onSession} />}
      {current === 'staff' && <StaffPanel {...panel} />}
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
