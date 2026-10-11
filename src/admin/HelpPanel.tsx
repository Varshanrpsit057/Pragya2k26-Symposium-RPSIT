/**
 * Help requests sent with Contact admin, for admins and the web assistant team: read, answer
 * (the sender sees the answer under Contact admin) and mark resolved.
 */
import { useCallback, useState } from 'react';
import { HELP_CATEGORIES, type HelpRequest } from '../lib/help';
import type { SessionInfo } from '../lib/staff';
import { SignedOut, listHelp, updateHelp } from './adminApi';
import { Badge, ErrorNote, LiveStatus, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

export function HelpPanel({ token, onSignedOut }: PanelProps) {
  const load = useCallback(() => listHelp(token), [token]);
  const live = useLiveData(load, onSignedOut, 15_000);
  const [showResolved, setShowResolved] = useState(false);
  const requests = live.data ?? [];
  const open = requests.filter((request) => request.status === 'OPEN');
  const shown = showResolved ? requests : open;
  const replace = (updated: HelpRequest) => live.setData((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null);

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Help requests</h2>
          <span className="adm-muted">{open.length} open</span>
          <label className="adm-check">
            <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
            <span>Show resolved too</span>
          </label>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <p className="adm-muted">Problems the student coordinators report with Contact admin. Your reply shows to them under Contact admin.</p>
        <ErrorNote error={live.error} />
        {live.data !== null && shown.length === 0 && <p className="adm-muted adm-empty">No open help requests.</p>}
        <ul className="adm-help-list">
          {shown.map((request) => (
            <HelpItem key={request.id} request={request} token={token} onChange={replace} onSignedOut={onSignedOut} />
          ))}
        </ul>
      </section>
    </main>
  );
}

function HelpItem({ request, token, onChange, onSignedOut }: { request: HelpRequest; token: string; onChange: (request: HelpRequest) => void; onSignedOut: () => void }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const send = async (status?: HelpRequest['status']) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await updateHelp(token, request.id, { ...(status && { status }), ...(reply.trim() && { reply: reply.trim() }) }));
      setReply('');
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`adm-help-item${request.status === 'RESOLVED' ? ' is-resolved' : ''}`}>
      <div className="adm-help-item__head">
        <strong>{HELP_CATEGORIES[request.category]}</strong>
        {request.status === 'OPEN' ? <Badge tone="warn">Open</Badge> : <Badge tone="good">Resolved</Badge>}
        <span className="adm-muted">{when(request.createdAt)}</span>
      </div>
      <p className="adm-help-item__message">{request.message}</p>
      <p className="adm-muted">
        From {request.name}
        {request.username && ` (${request.username})`}
        {request.contact && ` · ${request.contact}`}
        {request.page && ` · in ${request.page}`}
        {request.registrationId && (
          <>
            {' '}
            · about <strong className="adm-mono">{request.registrationId}</strong>
          </>
        )}
      </p>
      {(request.replies ?? []).length > 0 && (
        <ul className="adm-replies" aria-label="Replies">
          {request.replies!.map((item) => (
            <li key={item.at}>
              <strong>{item.by}</strong> <span className="adm-muted">{when(item.at)}</span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      )}
      {request.status === 'RESOLVED' && (
        <p className="adm-muted">
          Resolved by {request.resolvedBy} {when(request.resolvedAt)}
        </p>
      )}
      <label className="adm-field">
        <span>Reply to {request.name}</span>
        <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} maxLength={1000} placeholder="e.g. Fixed: the college is now Sona College of Technology." />
      </label>
      <div className="adm-inline adm-inline--wrap">
        <button className="adm-button adm-button--primary" type="button" disabled={busy || !reply.trim()} onClick={() => void send()}>
          Send reply
        </button>
        {request.status === 'OPEN' ? (
          <button className="adm-button adm-button--approve" type="button" disabled={busy} onClick={() => void send('RESOLVED')}>
            {reply.trim() ? 'Reply and mark resolved' : 'Mark resolved'}
          </button>
        ) : (
          <button className="adm-button" type="button" disabled={busy} onClick={() => void send('OPEN')}>
            Open again
          </button>
        )}
        {request.contact && /\d{6,}/.test(request.contact) && (
          <a className="adm-button" href={`tel:${request.contact.replace(/\s+/g, '')}`}>
            Call {request.name}
          </a>
        )}
      </div>
      <ErrorNote error={error} />
    </li>
  );
}
