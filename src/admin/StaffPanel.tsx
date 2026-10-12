/** Staff accounts (admins): create, set roles, assign events, reset passwords, deactivate, delete. */
import { useCallback, useState, type FormEvent } from 'react';
import { events as allEvents } from '../content/events';
import { eventLabel, toCsv, type FestCatalog } from '../lib/fest';
import { CREATABLE_ROLES, DEPARTMENT_ROLES, ROLE_INFO, type SessionInfo, type StaffAccountView, type StaffRole } from '../lib/staff';
import { ApiFailure, SignedOut, createStaff, deleteStaff, listStaff, signOutStaff, signedInNow, updateStaff, type StaffChange } from './adminApi';
import { useFestCatalog } from './fest/FestData';
import { Badge, ErrorNote, LiveStatus, saveFile, useLiveData, when } from './ui';

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
      <DepartmentAccounts token={token} existing={live.data ?? []} onCreated={replace} onSignedOut={onSignedOut} />
      <NewAccount token={token} onCreated={replace} onSignedOut={onSignedOut} />
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
    </main>
  );
}

/** Department and desk choices for a department role. */
function ScopeFields({ role, department, deskNumber, onChange }: { role: StaffRole; department: string; deskNumber: number; onChange: (next: { department: string; deskNumber: number }) => void }) {
  const catalog = useFestCatalog();
  if (!DEPARTMENT_ROLES.includes(role)) return null;
  const desks = catalog.departments.find((dept) => dept.code === department)?.desks ?? 0;
  return (
    <>
      <label className="adm-field">
        <span>Department</span>
        <select value={department} onChange={(event) => onChange({ department: event.target.value, deskNumber: 1 })}>
          <option value="">Choose…</option>
          {catalog.departments.map((dept) => (
            <option key={dept.code} value={dept.code}>
              {dept.code} · {dept.name}
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
        <label className="adm-field">
          <span>Password (at least 14 characters)</span>
          <span className="adm-inline">
            <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required autoComplete="new-password" />
            <button className="adm-button adm-button--small" type="button" onClick={() => setForm({ ...form, password: generatePassword() })}>
              Generate
            </button>
          </span>
        </label>
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
      {created && (
        <p className="adm-note">
          Created <strong>{created.username}</strong>. Give the password to them privately now: <span className="adm-mono">{created.password}</span>. It is not
          shown again.
        </p>
      )}
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
          <label className="adm-field">
            <span>New password (leave empty to keep)</span>
            <span className="adm-inline">
              <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <button className="adm-button adm-button--small" type="button" onClick={() => setPassword(generatePassword())}>
                Generate
              </button>
            </span>
          </label>
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
            {password && <span className="adm-muted">Give the new password to them privately: <span className="adm-mono">{password}</span></span>}
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

interface PlannedAccount {
  username: string;
  displayName: string;
  role: StaffRole;
  department: string;
  deskNumber?: number;
  eventIds: string[];
  password: string;
  status?: 'created' | 'exists' | 'failed';
  message?: string;
}

/** The accounts a department needs: HOD, department admin, each desk, two coordinators per event. */
function planFor(catalog: FestCatalog, code: string): PlannedAccount[] {
  const dept = catalog.departments.find((item) => item.code === code);
  if (!dept) return [];
  const lower = code.toLowerCase();
  const plan: PlannedAccount[] = [
    { username: `${lower}-hod`, displayName: `${code} HOD`, role: 'HOD', department: code, eventIds: [], password: generatePassword() },
    { username: `${lower}-admin`, displayName: `${code} Department admin`, role: 'DEPT_ADMIN', department: code, eventIds: [], password: generatePassword() },
    ...Array.from({ length: dept.desks }, (_, index) => ({
      username: `${lower}-desk${index + 1}`,
      displayName: `${code} Desk ${index + 1}`,
      role: 'DESK' as StaffRole,
      department: code,
      deskNumber: index + 1,
      eventIds: [],
      password: generatePassword(),
    })),
  ];
  for (const event of catalog.events.filter((item) => item.dept === code)) {
    const slug = event.id.replace(new RegExp(`^${lower}-`), '').slice(0, 22).replace(/-+$/, '');
    for (const n of [1, 2]) {
      plan.push({
        username: `${lower}-${slug}-${n}`,
        displayName: `${event.name.replace(/[^\p{L}\p{N} .'()&-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)} coordinator ${n}`,
        role: 'COORDINATOR',
        department: code,
        eventIds: [event.id],
        password: generatePassword(),
      });
    }
  }
  return plan;
}

/**
 * Makes a department's accounts in one go (those that do not exist yet), with strong
 * passwords shown once and downloadable to print and hand out.
 */
function DepartmentAccounts({ token, existing, onCreated, onSignedOut }: { token: string; existing: StaffAccountView[]; onCreated: (account: StaffAccountView) => void; onSignedOut: () => void }) {
  const catalog = useFestCatalog();
  const [code, setCode] = useState('');
  const [plan, setPlan] = useState<PlannedAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const taken = new Set(existing.map((account) => account.username));
  const choose = (next: string) => {
    setCode(next);
    setPlan(next ? planFor(catalog, next).map((item) => (taken.has(item.username) ? { ...item, status: 'exists' as const } : item)) : []);
  };
  const create = async () => {
    setBusy(true);
    const next = [...plan];
    for (const [index, item] of next.entries()) {
      if (item.status) continue;
      try {
        const account = await createStaff(token, { username: item.username, displayName: item.displayName, role: item.role, department: item.department, deskNumber: item.deskNumber ?? null, eventIds: item.eventIds, password: item.password });
        onCreated(account);
        next[index] = { ...item, status: 'created' };
      } catch (failure) {
        if (failure instanceof SignedOut) {
          onSignedOut();
          return;
        }
        next[index] = { ...item, status: failure instanceof ApiFailure && failure.code === 'USERNAME_TAKEN' ? 'exists' : 'failed', message: failure instanceof Error ? failure.message : '' };
      }
      setPlan([...next]);
    }
    setBusy(false);
  };
  const created = plan.filter((item) => item.status === 'created');
  const toCreate = plan.filter((item) => !item.status).length;

  return (
    <section className="adm-card adm-pad">
      <h2 className="adm-h2">Create a department’s accounts</h2>
      <p className="adm-muted">The HOD, the department admin, every desk and two coordinators for each event, with strong passwords. Accounts that already exist are left as they are.</p>
      <label className="adm-field">
        <span>Department</span>
        <select value={code} onChange={(event) => choose(event.target.value)} disabled={busy}>
          <option value="">Choose…</option>
          {catalog.departments.map((dept) => (
            <option key={dept.code} value={dept.code}>
              {dept.code} · {dept.name}
            </option>
          ))}
        </select>
      </label>
      {plan.length > 0 && (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static">
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {plan.map((item) => (
                  <tr key={item.username}>
                    <td className="adm-mono">{item.username}</td>
                    <td>{item.displayName}</td>
                    <td>
                      {ROLE_INFO[item.role].label}
                      {item.deskNumber ? ` ${item.deskNumber}` : ''}
                    </td>
                    <td>
                      {item.status === 'created' && <Badge tone="good">Created</Badge>}
                      {item.status === 'exists' && <Badge tone="plain">Already exists</Badge>}
                      {item.status === 'failed' && <Badge tone="bad">{item.message || 'Failed'}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adm-inline adm-inline--wrap">
            <button className="adm-button adm-button--primary" type="button" disabled={busy || toCreate === 0} onClick={() => void create()}>
              {busy ? 'Creating…' : `Create ${toCreate} accounts`}
            </button>
            <button
              className="adm-button"
              type="button"
              disabled={!created.length}
              onClick={() =>
                saveFile(
                  `${code}-accounts.csv`,
                  toCsv([
                    ['Department', 'Role', 'Name', 'Username', 'Password', 'Desk', 'Events', 'Sign in at'],
                    ...created.map((item) => [
                      item.department,
                      ROLE_INFO[item.role].label,
                      item.displayName,
                      item.username,
                      item.password,
                      item.deskNumber ?? '',
                      item.eventIds.map((id) => eventName(catalog, id)).join('; '),
                      `${window.location.origin}/landing/${item.department.toLowerCase()}/admin/`,
                    ]),
                  ]),
                  'text/csv;charset=utf-8',
                )
              }
            >
              Download the new logins (CSV)
            </button>
          </div>
          {created.length > 0 && <p className="adm-note">Download the logins now: the passwords are not shown again. Give each person their own login privately.</p>}
        </>
      )}
    </section>
  );
}
