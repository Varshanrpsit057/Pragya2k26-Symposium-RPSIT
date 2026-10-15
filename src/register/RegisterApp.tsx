/**
 * The students' page (pragya2k26.online/register/), INFINITE TECHFEST'26 · On-site Registration
 * Portal, on their own phones and mobile data: choose the department, fill in the details and get
 * the registration ID at once. Then the ₹100 entry fee: by UPI here (the QR code, and the UTR sent
 * for the desk to match), or at the department's desk in cash. The ID stays on the phone, and
 * "My registration ID" finds it on another phone with the mobile number (or the admin is asked to help).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { COLLEGES, OTHER_COLLEGE } from '../content/colleges';
import { COURSE_DEPARTMENTS, OTHER, STREAMS, courseText } from '../content/courses';
import { SearchSelect } from '../components/ui/SearchSelect';
import { formatIst } from '../lib/countdown';
import { deptShort, readParticipant, selfRegistrationProblems, showId, YEARS, type FestMethod, type StudentView } from '../lib/fest';

/** How the entry fee was paid, as the student reads it. */
const PAID_BY: Record<FestMethod, string> = { CASH: 'in cash', UPI: 'by UPI', ONLINE: 'online' };
import { UTR, tidyUtr, upiLink } from '../lib/portal';
import { isLocalCopy } from '../lib/localCopy';
import {
  NO_CONNECTION,
  StudentApiError,
  fetchInfo,
  fetchMe,
  fetchPayment,
  askAdmin,
  findMine,
  registerSelf,
  sendMyPayment,
  type PaymentInfo,
  type PublicEvent,
  type PublicInfo,
  type StudentPass,
} from './registerApi';

const SAVED = 'techfest-student';
const DRAFT = 'techfest-draft';
/** How the student chose to pay (UPI here or at the desk), for the ID it was chosen for. */
const CHOICE = 'techfest-pay-choice';

/** The ID, the mobile number and (on the phone that registered) the page's private key. */
type Saved = StudentPass;
type PayChoice = 'upi' | 'desk';

interface Draft {
  submissionId: string;
  name: string;
  phone: string;
  email: string;
  /** One of COLLEGES, or Other (then `collegeOther`). */
  college: string;
  collegeOther: string;
  /** The college's code (e.g. its Anna University code). */
  collegeCode?: string;
  /** B.E., B.Sc… */
  stream: string;
  /** One of COURSE_DEPARTMENTS, or Other (then `courseOther`). */
  course: string;
  courseOther: string;
  year: string;
  team: string;
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
const emptyDraft = (): Draft => ({ submissionId: newId(), name: '', phone: '', email: '', college: '', collegeOther: '', collegeCode: '', stream: '', course: '', courseOther: '', year: '', team: '' });
/** A draft kept from before the college list (a typed college not in the list becomes Other). */
const loadDraft = (): Draft => {
  const draft = { ...emptyDraft(), ...read<Draft>(DRAFT) };
  if (draft.college && !COLLEGES.includes(draft.college)) return { ...draft, college: OTHER_COLLEGE, collegeOther: draft.collegeOther || draft.college };
  return draft;
};
/** The college as stored: the one chosen, or the one typed after Other. */
const collegeOf = (draft: Pick<Draft, 'college' | 'collegeOther'>) => (draft.college === OTHER_COLLEGE ? draft.collegeOther.replace(/\s+/g, ' ').trim() : draft.college);
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : NO_CONNECTION);

export function RegisterApp() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [saved, setSaved] = useState<Saved | null>(() => read<Saved>(SAVED));
  // "My registration ID" on the home page comes here as /register/?my: straight to the registration
  // (this phone's own if it registered here, otherwise found by mobile number).
  const [finding, setFinding] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('my'));
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
  const find = () => setFinding(true);

  return (
    <div className="reg">
      {isLocalCopy() && (
        <p role="note" style={{ margin: 0, padding: '0.55rem 1rem', background: '#b91c1c', color: '#fff', fontWeight: 700, textAlign: 'center' }}>
          LOCAL TEST COPY on this computer: not the live site.
        </p>
      )}
      <header className="reg-top">
        <a className="reg-brand" href="/">
          <strong>INFINITE TECHFEST’26</strong>
          <span>On-site Registration Portal · R P Sarathy Institute of Technology</span>
        </a>
      </header>
      <main className="reg-main">
        {saved ? (
          <MyRegistration saved={saved} info={info} onForget={() => remember(null)} />
        ) : finding ? (
          <FindMine info={info} onDone={(found) => remember(found)} onBack={() => setFinding(false)} />
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
            <FindLink onClick={find} />
          </Panel>
        ) : !info.selfRegistration ? (
          <Panel title="Registration on phones is paused">
            <p className="reg-lead">Please register at your department’s registration desk. You get your registration ID there.</p>
            <FindLink onClick={find} />
          </Panel>
        ) : !info.departments.some((item) => item.code === dept) ? (
          <ChooseDepartment info={info} onChoose={chooseDept} onFind={find} />
        ) : (
          <RegisterForm info={info} dept={dept} onChangeDept={() => chooseDept('')} onRegistered={(view, phone, key) => remember({ id: view.id, phone, key })} onFind={find} />
        )}
      </main>
      <footer className="reg-foot">
        <a href="/">Home</a>
        <span>INFINITE TECHFEST’26 · On-site Registration Portal</span>
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

function FindLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="reg-link" type="button" onClick={onClick}>
      Already registered? Find your registration ID
    </button>
  );
}

// ------------------------------------------------------------------------------------------ the form

/** First, the department: the student registers for one, and its desks and event coordinators see them. */
function ChooseDepartment({ info, onChoose, onFind }: { info: PublicInfo; onChoose: (code: string) => void; onFind: () => void }) {
  return (
    <section className="reg-panel">
      <h1 className="reg-h1">Choose your department</h1>
      <p className="reg-lead">You register under one department only, and take part in its events. Its registration desk checks your payment.</p>
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
      <FindLink onClick={onFind} />
    </section>
  );
}

function RegisterForm({
  info,
  dept,
  onChangeDept,
  onRegistered,
  onFind,
}: {
  info: PublicInfo;
  dept: string;
  onChangeDept: () => void;
  onRegistered: (view: StudentView, phone: string, key: string) => void;
  onFind: () => void;
}) {
  const deptName = info.departments.find((item) => item.code === dept)?.name ?? '';
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const set = (change: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...change };
      write(DRAFT, next);
      return next;
    });
    setServerFields({});
  };

  const participant = readParticipant({ ...draft, college: collegeOf(draft), branch: courseText(draft.stream, draft.course, draft.courseOther) });
  const problems: Record<string, string> = { ...selfRegistrationProblems(participant) };
  if (!participant.collegeCode) problems.collegeCode = 'Enter your college code.';
  if (!draft.college) problems.college = 'Choose your college.';
  else if (draft.college === OTHER_COLLEGE && draft.collegeOther.trim().length < 3) problems.college = 'Type the name of your college.';
  // The stream and department make up the "department / course" the desks see (B.E. CSE).
  delete problems.branch;
  if (!draft.stream) problems.stream = 'Choose your stream.';
  if (!draft.course) problems.course = 'Choose your department.';
  else if (draft.course === OTHER && draft.courseOther.trim().length < 2) problems.course = 'Type the name of your department.';
  const fieldError = (name: string) => {
    const server = serverFields[name] ?? (name === 'course' ? serverFields.branch : undefined);
    return tried ? (server ?? problems[name]) : server;
  };

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
      const view = await registerSelf({ submissionId: draft.submissionId, dept, participant, events: [] });
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
      <p className="reg-lead">Fill in your details and you get your registration ID at once.</p>
      <FindLink onClick={onFind} />

      <fieldset className="reg-group">
        <legend>Your details</legend>
        <Field label="Name with initial" error={fieldError('name')}>
          <input value={draft.name} autoComplete="name" autoCapitalize="words" onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label="Mobile number" error={fieldError('phone')} hint="10 digits. It finds your registration later, on any phone.">
          <input value={draft.phone} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} onChange={(event) => set({ phone: event.target.value })} />
        </Field>
        <Field label="Email" error={fieldError('email')}>
          <input value={draft.email} type="email" inputMode="email" autoComplete="email" onChange={(event) => set({ email: event.target.value })} />
        </Field>
        <PickField id="reg-college" label="College" error={draft.college === OTHER_COLLEGE ? undefined : fieldError('college')}>
          {(labelId, invalid) => (
            <SearchSelect
              id="reg-college"
              labelId={labelId}
              options={COLLEGES}
              value={draft.college}
              onChange={(college) => set({ college })}
              placeholder="Choose… (type to find it)"
              searchPlaceholder="Type your college’s name or initials"
              searchLabel="Search colleges"
              emptyText={(query) => `No college matches “${query}”. Choose ${OTHER_COLLEGE} and type it.`}
              invalid={invalid}
              bestFirst
              searchFirst
            />
          )}
        </PickField>
        {draft.college === OTHER_COLLEGE && (
          <Field label="Your college" error={fieldError('college')} hint="Its full name and town.">
            <input value={draft.collegeOther} maxLength={120} autoComplete="organization" onChange={(event) => set({ collegeOther: event.target.value })} />
          </Field>
        )}
        <Field label="College code" error={fieldError('collegeCode')} hint="Your college’s code (for example 2639). Ask your faculty if you do not know it.">
          <input
            value={draft.collegeCode ?? ''}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => set({ collegeCode: event.target.value })}
          />
        </Field>
        <PickField id="reg-stream" label="Stream" error={fieldError('stream')}>
          {(labelId, invalid) => (
            <SearchSelect
              id="reg-stream"
              labelId={labelId}
              options={STREAMS}
              value={draft.stream}
              onChange={(stream) => set({ stream })}
              placeholder="Choose… (B.E., B.Tech., B.Sc.…)"
              searchPlaceholder="Search streams"
              searchLabel="Search streams"
              invalid={invalid}
            />
          )}
        </PickField>
        <PickField id="reg-course" label="Department" error={fieldError('course')}>
          {(labelId, invalid) => (
            <SearchSelect
              id="reg-course"
              labelId={labelId}
              options={COURSE_DEPARTMENTS}
              value={draft.course}
              onChange={(course) => set({ course })}
              placeholder="Choose… (CSE, ECE, Mechanical…)"
              searchPlaceholder="Search departments"
              searchLabel="Search departments"
              emptyText={(query) => `Nothing matches “${query}”. Choose Other and type it.`}
              invalid={invalid}
              bestFirst
            />
          )}
        </PickField>
        {draft.course === OTHER && (
          <Field label="Your department" error={tried ? problems.course : undefined}>
            <input value={draft.courseOther} maxLength={60} onChange={(event) => set({ courseOther: event.target.value })} />
          </Field>
        )}
        <Field label="Year" error={fieldError('year')}>
          <select value={draft.year} onChange={(event) => set({ year: event.target.value })}>
            <option value="">Choose…</option>
            {YEARS.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </Field>
        <Field label="Team name (optional)" error={fieldError('team')}>
          <input value={draft.team} onChange={(event) => set({ team: event.target.value })} />
        </Field>
      </fieldset>

      <p className="reg-note">
        <strong>Entry fee {rupees(info.entryFee)}</strong>
        {info.onlinePayment
          ? ` After you register, pay it here by UPI (GPay, PhonePe, Paytm…) or in cash at the ${deptShort(dept)} registration desk.`
          : ` Pay it at the ${deptShort(dept)} registration desk (cash or UPI).`}
      </p>

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

/** A field whose control is a searchable list (not inside a <label>: its search box would press the button). */
function PickField({ id, label, error, children }: { id: string; label: string; error?: string; children: (labelId: string, invalid: boolean) => ReactNode }) {
  const labelId = `${id}-label`;
  return (
    <div className={`reg-field${error ? ' has-error' : ''}`}>
      <span className="reg-field__label" id={labelId}>
        {label}
      </span>
      {children(labelId, Boolean(error))}
      {error && <span className="reg-field__error">{error}</span>}
    </div>
  );
}

const eventFacts = (event: PublicEvent) =>
  [event.venue, event.time, event.fee ? `${rupees(event.fee)} at the venue` : 'No fee', event.teamMax > 1 ? `teams up to ${event.teamMax}` : 'individual'].filter(Boolean).join(' · ');

// ------------------------------------------------------------------------------------------ finding it again

/** "My registration ID" on a phone that did not register: the mobile number finds it (or the admin is asked to help). */
function FindMine({ info, onDone, onBack }: { info: PublicInfo | null; onDone: (saved: Saved) => void; onBack: () => void }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [several, setSeveral] = useState<StudentView[]>([]);
  const tidyPhone = readParticipant({ phone }).phone;

  if (info && !info.lookup) {
    return (
      <Panel title="Find your registration ID">
        <p className="reg-lead">On the phone you registered with, this page shows your ID by itself. Otherwise ask at any registration desk with your mobile number.</p>
        <button className="reg-link" type="button" onClick={onBack}>
          Not registered yet? Register
        </button>
      </Panel>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMissing(false);
    try {
      const found = await findMine(tidyPhone);
      if (found.length === 1) onDone({ id: found[0]!.id, phone: tidyPhone });
      else {
        setSeveral(found);
        setBusy(false);
      }
    } catch (failure) {
      setError(messageOf(failure));
      // Not found: the number may be mistyped here, or was typed wrong when registering.
      setMissing(failure instanceof StudentApiError && failure.code === 'NOT_FOUND');
      setBusy(false);
    }
  };

  if (several.length) {
    return (
      <Panel title="Your registrations">
        <p className="reg-lead">This mobile number is registered in {several.length} departments. Which one?</p>
        <ul className="reg-depts">
          {several.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onDone({ id: item.id, phone: tidyPhone })}>
                <strong>{showId(item.id)}</strong>
                <span>
                  {item.name} · {deptShort(item.dept)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  return (
    <>
      <form className="reg-panel" onSubmit={(event) => void submit(event)}>
        <h1 className="reg-h1">Find your registration ID</h1>
        <p className="reg-lead">On the phone you registered with, this page shows your ID by itself. On another phone, type the mobile number you registered with.</p>
        <Field label="Mobile number">
          <input value={phone} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        {error && (
          <p className="reg-error" role="alert">
            {error}
          </p>
        )}
        <button className="reg-button reg-button--big" type="submit" disabled={busy || tidyPhone.length !== 10}>
          {busy ? 'Looking…' : 'Find my registration'}
        </button>
        {!missing && <p className="reg-muted">Still can’t find it? Any registration desk finds you by your mobile number.</p>}
        <button className="reg-link" type="button" onClick={onBack}>
          Not registered yet? Register
        </button>
      </form>
      {missing && <AskAdmin info={info} triedPhone={tidyPhone} />}
    </>
  );
}

/**
 * When the mobile number finds nothing: the student tells the web assist team who they are and
 * how to reach them (it arrives in the dashboard's Help requests); they are called back.
 */
function AskAdmin({ info, triedPhone }: { info: PublicInfo | null; triedPhone: string }) {
  const [name, setName] = useState('');
  const [dept, setDept] = useState('');
  const [contact, setContact] = useState(triedPhone);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const reach = readParticipant({ phone: contact }).phone;
  const ready = name.trim().length >= 2 && reach.length === 10;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const department = info?.departments.find((item) => item.code === dept);
      await askAdmin({
        category: 'FIND_ID',
        name: name.trim(),
        contact: reach,
        page: 'Student page: find my registration ID',
        message: [
          `Cannot find their registration ID with the mobile number ${triedPhone}.`,
          department ? `Registered under ${deptShort(department.code)} (${department.name}).` : 'Department not given.',
          `Call or WhatsApp them on ${reach}.`,
          note.trim() && `Note: ${note.trim()}`,
        ]
          .filter(Boolean)
          .join(' '),
      });
      setSent(reach);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="reg-panel reg-ask" role="status">
        <h2 className="reg-h2">Message sent to the admin</h2>
        <p className="reg-lead">The web assist team will call or WhatsApp you on {sent} to find your registration. You can also show this page at any registration desk.</p>
      </section>
    );
  }

  return (
    <form className="reg-panel reg-ask" aria-label="Contact the admin" onSubmit={(event) => void send(event)}>
      <h2 className="reg-h2">Contact the admin</h2>
      <p className="reg-lead">
        No registration has the number {triedPhone}. Check it and try again. If you are sure you registered (the number may have been typed wrong then), send these details: the web
        assist team will contact you.
      </p>
      <Field label="Your name">
        <input value={name} maxLength={60} autoComplete="name" onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Department you registered under">
        <select value={dept} onChange={(event) => setDept(event.target.value)}>
          <option value="">Choose (if you know it)</option>
          {info?.departments.map((item) => (
            <option key={item.code} value={item.code}>
              {deptShort(item.code)} · {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Mobile number to contact you" hint="We call or WhatsApp you on this number.">
        <input value={contact} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} onChange={(event) => setContact(event.target.value)} />
      </Field>
      <Field label="Anything else (optional)" hint="For example your email, or when and how you registered.">
        <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
      <button className="reg-button reg-button--big" type="submit" disabled={busy || !ready}>
        {busy ? 'Sending…' : 'Send to the admin'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------------------------------ the registration

const STATUS: Record<StudentView['status'], { label: string; tone: string }> = {
  waiting: { label: 'Payment sent · desk to check', tone: 'warn' },
  verified: { label: 'Verified', tone: 'good' },
  rejected: { label: 'Payment not found', tone: 'bad' },
  due: { label: 'Entry fee not paid yet', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

function MyRegistration({ saved, info, onForget }: { saved: Saved; info: PublicInfo | null; onForget: () => void }) {
  const [view, setView] = useState<StudentView | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    fetchMe(saved)
      .then((next) => {
        setView(next);
        setError('');
      })
      .catch((failure) => setError(messageOf(failure)));
  }, [saved]);
  useEffect(refresh, [refresh]);
  // While the desk has not taken the fee yet, look again now and then (only while the page is on
  // screen; less often without the key, as those lookups are limited for each ID).
  useEffect(() => {
    if (view && view.status !== 'waiting' && view.status !== 'due') return;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') refresh();
      },
      saved.key ? 45_000 : 120_000,
    );
    return () => window.clearInterval(timer);
  }, [view, refresh, saved.key]);

  const eventName = (eventId: string) => info?.events.find((event) => event.id === eventId);
  const status = view ? STATUS[view.status] : null;
  const fee = info?.entryFee ?? 100;

  return (
    <section className="reg-panel">
      <div className="reg-idcard" aria-live="polite">
        <span className="reg-idcard__label">Your registration ID</span>
        <strong className="reg-idcard__id">{showId(saved.id)}</strong>
        {view && <span className="reg-idcard__name">{view.name}</span>}
        {view && (
          <span className="reg-idcard__college">
            {view.college}
            {view.collegeCode ? ` · code ${view.collegeCode}` : ''}
          </span>
        )}
        {view && <span className="reg-idcard__dept">{deptShort(view.dept)}</span>}
        {status && <span className={`reg-status reg-status--${status.tone}`}>{status.label}</span>}
      </div>
      <p className="reg-muted reg-center">Take a screenshot of your ID. It also stays on this phone.</p>

      {view?.status === 'due' && <PaymentStep saved={saved} view={view} info={info} fee={fee} onSent={setView} />}
      {view?.status === 'rejected' && (
        <div className="reg-next reg-next--bad">
          <p>
            <strong>The desk could not find your payment</strong>
            {view.reason ? `: ${view.reason}` : ''}. Check the UTR in your UPI app and send it again, or pay at the {deptShort(view.dept)} registration desk.
          </p>
        </div>
      )}
      {view?.status === 'rejected' && <PaymentStep saved={saved} view={view} info={info} fee={fee} onSent={setView} resend />}
      {view?.status === 'waiting' && (
        <div className="reg-next">
          <p>
            <strong>Payment sent{view.txnEnd ? ` · UTR ending ${view.txnEnd}` : ''}.</strong> The {deptShort(view.dept)} registration desk matches it with the payment received. Show this
            ID at the desk to verify it, then register for events at each event’s venue.
          </p>
        </div>
      )}
      {view?.status === 'verified' && (
        <div className="reg-next reg-next--good">
          <p>
            <strong>Payment collected and verified.</strong>
            {view.paid && (
              <>
                {' '}
                {rupees(view.paid.amount)} {PAID_BY[view.paid.method]} · {formatIst(Date.parse(view.paid.at))}
                {view.paid.desk ? ` · ${deptShort(view.dept)} desk ${view.paid.desk}` : ''}.
              </>
            )}
          </p>
          <p>Go to your {deptShort(view.dept)} events: register at each event’s venue with this ID (its fee is paid there).</p>
        </div>
      )}
      {view?.status === 'cancelled' && <p className="reg-next">This registration was cancelled. Please go to a registration desk.</p>}

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
                  {item.feePaid && <span className="reg-status reg-status--good">Fee paid · {rupees(item.feeAmount)}</span>}
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
            if (window.confirm('Remove this registration from this phone? You can find it again with your mobile number.')) onForget();
          }}
        >
          Not you? Remove from this phone
        </button>
      </div>
    </section>
  );
}

const readChoice = (id: string): PayChoice | null => {
  const saved = read<{ id: string; choice: PayChoice }>(CHOICE);
  return saved?.id === id ? saved.choice : null;
};

/**
 * The entry fee, right after registering: by UPI here (the QR code, then the UTR for the desk to
 * match), or at the department's desk in cash. Either way the desk completes it.
 */
function PaymentStep({ saved, view, info, fee, onSent, resend = false }: { saved: Saved; view: StudentView; info: PublicInfo | null; fee: number; onSent: (view: StudentView) => void; resend?: boolean }) {
  const [choice, setChoiceState] = useState<PayChoice | null>(() => (resend ? 'upi' : readChoice(view.id)));
  const setChoice = (next: PayChoice | null) => {
    write(CHOICE, next ? { id: view.id, choice: next } : null);
    setChoiceState(next);
  };
  const desk = deptShort(view.dept);
  const online = Boolean(info?.onlinePayment);

  const atDesk = (
    <div className="reg-next">
      <p>
        <strong>
          Pay the {rupees(fee)} entry fee at the {desk} registration desk
        </strong>{' '}
        in cash (or by UPI there). Show this ID: the desk takes the fee and verifies you. Then register for events at each event’s venue.
      </p>
    </div>
  );

  if (!online) return atDesk;
  if (!view.canChange) {
    return (
      <>
        {atDesk}
        <p className="reg-muted">To pay by UPI here, open this page on the phone you registered with.</p>
      </>
    );
  }
  if (!choice) {
    return (
      <section className="reg-pay" aria-labelledby="reg-pay-title">
        <h2 className="reg-h2" id="reg-pay-title">
          How will you pay the {rupees(fee)} entry fee?
        </h2>
        <div className="reg-pay__choices">
          <button className="reg-choice" type="button" onClick={() => setChoice('upi')}>
            <strong>Pay now by UPI</strong>
            <span>GPay, PhonePe, Paytm or any UPI app: pay here, then send the UTR.</span>
          </button>
          <button className="reg-choice" type="button" onClick={() => setChoice('desk')}>
            <strong>Pay at the desk</strong>
            <span>Cash (or UPI) at the {desk} registration desk.</span>
          </button>
        </div>
      </section>
    );
  }
  if (choice === 'desk') {
    return (
      <>
        {atDesk}
        <button className="reg-link" type="button" onClick={() => setChoice('upi')}>
          Pay by UPI now instead
        </button>
      </>
    );
  }
  return (
    <>
      <UpiPayment saved={saved} view={view} fee={fee} onSent={onSent} />
      {!resend && (
        <button className="reg-link" type="button" onClick={() => setChoice('desk')}>
          Pay at the desk instead
        </button>
      )}
    </>
  );
}

function UpiPayment({ saved, view, fee, onSent }: { saved: Saved; view: StudentView; fee: number; onSent: (view: StudentView) => void }) {
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () =>
      fetchPayment()
        .then((next) => {
          setPayment(next);
          setLoadError('');
        })
        .catch((failure) => setLoadError(messageOf(failure))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const typed = tidyUtr(utr);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSent(await sendMyPayment(saved, typed));
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payment?.upiId ?? '');
      setCopied(true);
    } catch {
      // No clipboard: the UPI ID is on screen to type.
    }
  };

  if (loadError) {
    return (
      <div className="reg-pay">
        <p className="reg-error">{loadError}</p>
        <button className="reg-button reg-button--ghost" type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!payment) {
    return (
      <p className="reg-loading" role="status">
        Loading the QR code…
      </p>
    );
  }
  if (!payment.online) return <p className="reg-next">Online payment is not available now. Pay at the {deptShort(view.dept)} registration desk.</p>;

  return (
    <form className="reg-pay" onSubmit={(event) => void send(event)}>
      <h2 className="reg-h2">Pay {rupees(fee)} by UPI</h2>
      <ol className="reg-steps">
        <li>
          <span>
            {payment.qr ? `Scan the QR code with GPay, PhonePe, Paytm or any UPI app and pay ${rupees(fee)}.` : `Pay ${rupees(fee)} to this UPI ID with GPay, PhonePe, Paytm or any UPI app.`}
          </span>
          {payment.qr && <img className="reg-qr" src={payment.qr} alt={`UPI QR code: pay ${rupees(fee)} to ${payment.upiPayee || payment.upiId}`} width={240} height={240} />}
          {payment.upiId && (
            <span className="reg-upi">
              <span>
                {payment.upiPayee && (
                  <>
                    <strong>{payment.upiPayee}</strong>
                    <br />
                  </>
                )}
                UPI ID <code>{payment.upiId}</code>
              </span>
              <button className="reg-button reg-button--ghost reg-button--small" type="button" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
          )}
          {payment.upiId && (
            <a className="reg-button reg-button--ghost" href={upiLink(payment.upiId, payment.upiPayee, fee, view.id)}>
              Open a UPI app on this phone
            </a>
          )}
        </li>
        <li>
          <span>Then type the UTR from the payment’s details and send it. The desk matches it with the payment received.</span>
          <Field label="UPI reference number (UTR)" hint="12 digits. GPay: “UPI transaction ID”; PhonePe: “UTR”; Paytm: “UPI Ref No”.">
            <input value={utr} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={16} placeholder="e.g. 412345678901" onChange={(event) => setUtr(event.target.value)} />
          </Field>
        </li>
      </ol>
      {error && (
        <p className="reg-error" role="alert">
          {error}
        </p>
      )}
      <button className="reg-button reg-button--big" type="submit" disabled={busy || !UTR.test(typed)}>
        {busy ? 'Sending…' : 'I have paid · send the UTR'}
      </button>
    </form>
  );
}
