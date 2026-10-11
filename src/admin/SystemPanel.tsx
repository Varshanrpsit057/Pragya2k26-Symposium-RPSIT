/**
 * System status, for the web assistant team and admins: is the website answering (checked from
 * this browser), and which registrations need attention (a pass, email or Sheet copy that
 * failed, a GPay payment waiting for verification), each opening in its pop-up to fix.
 */
import { useCallback, useState } from 'react';
import { API_BASE, apiUrl } from '../lib/api';
import type { AdminRegistration } from '../lib/admin';
import { STUDENT_PAGE } from '../lib/student';
import type { SessionInfo } from '../lib/staff';
import { SignedOut, getRegistration, systemStatus } from './adminApi';
import { RegistrationDialog } from './RegistrationDialog';
import { Badge, ErrorNote, LiveStatus, messageOf, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

interface Check {
  name: string;
  url: string;
  state: 'waiting' | 'ok' | 'slow' | 'failed';
  ms: number | null;
  note: string;
}

const CHECKS: { name: string; url: string }[] = [
  { name: 'Main website', url: '/' },
  { name: 'Student login page', url: STUDENT_PAGE },
  { name: 'Registration server (API)', url: apiUrl(API_BASE, '/api/health') },
];

/** Loads a page or the API from this browser and times it. */
async function check(url: string): Promise<Omit<Check, 'name' | 'url'>> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) return { state: 'failed', ms, note: `Answered ${response.status}` };
    return { state: ms > 3000 ? 'slow' : 'ok', ms, note: ms > 3000 ? 'Answering slowly: the network may be busy' : 'Answering' };
  } catch (error) {
    return { state: 'failed', ms: null, note: controller.signal.aborted ? 'No answer in 15 seconds' : messageOf(error) };
  } finally {
    window.clearTimeout(timer);
  }
}

export function SystemPanel({ token, session, onSignedOut }: PanelProps) {
  const load = useCallback(() => systemStatus(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const status = live.data;
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<AdminRegistration | null>(null);
  const [error, setError] = useState<unknown>(null);

  const runChecks = async () => {
    setChecking(true);
    setChecks(CHECKS.map((item) => ({ ...item, state: 'waiting', ms: null, note: 'Checking…' })));
    const results = await Promise.all(CHECKS.map(async (item) => ({ ...item, ...(await check(item.url)) })));
    setChecks(results);
    setChecking(false);
  };

  const openRecord = async (registrationId: string) => {
    setError(null);
    try {
      setOpen(await getRegistration(token, registrationId));
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    }
  };

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">System status</h2>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <ErrorNote error={live.error ?? error} />

        <h3 className="adm-h3">Is the website answering?</h3>
        <p className="adm-muted">Checks the pages and the server from this computer. If they answer here but not for someone else, the problem is their network.</p>
        <button className="adm-button adm-button--primary adm-button--big" type="button" disabled={checking} onClick={() => void runChecks()}>
          {checking ? 'Checking…' : 'Check the website now'}
        </button>
        {checks.length > 0 && (
          <ul className="adm-checks">
            {checks.map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <Badge tone={item.state === 'ok' ? 'good' : item.state === 'slow' ? 'warn' : item.state === 'failed' ? 'bad' : 'plain'}>
                  {item.state === 'ok' ? 'OK' : item.state === 'slow' ? 'Slow' : item.state === 'failed' ? 'Not working' : '…'}
                </Badge>
                <span className="adm-muted">
                  {item.note}
                  {item.ms !== null && ` (${item.ms} ms)`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {status && (
          <>
            <div className="adm-stats">
              <Stat label="Registrations" value={status.registrations.total} note={`${status.registrations.online} online · ${status.registrations.onsite} at the desk`} />
              <Stat label="GPay payments to verify" value={status.counts.paymentWaiting} note="Desk, coordinators or admins" tone={status.counts.paymentWaiting ? 'warn' : undefined} />
              <Stat label="Passes failed" value={status.counts.passFailed} note="Retry in the record" tone={status.counts.passFailed ? 'bad' : undefined} />
              <Stat label="Emails failed" value={status.counts.emailFailed + status.counts.emailUnconfirmed} note={`${status.counts.emailUnconfirmed} not confirmed by Gmail`} tone={status.counts.emailFailed + status.counts.emailUnconfirmed ? 'bad' : undefined} />
              <Stat label="Google Sheet" value={status.counts.sheetFailed ? `${status.counts.sheetFailed} failing` : 'OK'} note={`${status.counts.sheetWaiting} waiting to copy (every 10 minutes)`} tone={status.counts.sheetFailed ? 'bad' : undefined} />
              <Stat label="Help requests" value={status.openHelp} note="open" tone={status.openHelp ? 'warn' : undefined} />
            </div>
            <p className="adm-muted">
              Server time {when(status.serverTime)} · Student login is {status.studentPortal ? 'on' : 'paused'}
            </p>

            <h3 className="adm-h3">Needs attention ({status.problems.length})</h3>
            {status.problems.length === 0 ? (
              <p className="adm-muted">Nothing: every pass, email and Sheet copy went through.</p>
            ) : (
              <ul className="adm-problems">
                {status.problems.map((problem) => (
                  <li key={problem.registrationId}>
                    <button type="button" className="adm-link adm-mono" onClick={() => void openRecord(problem.registrationId)}>
                      {problem.registrationId}
                    </button>{' '}
                    {problem.name}
                    <ul>
                      {problem.problems.map((text) => (
                        <li key={text} className="adm-muted">
                          {text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            {status.deleted.length > 0 && (
              <>
                <h3 className="adm-h3">Deleted records</h3>
                <ul className="adm-problems">
                  {status.deleted.map((entry) => (
                    <li key={`${entry.at}-${entry.registrationId}`}>
                      <strong className="adm-mono">{entry.registrationId}</strong> {entry.name} · deleted by {entry.by} {when(entry.at)}: {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
      {open && (
        <RegistrationDialog
          registration={open}
          token={token}
          session={session}
          onChange={(updated) => {
            setOpen(updated);
            live.refresh();
          }}
          onDeleted={() => {
            setOpen(null);
            live.refresh();
          }}
          onClose={() => setOpen(null)}
          onSignedOut={onSignedOut}
        />
      )}
    </main>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`adm-stat${tone ? ` adm-stat--${tone}` : ''}`}>
      <span className="adm-stat__label">{label}</span>
      <strong className="adm-stat__value">{value}</strong>
      <span className="adm-muted">{note}</span>
    </div>
  );
}
