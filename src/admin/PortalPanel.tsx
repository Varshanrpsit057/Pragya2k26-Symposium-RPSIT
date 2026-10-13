/**
 * Website controls (web assist team): every part of the On-site Registration Portal can be switched
 * off and on again, the UPI QR code students pay with is uploaded, replaced or removed, and each
 * role's sign-in can be switched off, with how many of them are signed in right now. The server
 * enforces every switch; the pages and dashboards follow within seconds.
 */
import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { UPI_ID } from '../lib/fest';
import { LOGIN_LABELS, LOGIN_ROLES, QR_MAX_CHARS, SWITCH_INFO, type BackupStatus, type LoginRole, type SwitchName } from '../lib/portal';
import type { SessionInfo } from '../lib/staff';
import { SignedOut, signedInNow } from './adminApi';
import { fetchPortal, savePortal, saveQr, type PortalView } from './fest/festApi';
import { Badge, ErrorNote, useLiveData, when } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

const STUDENT_SWITCHES: SwitchName[] = ['selfRegistration', 'studentLookup'];
const EVENT_SWITCHES: SwitchName[] = ['ownDepartmentEvents', 'eventEntry', 'results'];
const STAFF_SWITCHES: SwitchName[] = ['deskRegistration', 'downloads'];

/** Makes the QR code picture small enough to send (a PNG when it fits; it stays sharp enough to scan). */
export async function shrinkQr(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That file is not a picture. Upload the QR code as a PNG or JPEG.'));
      element.src = url;
    });
    for (const size of [560, 480, 400, 320]) {
      const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare the picture. Try another browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const [type, quality] of [
        ['image/png', undefined],
        ['image/webp', 0.92],
        ['image/jpeg', 0.9],
      ] as const) {
        const data = canvas.toDataURL(type, quality);
        if (data.startsWith(`data:${type};`) && data.length <= QR_MAX_CHARS) return data;
      }
    }
    throw new Error('The picture is too detailed to send. Crop it to just the QR code and try again.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PortalPanel({ token, onSignedOut }: PanelProps) {
  const [view, setView] = useState<PortalView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [upi, setUpi] = useState({ upiId: '', upiPayee: '' });
  const signedIn = useLiveData(useCallback(() => signedInNow(token), [token]), onSignedOut, 30_000);

  const show = useCallback((next: PortalView) => {
    // A save answers without the backup status: keep the one already shown.
    setView((current) => ({ ...next, backup: next.backup !== undefined ? next.backup : current?.backup }));
    setUpi({ upiId: next.portal.upiId, upiPayee: next.portal.upiPayee });
  }, []);
  const run = async (key: string, work: () => Promise<PortalView>) => {
    setBusy(key);
    setError(null);
    try {
      show(await work());
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    let active = true;
    fetchPortal(token)
      .then((next) => active && show(next))
      .catch((failure) => {
        if (!active) return;
        if (failure instanceof SignedOut) onSignedOut();
        else setError(failure);
      });
    return () => {
      active = false;
    };
  }, [token, onSignedOut, show]);

  if (!view) {
    return (
      <main className="adm-page">
        {error ? <ErrorNote error={error} /> : <p className="adm-muted">Loading the website controls…</p>}
      </main>
    );
  }
  const { portal, qr } = view;

  const flip = (name: SwitchName) => {
    const next = !portal[name];
    if (!next && !window.confirm(`Switch off “${SWITCH_INFO[name].label}”?\n\n${SWITCH_INFO[name].off}`)) return;
    void run(name, () => savePortal(token, { [name]: next }));
  };
  const flipLogin = (role: LoginRole) => {
    const next = !portal.logins[role];
    if (!next && !window.confirm(`Switch off sign-in for ${LOGIN_LABELS[role].toLowerCase()}?\n\nEveryone signed in with those accounts is signed out at once, and they cannot sign in until you switch it on again.`)) return;
    void run(`login-${role}`, () => savePortal(token, { logins: { ...portal.logins, [role]: next } }));
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('qr');
    setError(null);
    try {
      const image = await shrinkQr(file);
      show(await saveQr(token, image));
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };
  const upiChanged = upi.upiId.trim() !== portal.upiId || upi.upiPayee.trim() !== portal.upiPayee;
  const upiProblem = upi.upiId.trim() && !UPI_ID.test(upi.upiId.trim()) ? 'The UPI ID looks wrong (like name@bank).' : '';
  const countOf = (role: LoginRole) => (signedIn.data ?? []).filter((item) => item.role === role).length;

  return (
    <main className="adm-page adm-controls">
      <section className="adm-card adm-pad">
        <h2 className="adm-h2">Website controls</h2>
        <p className="adm-muted">
          Switch any part of the portal off and on again. Each change applies at once: the students’ page and every dashboard follow within seconds, and the server refuses what is off (the web
          assist team can still fix things).
          {portal.updatedBy && portal.updatedAt && (
            <>
              {' '}
              Last changed by {portal.updatedBy} {when(portal.updatedAt)}.
            </>
          )}
        </p>
        <ErrorNote error={error} />
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Students’ page</h3>
        {STUDENT_SWITCHES.map((name) => (
          <Switch key={name} name={name} on={portal[name]} busy={busy === name} onFlip={() => flip(name)} />
        ))}
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Online payment</h3>
        <Switch name="onlinePayment" on={portal.onlinePayment} busy={busy === 'onlinePayment'} onFlip={() => flip('onlinePayment')} />
        <div className="adm-qr">
          <div className="adm-qr__preview">{qr ? <img src={qr} alt="The UPI QR code students see" width={200} height={200} /> : <span className="adm-muted">No QR code uploaded</span>}</div>
          <div className="adm-qr__actions">
            <p className="adm-muted">
              Upload the QR code from GPay (or any UPI app) for the account receiving the entry fees. Students scan it, pay, then send the 12-digit UTR; desks match it.
              {portal.qrAt && <> Uploaded {when(portal.qrAt)}.</>}
            </p>
            <label className={`adm-button adm-button--primary${busy === 'qr' ? ' is-busy' : ''}`}>
              {busy === 'qr' ? 'Uploading…' : qr ? 'Replace the QR code' : 'Upload the QR code'}
              <input className="adm-visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy !== null} onChange={(event) => void upload(event)} />
            </label>
            {qr && (
              <button
                className="adm-button adm-button--danger-outline"
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm('Remove the QR code? Students then see only the UPI ID (if one is set) to pay to.')) void run('qr', () => saveQr(token, null));
                }}
              >
                Remove the QR code
              </button>
            )}
          </div>
        </div>
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>UPI ID (shown under the QR code)</span>
            <input value={upi.upiId} placeholder="name@bank" autoComplete="off" spellCheck={false} onChange={(event) => setUpi({ ...upi, upiId: event.target.value })} />
          </label>
          <label className="adm-field">
            <span>Account holder name</span>
            <input value={upi.upiPayee} maxLength={80} onChange={(event) => setUpi({ ...upi, upiPayee: event.target.value })} />
          </label>
        </div>
        {upiProblem && <p className="adm-field__error">{upiProblem}</p>}
        <span className="adm-inline">
          <button className="adm-button adm-button--primary" type="button" disabled={!upiChanged || Boolean(upiProblem) || busy !== null} onClick={() => void run('upi', () => savePortal(token, { upiId: upi.upiId.trim(), upiPayee: upi.upiPayee.trim() }))}>
            {busy === 'upi' ? 'Saving…' : 'Save the UPI account'}
          </button>
        </span>
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Events</h3>
        {EVENT_SWITCHES.map((name) => (
          <Switch key={name} name={name} on={portal[name]} busy={busy === name} onFlip={() => flip(name)} />
        ))}
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Desks and downloads</h3>
        {STAFF_SWITCHES.map((name) => (
          <Switch key={name} name={name} on={portal[name]} busy={busy === name} onFlip={() => flip(name)} />
        ))}
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Sign-in by role</h3>
        <p className="adm-muted">Off: every account of that role is signed out at once and cannot sign in. One account at a time: Accounts (sign out, deactivate, delete, new password).</p>
        {LOGIN_ROLES.map((role) => (
          <SwitchRow
            key={role}
            label={LOGIN_LABELS[role]}
            on={portal.logins[role]}
            busy={busy === `login-${role}`}
            onFlip={() => flipLogin(role)}
            detail={
              <>
                {portal.logins[role] ? 'Can sign in.' : 'Signed out; cannot sign in.'} <Badge tone={countOf(role) ? 'good' : 'plain'}>{countOf(role)} signed in now</Badge>
              </>
            }
          />
        ))}
      </section>

      <Backups status={view.backup ?? null} />

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">Elsewhere in the dashboard</h3>
        <ul className="adm-list">
          <li>Registration times (open, extend, close now) and the website notice: Event-day controls.</li>
          <li>Each department and event on or off, names, venues, fees: Departments & events.</li>
          <li>Each account (create, sign out, deactivate, delete, new password) and who is signed in: Accounts.</li>
        </ul>
      </section>
    </main>
  );
}

/** How the scheduled copies went (every 10 minutes): the private copy and the Google Sheet. */
function Backups({ status }: { status: BackupStatus | null }) {
  return (
    <section className="adm-card adm-pad" aria-labelledby="adm-backups">
      <h3 className="adm-h3" id="adm-backups">
        Backups
      </h3>
      <p className="adm-muted">
        Every 10 minutes the server copies every department’s registrations and results to a private file (each earlier version kept) and to the Google Sheet. A failed copy loses
        nothing: the live data stays in the database, and the next run writes the whole copy again. The Excel downloads work at any time.
      </p>
      {!status ? (
        <p className="adm-muted">No backup has run yet.</p>
      ) : (
        <ul className="adm-list">
          <li>
            Last run {when(status.at)}: private copy <Badge tone={status.file === 'saved' ? 'good' : 'bad'}>{status.file === 'saved' ? 'saved' : 'failed'}</Badge>
            {status.file !== 'saved' && status.lastFileAt && <> (last saved {when(status.lastFileAt)})</>}
          </li>
          <li>
            Google Sheet{' '}
            <Badge tone={status.sheet === 'failed' ? 'bad' : status.sheet === 'off' ? 'plain' : 'good'}>
              {status.sheet === 'written' ? 'updated' : status.sheet === 'unchanged' ? 'up to date' : status.sheet === 'off' ? 'not set up' : 'failed'}
            </Badge>
            {status.sheet === 'failed' && (
              <>
                {' '}
                {status.lastSheetAt ? `Last good copy ${when(status.lastSheetAt)}.` : 'No good copy yet.'} Tried again at the next run{status.sheetError ? `: ${status.sheetError}` : ''}.
              </>
            )}
          </li>
        </ul>
      )}
    </section>
  );
}

function Switch({ name, on, busy, onFlip }: { name: SwitchName; on: boolean; busy: boolean; onFlip: () => void }) {
  const info = SWITCH_INFO[name];
  return <SwitchRow label={info.label} on={on} busy={busy} onFlip={onFlip} detail={on ? info.on : info.off} />;
}

function SwitchRow({ label, on, busy, onFlip, detail }: { label: string; on: boolean; busy: boolean; onFlip: () => void; detail: ReactNode }) {
  return (
    <div className={`adm-switch-row${on ? '' : ' is-off'}`}>
      <div className="adm-switch-row__text">
        <strong>{label}</strong>
        <span className="adm-muted">{detail}</span>
      </div>
      <button className={`adm-switch${on ? ' is-on' : ''}`} type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={onFlip}>
        <span className="adm-switch__knob" />
        <span className="adm-switch__text">{busy ? '…' : on ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}
