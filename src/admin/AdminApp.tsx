import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminRegistration } from '../lib/admin';
import { rupees, type RegistrationStatus } from '../lib/registration';
import {
  SignedOut,
  approve,
  currentAdmin,
  listRegistrations,
  passUrl,
  reject,
  retry,
  savedToken,
  screenshotUrl,
  signIn,
  signOut,
} from './adminApi';

type Filter = RegistrationStatus | 'ALL';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

const STATUS_LABEL: Record<RegistrationStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

const istFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const when = (iso: string | null) => (iso ? `${istFormat.format(new Date(iso))} IST` : '—');

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/** Starts a download from a short-lived link without leaving the dashboard. */
function download(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.click();
}

export function AdminApp() {
  const [token, setToken] = useState<string | null>(savedToken);
  const [username, setUsername] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const signedOut = useCallback((message = '') => {
    setToken(null);
    setUsername(null);
    setNotice(message);
  }, []);

  // A saved session is checked with the server before anything is shown.
  useEffect(() => {
    if (!token || username) return;
    let active = true;
    currentAdmin(token)
      .then((session) => active && setUsername(session.username))
      .catch((error: unknown) => active && signedOut(error instanceof SignedOut ? 'Your session has ended. Please sign in again.' : messageOf(error)));
    return () => {
      active = false;
    };
  }, [token, username, signedOut]);

  if (!token) {
    return (
      <LoginForm
        notice={notice}
        onSignedIn={(newToken, name) => {
          setToken(newToken);
          setUsername(name);
          setNotice('');
        }}
      />
    );
  }
  if (!username) return <p className="adm-loading">Checking your session…</p>;
  return (
    <Dashboard
      token={token}
      username={username}
      onSignOut={() => {
        void signOut(token);
        signedOut('You have signed out.');
      }}
      onSignedOut={() => signedOut('Your session has ended. Please sign in again.')}
    />
  );
}

function LoginForm({ notice, onSignedIn }: { notice: string; onSignedIn: (token: string, username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const token = await signIn(username.trim(), password);
      setPassword('');
      onSignedIn(token, username.trim());
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };

  return (
    <main className="adm-login">
      <form className="adm-card adm-login__card" onSubmit={submit}>
        <h1 className="adm-login__title">PRAGYA 2026 Admin</h1>
        <p className="adm-muted">Sign in to verify payments and approve registrations.</p>
        {notice && <p className="adm-note">{notice}</p>}
        <label className="adm-field">
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label className="adm-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="adm-error" role="alert">
            {error}
          </p>
        )}
        <button className="adm-button adm-button--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

interface DashboardProps {
  token: string;
  username: string;
  onSignOut: () => void;
  onSignedOut: () => void;
}

function Dashboard({ token, username, onSignOut, onSignedOut }: DashboardProps) {
  const [registrations, setRegistrations] = useState<AdminRegistration[] | null>(null);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const handle = useCallback(
    (failure: unknown) => {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(messageOf(failure));
    },
    [onSignedOut],
  );

  // Bumped by Refresh to load the list again.
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let active = true;
    listRegistrations(token).then(
      (list) => {
        if (!active) return;
        setRegistrations(list);
        setError('');
        setLoading(false);
      },
      (failure: unknown) => {
        if (!active) return;
        handle(failure);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [token, handle, reloads]);

  const refresh = () => {
    setLoading(true);
    setReloads((count) => count + 1);
  };

  const counts = useMemo(() => {
    const all = registrations ?? [];
    return {
      PENDING: all.filter((item) => item.status === 'PENDING').length,
      APPROVED: all.filter((item) => item.status === 'APPROVED').length,
      REJECTED: all.filter((item) => item.status === 'REJECTED').length,
      ALL: all.length,
    };
  }, [registrations]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (registrations ?? []).filter((item) => {
      if (filter !== 'ALL' && item.status !== filter) return false;
      if (!needle) return true;
      const { participant, payment } = item;
      return [item.registrationId, participant.name, participant.email, participant.phone, participant.college, payment.transactionId].some(
        (value) => value.toLowerCase().includes(needle),
      );
    });
  }, [registrations, filter, query]);

  const selected = registrations?.find((item) => item.registrationId === selectedId) ?? null;

  const replace = (updated: AdminRegistration) =>
    setRegistrations((current) => current?.map((item) => (item.registrationId === updated.registrationId ? updated : item)) ?? null);

  return (
    <div className="adm">
      <header className="adm-bar">
        <h1 className="adm-bar__title">PRAGYA 2026 · Registrations</h1>
        <div className="adm-bar__side">
          <span className="adm-muted">Signed in as {username}</span>
          <button className="adm-button" type="button" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className="adm-button" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="adm-main">
        <section className="adm-card adm-list" aria-label="Registrations">
          <div className="adm-toolbar">
            <div className="adm-tabs" role="tablist" aria-label="Filter by status">
              {FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  className="adm-tab"
                  onClick={() => setFilter(value)}
                >
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
          </div>

          {error && (
            <p className="adm-error" role="alert">
              {error}
            </p>
          )}

          {registrations === null ? (
            <p className="adm-muted adm-empty">{loading ? 'Loading registrations…' : 'Registrations could not be loaded.'}</p>
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
                    <tr
                      key={item.registrationId}
                      className={item.registrationId === selectedId ? 'is-selected' : undefined}
                      onClick={() => setSelectedId(item.registrationId)}
                    >
                      <td>
                        <button type="button" className="adm-link" onClick={() => setSelectedId(item.registrationId)}>
                          {item.registrationId}
                        </button>
                      </td>
                      <td>{item.participant.name}</td>
                      <td>{item.participant.college}</td>
                      <td className="adm-mono">{item.payment.transactionId}</td>
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

        <section className="adm-card adm-detail" aria-label="Registration details">
          {selected ? (
            <Detail key={selected.registrationId} registration={selected} token={token} onChange={replace} onError={handle} />
          ) : (
            <p className="adm-muted adm-empty">Select a registration to see its details and payment.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <span className={`adm-badge adm-badge--${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

interface DetailProps {
  registration: AdminRegistration;
  token: string;
  onChange: (registration: AdminRegistration) => void;
  onError: (error: unknown) => void;
}

function Detail({ registration: item, token, onChange, onError }: DetailProps) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState('');
  const [verified, setVerified] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { participant, payment } = item;

  // The screenshot link expires after a few minutes: "Reload screenshot" bumps this for a new one.
  const [screenshotLoads, setScreenshotLoads] = useState(0);
  const loadScreenshot = () => setScreenshotLoads((count) => count + 1);
  useEffect(() => {
    let active = true;
    screenshotUrl(token, item.registrationId).then(
      (url) => {
        if (!active) return;
        setScreenshot(url);
        setScreenshotError('');
      },
      (failure: unknown) => {
        if (!active) return;
        if (failure instanceof SignedOut) onError(failure);
        else setScreenshotError(messageOf(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [token, item.registrationId, onError, screenshotLoads]);

  const run = async (name: string, task: () => Promise<AdminRegistration>) => {
    setBusy(name);
    setError('');
    try {
      onChange(await task());
      setRejecting(false);
    } catch (failure) {
      if (failure instanceof SignedOut) onError(failure);
      else setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  };

  const doApprove = () => {
    const confirmed = window.confirm(
      `Approve ${item.registrationId} (${participant.name})?\n\nTheir participant pass will be generated and the confirmation email sent to ${participant.email}.`,
    );
    if (confirmed) void run('approve', () => approve(token, item.registrationId));
  };

  const doReject = () => void run('reject', () => reject(token, item.registrationId, reason.trim()));

  const doResend = () => {
    const confirmed = window.confirm(
      'Gmail did not confirm whether this email was sent. Check the Sent folder of the sending Gmail account first.\n\nSend the confirmation email again?',
    );
    if (confirmed) void run('resend', () => retry(token, item.registrationId, true));
  };

  const viewPass = async () => {
    setBusy('pass');
    setError('');
    try {
      download(await passUrl(token, item.registrationId));
    } catch (failure) {
      if (failure instanceof SignedOut) onError(failure);
      else setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  };

  const needsRetry =
    item.status === 'APPROVED' &&
    (item.pdfStatus !== 'GENERATED' || item.emailStatus === 'FAILED' || item.emailStatus === 'NOT_SENT' || !item.sheet.synced);

  return (
    <div className="adm-detail__body">
      <header className="adm-detail__head">
        <div>
          <h2 className="adm-detail__id">{item.registrationId}</h2>
          <p className="adm-muted">Submitted {when(item.submittedAt)}</p>
        </div>
        <StatusBadge status={item.status} />
      </header>

      <Section title="Student">
        <Fact label="Name" value={participant.name} />
        <Fact label="Email" value={<a href={`mailto:${participant.email}`}>{participant.email}</a>} />
        <Fact label="Phone" value={<a href={`tel:${participant.phone}`}>{participant.phone}</a>} />
        <Fact label="College" value={participant.college} />
        <Fact label="Department" value={participant.department} />
        <Fact label="Year" value={participant.year} />
      </Section>

      <Section title={`Events (${item.eventCount})`}>
        <Fact label="Technical" value={item.technicalEvents.join(', ') || '—'} />
        <Fact label="Non-technical" value={item.nonTechnicalEvents.join(', ') || '—'} />
        <Fact label="Payable at venue" value={`${rupees(item.payableAtVenue)} (${item.eventCount} × ${rupees(item.feePerEvent)})`} />
      </Section>

      <Section title="Payment">
        <Fact label="Gate pass amount" value={rupees(payment.amount)} />
        <Fact label="Transaction ID" value={<span className="adm-mono">{payment.transactionId}</span>} />
        <div className="adm-shot">
          {screenshot ? (
            <a href={screenshot} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img
                src={screenshot}
                alt={`Payment screenshot for ${item.registrationId}`}
                onError={() => setScreenshotError('The screenshot could not be shown (its link may have expired). Reload it, or open it in Google Drive.')}
              />
            </a>
          ) : (
            <p className="adm-muted">{screenshotError || 'Loading screenshot…'}</p>
          )}
          {screenshotError && screenshot && <p className="adm-muted">{screenshotError}</p>}
          <div className="adm-shot__links">
            <button type="button" className="adm-link" onClick={loadScreenshot}>
              Reload screenshot
            </button>
            {item.driveLinks.payment && (
              <a href={item.driveLinks.payment} target="_blank" rel="noopener noreferrer">
                Open in Google Drive
              </a>
            )}
          </div>
        </div>
      </Section>

      <Section title="Progress">
        {item.status !== 'PENDING' && (
          <Fact
            label={item.status === 'APPROVED' ? 'Approved' : 'Rejected'}
            value={`${when(item.approvedAt ?? item.rejectedAt)}${item.reviewedBy ? ` by ${item.reviewedBy}` : ''}`}
          />
        )}
        {item.rejectionReason && <Fact label="Reason" value={item.rejectionReason} />}
        <Fact
          label="Participant pass"
          value={
            item.pdfStatus === 'GENERATED'
              ? `Generated ${when(item.pdfGeneratedAt)}`
              : item.pdfStatus === 'FAILED'
                ? `Failed: ${item.pdfError ?? 'unknown error'}`
                : 'Not generated (made on approval)'
          }
          tone={item.pdfStatus === 'FAILED' ? 'bad' : undefined}
        />
        <Fact
          label="Confirmation email"
          value={
            {
              SENT: `Sent ${when(item.emailSentAt)}`,
              FAILED: `Failed: ${item.emailError ?? 'unknown error'}`,
              UNKNOWN: `Not confirmed by Gmail: ${item.emailError ?? ''}`,
              SENDING: 'Sending…',
              NOT_SENT: item.status === 'APPROVED' ? 'Not sent yet' : 'Not sent (sent on approval)',
            }[item.emailStatus]
          }
          tone={item.emailStatus === 'FAILED' || item.emailStatus === 'UNKNOWN' ? 'bad' : undefined}
        />
        <Fact
          label="Google Sheet"
          value={item.sheet.synced ? 'Up to date' : `Waiting to sync${item.sheet.error ? `: ${item.sheet.error}` : ''}`}
          tone={item.sheet.synced ? undefined : 'warn'}
        />
      </Section>

      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}

      {item.status === 'PENDING' && (
        <div className="adm-actions">
          <label className="adm-check">
            <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
            <span>
              I have checked the screenshot: {rupees(payment.amount)} was paid and the transaction ID matches.
            </span>
          </label>
          {rejecting ? (
            <div className="adm-reject">
              <label className="adm-field">
                <span>Reason (optional, shown to the student)</span>
                <textarea value={reason} maxLength={300} rows={2} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="adm-actions__row">
                <button className="adm-button adm-button--danger" type="button" onClick={doReject} disabled={busy !== null}>
                  {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
                </button>
                <button className="adm-button" type="button" onClick={() => setRejecting(false)} disabled={busy !== null}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="adm-actions__row">
              <button className="adm-button adm-button--approve" type="button" onClick={doApprove} disabled={!verified || busy !== null}>
                {busy === 'approve' ? 'Approving… (pass and email)' : 'Approve'}
              </button>
              <button className="adm-button adm-button--danger-outline" type="button" onClick={() => setRejecting(true)} disabled={busy !== null}>
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {item.status === 'APPROVED' && (
        <div className="adm-actions">
          {item.processing && <p className="adm-note">The pass or email is being sent right now. Refresh in a moment.</p>}
          {item.emailStatus === 'UNKNOWN' && (
            <p className="adm-note">
              Gmail did not confirm this email. Check the Sent folder of the sending account before resending, so the student
              does not get it twice.
            </p>
          )}
          <div className="adm-actions__row">
            {item.pdfStatus === 'GENERATED' && (
              <button className="adm-button" type="button" onClick={() => void viewPass()} disabled={busy !== null}>
                {busy === 'pass' ? 'Opening…' : 'Download pass (PDF)'}
              </button>
            )}
            {needsRetry && (
              <button
                className="adm-button adm-button--primary"
                type="button"
                onClick={() => void run('retry', () => retry(token, item.registrationId))}
                disabled={busy !== null}
              >
                {busy === 'retry' ? 'Retrying…' : 'Retry failed steps'}
              </button>
            )}
            {item.emailStatus === 'UNKNOWN' && (
              <button className="adm-button adm-button--primary" type="button" onClick={doResend} disabled={busy !== null}>
                {busy === 'resend' ? 'Sending…' : 'Resend email'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="adm-section">
      <h3 className="adm-section__title">{title}</h3>
      <dl className="adm-facts">{children}</dl>
    </section>
  );
}

function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`adm-fact${tone ? ` adm-fact--${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
