/** Staff accounts (admins): create, set roles, assign events, reset passwords, deactivate. */
import { useCallback, useState, type FormEvent } from 'react';
import { events as allEvents } from '../content/events';
import { ROLE_INFO, STAFF_ROLES, type SessionInfo, type StaffAccountView, type StaffRole } from '../lib/staff';
import { SignedOut, createStaff, listStaff, signedInNow, updateStaff, type StaffChange } from './adminApi';
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

const eventName = (id: string) => allEvents.find((event) => event.id === id)?.name ?? id;

function EventChoice({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset className="adm-events">
      <legend>Assigned events</legend>
      {allEvents.map((event) => (
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

  const replace = (account: StaffAccountView) =>
    live.setData((current) => {
      const list = current ?? [];
      return list.some((item) => item.username === account.username) ? list.map((item) => (item.username === account.username ? account : item)) : [...list, account];
    });

  return (
    <main className="adm-page">
      <SignedInNow token={token} onSignedOut={onSignedOut} />
      <NewAccount token={token} onCreated={replace} onSignedOut={onSignedOut} />
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Staff accounts</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p className="adm-muted">
          The owner account ({session.kind === 'owner' ? 'you' : 'ADMIN_USERNAME'}) is set in the Amplify secrets and is not listed here. Changes apply
          at once: a deactivated account or a reset password signs that person out.
        </p>
        <ErrorNote error={live.error} />
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--static">
            <thead>
              <tr>
                <th scope="col">Username</th>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
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
                    <td>{ROLE_INFO[account.role].label}</td>
                    <td>{account.role === 'COORDINATOR' ? account.eventIds.map(eventName).join(', ') : 'All'}</td>
                    <td>{account.active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Deactivated</Badge>}</td>
                    <td className="adm-muted">
                      {when(account.updatedAt)} by {account.updatedBy}
                    </td>
                    <td>
                      <button className="adm-button adm-button--small" type="button" onClick={() => setEditing(account.username)}>
                        Edit
                      </button>
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

function NewAccount({ token, onCreated, onSignedOut }: { token: string; onCreated: (account: StaffAccountView) => void; onSignedOut: () => void }) {
  const [form, setForm] = useState({ username: '', displayName: '', role: 'DESK' as StaffRole, eventIds: [] as string[], password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = await createStaff(token, { ...form, eventIds: form.role === 'COORDINATOR' ? form.eventIds : [] });
      onCreated(account);
      setCreated({ username: account.username, password: form.password });
      setForm({ username: '', displayName: '', role: form.role, eventIds: [], password: '' });
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
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as StaffRole })}>
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_INFO[role].label}
              </option>
            ))}
          </select>
        </label>
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
            <EventChoice value={form.eventIds} onChange={(eventIds) => setForm({ ...form, eventIds })} />
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
  const [change, setChange] = useState<StaffChange>({ displayName: account.displayName, role: account.role, eventIds: account.eventIds, active: account.active });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await updateStaff(token, account.username, { ...change, ...(password && { password }) }));
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
            <select value={change.role} onChange={(event) => setChange({ ...change, role: event.target.value as StaffRole })}>
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_INFO[role].label}
                </option>
              ))}
            </select>
          </label>
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
              <EventChoice value={change.eventIds ?? []} onChange={(eventIds) => setChange({ ...change, eventIds })} />
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

/** Who is signed in right now, with the registration desk each desk sign-in is at. */
function SignedInNow({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const load = useCallback(() => signedInNow(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const sessions = live.data ?? [];
  return (
    <section className="adm-card adm-pad" aria-label="Signed in now">
      <div className="adm-toolbar">
        <h2 className="adm-h2">Signed in now ({sessions.length})</h2>
        <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
      </div>
      <ErrorNote error={live.error} />
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
