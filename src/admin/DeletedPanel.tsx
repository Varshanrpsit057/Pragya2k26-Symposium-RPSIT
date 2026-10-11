/**
 * Deleted (web assistant team and admins): every student record deleted from the lists, who
 * deleted it, when and why, with Restore to bring it back as it was. Nobody else sees them.
 */
import { useCallback, useMemo, useState } from 'react';
import type { SessionInfo } from '../lib/staff';
import { SignedOut, listDeleted, restoreDeleted } from './adminApi';
import { ErrorNote, LiveStatus, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

export function DeletedPanel({ token, onSignedOut }: PanelProps) {
  const load = useCallback(() => listDeleted(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const all = live.data ?? [];
    return words ? all.filter((item) => [item.registrationId, item.name, item.phone, item.email, item.college].join(' ').toLowerCase().includes(words)) : all;
  }, [live.data, query]);

  const restore = async (registrationId: string, name: string) => {
    if (!window.confirm(`Bring ${registrationId} (${name}) back to the lists?`)) return;
    setBusy(registrationId);
    setError(null);
    setNote('');
    try {
      await restoreDeleted(token, registrationId);
      setNote(`${registrationId} (${name}) is back on the lists.`);
      live.refresh();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad" aria-label="Deleted students">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Deleted students ({live.data?.length ?? 0})</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p className="adm-muted">Records deleted from the lists: nobody else sees them. Restore brings one back as it was, unless its phone or email has since been used by another registration.</p>
        <ErrorNote error={live.error ?? error} />
        {note && (
          <p className="adm-note" role="status">
            {note}
          </p>
        )}
        <label className="adm-field">
          <span>Search</span>
          <input value={query} placeholder="ID, name, phone, email or college" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {live.data && shown.length === 0 ? (
          <p className="adm-muted">{query ? 'No deleted student matches.' : 'No deleted students.'}</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Student</th>
                  <th>Deleted</th>
                  <th>Reason</th>
                  <th>
                    <span className="adm-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.registrationId}>
                    <td className="adm-mono">
                      {item.registrationId}
                      <div className="adm-muted">{item.source === 'ONSITE' ? 'Desk' : 'Online'}</div>
                    </td>
                    <td>
                      {item.name}
                      <div className="adm-muted">
                        {[item.phone, item.email, item.college].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {item.deletedBy}
                      <div className="adm-muted">{when(item.deletedAt)}</div>
                    </td>
                    <td>{item.reason}</td>
                    <td>
                      <button className="adm-button adm-button--small" type="button" disabled={busy !== null} onClick={() => void restore(item.registrationId, item.name)}>
                        {busy === item.registrationId ? 'Restoring…' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
