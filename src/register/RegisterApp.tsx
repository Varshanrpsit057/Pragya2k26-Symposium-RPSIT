/**
 * The students' page (pragya2k26.online/register/), on their own phones and mobile data:
 * register for the fest (details, the ₹100 entry fee by UPI and its transaction ID), then see
 * their ID and whether a desk has verified the payment. The ID stays on the phone.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { COLLEGES, OTHER_COLLEGE } from '../content/colleges';
import { DEFAULT_UPI, deptShort, participantProblems, readParticipant, showId, TXN, YEARS, type StudentView } from '../lib/fest';
import { NO_CONNECTION, StudentApiError, fetchInfo, fetchMe, registerSelf, sendMyPayment, type PublicEvent, type PublicInfo, type StudentPass } from './registerApi';

const SAVED = 'techfest-student';
const DRAFT = 'techfest-draft';
const STAFF = '/landing/admin/';

/** The ID, the mobile number and (on the phone that registered) the page's private key. */
type Saved = StudentPass;

interface Draft {
  submissionId: string;
  name: string;
  phone: string;
  email: string;
  college: string;
  branch: string;
  year: string;
  team: string;
  txn: string;
}

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: works for this visit only.
  }
};
/** A random submission id (122 bits or more): it is also the private key of the student's page. */
const newId = () => {
  const random: Crypto = globalThis.crypto;
  if (typeof random.randomUUID === 'function') return random.randomUUID();
  const bytes = random.getRandomValues(new Uint8Array(16));
  return `s-${Array.from(bytes, (byte: number) => byte.toString(16).padStart(2, '0')).join('')}`;
};
const emptyDraft = (): Draft => ({ submissionId: newId(), name: '', phone: '', email: '', college: '', branch: '', year: '', team: '', txn: '' });
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
const upiLink = (info: PublicInfo) =>
  `upi://pay?pa=${encodeURIComponent(info.upiId)}&pn=${encodeURIComponent(info.upiPayee)}&am=${info.entryFee}&cu=INR&tn=${encodeURIComponent("INFINITE TECHFEST'26 entry")}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : NO_CONNECTION);

export function RegisterApp() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [saved, setSaved] = useState<Saved | null>(() => read<Saved>(SAVED));
  // "My registration ID" on the home page comes here as /register/?my: straight to the registration
  // (this phone's own if it registered here, otherwise the ID and mobile number).
  const [signingIn, setSigningIn] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('my'));
  // The department chosen in the home page's pop-up (/register/?dept=CSE), or here first.
  const [dept, setDept] = useState(() => (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('dept') ?? '').toUpperCase() : ''));
  const chooseDept = (code: string) => {
    setDept(code);
    try {
      window.history.replaceState(null, '', code ? `?dept=${code}` : window.location.pathname);
    } catch {
      // Only the address bar: nothing else depends on it.
    }
  };

  const loadInfo = useCallback(
    () =>
      fetchInfo()
        .then((next) => {
          setInfo(next);
          setInfoError('');
        })
        .catch((error) => setInfoError(messageOf(error))),
    [],
  );
  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const remember = (next: Saved | null) => {
    write(SAVED, next);
    setSaved(next);
  };

  return (
    <div className="reg">
      <header className="reg-top">
        <a className="reg-brand" href="/">
          <strong>INFINITE TECHFEST’26</strong>
          <span>PRAGYA 2K26 · R P Sarathy Institute of Technology</span>
        </a>
      </header>
      <main className="reg-main">
        {saved ? (
          <MyRegistration saved={saved} info={info} onForget={() => remember(null)} />
        ) : signingIn ? (
          <SignIn onDone={(found) => remember(found)} onBack={() => setSigningIn(false)} />
        ) : infoError ? (
          <Panel title="Could not load the form">
            <p className="reg-error">{infoError}</p>
            <button className="reg-button" type="button" onClick={() => void loadInfo()}>
              Try again
            </button>
          </Panel>
        ) : !info ? (
          <p className="reg-loading" role="status">
            Loading…
          </p>
        ) : !info.open ? (
          <Panel title="Registration is closed">
            <p>Registration for the fest is closed. For help, ask at a registration desk.</p>
            <button className="reg-link" type="button" onClick={() => setSigningIn(true)}>
              Already registered? See your registration
            </button>
          </Panel>
        ) : !info.departments.some((item) => item.code === dept) ? (
          <ChooseDepartment info={info} onChoose={chooseDept} onSignIn={() => setSigningIn(true)} />
        ) : (
          <RegisterForm
            info={info}
            dept={dept}
            onChangeDept={() => chooseDept('')}
            onRegistered={(view, phone, key) => remember({ id: view.id, phone, key })}
            onSignIn={() => setSigningIn(true)}
          />
        )}
      </main>
      <footer className="reg-foot">
        <a href="/">Home</a>
        <a href={STAFF}>Staff sign in</a>
      </footer>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="reg-panel">
      <h1 className="reg-h1">{title}</h1>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------------------------------ the form

/** First, the department: the student registers for one, and its desks and event coordinators see them. */
function ChooseDepartment({ info, onChoose, onSignIn }: { info: PublicInfo; onChoose: (code: string) => void; onSignIn: () => void }) {
  return (
    <section className="reg-panel">
      <h1 className="reg-h1">Choose your department</h1>
      <p className="reg-lead">You register for one department and take part in its events. Its registration desk checks your payment.</p>
      <ul className="reg-depts">
        {info.departments.map((item) => (
          <li key={item.code}>
            <button type="button" onClick={() => onChoose(item.code)}>
              <strong>{deptShort(item.code)}</strong>
              <span>{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="reg-link" type="button" onClick={onSignIn}>
        Already registered? See your registration
      </button>
    </section>
  );
}

function RegisterForm({
  info,
  dept,
  onChangeDept,
  onRegistered,
  onSignIn,
}: {
  info: PublicInfo;
  dept: string;
  onChangeDept: () => void;
  onRegistered: (view: StudentView, phone: string, key: string) => void;
  onSignIn: () => void;
}) {
  const deptName = info.departments.find((item) => item.code === dept)?.name ?? '';
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft(), ...read<Draft>(DRAFT) }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const set = (change: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...change };
      write(DRAFT, next);
      return next;
    });
    setServerFields({});
  };

  const participant = readParticipant(draft);
  const problems: Record<string, string> = { ...participantProblems(participant) };
  if (draft.college === OTHER_COLLEGE) problems.college = 'Type the name of your college.';
  const txn = draft.txn.replace(/\s/g, '');
  if (!TXN.test(txn)) problems.txn = 'Type the transaction ID (UTR) from your UPI app: letters and digits, usually 12 digits.';
  const fieldError = (name: string) => (tried ? (serverFields[name] ?? problems[name]) : serverFields[name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError('');
    if (Object.keys(problems).length) {
      setError('Check the fields marked in red.');
      return;
    }
    setBusy(true);
    try {
      const view = await registerSelf({ submissionId: draft.submissionId, dept, participant, events: [], txn });
      write(DRAFT, null);
      onRegistered(view, participant.phone, draft.submissionId);
    } catch (failure) {
      setError(messageOf(failure));
      if (failure instanceof StudentApiError) setServerFields(failure.fields);
      setBusy(false);
    }
  };

  return (
    <form className="reg-panel" noValidate onSubmit={(event) => void submit(event)}>
      <h1 className="reg-h1">Register for the fest</h1>
      <p className="reg-chosen">
        <span>
          Department <strong>{deptShort(dept)}</strong> · {deptName}
        </span>
        <button className="reg-link" type="button" onClick={onChangeDept}>
          Change
        </button>
      </p>
      <p className="reg-lead">
        Fill in your details, pay the {rupees(info.entryFee)} entry fee by UPI, and type its transaction ID. You get your registration ID at once.
      </p>
      <button className="reg-link" type="button" onClick={onSignIn}>
        Already registered? See your registration
      </button>

      <fieldset className="reg-group">
        <legend>Your details</legend>
        <Field label="Name with initial" error={fieldError('name')}>
          <input value={draft.name} autoComplete="name" autoCapitalize="words" onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label="Mobile number" error={fieldError('phone')} hint="10 digits. You need it to see your registration later.">
          <input value={draft.phone} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} onChange={(event) => set({ phone: event.target.value })} />
        </Field>
        <Field label="College" error={fieldError('college')}>
          <input value={draft.college} list="reg-colleges" autoComplete="organization" placeholder="Start typing to find it" onChange={(event) => set({ college: event.target.value })} />
          <datalist id="reg-colleges">
            {COLLEGES.filter((college) => college !== OTHER_COLLEGE).map((college) => (
              <option key={college} value={college} />
            ))}
          </datalist>
        </Field>
        <Field label="Department / course (optional)">
          <input value={draft.branch} placeholder="e.g. B.E. CSE" onChange={(event) => set({ branch: event.target.value })} />
        </Field>
        <Field label="Year (optional)">
          <select value={draft.year} onChange={(event) => set({ year: event.target.value })}>
            <option value="">Choose…</option>
            {YEARS.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </Field>
        <Field label="Email (optional)" error={fieldError('email')}>
          <input value={draft.email} type="email" inputMode="email" autoComplete="email" onChange={(event) => set({ email: event.target.value })} />
        </Field>
        <Field label="Team name (optional)" error={fieldError('team')}>
          <input value={draft.team} onChange={(event) => set({ team: event.target.value })} />
        </Field>
      </fieldset>

      <fieldset className="reg-group">
        <legend>Entry fee: {rupees(info.entryFee)}</legend>
        <ol className="reg-steps">
          <li>
            Pay {rupees(info.entryFee)} to <strong>{info.upiPayee}</strong>.
            <a className="reg-button reg-button--pay" href={upiLink(info)}>
              Pay {rupees(info.entryFee)} with a UPI app
            </a>
            <span className="reg-upi">
              UPI ID <strong>{info.upiId}</strong>
              <button
                className="reg-chip"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(info.upiId).then(() => setCopied(true));
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
            {info.upiId === DEFAULT_UPI.upiId && <img className="reg-qr" src="/images/upi-qr.jpg" alt={`UPI QR code for ${info.upiId}`} width="200" height="200" loading="lazy" />}
          </li>
          <li>
            Open the payment in your UPI app and copy its <strong>transaction ID (UTR)</strong>.
          </li>
        </ol>
        <Field label="UPI transaction ID (UTR)" error={fieldError('txn')} hint="A registration desk checks it against the money received.">
          <input value={draft.txn} inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(event) => set({ txn: event.target.value })} />
        </Field>
      </fieldset>

      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
      <button className="reg-button reg-button--big" type="submit" disabled={busy}>
        {busy ? 'Registering…' : 'Register'}
      </button>
    </form>
  );
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`reg-field${error ? ' has-error' : ''}`}>
      <span className="reg-field__label">{label}</span>
      {children}
      {error ? <span className="reg-field__error">{error}</span> : hint ? <span className="reg-field__hint">{hint}</span> : null}
    </label>
  );
}

const eventFacts = (event: PublicEvent) =>
  [event.venue, event.time, event.fee ? `${rupees(event.fee)} at the venue` : 'No fee', event.teamMax > 1 ? `teams up to ${event.teamMax}` : 'individual'].filter(Boolean).join(' · ');

// ------------------------------------------------------------------------------------------ signed in

function SignIn({ onDone, onBack }: { onDone: (saved: Saved) => void; onBack: () => void }) {
  const [id, setId] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const found = await fetchMe({ id: id.trim(), phone: phone.trim() });
      onDone({ id: found.id, phone: readParticipant({ phone }).phone });
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };
  return (
    <form className="reg-panel" onSubmit={(event) => void submit(event)}>
      <h1 className="reg-h1">Your registration</h1>
      <p className="reg-lead">Type your registration ID and the mobile number you registered with.</p>
      <Field label="Registration ID">
        <input value={id} autoCapitalize="characters" placeholder="e.g. CSE-2017" autoComplete="off" onChange={(event) => setId(event.target.value)} />
      </Field>
      <Field label="Mobile number">
        <input value={phone} type="tel" inputMode="numeric" autoComplete="tel-national" onChange={(event) => setPhone(event.target.value)} />
      </Field>
      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
      <button className="reg-button reg-button--big" type="submit" disabled={busy || !id.trim() || !phone.trim()}>
        {busy ? 'Looking…' : 'Show my registration'}
      </button>
      <p className="reg-muted">Forgot your ID? Ask at any registration desk with your mobile number.</p>
      <button className="reg-link" type="button" onClick={onBack}>
        Not registered yet? Register
      </button>
    </form>
  );
}

const STATUS: Record<StudentView['status'], { label: string; tone: string }> = {
  waiting: { label: 'Payment not verified yet', tone: 'warn' },
  verified: { label: 'Verified', tone: 'good' },
  rejected: { label: 'Payment not found', tone: 'bad' },
  due: { label: 'Entry fee to pay at a desk', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

function MyRegistration({ saved, info, onForget }: { saved: Saved; info: PublicInfo | null; onForget: () => void }) {
  const [view, setView] = useState<StudentView | null>(null);
  const [error, setError] = useState('');
  const [txn, setTxn] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetchMe(saved)
      .then((next) => {
        setView(next);
        setError('');
      })
      .catch((failure) => setError(messageOf(failure)));
  }, [saved]);
  useEffect(refresh, [refresh]);
  // While a desk has not checked the payment yet, look again every 45 seconds (only while the page is open on screen).
  useEffect(() => {
    if (view && view.status !== 'waiting') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [view, refresh]);

  const act = async (work: () => Promise<StudentView>) => {
    setBusy(true);
    setError('');
    try {
      setView(await work());
      setTxn('');
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  const eventName = (eventId: string) => info?.events.find((event) => event.id === eventId);
  const status = view ? STATUS[view.status] : null;

  return (
    <section className="reg-panel">
      <div className="reg-idcard" aria-live="polite">
        <span className="reg-idcard__label">Your registration ID</span>
        <strong className="reg-idcard__id">{showId(saved.id)}</strong>
        {view && <span className="reg-idcard__name">{view.name}</span>}
        {view && <span className="reg-idcard__college">{view.college}</span>}
        {view && <span className="reg-idcard__dept">{deptShort(view.dept)}</span>}
        {status && <span className={`reg-status reg-status--${status.tone}`}>{status.label}</span>}
      </div>

      {(!view || view.status === 'waiting') && (
        <p className="reg-next">
          <strong>Verify your payment at a payment verification desk</strong> (show this ID), and you can register for events at each event’s venue.
        </p>
      )}
      {view?.status === 'verified' && <p className="reg-next reg-next--good">You are verified. Go to any event and register at its venue with this ID.</p>}
      {view?.status === 'due' && <p className="reg-next">Pay the entry fee at a registration desk and show this ID.</p>}
      {view?.status === 'cancelled' && <p className="reg-next">This registration was cancelled. Please go to a registration desk.</p>}
      {view?.status === 'rejected' && (
        <div className="reg-next reg-next--bad">
          <p>
            The desk could not find your payment{view.reason ? `: ${view.reason}` : ''}. Check the transaction ID (UTR) in your UPI app and send it again, or go to a desk.
          </p>
          {view.canChange && (
            <Field label="Correct transaction ID (UTR)">
              <input value={txn} autoCapitalize="characters" spellCheck={false} onChange={(event) => setTxn(event.target.value)} />
            </Field>
          )}
          {view.canChange ? (
            <button className="reg-button" type="button" disabled={busy || !TXN.test(txn.replace(/\s/g, ''))} onClick={() => void act(() => sendMyPayment(saved, txn.replace(/\s/g, '')))}>
              Send the transaction ID
            </button>
          ) : (
            <p>Send it from the phone you registered with, or show your payment at a registration desk.</p>
          )}
        </div>
      )}

      {view?.txnEnd && view.status !== 'rejected' && (
        <p className="reg-muted">
          Entry fee {rupees(view.entryFee)} · transaction ID ending {view.txnEnd}
        </p>
      )}

      {view && view.events.length > 0 && (
        <div className="reg-group">
          <h2 className="reg-h2">Your events</h2>
          <ul className="reg-myevents">
            {view.events.map((item) => {
              const event = eventName(item.eventId);
              return (
                <li key={item.eventId}>
                  <strong>{event ? `${deptShort(event.dept)} · ${event.name}` : item.eventId}</strong>
                  {event && <span className="reg-muted">{eventFacts(event)}</span>}
                  {item.present && <span className="reg-status reg-status--good">Attended</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
      <div className="reg-row">
        <button className="reg-button reg-button--ghost" type="button" onClick={refresh}>
          Refresh
        </button>
        <button
          className="reg-link"
          type="button"
          onClick={() => {
            if (window.confirm('Remove this registration from this phone? You can see it again with your ID and mobile number.')) onForget();
          }}
        >
          Not you? Remove from this phone
        </button>
      </div>
      <p className="reg-muted">Take a screenshot of your ID. It also stays on this phone.</p>
    </section>
  );
}
