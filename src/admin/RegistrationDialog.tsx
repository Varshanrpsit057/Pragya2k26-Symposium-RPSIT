/**
 * One student's record in a pop-up window, the same for every role, with big buttons for what
 * that role may do: verify a GPay payment, correct the details, change events, retry what
 * failed, and (admins) cancel or delete the record. The pass is the student's own: they
 * download it with Student login, so the dashboard never offers it.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { COLLEGES, OTHER_COLLEGE } from '../content/colleges';
import { events as allEvents } from '../content/events';
import { site } from '../content/site';
import type { AdminRegistration } from '../lib/admin';
import { DEPARTMENTS, OTHER_DEPARTMENT, YEARS_OF_STUDY, rupees } from '../lib/registration';
import { hasPermission, type SessionInfo } from '../lib/staff';
import {
  ApiFailure,
  SignedOut,
  approve,
  cancelRegistration,
  changeEvents,
  deleteRegistration,
  editDetails,
  proofUrl,
  reject,
  retry,
  screenshotUrl,
} from './adminApi';
import { Dialog } from './Dialog';
import { PaymentRecord } from './PaymentRecord';
import { Screenshot } from './Screenshot';
import { Badge, ErrorNote, Fact, FeeBadge, Section, StatusBadge, messageOf, when } from './ui';

const GATE_PASS_METHOD = { ONLINE_UPI: 'GPay online', CASH: 'cash at desk', UPI: 'GPay at desk' } as const;

/** The facts every view of a registration shares: student, events, gate pass. */
export function RegistrationFacts({ registration: item }: { registration: AdminRegistration }) {
  const { participant, gatePass } = item;
  return (
    <>
      <Section title="Student">
        <Fact label="Name" value={participant.name} />
        <Fact label="College" value={participant.college} />
        <Fact label="Department" value={participant.department} />
        <Fact label="Year" value={participant.year} />
        <Fact label="Phone" value={<a href={`tel:${participant.phone}`}>{participant.phone}</a>} />
        <Fact label="Email" value={<a href={`mailto:${participant.email}`}>{participant.email}</a>} />
        <Fact label="Participating as" value={item.teamName ? `Team · ${item.teamName}` : 'Individual'} />
      </Section>

      <Section title={`Events (${item.eventCount})`}>
        {item.events.length === 0 && <Fact label="Events" value="None yet: registered at each venue by its coordinator" />}
        {item.events.map((event) => (
          <Fact
            key={event.eventId}
            label={event.name}
            value={
              <span className="adm-inline">
                <FeeBadge fee={event.fee} />
                {event.attendance?.present ? <Badge tone="good">Present</Badge> : <Badge tone="plain">Not marked</Badge>}
                {event.team && <Badge tone="plain">Team · {event.team}</Badge>}
                {event.addedBy && <span className="adm-muted">added by {event.addedBy}</span>}
              </span>
            }
          />
        ))}
        {item.discontinuedEvents.length > 0 && <Fact label="Discontinued" value={`${item.discontinuedEvents.join(', ')} (no longer held; not charged)`} tone="warn" />}
        <Fact label="Still payable" value={`${rupees(item.payableAtVenue)} in event fees (${rupees(item.feePerEvent)} per event)`} />
      </Section>

      <Section title="Gate pass">
        <Fact
          label="Registered"
          value={item.source === 'ONSITE' ? `At ${item.deskNumber ? `desk ${item.deskNumber}` : 'the desk'}, by ${item.createdBy ?? '—'}, ${when(item.submittedAt)}` : `Online, ${when(item.submittedAt)}`}
        />
        <Fact
          label="Payment"
          value={
            gatePass.status === 'VERIFIED'
              ? `${rupees(gatePass.amount)} · ${GATE_PASS_METHOD[gatePass.method]} · verified by ${gatePass.verifiedBy ?? '—'} ${when(gatePass.verifiedAt)}`
              : gatePass.status === 'CANCELLED'
                ? `${rupees(gatePass.amount)} · registration cancelled, no longer counted as collected`
                : gatePass.status === 'REJECTED'
                  ? 'Rejected'
                  : item.source === 'ONSITE'
                    ? `${rupees(gatePass.amount)} by GPay from Student login: ${gatePassProof(item) ? 'screenshot received, waiting for approval' : 'waiting for the student to pay and upload the screenshot'}`
                    : `${rupees(gatePass.amount)} by GPay: waiting for verification`
          }
          tone={gatePass.status === 'VERIFIED' ? undefined : gatePass.status === 'CANCELLED' ? 'bad' : 'warn'}
        />
        {gatePass.reference && <Fact label={item.source === 'ONSITE' ? 'UPI reference' : 'Transaction ID'} value={<span className="adm-mono">{gatePass.reference}</span>} />}
      </Section>
    </>
  );
}

/** Where the pass, the email and the Google Sheet copy stand. */
export function Progress({ registration: item, passByEmail }: { registration: AdminRegistration; passByEmail: boolean }) {
  return (
    <Section title="Pass, email and Sheet">
      {item.status !== 'PENDING' && (
        <Fact label={item.status === 'REJECTED' ? 'Rejected' : 'Approved'} value={`${when(item.approvedAt ?? item.rejectedAt)}${item.reviewedBy ? ` by ${item.reviewedBy}` : ''}`} />
      )}
      {item.rejectionReason && <Fact label="Reason" value={item.rejectionReason} />}
      {item.cancelled && (
        <>
          <Fact label="Cancelled" value={`${when(item.cancelled.at)} by ${item.cancelled.by}`} tone="bad" />
          <Fact label="Why" value={item.cancelled.reason} />
        </>
      )}
      <Fact
        label="Student pass"
        value={item.pdfStatus === 'GENERATED' ? `Ready ${when(item.pdfGeneratedAt)}` : item.pdfStatus === 'FAILED' ? `Failed: ${item.pdfError ?? 'unknown error'}` : 'Made when approved'}
        tone={item.pdfStatus === 'FAILED' ? 'bad' : undefined}
      />
      {!passByEmail ? (
        <Fact label="Pass" value="Not emailed: the student downloads it themselves from the website (Student login)." />
      ) : (
      <Fact
        label="Confirmation email"
        value={
          {
            SENT: `Sent ${when(item.emailSentAt)}`,
            FAILED: `Failed: ${item.emailError ?? 'unknown error'}`,
            UNKNOWN: `Not confirmed by Gmail: ${item.emailError ?? ''}`,
            SENDING: 'Sending…',
            NOT_SENT: item.status === 'APPROVED' ? 'Not sent yet' : 'Sent when approved',
          }[item.emailStatus]
        }
        tone={item.emailStatus === 'FAILED' || item.emailStatus === 'UNKNOWN' ? 'bad' : undefined}
      />
      )}
      <Fact label="Google Sheet" value={item.sheet.synced ? 'Up to date' : `Waiting to copy${item.sheet.error ? `: ${item.sheet.error}` : ''}`} tone={item.sheet.synced ? undefined : 'warn'} />
    </Section>
  );
}

interface PaymentCheckProps {
  registrationId: string;
  amount: number;
  /** Online: the transaction ID typed with the form. */
  transactionId: string | null;
  /** Online: the screenshot uploaded with the form. */
  hasScreenshot: boolean;
  /**
   * A desk registration the student pays by GPay from Student login: their latest screenshot
   * (null until it arrives) and the transaction ID they typed with it, if any. Give the
   * component `key={proofId}` so a new screenshot starts a fresh check.
   */
  desk?: { proofId: string | null; studentTransactionId: string | null };
  token: string;
  /** After approving or rejecting: the updated record. */
  onDone: (registration: AdminRegistration) => void;
  onSignedOut: () => void;
}

const UTR = /^[A-Z0-9]{6,35}$/;

/**
 * A ₹100 gate pass paid by GPay: look at the screenshot (big, with zoom), check the amount,
 * the payee and the transaction ID, then approve (the pass is made) or reject. Paid online,
 * the transaction ID came with the form; paid from Student login after a desk registration,
 * the staff member types it from the screenshot (or records cash, if the student paid cash
 * in the end). For admins, the desk and coordinators.
 */
export function PaymentCheck({ registrationId, amount, transactionId, hasScreenshot, desk, token, onDone, onSignedOut }: PaymentCheckProps) {
  const { payment } = site.registration;
  const [reference, setReference] = useState(desk?.studentTransactionId ?? '');
  const [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<'check' | 'reject' | 'cash'>('check');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'cash' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const proofId = desk?.proofId ?? null;
  const forDesk = desk !== undefined;
  const load = useCallback(
    () => (forDesk ? proofUrl(token, registrationId, proofId ?? '') : screenshotUrl(token, registrationId)),
    [forDesk, token, registrationId, proofId],
  );
  const shown = forDesk ? proofId !== null : hasScreenshot;
  const utr = reference.replace(/\s+/g, '').toUpperCase();
  const utrOk = !forDesk || UTR.test(utr);

  const run = async (name: 'approve' | 'reject' | 'cash', task: () => Promise<AdminRegistration>) => {
    setBusy(name);
    setError(null);
    try {
      onDone(await task());
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="adm-verify" aria-label="Verify the GPay payment">
      <div className="adm-verify__shot">
        {shown ? (
          <Screenshot load={load} alt={`GPay payment screenshot for ${registrationId}`} onSignedOut={onSignedOut} />
        ) : forDesk ? (
          <div className="adm-wait" role="status">
            <p className="adm-wait__title">Waiting for the student's screenshot…</p>
            <p className="adm-muted">
              They sign in to Student login on their phone (Registration ID and phone), check their details, pay {rupees(amount)} by GPay and upload the screenshot. It appears here by
              itself.
            </p>
          </div>
        ) : (
          <p className="adm-muted">There is no payment screenshot.</p>
        )}
      </div>

      <div className="adm-verify__side">
        <div className="adm-verify__facts">
          <p>
            Amount: <strong>{rupees(amount)}</strong>
          </p>
          {payment.payee && (
            <p>
              Paid to: <strong>{payment.payee}</strong>
              {payment.upiId && <span className="adm-muted adm-mono"> ({payment.upiId})</span>}
            </p>
          )}
          {!forDesk && (
            <p>
              Transaction ID: <strong className="adm-mono">{transactionId ?? '—'}</strong>
            </p>
          )}
        </div>
        {forDesk && (
          <label className="adm-field adm-field--big">
            <span>Transaction ID from the screenshot (UPI reference / UTR)</span>
            <input
              className="adm-mono"
              value={reference}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              disabled={!shown || busy !== null}
              onChange={(event) => setReference(event.target.value)}
            />
            {desk?.studentTransactionId && <small className="adm-muted">Filled in from what the student typed: compare it with the screenshot.</small>}
            {reference.trim() !== '' && !utrOk && <small className="adm-field__error">6–35 letters or digits, exactly as in the screenshot.</small>}
          </label>
        )}
        <label className="adm-check adm-check--big">
          <input type="checkbox" checked={checked} disabled={!shown} onChange={(event) => setChecked(event.target.checked)} />
          <span>
            I have checked the screenshot: {rupees(amount)} was paid{payment.payee ? ` to ${payment.payee}` : ''}, today, and the transaction ID matches.
          </span>
        </label>
        <ErrorNote error={error} />
        {mode === 'reject' ? (
          <div className="adm-reject">
            <label className="adm-field">
              <span>Why is it rejected? (the student sees this)</span>
              <textarea value={reason} maxLength={300} rows={2} onChange={(event) => setReason(event.target.value)} />
            </label>
            <div className="adm-actions__row">
              <button className="adm-button adm-button--danger adm-button--big" type="button" disabled={busy !== null} onClick={() => void run('reject', () => reject(token, registrationId, reason.trim()))}>
                {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
              </button>
              <button className="adm-button adm-button--big" type="button" disabled={busy !== null} onClick={() => setMode('check')}>
                Back
              </button>
            </div>
          </div>
        ) : mode === 'cash' ? (
          <div className="adm-reject">
            <p>Did the student pay {rupees(amount)} in cash instead? Count it first.</p>
            <div className="adm-actions__row">
              <button className="adm-button adm-button--approve adm-button--big" type="button" disabled={busy !== null} onClick={() => void run('cash', () => approve(token, registrationId, { method: 'CASH' }))}>
                {busy === 'cash' ? 'Recording…' : `I have received ${rupees(amount)} in cash`}
              </button>
              <button className="adm-button adm-button--big" type="button" disabled={busy !== null} onClick={() => setMode('check')}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="adm-actions__row">
            <button
              className="adm-button adm-button--approve adm-button--big"
              type="button"
              disabled={!checked || !utrOk || !shown || busy !== null}
              onClick={() => void run('approve', () => approve(token, registrationId, forDesk ? { method: 'UPI', reference: utr } : undefined))}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve payment'}
            </button>
            {forDesk && (
              <button className="adm-button adm-button--big" type="button" disabled={busy !== null} onClick={() => setMode('cash')}>
                Paid cash instead
              </button>
            )}
            <button className="adm-button adm-button--danger-outline adm-button--big" type="button" disabled={busy !== null} onClick={() => setMode('reject')}>
              Reject
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The student's latest gate pass screenshot (from Student login), for a desk GPay to approve. */
export const gatePassProof = (item: Pick<AdminRegistration, 'proofs'>) => [...item.proofs].reverse().find((proof) => proof.kind === 'GATE_PASS') ?? null;

type View = 'record' | 'verify' | 'edit' | 'events' | 'cancel' | 'delete';

interface RegistrationDialogProps {
  registration: AdminRegistration;
  token: string;
  session: SessionInfo;
  onChange: (registration: AdminRegistration) => void;
  /** After an admin deleted the record. */
  onDeleted: (registrationId: string) => void;
  onClose: () => void;
  onSignedOut: () => void;
}

export function RegistrationDialog({ registration: item, token, session, onChange, onDeleted, onClose, onSignedOut }: RegistrationDialogProps) {
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(session.role, permission);
  const verifiable = item.status === 'PENDING' && can('registrations.approve');
  // Registered at the desk, paid by GPay from Student login: the student's screenshot.
  const deskPending = item.status === 'PENDING' && item.source === 'ONSITE';
  const proof = gatePassProof(item);
  const [view, setView] = useState<View>(verifiable ? 'verify' : 'record');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (name: string, task: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await task();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };
  const done = (updated: AdminRegistration) => {
    onChange(updated);
    setView('record');
  };

  const active = item.status !== 'REJECTED' && item.status !== 'CANCELLED';
  const canChangeEvents = can('registrations.events') && active && (session.eventDayStarted || session.role === 'ADMIN');
  const emailPending = session.passByEmail && (item.emailStatus === 'FAILED' || item.emailStatus === 'NOT_SENT');
  const needsRetry = item.status === 'APPROVED' && (item.pdfStatus !== 'GENERATED' || emailPending || !item.sheet.synced);

  const actions: { view?: View; label: string; onClick?: () => void; tone?: 'primary' | 'danger'; show: boolean }[] = [
    { view: 'verify', label: 'Verify GPay payment', tone: 'primary', show: verifiable },
    { view: 'edit', label: 'Correct details', show: can('registrations.edit') },
    { view: 'events', label: 'Change events', show: canChangeEvents },
    {
      label: busy === 'retry' ? 'Retrying…' : 'Retry failed steps',
      onClick: () => void run('retry', async () => onChange(await retry(token, item.registrationId))),
      show: needsRetry && can('registrations.retry'),
    },
    {
      label: busy === 'resend' ? 'Sending…' : 'Resend email',
      onClick: () => {
        if (window.confirm('Gmail did not confirm whether this email was sent. Check the Sent folder of the sending Gmail account first.\n\nSend the confirmation email again?')) {
          void run('resend', async () => onChange(await retry(token, item.registrationId, true)));
        }
      },
      show: session.passByEmail && item.emailStatus === 'UNKNOWN' && can('registrations.retry'),
    },
    { view: 'cancel', label: 'Cancel registration', tone: 'danger', show: item.status === 'APPROVED' && can('registrations.remove') },
    { view: 'delete', label: 'Delete record', tone: 'danger', show: can('registrations.delete') },
  ];

  const back = (
    <button className="adm-button" type="button" onClick={() => setView('record')}>
      ← Back to the record
    </button>
  );

  return (
    <Dialog
      title={
        <span className="adm-inline">
          {item.registrationId} · {item.participant.name} <StatusBadge status={item.status} />
        </span>
      }
      subtitle={`${item.participant.college} · ${item.source === 'ONSITE' ? 'registered at the desk' : 'registered online'}`}
      onClose={onClose}
      size={view === 'verify' ? 'full' : 'large'}
    >
      {view === 'record' && (
        <>
          <div className="adm-actions__row adm-record-actions">
            {actions
              .filter((action) => action.show)
              .map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`adm-button adm-button--big${action.tone === 'primary' ? ' adm-button--primary' : action.tone === 'danger' ? ' adm-button--danger-outline' : ''}`}
                  disabled={busy !== null}
                  onClick={action.onClick ?? (() => setView(action.view!))}
                >
                  {action.label}
                </button>
              ))}
          </div>
          <ErrorNote error={error} />
          {item.status === 'PENDING' && !verifiable && <p className="adm-note">This GPay payment is not verified yet: the desk, a coordinator or an admin must check it first.</p>}
          {deskPending && verifiable && (
            <p className="adm-note">
              {proof
                ? 'The student uploaded their GPay screenshot: press Verify GPay payment, type the transaction ID and approve.'
                : 'Waiting for the student to pay by GPay from Student login (Registration ID and phone) and upload the screenshot.'}
            </p>
          )}
          {item.status === 'REJECTED' && <p className="adm-error">This registration was rejected{item.rejectionReason ? `: ${item.rejectionReason}` : ''}. Register the student again if they pay now.</p>}
          {item.cancelled && <p className="adm-error">Cancelled by {item.cancelled.by} {when(item.cancelled.at)}: {item.cancelled.reason}. The pass is no longer valid.</p>}
          {item.processing && <p className="adm-note">The pass or email is being sent right now. It updates in a moment.</p>}
          <div className="adm-record">
            <RegistrationFacts registration={item} />
            <div>
              <Progress registration={item} passByEmail={session.passByEmail} />
              <Section title="Payments: screenshots and transaction IDs">
                <div className="adm-payrecs">
                  {item.payments.map((record) => (
                    <PaymentRecord
                      key={record.kind}
                      record={record}
                      registrationId={item.registrationId}
                      token={token}
                      onSignedOut={onSignedOut}
                      canSeeFormScreenshot={can('registrations.approve')}
                    />
                  ))}
                </div>
              </Section>
              <Proofs registration={item} token={token} onSignedOut={onSignedOut} />
            </div>
          </div>
        </>
      )}

      {view === 'verify' && (
        <Step title="Verify the GPay payment" back={back}>
          <PaymentCheck
            key={proof?.id ?? 'none'}
            registrationId={item.registrationId}
            amount={item.payment.amount}
            transactionId={item.payment.transactionId || null}
            hasScreenshot={item.screenshot !== null}
            desk={deskPending ? { proofId: proof?.id ?? null, studentTransactionId: proof?.transactionId ?? null } : undefined}
            token={token}
            onDone={done}
            onSignedOut={onSignedOut}
          />
        </Step>
      )}

      {view === 'edit' && (
        <Step title="Correct the details" back={back}>
          <EditDetails registration={item} token={token} onDone={done} onSignedOut={onSignedOut} />
        </Step>
      )}

      {view === 'events' && (
        <Step title="Change events" back={back}>
          <ChangeEvents registration={item} token={token} onChange={onChange} onSignedOut={onSignedOut} />
        </Step>
      )}

      {view === 'cancel' && (
        <Step title="Cancel this registration" back={back}>
          <ReasonForm
            intro={`Cancelling ${item.registrationId} (${item.participant.name}) makes their pass invalid and takes them off every event list and the collection totals; refund the ${rupees(item.gatePass.amount)} gate pass if needed. Their email can register again. This cannot be undone.`}
            paidEvents={item.events.filter((event) => event.fee.status === 'PAID').map((event) => event.name)}
            label="Reason (required, shown to the student)"
            confirm="Confirm cancellation"
            busyLabel="Cancelling…"
            onSubmit={async (reason) => done(await cancelRegistration(token, item.registrationId, reason))}
            onSignedOut={onSignedOut}
          />
        </Step>
      )}

      {view === 'delete' && (
        <Step title="Delete this record" back={back}>
          <ReasonForm
            intro={`Deleting takes ${item.registrationId} (${item.participant.name}) off every list and frees their email and phone: use it for a duplicate or a mistake. Nothing is lost: it goes to the Deleted list (web assistant team and admins), where it can be restored, with your name and the reason; its screenshots and pass stay, and its Google Sheet row and Drive record file are marked DELETED.`}
            paidEvents={item.events.filter((event) => event.fee.status === 'PAID').map((event) => event.name)}
            label="Reason (required, kept in the log)"
            confirm="Delete record"
            busyLabel="Deleting…"
            acknowledge="I understand it leaves every list (it can be restored from the Deleted list)."
            onSubmit={async (reason) => {
              await deleteRegistration(token, item.registrationId, reason);
              onDeleted(item.registrationId);
            }}
            onSignedOut={onSignedOut}
          />
        </Step>
      )}
    </Dialog>
  );
}

/** Other GPay screenshots the student uploaded from Student login (e.g. one sent again), shown big in place. */
function Proofs({ registration: item, token, onSignedOut }: { registration: AdminRegistration; token: string; onSignedOut: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = new Set(item.payments.map((record) => record.screenshot?.proofId).filter(Boolean));
  const others = item.proofs.filter((proof) => !shown.has(proof.id));
  if (!others.length) return null;
  return (
    <Section title="Other screenshots from the student">
      {others.map((proof) => (
        <div key={proof.id} className="adm-proof">
          <Fact
            label={proof.label}
            value={
              <span className="adm-inline">
                <span>
                  {when(proof.uploadedAt)}
                  {proof.transactionId && (
                    <>
                      {' '}
                      · <span className="adm-mono">{proof.transactionId}</span>
                    </>
                  )}
                </span>
                <button type="button" className="adm-button adm-button--small" aria-expanded={open === proof.id} onClick={() => setOpen(open === proof.id ? null : proof.id)}>
                  {open === proof.id ? 'Hide' : 'View'}
                </button>
              </span>
            }
          />
          {open === proof.id && <ProofImage registrationId={item.registrationId} proofId={proof.id} label={proof.label} token={token} onSignedOut={onSignedOut} />}
        </div>
      ))}
    </Section>
  );
}

function ProofImage({ registrationId, proofId, label, token, onSignedOut }: { registrationId: string; proofId: string; label: string; token: string; onSignedOut: () => void }) {
  const load = useCallback(() => proofUrl(token, registrationId, proofId), [token, registrationId, proofId]);
  return <Screenshot load={load} alt={`${label} screenshot for ${registrationId}`} onSignedOut={onSignedOut} />;
}

function Step({ title, back, children }: { title: string; back: ReactNode; children: ReactNode }) {
  return (
    <section className="adm-step" aria-label={title}>
      <div className="adm-step__head">
        <h3 className="adm-h3">{title}</h3>
        {back}
      </div>
      {children}
    </section>
  );
}

interface ReasonFormProps {
  intro: string;
  paidEvents: string[];
  label: string;
  confirm: string;
  busyLabel: string;
  acknowledge?: string;
  onSubmit: (reason: string) => Promise<void>;
  onSignedOut: () => void;
}

/** Cancelling or deleting: a reason, and nothing while an event fee is recorded. */
function ReasonForm({ intro, paidEvents, label, confirm, busyLabel, acknowledge, onSubmit, onSignedOut }: ReasonFormProps) {
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(!acknowledge);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSubmit(reason.trim());
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="adm-reject">
      <p className="adm-note">{intro}</p>
      {paidEvents.length > 0 && <p className="adm-error">The {paidEvents.join(', ')} fee is recorded: void it under Events first.</p>}
      <label className="adm-field">
        <span>{label}</span>
        <textarea value={reason} maxLength={300} rows={2} onChange={(event) => setReason(event.target.value)} />
      </label>
      {acknowledge && (
        <label className="adm-check">
          <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} />
          <span>{acknowledge}</span>
        </label>
      )}
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      <div className="adm-actions__row">
        <button className="adm-button adm-button--danger adm-button--big" type="button" disabled={busy || reason.trim().length < 3 || !sure || paidEvents.length > 0} onClick={() => void submit()}>
          {busy ? busyLabel : confirm}
        </button>
      </div>
    </div>
  );
}

/** Correcting a typo in the student's details; an approved student gets a new pass. */
function EditDetails({ registration: item, token, onDone, onSignedOut }: { registration: AdminRegistration; token: string; onDone: (registration: AdminRegistration) => void; onSignedOut: () => void }) {
  const known = (DEPARTMENTS as readonly string[]).includes(item.participant.department);
  const [form, setForm] = useState({
    name: item.participant.name,
    department: known ? item.participant.department : OTHER_DEPARTMENT,
    departmentOther: known ? '' : item.participant.department,
    year: item.participant.year,
    college: item.participant.college,
    phone: item.participant.phone,
    email: item.participant.email,
  });
  const emailChanged = form.email.trim().toLowerCase() !== item.participant.email;
  const [resend, setResend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fieldErrors = error instanceof ApiFailure ? error.fieldErrors : {};
  const set = (name: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [name]: event.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await editDetails(token, item.registrationId, {
          name: form.name,
          department: form.department === OTHER_DEPARTMENT ? form.departmentOther : form.department,
          college: form.college,
          year: form.year,
          phone: form.phone,
          email: form.email,
          resendEmail: item.status === 'APPROVED' && emailChanged && resend,
        }),
      );
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-form adm-form--two">
      <label className="adm-field adm-form__wide">
        <span>Name with initial</span>
        <input value={form.name} onChange={set('name')} autoFocus />
        {fieldErrors.name && <small className="adm-field__error">{fieldErrors.name}</small>}
      </label>
      <label className="adm-field">
        <span>Department</span>
        <select value={form.department} onChange={set('department')}>
          {DEPARTMENTS.map((department) => (
            <option key={department}>{department}</option>
          ))}
        </select>
        {fieldErrors.department && <small className="adm-field__error">{fieldErrors.department}</small>}
      </label>
      {form.department === OTHER_DEPARTMENT && (
        <label className="adm-field">
          <span>Department (typed)</span>
          <input value={form.departmentOther} onChange={set('departmentOther')} />
        </label>
      )}
      <label className="adm-field">
        <span>Year</span>
        <select value={form.year} onChange={set('year')}>
          {YEARS_OF_STUDY.map((year) => (
            <option key={year}>{year}</option>
          ))}
        </select>
      </label>
      <label className="adm-field adm-form__wide">
        <span>College</span>
        <input value={form.college} onChange={set('college')} list="edit-colleges" autoComplete="off" />
        <datalist id="edit-colleges">
          {COLLEGES.filter((college) => college !== OTHER_COLLEGE).map((college) => (
            <option key={college} value={college} />
          ))}
        </datalist>
        {fieldErrors.college && <small className="adm-field__error">{fieldErrors.college}</small>}
      </label>
      <label className="adm-field">
        <span>Phone</span>
        <input value={form.phone} onChange={set('phone')} inputMode="tel" />
        {fieldErrors.phone && <small className="adm-field__error">{fieldErrors.phone}</small>}
      </label>
      <label className="adm-field">
        <span>Email</span>
        <input value={form.email} onChange={set('email')} type="email" />
        {fieldErrors.email && <small className="adm-field__error">{fieldErrors.email}</small>}
      </label>
      {item.status === 'APPROVED' && emailChanged && (
        <label className="adm-check adm-form__wide">
          <input type="checkbox" checked={resend} onChange={(event) => setResend(event.target.checked)} />
          <span>Send the pass to the new email</span>
        </label>
      )}
      {item.status === 'APPROVED' && <p className="adm-muted adm-form__wide">The student gets a new pass with the corrected details.</p>}
      <div className="adm-form__wide">
        <ErrorNote error={error} />
        <button className="adm-button adm-button--approve adm-button--big" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save the corrections'}
        </button>
      </div>
    </div>
  );
}

/** Adding or removing events (not one whose fee or attendance is recorded). */
function ChangeEvents({ registration: item, token, onChange, onSignedOut }: { registration: AdminRegistration; token: string; onChange: (registration: AdminRegistration) => void; onSignedOut: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const enrolled = item.events.map((event) => event.eventId);
  const toggle = async (eventId: string, has: boolean) => {
    setBusy(eventId);
    setError(null);
    try {
      onChange(await changeEvents(token, item.registrationId, has ? { remove: [eventId] } : { add: [eventId] }));
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="adm-event-toggles">
      {allEvents.map((event) => {
        const has = enrolled.includes(event.id);
        const locked = item.events.some((entry) => entry.eventId === event.id && (entry.fee.status === 'PAID' || entry.attendance?.present));
        const lastOnline = has && enrolled.length === 1 && item.source === 'ONLINE';
        return (
          <div key={event.id} className={`adm-event-toggle${has ? ' is-on' : ''}`}>
            <div>
              <strong>{event.name}</strong>
              <p className="adm-muted">
                {[event.schedule, event.venue].filter(Boolean).join(' · ')}
                {locked && ' · fee or attendance recorded'}
              </p>
            </div>
            <button
              type="button"
              className={`adm-button adm-button--big${has ? '' : ' adm-button--primary'}`}
              disabled={busy !== null || (has && (locked || lastOnline))}
              onClick={() => void toggle(event.id, has)}
            >
              {busy === event.id ? 'Saving…' : has ? `Remove ${event.name}` : `Add ${event.name}`}
            </button>
          </div>
        );
      })}
      <ErrorNote error={error} />
    </div>
  );
}
