/**
 * The student page (/landing/student/): sign in with the Registration ID and the phone number
 * used to register, then download the pass (passes are not emailed for now), see the events
 * with their timing alerts, and upload the GPay screenshot of a payment made at a venue.
 * Registered at the desk and paying by GPay, the student first checks the details the desk
 * typed, pays the ₹100 gate pass, uploads the screenshot and waits for the desk to approve it.
 * Admins pause it when the desks need the network; while paused it says so and costs one tiny
 * request. The help desk's numbers are always at the bottom.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LazyCampusMap } from '../components/map/LazyCampusMap';
import { GroupedId } from '../components/ui/GroupedId';
import { site } from '../content/site';
import { useSchedule } from '../lib/liveSchedule';
import { normaliseRegistrationId, rupees } from '../lib/registration';
import { credentialsProblem, type StudentCredentials, type StudentView } from '../lib/student';
import { studentAlerts, timedEvents } from './alerts';
import { StudentApiError, passUrl, portalState, signIn, uploadProof } from './studentApi';

const SAVED = 'pragya-student';
/** The event day ('2026-10-17'), for the event times. */
/** The event day's date (a test timeline moves it), for the event times and alerts. */
const dayOf = (onsiteOpensAt: string | null) => (onsiteOpensAt ?? site.registration.onsite.opensAt ?? '2026-10-17').slice(0, 10);
const PAUSED =
  'Student login is paused for a few minutes so the registration desks stay fast. Please try again soon, or ask at the help desk. At each venue, just tell the coordinator your Registration ID.';
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
const whatsapp = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

/** This tab's sign-in, so a reload does not ask again (gone when the tab closes). */
function readSaved(): StudentCredentials | null {
  try {
    const raw = sessionStorage.getItem(SAVED);
    return raw ? (JSON.parse(raw) as StudentCredentials) : null;
  } catch {
    return null;
  }
}

function save(credentials: StudentCredentials | null) {
  try {
    if (credentials) sessionStorage.setItem(SAVED, JSON.stringify(credentials));
    else sessionStorage.removeItem(SAVED);
  } catch {
    // Private browsing: the student signs in again after a reload.
  }
}

const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something went wrong. Please try again.');
const isPaused = (failure: unknown) => failure instanceof StudentApiError && failure.code === 'STUDENT_LOGIN_PAUSED';

type Screen =
  | { kind: 'loading' }
  | { kind: 'paused'; message: string }
  | { kind: 'signin'; notice: string }
  /** `at`: when the view was last read from the server. */
  | { kind: 'home'; view: StudentView; credentials: StudentCredentials; at: number };

/** What to show first: this tab's sign-in again, or whether the page is on at all. */
async function firstScreen(): Promise<Screen> {
  const saved = readSaved();
  try {
    if (saved) return { kind: 'home', view: await signIn(saved), credentials: saved, at: Date.now() };
    return (await portalState()).enabled ? { kind: 'signin', notice: '' } : { kind: 'paused', message: PAUSED };
  } catch (failure) {
    if (isPaused(failure)) return { kind: 'paused', message: messageOf(failure) };
    if (failure instanceof StudentApiError && failure.code === 'NOT_FOUND') save(null);
    return { kind: 'signin', notice: messageOf(failure) };
  }
}

export function StudentApp() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void firstScreen().then((next) => {
      if (active) setScreen(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const retry = () => {
    setScreen({ kind: 'loading' });
    void firstScreen().then(setScreen);
  };
  // Stable, for the page that checks by itself while the desk approves a payment.
  const update = useCallback((view: StudentView) => setScreen((current) => (current.kind === 'home' ? { ...current, view, at: Date.now() } : current)), []);
  const paused = useCallback((message: string) => setScreen({ kind: 'paused', message }), []);

  return (
    <div className="stu">
      <header className="stu-head">
        <p className="stu-head__brand">
          {site.name} {site.year}
        </p>
        <p className="stu-head__sub">Student login · {site.dates}</p>
      </header>
      <main className="stu-main">
        {screen.kind === 'loading' && <p className="stu-muted">Loading…</p>}
        {screen.kind === 'paused' && <Paused message={screen.message} onRetry={retry} />}
        {screen.kind === 'signin' && (
          <SignIn
            notice={screen.notice}
            onSignedIn={(view, credentials) => {
              save(credentials);
              setScreen({ kind: 'home', view, credentials, at: Date.now() });
            }}
            onPaused={(message) => setScreen({ kind: 'paused', message })}
          />
        )}
        {screen.kind === 'home' && (
          <Home
            key={screen.view.registrationId}
            view={screen.view}
            credentials={screen.credentials}
            updatedAt={screen.at}
            onUpdate={update}
            onPaused={paused}
            onSignOut={() => {
              save(null);
              setScreen({ kind: 'signin', notice: '' });
            }}
          />
        )}
      </main>
      {site.helpDesk.phones.length > 0 && (
        <footer className="stu-foot" aria-label="Help desk">
          <p>
            <strong>Help desk</strong> for any help:
          </p>
          {site.helpDesk.phones.map((line) => (
            <p key={line.phone} className="stu-foot__line">
              <a className="stu-button stu-button--ghost stu-button--small" href={tel(line.phone)}>
                Call {line.phone}
              </a>
              <a className="stu-button stu-button--ghost stu-button--small" href={whatsapp(line.phone)} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </p>
          ))}
          <p className="stu-muted">{site.helpDesk.where}</p>
        </footer>
      )}
    </div>
  );
}

function Paused({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="stu-card" aria-labelledby="stu-paused">
      <h1 id="stu-paused" className="stu-title">
        Student login is paused
      </h1>
      <p>{message}</p>
      <button className="stu-button stu-button--ghost" type="button" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

function SignIn({ notice, onSignedIn, onPaused }: { notice: string; onSignedIn: (view: StudentView, credentials: StudentCredentials) => void; onPaused: (message: string) => void }) {
  const [registrationId, setRegistrationId] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const credentials = { registrationId: normaliseRegistrationId(registrationId), phone: phone.trim() };
    const problem = credentialsProblem(credentials);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      onSignedIn(await signIn(credentials), credentials);
    } catch (failure) {
      if (isPaused(failure)) onPaused(messageOf(failure));
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stu-card" onSubmit={submit} aria-labelledby="stu-signin" noValidate>
      <h1 id="stu-signin" className="stu-title">
        Sign in
      </h1>
      <p className="stu-muted">For your pass, your events and their timings.</p>
      <label className="stu-field">
        <span>Registration ID</span>
        <input value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="e.g. 262007" required />
      </label>
      <label className="stu-field">
        <span>Phone number you registered with</span>
        <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" type="tel" autoComplete="tel" placeholder="10-digit mobile number" required />
      </label>
      {error && (
        <p className="stu-error" role="alert">
          {error}
        </p>
      )}
      <button className="stu-button" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

const STATUS_NOTE: Record<Exclude<StudentView['status'], 'APPROVED'>, (reason: string | null) => string> = {
  PENDING: () => 'Your online payment is not verified yet, so you have no pass yet. Please go to the registration desk with your payment screenshot.',
  REJECTED: (reason) => `Your registration was not approved${reason ? `: ${reason}` : '.'} Please go to the registration desk.`,
  CANCELLED: (reason) => `Your registration was cancelled${reason ? `: ${reason}` : '.'} Your pass is no longer valid. Please speak to the organisers at the registration desk.`,
};

interface HomeProps {
  view: StudentView;
  credentials: StudentCredentials;
  /** When the view was last read from the server. */
  updatedAt: number;
  onUpdate: (view: StudentView) => void;
  onPaused: (message: string) => void;
  onSignOut: () => void;
}

function Home({ view, credentials, updatedAt, onUpdate, onPaused, onSignOut }: HomeProps) {
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState<'pass' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const [mapFor, setMapFor] = useState<string | null>(null);

  // The alerts follow the clock without asking the server again.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const run = async (name: 'pass' | 'refresh', task: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await task();
    } catch (failure) {
      if (isPaused(failure)) onPaused(messageOf(failure));
      else setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  };

  const day = dayOf(useSchedule().onsiteOpensAt);
  const alerts = studentAlerts(view, now, day);
  const events = timedEvents(view, day);
  const showEvents = view.status === 'APPROVED' || (view.status === 'PENDING' && !view.payAtLogin);
  const time = new Date(updatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  return (
    <>
      <section className="stu-card stu-id" aria-label="Your registration">
        <p className="stu-muted">Hi, {view.name}</p>
        <p className="stu-id__number">
          <GroupedId id={view.registrationId} />
        </p>
        <p className="stu-muted">
          {view.college}
          {view.teamName && ` · Team ${view.teamName}`}
        </p>
        {view.status === 'APPROVED' ? (
          <span className="stu-chip stu-chip--good">Gate pass verified</span>
        ) : view.payAtLogin ? (
          <span className="stu-chip stu-chip--warn">
            {view.payAtLogin.screenshotSent ? 'Payment submitted: waiting for approval' : `Gate pass ${rupees(view.payAtLogin.amount)}: to pay below`}
          </span>
        ) : (
          <p className="stu-banner" role="status">
            {STATUS_NOTE[view.status](view.reason)}
          </p>
        )}
        {view.passAvailable && (
          <button className="stu-button" type="button" disabled={busy !== null} onClick={() => void run('pass', async () => window.location.assign(await passUrl(credentials)))}>
            {busy === 'pass' ? 'Preparing your pass…' : 'Download your pass (PDF)'}
          </button>
        )}
        {view.status === 'APPROVED' && !view.passAvailable && view.source === 'ONSITE' && (
          <p className="stu-muted">No pass is needed: show your Registration ID (above) to the coordinator at each event.</p>
        )}
        {view.status === 'APPROVED' && !view.passAvailable && view.source !== 'ONSITE' && <p className="stu-muted">Your pass is being prepared. Refresh in a few minutes.</p>}
        {!view.payAtLogin && (
          <details className="stu-more">
            <summary>Your details</summary>
            <DetailsList view={view} />
            <p className="stu-muted stu-small">Something wrong? Ask at the registration desk: they correct it and your pass is made again.</p>
          </details>
        )}
      </section>

      {view.payAtLogin && <DeskPayment view={view} credentials={credentials} onUpdate={onUpdate} onPaused={onPaused} />}

      {!view.payAtLogin && alerts.length > 0 && (
        <section className="stu-card" aria-labelledby="stu-alerts">
          <h2 id="stu-alerts" className="stu-subtitle">
            Timing alerts
          </h2>
          <ul className="stu-alerts" aria-live="polite">
            {alerts.map((alert) => (
              <li key={alert.text} className={`stu-alert stu-alert--${alert.tone}`}>
                {alert.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {showEvents && (
        <section className="stu-card" aria-labelledby="stu-events">
          <h2 id="stu-events" className="stu-subtitle">
            Your events ({events.length})
          </h2>
          {events.length === 0 && <p className="stu-muted">No events yet. Register for an event at its venue, with its coordinator.</p>}
          <p className="stu-note">The judges' decision is final. The rules given at the venue are final; the rules on the website may change.</p>
          <ul className="stu-events">
            {events.map((event) => (
              <li key={event.id} className="stu-event">
                <p className="stu-event__name">{event.name}</p>
                <p className="stu-event__when">
                  {event.schedule ?? 'Time to be announced'}
                  {event.venue && ` · ${event.venue}`}
                </p>
                <p className="stu-event__chips">
                  {event.team && <span className="stu-chip">Team {event.team}</span>}
                  <span className={`stu-chip ${event.feePaid ? 'stu-chip--good' : 'stu-chip--warn'}`}>
                    {event.feePaid
                      ? `${rupees(view.feePerEvent)} paid`
                      : screenshotSent(view, event.id)
                        ? 'Screenshot sent: the coordinator approves it'
                        : `${rupees(view.feePerEvent)} to pay (GPay below, or cash at the venue)`}
                  </span>
                  {event.present && <span className="stu-chip stu-chip--good">Marked present</span>}
                </p>
                {event.routeMap ? (
                  <a className="stu-link" href={event.routeMap} target="_blank" rel="noopener noreferrer">
                    Route map to {event.venue ?? 'the venue'}
                  </a>
                ) : (
                  event.venue && (
                    <button type="button" className="stu-button stu-button--ghost stu-button--small" aria-expanded={mapFor === event.id} onClick={() => setMapFor(mapFor === event.id ? null : event.id)}>
                      {mapFor === event.id ? 'Hide the map' : `Show ${event.venue} on the map`}
                    </button>
                  )
                )}
                {mapFor === event.id && <LazyCampusMap venue={event.venue} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.status === 'APPROVED' && view.events.length > 0 && <EventFeePay view={view} credentials={credentials} onUpdate={onUpdate} onPaused={onPaused} />}

      {error && (
        <p className="stu-error" role="alert">
          {error}
        </p>
      )}
      <div className="stu-actions">
        <button
          className="stu-button stu-button--ghost"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('refresh', async () => {
              onUpdate(await signIn(credentials));
              setNow(Date.now());
            })
          }
        >
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
        </button>
        <button className="stu-button stu-button--ghost" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <p className="stu-muted stu-small">As of {time}. Fees and attendance update when you refresh.</p>
    </>
  );
}

interface EventFeePayProps {
  view: StudentView;
  credentials: StudentCredentials;
  onUpdate: (view: StudentView) => void;
  onPaused: (message: string) => void;
}

/** The student has sent a GPay screenshot of this event's fee (the coordinator approves it). */
const screenshotSent = (view: StudentView, eventId: string) => view.proofs.some((proof) => proof.kind === eventId);

/**
 * An event's ₹50 fee by GPay from this page: the same QR as the gate pass, then the screenshot
 * goes to that event's coordinator, who checks it, approves it and marks attendance at the
 * venue. (Or pay the coordinator in cash at the venue.)
 */
function EventFeePay({ view, credentials, onUpdate, onPaused }: EventFeePayProps) {
  const unpaid = view.events.filter((event) => !event.feePaid);
  const [chosen, setChosen] = useState(() => unpaid.find((event) => !screenshotSent(view, event.eventId))?.eventId ?? unpaid[0]?.eventId ?? '');
  const [transactionId, setTransactionId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const preview = useMemo(() => (file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  // An event paid meanwhile drops out of the list.
  const kind = unpaid.some((event) => event.eventId === chosen) ? chosen : (unpaid[0]?.eventId ?? '');
  const event = unpaid.find((item) => item.eventId === kind);
  const fee = rupees(view.feePerEvent);

  const submit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!file) return setError('Choose the screenshot first.');
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('The screenshot must be a PNG or JPG image.');
    if (file.size > 5 * 1024 * 1024) return setError('The image must be 5 MB or smaller.');
    setBusy(true);
    setError('');
    setDone('');
    try {
      const next = await uploadProof(credentials, file, kind, transactionId.replace(/\s+/g, ''));
      onUpdate(next);
      setDone(`Sent to the ${event?.name ?? ''} coordinator. They approve it at the venue.`);
      // On to the next event still to pay, if any.
      setChosen(next.events.find((item) => !item.feePaid && !screenshotSent(next, item.eventId))?.eventId ?? kind);
      setFile(null);
      setTransactionId('');
      setInputKey((count) => count + 1);
    } catch (failure) {
      if (isPaused(failure)) onPaused(messageOf(failure));
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const sent = view.events.filter((item) => screenshotSent(view, item.eventId));
  return (
    <form className="stu-card" onSubmit={submit} aria-labelledby="stu-fee" noValidate>
      <h2 id="stu-fee" className="stu-subtitle">
        Pay an event fee by GPay
      </h2>
      <p className="stu-muted">
        {fee} per event. Pay here and upload the screenshot: the event's coordinator approves it and marks you present at the venue. Or pay the coordinator in cash there.
      </p>
      {unpaid.length === 0 ? (
        <p className="stu-chip stu-chip--good">All your event fees are paid.</p>
      ) : (
        <>
          <label className="stu-field">
            <span>Which event?</span>
            <select value={kind} onChange={(changeEvent) => setChosen(changeEvent.target.value)}>
              {unpaid.map((item) => (
                <option key={item.eventId} value={item.eventId}>
                  {item.name} {fee}
                  {screenshotSent(view, item.eventId) ? ' (screenshot sent)' : ''}
                </option>
              ))}
            </select>
          </label>
          <PayBox amount={view.feePerEvent} note={`PRAGYA ${view.registrationId} ${event?.name ?? ''}`.trim()} />
          <label className="stu-field">
            <span>Screenshot (PNG or JPG)</span>
            <input key={inputKey} type="file" accept="image/png,image/jpeg" onChange={(changeEvent) => setFile(changeEvent.target.files?.[0] ?? null)} />
          </label>
          {preview && <img className="stu-preview" src={preview} alt="Your payment screenshot" />}
          <label className="stu-field">
            <span>Transaction ID / UTR (optional, from the screenshot)</span>
            <input value={transactionId} onChange={(changeEvent) => setTransactionId(changeEvent.target.value)} autoComplete="off" spellCheck={false} maxLength={40} />
          </label>
          {error && (
            <p className="stu-error" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="stu-chip stu-chip--good" role="status">
              {done}
            </p>
          )}
          <button className="stu-button" type="submit" disabled={busy || !file}>
            {busy ? 'Sending…' : `Send to the ${event?.name ?? 'event'} coordinator`}
          </button>
        </>
      )}
      {sent.length > 0 && (
        <ul className="stu-proofs" aria-label="Your event fee screenshots">
          {sent.map((item) => (
            <li key={item.eventId}>
              {item.name}: {item.feePaid ? `${fee} paid` : 'screenshot sent, the coordinator approves it at the venue'}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** While waiting for the desk to approve: how often the page checks, and for how long by itself. */
const WAIT_POLL_MS = 30_000;
const WAIT_FOR_MS = 10 * 60_000;

/** Each step starts at its top: the button that led to it was at the bottom of the last one. */
function useScrollIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);
  return ref;
}

/** A UPI payment link for a UPI app on this phone (GPay, PhonePe, Paytm…), with the amount and note filled in. */
export function upiLink(amount: number, note: string): string | null {
  const { upiId, payee } = site.registration.payment;
  if (!upiId) return null;
  const parts = [`pa=${upiId}`, payee && `pn=${encodeURIComponent(payee)}`, `am=${amount}`, 'cu=INR', `tn=${encodeURIComponent(note)}`];
  return `upi://pay?${parts.filter(Boolean).join('&')}`;
}

/** Where to pay: the organisers' UPI ID, the QR, and a button for a UPI app on this phone. */
function PayBox({ amount, note }: { amount: number; note: string }) {
  const { payment } = site.registration;
  const link = upiLink(amount, note);
  return (
    <>
      {payment.upiId && (
        <p>
          Pay <strong>{rupees(amount)}</strong> to <strong className="stu-mono">{payment.upiId}</strong>
          {payment.payee && <> ({payment.payee})</>}.
        </p>
      )}
      {payment.qrImage && <img className="stu-qr" src={payment.qrImage} alt={`UPI QR code to pay ${payment.payee ?? payment.upiId ?? 'the organisers'}`} />}
      {link && (
        <a className="stu-button stu-button--ghost" href={link}>
          Open GPay or another UPI app to pay {rupees(amount)}
        </a>
      )}
      <p className="stu-muted stu-small">Scan the QR with GPay, or press the button on this phone. If asked for a note, write {note}.</p>
    </>
  );
}

interface DeskPaymentProps {
  view: StudentView;
  credentials: StudentCredentials;
  onUpdate: (view: StudentView) => void;
  onPaused: (message: string) => void;
}

/**
 * Registered at the desk, paying the ₹100 gate pass by GPay from this page: 1. check the
 * details the desk typed, 2. pay (QR, or a UPI app on this phone) and 3. upload the screenshot
 * for approval; then wait here while the desk checks it. Once approved the page moves on by
 * itself to the pass, the events and the timing alerts.
 */
function DeskPayment({ view, credentials, onUpdate, onPaused }: DeskPaymentProps) {
  const sent = view.payAtLogin?.screenshotSent ?? false;
  const [step, setStep] = useState<'details' | 'pay'>('details');
  const [again, setAgain] = useState(false);
  if (sent && !again) return <WaitingForApproval credentials={credentials} onUpdate={onUpdate} onPaused={onPaused} onUploadAgain={() => setAgain(true)} />;
  if (!sent && step === 'details') return <CheckDetails view={view} onContinue={() => setStep('pay')} />;
  return (
    <PayAndUpload
      view={view}
      credentials={credentials}
      onUpdate={(next) => {
        setAgain(false);
        onUpdate(next);
      }}
      onBack={() => (sent ? setAgain(false) : setStep('details'))}
      onPaused={onPaused}
    />
  );
}

/** The student's details as registered (the pass shows them), with their events. */
function DetailsList({ view }: { view: StudentView }) {
  const events = timedEvents(view, dayOf(useSchedule().onsiteOpensAt));
  return (
      <dl className="stu-details">
        <dt>Name</dt>
        <dd>{view.name}</dd>
        <dt>College</dt>
        <dd>{view.college}</dd>
        <dt>Department</dt>
        <dd>{view.details.department}</dd>
        <dt>Year</dt>
        <dd>{view.details.year}</dd>
        <dt>Phone</dt>
        <dd>{view.details.phone}</dd>
        <dt>Email</dt>
        <dd>{view.details.email}</dd>
        {view.teamName && (
          <>
            <dt>Team</dt>
            <dd>{view.teamName}</dd>
          </>
        )}
        <dt>Events</dt>
        <dd>
          {events.length === 0 ? (
            'None yet: join an event at its venue.'
          ) : (
            <ul className="stu-details__events">
              {events.map((event) => (
                <li key={event.id}>
                  <strong>{event.name}</strong>
                  {event.schedule && <span className="stu-muted"> · {event.schedule}</span>}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
  );
}

function CheckDetails({ view, onContinue }: { view: StudentView; onContinue: () => void }) {
  return (
    <section className="stu-card" aria-labelledby="stu-check">
      <p className="stu-step">Step 1 of 3</p>
      <h1 id="stu-check" className="stu-title">
        Check your details
      </h1>
      <p className="stu-muted">The registration desk typed these for you.</p>
      <DetailsList view={view} />
      <button className="stu-button" type="button" onClick={onContinue}>
        My details are correct: continue to payment
      </button>
      <p className="stu-muted stu-small">Something wrong? Tell the registration desk now. They correct it; then press Refresh below.</p>
    </section>
  );
}

interface PayAndUploadProps {
  view: StudentView;
  credentials: StudentCredentials;
  onUpdate: (view: StudentView) => void;
  onBack: () => void;
  onPaused: (message: string) => void;
}

function PayAndUpload({ view, credentials, onUpdate, onBack, onPaused }: PayAndUploadProps) {
  const amount = view.payAtLogin?.amount ?? 0;
  const [file, setFile] = useState<File | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const top = useScrollIntoView<HTMLFormElement>();
  const preview = useMemo(() => (file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return setError('Choose the screenshot first.');
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('The screenshot must be a PNG or JPG image.');
    if (file.size > 5 * 1024 * 1024) return setError('The image must be 5 MB or smaller.');
    setBusy(true);
    setError('');
    try {
      onUpdate(await uploadProof(credentials, file, 'GATE_PASS', transactionId.replace(/\s+/g, '')));
    } catch (failure) {
      if (isPaused(failure)) onPaused(messageOf(failure));
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={top} className="stu-card" onSubmit={submit} aria-labelledby="stu-pay" noValidate>
      <p className="stu-step">Step 2 of 3</p>
      <h1 id="stu-pay" className="stu-title">
        Pay {rupees(amount)} by GPay
      </h1>
      <PayBox amount={amount} note={`PRAGYA ${view.registrationId}`} />

      <p className="stu-step">Step 3 of 3</p>
      <h2 className="stu-subtitle">Upload the payment screenshot</h2>
      <p className="stu-muted">After paying, take a screenshot of the GPay “paid” screen: it must show the amount, the time and the transaction ID.</p>
      <label className="stu-field">
        <span>Screenshot (PNG or JPG)</span>
        <input type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      {preview && <img className="stu-preview" src={preview} alt="Your payment screenshot" />}
      <label className="stu-field">
        <span>Transaction ID / UTR (optional, from the screenshot)</span>
        <input value={transactionId} onChange={(event) => setTransactionId(event.target.value)} autoComplete="off" spellCheck={false} maxLength={40} />
      </label>
      {error && (
        <p className="stu-error" role="alert">
          {error}
        </p>
      )}
      <button className="stu-button" type="submit" disabled={busy || !file}>
        {busy ? 'Submitting…' : 'Submit for approval'}
      </button>
      <button className="stu-button stu-button--ghost" type="button" disabled={busy} onClick={onBack}>
        Back
      </button>
    </form>
  );
}

interface WaitingProps {
  credentials: StudentCredentials;
  onUpdate: (view: StudentView) => void;
  onPaused: (message: string) => void;
  onUploadAgain: () => void;
}

/** Screenshot in: the desk checks it. Checks every 30 s for 10 minutes, then on request. */
function WaitingForApproval({ credentials, onUpdate, onPaused, onUploadAgain }: WaitingProps) {
  const top = useScrollIntoView<HTMLElement>();
  const [deadline, setDeadline] = useState(() => Date.now() + WAIT_FOR_MS);
  const [stopped, setStopped] = useState(false);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (stopped) return;
    const timer = window.setInterval(() => {
      if (Date.now() > deadline) {
        setStopped(true);
        return;
      }
      signIn(credentials).then(
        (latest) => {
          setCheckedAt(Date.now());
          onUpdate(latest);
        },
        (failure: unknown) => {
          if (isPaused(failure)) onPaused(messageOf(failure));
        },
      );
    }, WAIT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [stopped, deadline, credentials, onUpdate, onPaused]);

  const checkNow = async () => {
    setBusy(true);
    setError('');
    try {
      const latest = await signIn(credentials);
      setCheckedAt(Date.now());
      setDeadline(Date.now() + WAIT_FOR_MS);
      setStopped(false);
      onUpdate(latest);
    } catch (failure) {
      if (isPaused(failure)) onPaused(messageOf(failure));
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const time = new Date(checkedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
  return (
    <section ref={top} className="stu-card" aria-labelledby="stu-wait">
      <p className="stu-chip stu-chip--good">Screenshot submitted</p>
      <h1 id="stu-wait" className="stu-title">
        Waiting for approval
      </h1>
      <p>The registration desk is checking your payment. Keep this page open: once it is approved, your pass appears here by itself.</p>
      <p className="stu-muted stu-small" aria-live="polite">
        {stopped ? 'Stopped checking by itself. Press Check now.' : `Last checked ${time}.`}
      </p>
      {error && (
        <p className="stu-error" role="alert">
          {error}
        </p>
      )}
      <button className="stu-button" type="button" disabled={busy} onClick={() => void checkNow()}>
        {busy ? 'Checking…' : 'Check now'}
      </button>
      <button className="stu-button stu-button--ghost" type="button" onClick={onUploadAgain}>
        Uploaded the wrong screenshot? Upload again
      </button>
    </section>
  );
}
