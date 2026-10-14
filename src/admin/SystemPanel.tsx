/**
 * Health & backups (web assist team): is every part of the website answering (checked from this
 * browser), how the backups went, a backup or a full Excel copy on demand, and what to do when
 * something goes wrong, each with a button to the place that fixes it.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, apiUrl } from '../lib/api';
import type { BackupStatus } from '../lib/portal';
import type { SessionInfo } from '../lib/staff';
import { SignedOut } from './adminApi';
import { useFest } from './fest/FestData';
import { backupNow, fetchPortal } from './fest/festApi';
import { downloadFullCopy } from './fest/exports';
import { Badge, ErrorNote, messageOf, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
  /** Opens another section (only those this account has). */
  onGo?: (section: string) => void;
}

export interface Check {
  name: string;
  url: string;
  state: 'waiting' | 'ok' | 'slow' | 'failed';
  ms: number | null;
  note: string;
}

export const CHECKS: { name: string; url: string }[] = [
  { name: 'Main website', url: '/' },
  { name: 'Student registration page', url: '/register/' },
  { name: 'Staff dashboard', url: '/landing/admin/' },
  { name: 'Registration server (API)', url: apiUrl(API_BASE, '/api/health') },
];

/** Loads a page or the API from this browser and times it. */
export async function check(url: string): Promise<Omit<Check, 'name' | 'url'>> {
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

export const checkTone = (state: Check['state']) => (state === 'ok' ? 'good' : state === 'slow' ? 'warn' : state === 'failed' ? 'bad' : 'plain');
export const checkLabel = (state: Check['state']) => (state === 'ok' ? 'OK' : state === 'slow' ? 'Slow' : state === 'failed' ? 'Not working' : '…');

/** The backups: how the last run went, in one line each. */
export function BackupLines({ status }: { status: BackupStatus | null | undefined }) {
  if (!status) return <p className="adm-muted">No backup has run yet.</p>;
  return (
    <ul className="adm-list">
      <li>
        Private copy <Badge tone={status.file === 'saved' ? 'good' : 'bad'}>{status.file === 'saved' ? 'saved' : 'failed'}</Badge> {when(status.at)}
        {status.file !== 'saved' && status.lastFileAt && <> (last good {when(status.lastFileAt)})</>}
      </li>
      <li>
        Google Sheet{' '}
        <Badge tone={status.sheet === 'failed' ? 'bad' : status.sheet === 'off' ? 'plain' : 'good'}>
          {status.sheet === 'written' ? 'updated' : status.sheet === 'unchanged' ? 'up to date' : status.sheet === 'off' ? 'not set up' : 'failed'}
        </Badge>
        {status.sheet === 'failed' && (
          <>
            {' '}
            {status.lastSheetAt ? `Last good copy ${when(status.lastSheetAt)}.` : 'No good copy yet.'}
            {status.sheetError ? ` ${status.sheetError}` : ''}
          </>
        )}
      </li>
    </ul>
  );
}

/** Back up now, and the full Excel copy: the same two buttons on Home and here. */
export function BackupButtons({ token, onSignedOut, onBackup }: { token: string; onSignedOut: () => void; onBackup: (status: BackupStatus | null) => void }) {
  const { catalog, registrations, results, session } = useFest();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const run = async () => {
    setBusy(true);
    setError(null);
    setNote('');
    try {
      const status = await backupNow(token);
      onBackup(status);
      setNote(status?.file === 'saved' ? 'Backed up just now.' : 'The backup ran, but a copy failed: see above.');
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span className="adm-inline adm-inline--wrap">
        <button className="adm-button adm-button--primary" type="button" disabled={busy} onClick={() => void run()}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <button className="adm-button" type="button" disabled={!catalog} onClick={() => catalog && downloadFullCopy(catalog, registrations, results, session.displayName)}>
          Download a full copy (Excel)
        </button>
      </span>
      {note && (
        <p className="adm-note" role="status">
          {note}
        </p>
      )}
      <ErrorNote error={error} />
    </>
  );
}

/** What to do when something goes wrong: each with the section that fixes it. */
const RUNBOOK: { problem: string; fix: string; section: string; button: string }[] = [
  { problem: 'Students cannot register on their phones', fix: 'Check that student registration is on, and that the registration times are open.', section: 'controls', button: 'Switches' },
  { problem: 'Registration must stay open longer, or stop now', fix: 'Extend on-site registration by the hour, close it now, or post a notice.', section: 'window', button: 'Times & notice' },
  { problem: 'A coordinator cannot sign in', fix: 'Check their account, give a new password, or see why their sign-in failed.', section: 'staff', button: 'Accounts' },
  { problem: 'The network is overloaded at the gate', fix: 'Pause the parts that are not needed now (lookups, downloads), and tell students with a notice.', section: 'controls', button: 'Switches' },
  { problem: 'The server stops answering', fix: 'Download the full Excel copy now and then, so every list is on this computer even while the server is down. The private copy and the Google Sheet keep the rest.', section: '', button: '' },
  { problem: 'Someone asks for help', fix: 'Answer them: they see the answer under Contact admin.', section: 'help', button: 'Help requests' },
];

export function SystemPanel({ token, session, onSignedOut, onGo }: PanelProps) {
  const { registrations, results, catalog } = useFest();
  const portal = useLiveData(useCallback(() => fetchPortal(token), [token]), onSignedOut, 60_000);
  const [backup, setBackup] = useState<BackupStatus | null | undefined>(undefined);
  const [checks, setChecks] = useState<Check[]>([]);
  const [checking, setChecking] = useState(false);

  const runChecks = useCallback(async () => {
    setChecking(true);
    setChecks(CHECKS.map((item) => ({ ...item, state: 'waiting', ms: null, note: 'Checking…' })));
    const done = await Promise.all(CHECKS.map(async (item) => ({ ...item, ...(await check(item.url)) })));
    setChecks(done);
    setChecking(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void runChecks(), 0);
    return () => window.clearTimeout(timer);
  }, [runChecks]);

  const all = [...registrations.values()];
  const cancelled = all.filter((item) => item.cancelled && !item.deleted).length;
  const deleted = all.filter((item) => item.deleted).length;
  const submitted = [...results.values()].filter((result) => result.submitted).length;

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad" aria-label="Is the website answering?">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Is the website answering?</h2>
          <button className="adm-button adm-button--small" type="button" disabled={checking} onClick={() => void runChecks()}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
        <p className="adm-muted">Checked from this computer. If everything answers here but not for someone else, the problem is their network.</p>
        <ul className="adm-checks">
          {checks.map((item) => (
            <li key={item.name}>
              <span>{item.name}</span>
              <Badge tone={checkTone(item.state)}>{checkLabel(item.state)}</Badge>
              <span className="adm-muted">
                {item.note}
                {item.ms !== null && ` (${item.ms} ms)`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="adm-card adm-pad" aria-label="Backups">
        <h2 className="adm-h2">Backups</h2>
        <p className="adm-muted">
          The live data is in the database. Every 10 minutes the server also copies every department to a private file (each earlier version kept) and to the Google Sheet. A
          failed copy loses nothing: the next run writes it all again. The full Excel copy is saved on this computer.
        </p>
        <BackupLines status={backup !== undefined ? backup : portal.data?.backup} />
        <BackupButtons token={token} onSignedOut={onSignedOut} onBackup={setBackup} />
        <ErrorNote error={portal.error} />
      </section>

      <section className="adm-card adm-pad" aria-label="The data">
        <h2 className="adm-h2">The data</h2>
        <ul className="adm-list">
          <li>
            {all.length - cancelled - deleted} students registered{cancelled ? ` · ${cancelled} cancelled` : ''}
            {deleted ? ` · ${deleted} deleted (they can be restored from Students, with Show cancelled)` : ''}
          </li>
          <li>
            {submitted} of {catalog?.events.filter((event) => event.active).length ?? 0} events have submitted results
          </li>
          <li>
            Registration: {session.phase === 'onsite' ? 'on-site registration open' : session.phase === 'closed' ? 'closed' : session.phase === 'online' ? 'online registration open' : 'between online and on-site'}
            {session.testing?.session ? ` · test session on (${session.testing.session})` : ''}
          </li>
        </ul>
      </section>

      <section className="adm-card adm-pad" aria-label="If something goes wrong">
        <h2 className="adm-h2">If something goes wrong</h2>
        <ul className="adm-runbook">
          {RUNBOOK.map((item) => (
            <li key={item.problem}>
              <div>
                <strong>{item.problem}</strong>
                <span className="adm-muted">{item.fix}</span>
              </div>
              {item.section && onGo && (
                <button className="adm-button adm-button--small" type="button" onClick={() => onGo(item.section)}>
                  {item.button}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
