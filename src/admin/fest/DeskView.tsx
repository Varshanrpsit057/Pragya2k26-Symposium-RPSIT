/**
 * A registration desk on a phone: verify the students who registered themselves (their UPI
 * transaction ID checked by hand), register walk-ins (works with no signal), find and check in
 * students who registered online, and the desk's own totals for handing over the money.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { NEARBY_COLLEGES, OTHER_COLLEGES } from '../../content/colleges';
import { awaitingCheck, deptShort, eventLabel, eventsOf, isActive, normaliseFestId, OPEN_DEPT, parseFestId, participantProblems, readParticipant, rupees, showId, sourceOfNumber, teamRule, tidyPhone, YEARS, type FestParticipant, type FestRegistration } from '../../lib/fest';
import { hasPermission } from '../../lib/staff';
import { Badge, when } from '../ui';
import { useFest } from './FestData';
import { NO_PAYMENT, PaymentChoice, RegistrationCard, ShortList, Stat, matches, paymentBody, paymentReady, stampNow, type PaymentDraft } from './festUi';

const EMPTY: FestParticipant = { name: '', phone: '', email: '', college: '', branch: '', year: '', team: '' };
const COLLEGES = [...NEARBY_COLLEGES, ...OTHER_COLLEGES];

/** The department this screen works on: the account's own, or (web assist) the one chosen. */
export function useWorkDept(): [string, (dept: string) => void, boolean] {
  const { session, filters, setFilters } = useFest();
  const fixed = session.department ?? '';
  return [fixed || filters.dept, (dept: string) => setFilters({ ...filters, dept }), !fixed];
}

export function DeptPicker({ value, onChange, label = 'Department' }: { value: string; onChange: (dept: string) => void; label?: string }) {
  const { catalog } = useFest();
  return (
    <label className="adm-field fest-dept-pick">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose…</option>
        {catalog?.departments.map((dept) => (
          <option key={dept.code} value={dept.code}>
            {deptShort(dept.code)} · {dept.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DeskView() {
  const { session } = useFest();
  const [dept, setDept, canPick] = useWorkDept();
  const { registrations } = useFest();
  const [tab, setTab] = useState<'verify' | 'register' | 'find' | 'totals'>('verify');
  const waiting = useMemo(() => [...registrations.values()].filter(awaitingCheck).length, [registrations]);
  return (
    <main className="adm-page fest-desk">
      {canPick && <DeptPicker value={dept} onChange={setDept} />}
      {!dept ? (
        <p className="adm-note">Choose the department to register for.</p>
      ) : (
        <>
          <nav className="fest-tabs" aria-label="Desk">
            {(
              [
                ['verify', waiting ? `Verify payments (${waiting})` : 'Verify payments'],
                ['register', 'Register'],
                ['find', 'Find & check in'],
                ['totals', session.deskNumber ? `Desk ${session.deskNumber} totals` : 'My totals'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className="fest-tabs__tab" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === 'verify' && <VerifyPayments />}
          {tab === 'register' && <RegisterForm dept={dept} />}
          {tab === 'find' && <FindAndCheckIn dept={dept} />}
          {tab === 'totals' && <DeskTotals dept={dept} />}
        </>
      )}
    </main>
  );
}

/** The desk's form; `paper`: typing in a paper slip (its ID typed from the slip). */
export function RegisterForm({ dept, paper = false }: { dept: string; paper?: boolean }) {
  const { catalog, registrations, register, idsLeft, online } = useFest();
  const [slipId, setSlipId] = useState('');
  const [form, setForm] = useState<FestParticipant>(EMPTY);
  const [events, setEvents] = useState<string[]>([]);
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<FestRegistration | null>(null);
  const deptEvents = catalog ? eventsOf(catalog, dept) : [];
  const participant = readParticipant(form);
  const problems = participantProblems(participant);
  const phone = tidyPhone(form.phone);
  const already = phone.length === 10 ? [...registrations.values()].find((item) => (item.dept === dept || item.dept === OPEN_DEPT) && item.phone === phone && !item.deleted) : undefined;
  const teamAllowed = events.some((id) => (deptEvents.find((event) => event.id === id)?.teamMax ?? 1) > 1);
  const left = paper ? 1 : idsLeft(dept);
  const slip = normaliseFestId(slipId);
  const slipNumber = parseFestId(slip);
  const slipProblem = !paper ? '' : !slipNumber || slipNumber.dept !== dept || sourceOfNumber(slipNumber.number) !== 'PAPER' ? `Type the slip’s number (${deptShort(dept)}-9001 to ${deptShort(dept)}-9999).` : registrations.has(slip) ? `${slip} is already typed in.` : '';

  if (!catalog) return <p className="adm-muted">Loading the events…</p>;
  if (done) {
    return (
      <section className="adm-card adm-pad fest-done" aria-live="polite">
        <p className="adm-muted">Tell the student their Registration ID:</p>
        <p className="fest-done__id">{showId(done.id)}</p>
        <p>
          <strong>{done.name}</strong> · {done.college}
        </p>
        <p className="adm-muted">
          Events: {done.events.length ? done.events.map((entry) => deptEvents.find((event) => event.id === entry.eventId)?.name ?? entry.eventId).join(', ') : 'none yet'}. Each event’s fee is paid at its venue.
        </p>
        {!online && <p className="adm-note">Saved on this phone: it is sent as soon as the signal is back. The ID is final.</p>}
        <button
          className="adm-button adm-button--primary adm-button--big"
          type="button"
          onClick={() => {
            setDone(null);
            setForm(EMPTY);
            setEvents([]);
            setPayment(NO_PAYMENT);
            setTried(false);
            setSlipId('');
          }}
        >
          {paper ? 'Type the next slip' : 'Register the next student'}
        </button>
      </section>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError('');
    if (Object.keys(problems).length || already || !paymentReady(payment) || slipProblem) return;
    try {
      setDone(register({ dept, participant: { ...participant }, events, payment: paymentBody(payment), ...(paper && { source: 'PAPER' as const, id: slip }) }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not register.');
    }
  };
  const field = (name: keyof FestParticipant) => (tried && problems[name] ? <span className="adm-field__error">{problems[name]}</span> : null);

  return (
    <form className="adm-card adm-pad fest-form" onSubmit={submit} noValidate>
      {paper ? (
        <label className="adm-field">
          <span>Slip number</span>
          <input value={slipId} autoComplete="off" placeholder={`${deptShort(dept)}-9001`} onChange={(event) => setSlipId(event.target.value)} />
          {tried && slipProblem && <span className="adm-field__error">{slipProblem}</span>}
        </label>
      ) : (
        <p className={`fest-ids${left < 10 ? ' is-low' : ''}`}>
          {left ? `${left} IDs on this phone` : 'No IDs on this phone yet: connect to the internet for a moment.'}
          {left > 0 && left < 10 && ' · getting more when there is signal'}
        </p>
      )}
      <label className="adm-field">
        <span>Name with initial</span>
        <input value={form.name} autoComplete="off" onChange={(event) => setForm({ ...form, name: event.target.value })} />
        {field('name')}
      </label>
      <label className="adm-field">
        <span>Mobile number</span>
        <input value={form.phone} inputMode="tel" autoComplete="off" onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        {field('phone')}
        {already && (
          <span className="adm-field__error">
            Already registered as <strong>{already.id}</strong> ({already.name}). Do not register again: tell them their ID.
          </span>
        )}
      </label>
      <label className="adm-field">
        <span>College</span>
        <input value={form.college} list="fest-colleges" autoComplete="off" onChange={(event) => setForm({ ...form, college: event.target.value })} placeholder="Type the first letters" />
        <datalist id="fest-colleges">
          {COLLEGES.map((college) => (
            <option key={college} value={college} />
          ))}
        </datalist>
        {field('college')}
      </label>
      <div className="fest-form__row">
        <label className="adm-field">
          <span>Branch (optional)</span>
          <input value={form.branch} autoComplete="off" onChange={(event) => setForm({ ...form, branch: event.target.value })} placeholder="e.g. B.E. CSE" />
        </label>
        <label className="adm-field">
          <span>Year</span>
          <select value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })}>
            <option value="">Choose</option>
            {YEARS.map((year) => (
              <option key={year}>{year}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="adm-field">
        <span>Email (optional)</span>
        <input value={form.email} type="email" inputMode="email" autoComplete="off" onChange={(event) => setForm({ ...form, email: event.target.value })} />
        {field('email')}
      </label>
      <fieldset className="fest-events">
        <legend>Events (the fee for each is paid at its venue)</legend>
        {deptEvents.map((event) => (
          <label key={event.id} className={`fest-event-pick${events.includes(event.id) ? ' is-on' : ''}`}>
            <input type="checkbox" checked={events.includes(event.id)} onChange={() => setEvents(events.includes(event.id) ? events.filter((id) => id !== event.id) : [...events, event.id])} />
            <span>
              <strong>{eventLabel(event)}</strong>
              <small>
                {[event.time, event.venue, teamRule(event), event.fee ? rupees(event.fee) : 'Free'].filter(Boolean).join(' · ')}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      {teamAllowed && (
        <label className="adm-field">
          <span>Team name (if they are in a team; each member registers separately)</span>
          <input value={form.team} autoComplete="off" onChange={(event) => setForm({ ...form, team: event.target.value })} />
          {field('team')}
        </label>
      )}
      <PaymentChoice amount={catalog.entryFee} value={payment} onChange={setPayment} name="entry-payment" />
      {tried && !paymentReady(payment) && <p className="adm-field__error">Choose cash or UPI, type the UPI transaction ID if UPI, and tick that it is received.</p>}
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      <button className="adm-button adm-button--primary adm-button--big" type="submit" disabled={!left}>
        {paper ? 'Save the slip' : `Register · ${rupees(catalog.entryFee)} received`}
      </button>
    </form>
  );
}

function FindAndCheckIn({ dept }: { dept: string }) {
  const { catalog, registrations, session, change } = useFest();
  const [query, setQuery] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  const [adding, setAdding] = useState<string | null>(null);
  const canEdit = hasPermission(session.role, 'fest.edit');
  const found = useMemo(
    () =>
      query.trim().length < 2
        ? []
        : [...registrations.values()].filter((item) => (item.dept === dept || item.dept === OPEN_DEPT) && !item.deleted && matches(item, query)).sort((a, b) => a.id.localeCompare(b.id)),
    [registrations, dept, query],
  );
  if (!catalog) return null;
  const deptEvents = eventsOf(catalog, dept);

  const checkIn = (registration: FestRegistration, withPayment: boolean) => {
    const stamp = stampNow(session.username);
    change(
      registration.id,
      `/api/admin/fest/registrations/${registration.id}`,
      { action: 'checkin', ...(withPayment && { payment: paymentBody(payment) }) },
      `Check in ${showId(registration.id)}`,
      (current) => ({
        ...current,
        checkedIn: { ...stamp, ...(session.deskNumber && { desk: session.deskNumber }) },
        ...(withPayment && { entry: { status: 'PAID' as const, payment: { method: payment.method === 'UPI' ? ('UPI' as const) : ('CASH' as const), amount: catalog.entryFee, ...stamp } } }),
      }),
    );
    setPaying(null);
    setPayment(NO_PAYMENT);
  };

  return (
    <section className="adm-card adm-pad">
      <label className="adm-field">
        <span>Find a student</span>
        <input type="search" value={query} autoFocus placeholder="Registration ID, name, phone or college" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {query.trim().length < 2 ? (
        <p className="adm-muted">Type at least two letters or digits. Works without signal too (it searches the copy on this phone).</p>
      ) : (
        <ShortList
          items={found}
          empty="Nobody matches. Check the spelling, or register them in Register."
          render={(registration) => (
            <RegistrationCard key={registration.id} registration={registration}>
              {isActive(registration) && registration.entry.claim && registration.entry.status === 'DUE' && <VerifyBox registration={registration} />}
              {isActive(registration) && registration.source === 'ONLINE' && !registration.checkedIn && registration.entry.status === 'PAID' && (
                <button className="adm-button adm-button--approve" type="button" onClick={() => checkIn(registration, false)}>
                  Check in (paid online)
                </button>
              )}
              {isActive(registration) && registration.entry.status === 'DUE' && !registration.entry.claim && paying !== registration.id && (
                <button className="adm-button adm-button--primary" type="button" onClick={() => setPaying(registration.id)}>
                  Collect {rupees(catalog.entryFee)} and check in
                </button>
              )}
              {paying === registration.id && (
                <div className="fest-inline-form">
                  <PaymentChoice amount={catalog.entryFee} value={payment} onChange={setPayment} name={`pay-${registration.id}`} />
                  <span className="adm-inline">
                    <button className="adm-button adm-button--primary" type="button" disabled={!paymentReady(payment)} onClick={() => checkIn(registration, true)}>
                      Save and check in
                    </button>
                    <button className="adm-button" type="button" onClick={() => setPaying(null)}>
                      Cancel
                    </button>
                  </span>
                </div>
              )}
              {canEdit && isActive(registration) && registration.dept !== OPEN_DEPT && (adding === registration.id ? (
                <span className="adm-inline adm-inline--wrap">
                  {deptEvents
                    .filter((event) => !registration.events.some((entry) => entry.eventId === event.id))
                    .map((event) => (
                      <button
                        key={event.id}
                        className="adm-button adm-button--small"
                        type="button"
                        onClick={() => {
                          change(registration.id, `/api/admin/fest/registrations/${registration.id}`, { action: 'events', add: [event.id] }, `Add ${event.name} to ${registration.id}`, (current) => ({
                            ...current,
                            events: [...current.events, { eventId: event.id, added: stampNow(session.username) }],
                          }));
                          setAdding(null);
                        }}
                      >
                        + {event.name}
                      </button>
                    ))}
                  <button className="adm-button adm-button--small" type="button" onClick={() => setAdding(null)}>
                    Done
                  </button>
                </span>
              ) : (
                <button className="adm-button adm-button--small" type="button" onClick={() => setAdding(registration.id)}>
                  Add an event
                </button>
              ))}
            </RegistrationCard>
          )}
        />
      )}
    </section>
  );
}

/**
 * Students who registered themselves and typed their UPI transaction ID: the desk finds each
 * payment in the receiving account by that ID and amount, then verifies it (or says it was not found).
 */
function VerifyPayments() {
  const { registrations } = useFest();
  const [query, setQuery] = useState('');
  const waiting = useMemo(() => [...registrations.values()].filter(awaitingCheck).sort((a, b) => a.created.at.localeCompare(b.created.at)), [registrations]);
  const shown = query.trim() ? waiting.filter((item) => matches(item, query)) : waiting;
  return (
    <section className="adm-card adm-pad">
      <h2 className="adm-h2">Payments to check ({waiting.length})</h2>
      <p className="adm-muted">
        Students who registered on their phone. Find each payment in the account receiving the money by its transaction ID and amount, then verify it. Oldest first.
      </p>
      <label className="adm-field">
        <span>Find</span>
        <input type="search" value={query} placeholder="ID (20001…), name, phone or transaction ID" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <ShortList items={shown} empty={waiting.length ? 'Nobody matches.' : 'No payments waiting. New ones appear here by themselves.'} render={(registration) => (
        <RegistrationCard key={registration.id} registration={registration}>
          <VerifyBox registration={registration} />
        </RegistrationCard>
      )} />
    </section>
  );
}

/** The transaction ID the student typed, with Verify (the money is there) and Not found. */
function VerifyBox({ registration }: { registration: FestRegistration }) {
  const { session, change } = useFest();
  const claim = registration.entry.claim!;
  const [txn, setTxn] = useState(claim.txn);
  const [seen, setSeen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('Not received');
  const path = `/api/admin/fest/registrations/${registration.id}` as const;
  const verify = () => {
    const stamp = stampNow(session.username);
    const desk = session.deskNumber ?? undefined;
    change(registration.id, path, { action: 'verify', txn: txn.replace(/\s/g, ''), confirmed: true }, `Verify ${registration.id}`, (current) => ({
      ...current,
      entry: { status: 'PAID', claim: current.entry.claim, payment: { method: 'UPI', amount: claim.amount, txn: txn.replace(/\s/g, ''), ...stamp, ...(desk && { desk }) } },
      checkedIn: current.checkedIn ?? { ...stamp, ...(desk && { desk }) },
    }));
  };
  const reject = () => {
    const stamp = stampNow(session.username);
    change(registration.id, path, { action: 'reject', reason: reason.trim() }, `Payment not found · ${registration.id}`, (current) => ({ ...current, entry: { ...current.entry, rejected: { ...stamp, reason: reason.trim() } } }));
    setRejecting(false);
  };
  return (
    <div className="fest-verify">
      <p className="fest-verify__claim">
        {rupees(claim.amount)} by UPI · transaction ID <strong className="fest-verify__txn">{claim.txn}</strong> · {when(claim.at)}
      </p>
      {registration.entry.rejected && <p className="adm-field__error">Marked not found: {registration.entry.rejected.reason}. They may have sent a new ID.</p>}
      <label className="adm-field">
        <span>Transaction ID as it appears in the payment (correct a typo here)</span>
        <input value={txn} inputMode="text" autoCapitalize="characters" onChange={(event) => setTxn(event.target.value)} />
      </label>
      <label className="adm-check">
        <input type="checkbox" checked={seen} onChange={(event) => setSeen(event.target.checked)} />
        <span>I have seen {rupees(claim.amount)} received with this transaction ID.</span>
      </label>
      {rejecting ? (
        <span className="adm-inline adm-inline--wrap">
          <input className="fest-verify__reason" value={reason} aria-label="What is wrong" onChange={(event) => setReason(event.target.value)} />
          <button className="adm-button adm-button--small adm-button--danger-outline" type="button" disabled={reason.trim().length < 3} onClick={reject}>
            Mark not found
          </button>
          <button className="adm-button adm-button--small" type="button" onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="adm-inline adm-inline--wrap">
          <button className="adm-button adm-button--approve" type="button" disabled={!seen || txn.replace(/\s/g, '').length < 6} onClick={verify}>
            Verify {registration.id}
          </button>
          <button className="adm-button adm-button--small" type="button" onClick={() => setRejecting(true)}>
            Not found…
          </button>
        </span>
      )}
    </div>
  );
}

function DeskTotals({ dept }: { dept: string }) {
  const { registrations, session, catalog } = useFest();
  const mine = useMemo(() => [...registrations.values()].filter((item) => (item.dept === dept || item.dept === OPEN_DEPT) && isActive(item)), [registrations, dept]);
  const me = session.username;
  let cash = 0;
  let upi = 0;
  let made = 0;
  let checkIns = 0;
  let verified = 0;
  for (const registration of mine) {
    if (registration.created.by === me && registration.source !== 'ONLINE') made += 1;
    if (registration.checkedIn?.by === me && registration.source === 'ONLINE') checkIns += 1;
    if (registration.source === 'SELF' && registration.entry.payment?.by === me) verified += 1;
    const payment = registration.entry.payment;
    if (payment && payment.by === me && !payment.voided) {
      if (payment.method === 'CASH') cash += payment.amount;
      else if (payment.method === 'UPI') upi += payment.amount;
    }
  }
  const recent = mine.filter((item) => item.created.by === me).sort((a, b) => b.created.at.localeCompare(a.created.at));
  return (
    <section className="adm-card adm-pad">
      <div className="fest-stats">
        <Stat label="Registered by you" value={made} />
        <Stat label="Payments you verified" value={verified} />
        <Stat label="Online students checked in" value={checkIns} />
        <Stat label="Cash collected" value={rupees(cash)} />
        <Stat label="UPI collected" value={rupees(upi)} />
      </div>
      <p className="adm-note">
        Hand over <strong>{rupees(cash)}</strong> in cash at the end of your shift
        {upi ? (
          <>
            {' '}
            (<strong>{rupees(upi)}</strong> came by UPI: already in the account)
          </>
        ) : null}
        .
      </p>
      <h3 className="adm-h3">Your registrations</h3>
      <ShortList items={recent} empty="None yet." render={(registration) => <RegistrationCard key={registration.id} registration={registration} />} />
      {catalog && <p className="adm-muted">Entry fee {rupees(catalog.entryFee)} per student.</p>}
      <Badge tone="plain">{deptShort(dept)}</Badge>
    </section>
  );
}
