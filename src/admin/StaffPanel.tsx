/** Staff accounts (admins): create, set roles, assign events, reset passwords, deactivate, delete. */
import { useCallback, useState, type FormEvent } from 'react';
import { events as allEvents } from '../content/events';
import { DESKS, deptShort, eventLabel, type FestCatalog } from '../lib/fest';
import { CREATABLE_ROLES, DELETE_ALL_STAFF, DEPARTMENT_ROLES, ROLE_INFO, type SessionInfo, type SignInFailure, type StaffAccountView, type StaffRole } from '../lib/staff';
import { SignedOut, checkStaffPassword, createStaff, deleteAllStaff, deleteStaff, listStaff, signOutStaff, signedInNow, staffSignInFailures, updateStaff, type PasswordCheck, type StaffChange } from './adminApi';
import { useFestCatalog } from './fest/FestData';
import { Badge, ErrorNote, LiveStatus, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

/** A strong random password to hand over (shown once; only its hash is stored). */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${body.slice(0, 7)}-${body.slice(7)}-9`;
}

const eventName = (catalog: FestCatalog, id: string) => catalog.events.find((event) => event.id === id)?.name ?? allEvents.find((event) => event.id === id)?.name ?? id;

/** The events a coordinator may be given: their department's (or, with no department, the symposium's own). */
function EventChoice({ value, onChange, department }: { value: string[]; onChange: (next: string[]) => void; department: string | null | undefined }) {
  const catalog = useFestCatalog();
  const choices = department ? catalog.events.filter((event) => event.dept === department).map((event) => ({ id: event.id, name: eventLabel(event) })) : allEvents.map((event) => ({ id: event.id, name: event.name }));
  return (
    <fieldset className="adm-events">
      <legend>Assigned events</legend>
      {!choices.length && <span className="adm-muted">Choose the department first.</span>}
      {choices.map((event) => (
        <label key={event.id} className="adm-check">
          <input
            type="checkbox"
            checked={value.includes(event.id)}
            onChange={() => onChange(value.includes(event.id) ? value.filter((id) => id !== event.id) : [...value, event.id])}
          />
          <span>{event.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function StaffPanel({ token, session, onSignedOut }: PanelProps) {
  const load = useCallback(() => listStaff(token), [token]);
  const live = useLiveData(load, onSignedOut, 60_000);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [deleted, setDeleted] = useState('');

  const remove = async (account: StaffAccountView) => {
    const question = `Delete the account ${account.username} (${account.displayName}, ${ROLE_INFO[account.role].label})?\n\nThey can no longer sign in, and are signed out if they are signed in now. What they recorded keeps their name. This cannot be undone: to use them again, make a new account.`;
    if (!window.confirm(question)) return;
    setDeleting(account.username);
    setDeleteError(null);
    setDeleted('');
    try {
      const username = await deleteStaff(token, account.username);
      live.setData((current) => (current ?? []).filter((item) => item.username !== username));
      setDeleted(`Deleted ${username}.`);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setDeleteError(failure);
    } finally {
      setDeleting(null);
    }
  };

  const replace = (account: StaffAccountView) =>
    live.setData((current) => {
      const list = current ?? [];
      return list.some((item) => item.username === account.username) ? list.map((item) => (item.username === account.username ? account : item)) : [...list, account];
    });

  const catalog = useFestCatalog();
  return (
    <main className="adm-page">
      <SignedInNow token={token} session={session} onSignedOut={onSignedOut} />
      <NewAccount token={token} onCreated={replace} onSignedOut={onSignedOut} />
      <CheckPassword token={token} accounts={live.data ?? []} onSignedOut={onSignedOut} />
      <RecentFailures token={token} onSignedOut={onSignedOut} />
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Staff accounts</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p className="adm-muted">
          The owner account ({session.kind === 'owner' ? 'you' : 'ADMIN_USERNAME'}) is set in the Amplify secrets and is not listed here. Changes apply
          at once: a deactivated or deleted account, or a reset password, signs that person out.
        </p>
        <ErrorNote error={live.error} />
        <ErrorNote error={deleteError} />
        {deleted && (
          <p className="adm-note" role="status">
            {deleted}
          </p>
        )}
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static">
            <thead>
              <tr>
                <th scope="col">Username</th>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Department</th>
                <th scope="col">Events</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Changed</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {(live.data ?? []).map((account) =>
                editing === account.username ? (
                  <EditAccount key={account.username} token={token} account={account} onDone={(updated) => { if (updated) replace(updated); setEditing(null); }} onSignedOut={onSignedOut} />
                ) : (
                  <tr key={account.username}>
                    <td className="adm-mono">{account.username}</td>
                    <td>{account.displayName}</td>
                    <td>{ROLE_INFO[account.role]?.label ?? account.role}</td>
                    <td>
                      {account.department ?? (DEPARTMENT_ROLES.includes(account.role) ? '—' : 'All')}
                      {account.deskNumber ? ` · desk ${account.deskNumber}` : ''}
                    </td>
                    <td>{account.role === 'COORDINATOR' ? account.eventIds.map((id) => eventName(catalog, id)).join(', ') : 'All'}</td>
                    <td>{account.active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Deactivated</Badge>}</td>
                    <td className="adm-muted">{account.lastSignInAt ? when(account.lastSignInAt) : 'Never'}</td>
                    <td className="adm-muted">
                      {when(account.updatedAt)} by {account.updatedBy}
                    </td>
                    <td>
                      <span className="adm-inline">
                        <button className="adm-button adm-button--small" type="button" onClick={() => setEditing(account.username)}>
                          Edit
                        </button>
                        {!(session.kind === 'staff' && session.username === account.username) && (
                          <button
                            className="adm-button adm-button--small adm-button--danger-outline"
                            type="button"
                            disabled={deleting !== null}
                            aria-label={`Delete ${account.username}`}
                            onClick={() => void remove(account)}
                          >
                            {deleting === account.username ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {live.data?.length === 0 && <p className="adm-muted adm-empty">No staff accounts yet.</p>}
        </div>
      </section>
      {session.kind === 'owner' && <DeleteEveryAccount token={token} count={live.data?.length ?? 0} onDeleted={() => live.setData([])} onSignedOut={onSignedOut} />}
    </main>
  );
}

/** Department and desk choices for a department role. */
function ScopeFields({ role, department, deskNumber, onChange }: { role: StaffRole; department: string; deskNumber: number; onChange: (next: { department: string; deskNumber: number }) => void }) {
  const catalog = useFestCatalog();
  if (!DEPARTMENT_ROLES.includes(role)) return null;
  const desks = catalog.departments.some((dept) => dept.code === department) ? DESKS : 0;
  return (
    <>
      <label className="adm-field">
        <span>Department</span>
        <select value={department} onChange={(event) => onChange({ department: event.target.value, deskNumber: 1 })}>
          <option value="">Choose…</option>
          {catalog.departments.map((dept) => (
            <option key={dept.code} value={dept.code}>
              {deptShort(dept.code)} · {dept.name}
            </option>
          ))}
        </select>
      </label>
      {role === 'DESK' && department && (
        <label className="adm-field">
          <span>Desk</span>
          <select value={deskNumber} onChange={(event) => onChange({ department, deskNumber: Number(event.target.value) })}>
            {Array.from({ length: desks }, (_, index) => index + 1).map((desk) => (
              <option key={desk} value={desk}>
                Desk {desk}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function NewAccount({ token, onCreated, onSignedOut }: { token: string; onCreated: (account: StaffAccountView) => void; onSignedOut: () => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', role: 'DESK' as StaffRole, eventIds: [] as string[], password: '', department: '', deskNumber: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scoped = DEPARTMENT_ROLES.includes(form.role);
      const account = await createStaff(token, {
        ...form,
        eventIds: form.role === 'COORDINATOR' ? form.eventIds : [],
        department: scoped ? form.department || null : null,
        deskNumber: form.role === 'DESK' && form.department ? form.deskNumber : null,
      });
      onCreated(account);
      setCreated({ username: account.username, password: form.password });
      setForm({ ...form, username: '', displayName: '', eventIds: [], password: '' });
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adm-card adm-pad">
      <h2 className="adm-h2">New staff account</h2>
      <form className="adm-form" onSubmit={submit}>
        <label className="adm-field">
          <span>Username</span>
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} placeholder="e.g. desk1, codeflex-kabil" required autoComplete="off" />
        </label>
        <label className="adm-field">
          <span>Name</span>
          <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required autoComplete="off" />
        </label>
        <label className="adm-field">
          <span>Role</span>
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as StaffRole, eventIds: [] })}>
            {CREATABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_INFO[role].label}
              </option>
            ))}
          </select>
        </label>
        <ScopeFields role={form.role} department={form.department} deskNumber={form.deskNumber} onChange={(next) => setForm({ ...form, ...next, eventIds: [] })} />
        <PasswordField label="Password (at least 14 characters)" value={form.password} onChange={(password) => setForm({ ...form, password })} required />
        {form.role === 'COORDINATOR' && (
          <div className="adm-form__wide">
            <EventChoice value={form.eventIds} department={form.department} onChange={(eventIds) => setForm({ ...form, eventIds })} />
          </div>
        )}
        <p className="adm-muted adm-form__wide">{ROLE_INFO[form.role].summary}</p>
        <div className="adm-form__wide">
          <button className="adm-button adm-button--primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
      {created && <NewLogin username={created.username} password={created.password} what="Created" />}
    </section>
  );
}

function EditAccount({ token, account, onDone, onSignedOut }: { token: string; account: StaffAccountView; onDone: (updated: StaffAccountView | null) => void; onSignedOut: () => void }) {
  const [change, setChange] = useState<StaffChange>({
    displayName: account.displayName,
    role: account.role,
    eventIds: account.eventIds,
    active: account.active,
    department: account.department,
    deskNumber: account.deskNumber,
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const role = change.role ?? account.role;
      const scoped = DEPARTMENT_ROLES.includes(role);
      onDone(
        await updateStaff(token, account.username, {
          ...change,
          department: scoped ? (change.department ?? null) : null,
          deskNumber: role === 'DESK' && change.department ? (change.deskNumber ?? 1) : null,
          ...(password && { password }),
        }),
      );
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
      setBusy(false);
    }
  };

  return (
    <tr className="adm-table__expand">
      <td className="adm-mono">{account.username}</td>
      <td colSpan={6}>
        <div className="adm-form">
          <label className="adm-field">
            <span>Name</span>
            <input value={change.displayName} onChange={(event) => setChange({ ...change, displayName: event.target.value })} />
          </label>
          <label className="adm-field">
            <span>Role</span>
            <select value={change.role} onChange={(event) => setChange({ ...change, role: event.target.value as StaffRole, eventIds: [] })}>
              {[...new Set([...CREATABLE_ROLES, account.role])].map((role) => (
                <option key={role} value={role}>
                  {ROLE_INFO[role]?.label ?? role}
                </option>
              ))}
            </select>
          </label>
          <ScopeFields
            role={change.role ?? account.role}
            department={change.department ?? ''}
            deskNumber={change.deskNumber ?? 1}
            onChange={(next) => setChange({ ...change, department: next.department || null, deskNumber: next.deskNumber, eventIds: [] })}
          />
          <label className="adm-check">
            <input type="checkbox" checked={change.active} onChange={(event) => setChange({ ...change, active: event.target.checked })} />
            <span>Active (untick to sign them out and block sign-in)</span>
          </label>
          <PasswordField label="New password (leave empty to keep)" value={password} onChange={setPassword} />
          {change.role === 'COORDINATOR' && (
            <div className="adm-form__wide">
              <EventChoice value={change.eventIds ?? []} department={change.department} onChange={(eventIds) => setChange({ ...change, eventIds })} />
            </div>
          )}
          <div className="adm-form__wide adm-actions__row">
            <button className="adm-button adm-button--primary" type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="adm-button" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            {password && <span className="adm-muted">Saving signs them out everywhere; give them this password privately: <span className="adm-mono">{password}</span> <CopyButton text={password} /></span>}
          </div>
          <div className="adm-form__wide">
            <ErrorNote error={error} />
          </div>
        </div>
      </td>
    </tr>
  );
}

/** Who is signed in right now, with the registration desk each desk sign-in is at; an admin can sign someone out. */
function SignedInNow({ token, session, onSignedOut }: { token: string; session: SessionInfo; onSignedOut: () => void }) {
  const load = useCallback(() => signedInNow(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const sessions = live.data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const signOutPerson = async (username: string, name: string) => {
    if (!window.confirm(`Sign ${name} (${username}) out on every device now?\n\nThey can sign in again with their password (to stop that, deactivate the account).`)) return;
    setBusy(username);
    setError(null);
    try {
      await signOutStaff(token, username);
      live.refresh();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="adm-card adm-pad" aria-label="Signed in now">
      <div className="adm-toolbar">
        <h2 className="adm-h2">Signed in now ({sessions.length})</h2>
        <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
      </div>
      <ErrorNote error={live.error ?? error} />
      {sessions.length === 0 ? (
        <p className="adm-muted">{live.loading ? 'Loading…' : 'Nobody is signed in.'}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Username</th>
                <th scope="col">Role</th>
                <th scope="col">Desk</th>
                <th scope="col">Signed in</th>
                <th scope="col">Until</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((item) => (
                <tr key={`${item.username}-${item.since}`}>
                  <td>{item.displayName}</td>
                  <td className="adm-mono">{item.username}</td>
                  <td>{ROLE_INFO[item.role].label}</td>
                  <td>{item.deskNumber ? <Badge tone="good">Desk {item.deskNumber}</Badge> : item.role === 'DESK' ? <Badge tone="warn">Not chosen</Badge> : '—'}</td>
                  <td>{when(item.since)}</td>
                  <td>{when(item.until)}</td>
                  <td>
                    {item.kind === 'staff' && !(session.kind === 'staff' && session.username === item.username) && (
                      <button className="adm-button adm-button--small" type="button" disabled={busy !== null} onClick={() => void signOutPerson(item.username, item.displayName)}>
                        {busy === item.username ? 'Signing out…' : 'Sign out'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * A password box that a phone keyboard cannot change (no capital letter added, no autocorrect, no
 * spell check), with Generate.
 */
function PasswordField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (next: string) => void; required?: boolean }) {
  return (
    <label className="adm-field">
      <span>{label}</span>
      <span className="adm-inline">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="adm-mono"
        />
        <button className="adm-button adm-button--small" type="button" onClick={() => onChange(generatePassword())}>
          Generate
        </button>
      </span>
    </label>
  );
}

/** Copies exactly the text (no space or line break around it), and says so. */
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState<'' | 'copied' | 'failed'>('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone('copied');
    } catch {
      setDone('failed');
    }
    window.setTimeout(() => setDone(''), 2_500);
  };
  return (
    <button className="adm-button adm-button--small" type="button" onClick={() => void copy()}>
      {done === 'copied' ? 'Copied ✓' : done === 'failed' ? 'Copy it by hand' : label}
    </button>
  );
}

/** A login just made: shown once, with Copy for the username, the password, or both. */
function NewLogin({ username, password, what }: { username: string; password: string; what: string }) {
  return (
    <div className="adm-note" role="status">
      <p>
        {what} <strong className="adm-mono">{username}</strong>. Give the login to them privately now: it is not shown again.
      </p>
      <p className="adm-inline adm-inline--wrap">
        <span>
          Username <span className="adm-mono">{username}</span>
        </span>
        <CopyButton text={username} />
        <span>
          Password <span className="adm-mono">{password}</span>
        </span>
        <CopyButton text={password} />
        <CopyButton text={`Username: ${username}\nPassword: ${password}`} label="Copy both" />
      </p>
      <p className="adm-muted">
        On the sign-in page, clear the password box first: a browser that remembers the owner&apos;s password fills it in, and pasting adds to it. Use Show to see what is in the box.
      </p>
    </div>
  );
}

const CHECK_RESULT = (check: PasswordCheck) =>
  !check.exists
    ? { tone: 'bad' as const, text: `There is no account ${check.username}. Check the spelling (usernames are lower-case), or make it.` }
    : !check.matches
      ? { tone: 'bad' as const, text: `That is not ${check.username}'s password. Set a new one with Edit, and give it to them.` }
      : !check.active
        ? { tone: 'warn' as const, text: `The password is right, but ${check.username} is deactivated: tick Active with Edit.` }
        : check.signInOff
          ? { tone: 'warn' as const, text: `The password is right, but sign-in for this role is switched off in Website controls.` }
          : { tone: 'good' as const, text: `The password is right and ${check.username} can sign in.` };

/** "Check a password": is this the account's password? (No sign-in is made.) */
function CheckPassword({ token, accounts, onSignedOut }: { token: string; accounts: StaffAccountView[]; onSignedOut: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<PasswordCheck | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCheck(null);
    try {
      setCheck(await checkStaffPassword(token, username.trim().toLowerCase(), password));
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const result = check && CHECK_RESULT(check);
  return (
    <section className="adm-card adm-pad" aria-label="Check a password">
      <h2 className="adm-h2">Check a password</h2>
      <p className="adm-muted">Someone cannot sign in? Type their username and the password they were given: this says whether it is right, without signing in.</p>
      <form className="adm-form" onSubmit={(event) => void run(event)}>
        <label className="adm-field">
          <span>Username</span>
          <input value={username} list="staff-usernames" onChange={(event) => setUsername(event.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          <datalist id="staff-usernames">
            {accounts.map((account) => (
              <option key={account.username} value={account.username} />
            ))}
          </datalist>
        </label>
        <label className="adm-field">
          <span>Password</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="adm-mono" required />
        </label>
        <div className="adm-form__wide">
          <button className="adm-button" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Check'}
          </button>
        </div>
      </form>
      {result && (
        <p className="adm-note" role="status">
          <Badge tone={result.tone}>{result.tone === 'good' ? 'Right' : 'Problem'}</Badge> {result.text}
        </p>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

const FAILURE_LABEL: Record<SignInFailure['reason'], string> = {
  'no such account': 'No such account (a typo in the username, or not made yet)',
  'wrong password': 'Wrong password',
  'account deactivated': 'Account deactivated',
  'sign-in switched off': 'Sign-in switched off for this role',
};

/** The last refused sign-ins: who was tried, why, when (never the password). */
function RecentFailures({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const load = useCallback(() => staffSignInFailures(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const failures = live.data ?? [];
  return (
    <section className="adm-card adm-pad" aria-label="Recent failed sign-ins">
      <div className="adm-toolbar">
        <h2 className="adm-h2">Recent failed sign-ins ({failures.length})</h2>
        <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
      </div>
      <ErrorNote error={live.error} />
      {failures.length === 0 ? (
        <p className="adm-muted">{live.loading ? 'Loading…' : 'None.'}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Username tried</th>
                <th scope="col">Why it was refused</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((item, index) => (
                <tr key={`${item.at}-${index}`}>
                  <td>{when(item.at)}</td>
                  <td className="adm-mono">{item.username || '(empty)'}</td>
                  <td>{FAILURE_LABEL[item.reason] ?? item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The owner only: delete every staff account, so each login can be made again by hand. */
function DeleteEveryAccount({ token, count, onDeleted, onSignedOut }: { token: string; count: number; onDeleted: () => void; onSignedOut: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    if (!window.confirm(`Delete all ${count} staff accounts?\n\nEveryone but you is signed out at once and can no longer sign in. Your own sign-in (from the Amplify secrets) stays. This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    setDone('');
    try {
      const deleted = await deleteAllStaff(token, typed.trim());
      setDone(`Deleted ${deleted} accounts. Make each login again with New staff account.`);
      setTyped('');
      onDeleted();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="adm-card adm-pad" aria-label="Delete every staff account">
      <h2 className="adm-h2">Delete every staff account</h2>
      <p className="adm-muted">
        Only you (the owner) see this. It deletes all {count} staff accounts, including other web assist accounts, and signs them out. Registrations, payments and
        results stay. Type <strong className="adm-mono">{DELETE_ALL_STAFF}</strong> to confirm.
      </p>
      <span className="adm-inline adm-inline--wrap">
        <input value={typed} aria-label={`Type ${DELETE_ALL_STAFF}`} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        <button className="adm-button adm-button--danger-outline" type="button" disabled={busy || typed.trim() !== DELETE_ALL_STAFF || count === 0} onClick={() => void run()}>
          {busy ? 'Deleting…' : `Delete all ${count} accounts`}
        </button>
      </span>
      {done && (
        <p className="adm-note" role="status">
          {done}
        </p>
      )}
      <ErrorNote error={error} />
    </section>
  );
}
