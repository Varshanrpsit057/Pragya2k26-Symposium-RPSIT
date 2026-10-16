/**
 * A department's registration desk on a phone. Students register on their own phones (the QR code
 * at the gate) and come to their department's desk with their ID:
 *
 *   Students     the department's IDs (to verify, fee due, paid; search) → open one → their details
 *                → collect the entry fee (cash or UPI with its UTR), or verify the UTR they sent;
 *                a UTR that clashes shows everyone who has it, and either student's UTR can be
 *                corrected (kept in their UTR log)
 *   Register     only for a student who cannot register on a phone (online; Website controls can
 *                switch it off): the same IDs as the phones, then the fee as for anyone
 *   My totals    what this desk collected, for handing over the cash
 *
 * Everything about money is sent at once and waits for the server's answer: the desk sees a UTR
 * used elsewhere, or a lost connection, before the student leaves.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { COLLEGES, OTHER_COLLEGE } from '../../content/colleges';
import { COURSE_DEPARTMENTS, OTHER, STREAMS, courseText } from '../../content/courses';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { formatIst } from '../../lib/countdown';
import {
  awaitingCheck,
  DESKS,
  deskMoney,
  deptShort,
  eventLabel,
  eventOf,
  feePaid,
  isActive,
  readParticipant,
  rupees,
  selfRegistrationProblems,
  showId,
  tidyPhone,
  YEARS,
  type FestParticipant,
  type FestRegistration,
  type UtrHolder,
} from '../../lib/fest';
import { tidyUtr } from '../../lib/portal';
import { ApiFailure } from '../adminApi';
import { Badge, messageOf, when } from '../ui';
import { PORTAL, today } from './excel';
import { downloadStudents, howRegistered } from './exports';
import { useFest } from './FestData';
import { handOverCash, lookupUtr } from './festApi';
import { NO_PAYMENT, PaymentChoice, RegistrationCard, ShortList, Stat, handOverGap, matches, paymentBody, paymentReady, txnHolders, useHandOvers, type PaymentDraft } from './festUi';

const EMPTY: FestParticipant = { name: '', phone: '', email: '', college: '', collegeCode: '', branch: '', year: '', team: '' };

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
  const { session, switches, registrations } = useFest();
  const [dept, setDept, canPick] = useWorkDept();
  // Website controls can switch registering for a student off (the web assist team keeps it).
  const canRegister = switches.deskRegistration || session.role === 'ADMIN';
  const [tab, setTab] = useState<'students' | 'register' | 'totals'>('students');
  const [open, setOpen] = useState<string | null>(null);
  // The student just finished (fee collected or verified, or checked in): the list comes back
  // at once with an empty search, ready for the next student's ID.
  const [finished, setFinished] = useState('');
  // The list the desk works through (e.g. Fee due): kept while a student is open, so the next one is a tap away.
  const [filter, setFilter] = useState<DeskFilter>('all');
  const openStudent = (id: string | null) => {
    setFinished('');
    setOpen(id);
  };
  const waiting = useMemo(() => [...registrations.values()].filter((item) => item.dept === dept && isActive(item) && awaitingCheck(item)).length, [registrations, dept]);
  const tabs: [typeof tab, string][] = [
    ['students', waiting ? `Students (${waiting} to verify)` : 'Students'],
    ...(canRegister ? [['register', 'Register for them'] as [typeof tab, string]] : []),
    ['totals', session.deskNumber ? `Desk ${session.deskNumber} totals` : 'My totals'],
  ];
  return (
    <main className="adm-page fest-desk">
      {canPick && (
        <DeptPicker
          value={dept}
          onChange={(next) => {
            setDept(next);
            openStudent(null);
          }}
        />
      )}
      {!dept ? (
        <p className="adm-note">Choose the department.</p>
      ) : (
        <>
          <nav className="fest-tabs" aria-label="Desk">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="fest-tabs__tab"
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => {
                  setTab(id);
                  if (id === 'students') openStudent(null);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'students' &&
            (open ? (
              <StudentDetail
                key={open}
                id={open}
                onBack={() => openStudent(null)}
                onFinished={(text) => {
                  setOpen(null);
                  setFinished(text);
                }}
              />
            ) : (
              <DeskStudents dept={dept} onOpen={openStudent} filter={filter} onFilter={setFilter} finished={finished} onDismiss={() => setFinished('')} />
            ))}
          {tab === 'register' && canRegister && (
            <RegisterForStudent
              key={dept}
              dept={dept}
              onOpen={(id) => {
                openStudent(id);
                setTab('students');
              }}
            />
          )}
          {tab === 'totals' && <DeskTotals dept={dept} />}
        </>
      )}
    </main>
  );
}

// ------------------------------------------------------------------------------------------ the list

type DeskFilter = 'verify' | 'due' | 'paid' | 'all';
const DESK_FILTERS: { id: DeskFilter; label: string; test: (item: FestRegistration) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'verify', label: 'UTR sent · to verify', test: awaitingCheck },
  { id: 'due', label: 'Fee due', test: (item) => item.entry.status === 'DUE' && !awaitingCheck(item) },
  { id: 'paid', label: 'Paid', test: (item) => item.entry.status === 'PAID' },
];

/** The department's students: filter, search, open one. `finished`: the student just done (the search waits for the next). */
function DeskStudents({
  dept,
  onOpen,
  filter,
  onFilter,
  finished = '',
  onDismiss,
}: {
  dept: string;
  onOpen: (id: string) => void;
  filter: DeskFilter;
  onFilter: (next: DeskFilter) => void;
  finished?: string;
  onDismiss?: () => void;
}) {
  const { registrations, catalog, session, switches } = useFest();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  // Back from a student just finished: the cursor waits in the search for the next ID.
  useEffect(() => {
    if (finished) search.current?.focus();
  }, [finished]);
  const mine = useMemo(() => [...registrations.values()].filter((item) => item.dept === dept && isActive(item)).sort((a, b) => a.id.localeCompare(b.id)), [registrations, dept]);
  const counts = useMemo(() => Object.fromEntries(DESK_FILTERS.map((item) => [item.id, mine.filter(item.test).length])) as Record<DeskFilter, number>, [mine]);
  const test = DESK_FILTERS.find((item) => item.id === filter)!.test;
  const shown = mine.filter((item) => test(item) && matches(item, query));
  const canDownload = switches.downloads || session.role === 'ADMIN';
  const download = () => {
    if (!catalog) return;
    const label = DESK_FILTERS.find((item) => item.id === filter)!.label;
    downloadStudents(
      `techfest-${dept.toLowerCase()}-students-${today()}.xlsx`,
      `${deptShort(dept)} students`,
      `${PORTAL} · ${deptShort(dept)} · ${label}${query.trim() ? ` · search: ${query.trim()}` : ''} · downloaded by ${session.displayName} ${formatIst(Date.now())}`,
      shown,
      catalog,
    );
  };
  return (
    <section className="adm-card adm-pad">
      <div className="adm-toolbar">
        <h2 className="adm-h2">
          {deptShort(dept)} students ({mine.length})
        </h2>
        {canDownload && (
          <button className="adm-button adm-button--small" type="button" disabled={!shown.length} onClick={download}>
            Download (Excel)
          </button>
        )}
      </div>
      {finished && (
        <p className="fest-match is-good fest-finished" role="status">
          <span>✓ {finished} Next student: type their ID.</span>
          {onDismiss && (
            <button className="adm-button adm-button--small" type="button" onClick={onDismiss}>
              OK
            </button>
          )}
        </p>
      )}
      <label className="adm-field fest-find">
        <span>Find</span>
        <input ref={search} type="search" value={query} placeholder={`ID (${deptShort(dept)}-2001), name, phone, college or UTR`} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <p className="adm-muted">Type the ID the student shows you, open it, check their details, then collect the {rupees(catalog?.entryFee ?? 0)} entry fee or verify the UTR they sent.</p>
      <div className="fest-chips" role="group" aria-label="Show">
        {DESK_FILTERS.map((item) => (
          <button key={item.id} type="button" className={`fest-chip-button${filter === item.id ? ' is-on' : ''}`} aria-pressed={filter === item.id} onClick={() => onFilter(item.id)}>
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>
      <UtrLookup />
      <ShortList
        items={shown}
        empty={mine.length ? 'Nobody matches.' : `Nobody has registered under ${deptShort(dept)} yet. New students appear here by themselves.`}
        render={(registration) => (
          <RegistrationCard key={registration.id} registration={registration} compact>
            <button className="adm-button adm-button--primary" type="button" aria-label={`Open ${showId(registration.id)}`} onClick={() => onOpen(registration.id)}>
              Open
            </button>
          </RegistrationCard>
        )}
      />
    </section>
  );
}

// ------------------------------------------------------------------------------------------ one student

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fest-fact">
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

function StudentDetail({ id, onBack, onFinished }: { id: string; onBack: () => void; onFinished?: (text: string) => void }) {
  const { registrations, catalog } = useFest();
  const registration = registrations.get(id);
  const back = (
    <button className="adm-button adm-button--small" type="button" onClick={onBack}>
      ← Back to the list
    </button>
  );
  if (!registration || !catalog) {
    return (
      <section className="adm-card adm-pad">
        {back}
        <p className="adm-note">{showId(id)} is not on this phone yet. Refresh, or check the ID.</p>
      </section>
    );
  }
  return (
    <>
      <section className="adm-card adm-pad" aria-label={`${showId(id)} details`}>
        {back}
        <h2 className="adm-h2">
          <span className="fest-card__id">{showId(registration.id)}</span> {registration.name}
        </h2>
        {!isActive(registration) && (
          <p className="adm-note">
            {registration.deleted ? `Deleted: ${registration.deleted.reason}` : `Cancelled: ${registration.cancelled?.reason ?? ''}`}. Nothing can be collected for it.
          </p>
        )}
        <p className="adm-muted">Check these with the student (their phone shows the same ID) before taking any money.</p>
        <dl className="fest-factgrid">
          <Fact label="Mobile">{registration.phone}</Fact>
          <Fact label="Email">{registration.email}</Fact>
          <Fact label="College">{registration.college}</Fact>
          <Fact label="College code">{registration.collegeCode ?? ''}</Fact>
          <Fact label="Department / course">{registration.branch}</Fact>
          <Fact label="Year">{registration.year}</Fact>
          {registration.team && <Fact label="Team typed when registering">{registration.team}</Fact>}
          <Fact label="Registered">
            {howRegistered(registration)} · {when(registration.created.at)}
            {registration.created.by !== 'student' ? ` by ${registration.created.by}` : ''}
          </Fact>
          <Fact label="At the desk">{registration.checkedIn ? `${when(registration.checkedIn.at)} by ${registration.checkedIn.by}${registration.checkedIn.desk ? ` (desk ${registration.checkedIn.desk})` : ''}` : 'Not yet'}</Fact>
        </dl>
      </section>
      {isActive(registration) && <EntryFee registration={registration} onFinished={onFinished && ((text) => onFinished(`${showId(registration.id)} ${registration.name}: ${text}`))} />}
      <UtrLog registration={registration} />
      <StudentEvents registration={registration} />
    </>
  );
}

const sent = (registration: FestRegistration) => registration.entry.claim;

/**
 * The entry fee: paid (how), or collect it (cash or UPI), or verify the UTR the student sent.
 * `onFinished`: once collected, verified or checked in, the desk goes back to its list for the next student.
 */
function EntryFee({ registration, onFinished }: { registration: FestRegistration; onFinished?: (text: string) => void }) {
  const { catalog, registrations, send } = useFest();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [clash, setClash] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const path = `/api/admin/fest/registrations/${registration.id}` as const;
  const fee = catalog?.entryFee ?? 0;
  const run = async (body: Record<string, unknown>, success: string, utr?: string) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      await send(path, body);
      setDone(success);
      setCollecting(false);
      return true;
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : `${messageOf(failure)} Nothing was saved: try again when the connection is back.`);
      if (failure instanceof ApiFailure && failure.code === 'TXN_USED' && utr) setClash(utr);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Collected, verified or checked in: this student is done.
  const finish = async (body: Record<string, unknown>, success: string, utr?: string) => {
    if ((await run(body, success, utr)) && onFinished) onFinished(success);
  };
  const status = registration.entry;
  const payment = status.payment;
  const claim = sent(registration);
  const localClash = claim && status.status === 'DUE' ? txnHolders(registrations, claim.txn, registration.id) : [];

  return (
    <section className="adm-card adm-pad" aria-label="Entry fee">
      <h3 className="adm-h3">Entry fee {rupees(fee)}</h3>
      {status.status === 'PAID' && payment ? (
        <>
          <p className="fest-match is-good" role="status">
            ✓ Payment collected and verified: {rupees(payment.amount)} {payment.method === 'CASH' ? 'in cash' : payment.method === 'UPI' ? `by UPI · UTR ${payment.txn ?? ''}` : 'online'} · {when(payment.at)} by {payment.by}
            {payment.desk ? ` (desk ${payment.desk})` : ''}
          </p>
          {!registration.checkedIn && (
            <button className="adm-button adm-button--approve" type="button" disabled={busy} onClick={() => void finish({ action: 'checkin' }, 'checked in.')}>
              Check in (already paid)
            </button>
          )}
          {payment.method === 'UPI' && payment.txn && <ChangeUtr id={registration.id} current={payment.txn} onChanged={(next) => setDone(`UTR changed to ${next}.`)} />}
        </>
      ) : (
        <>
          {claim && (
            <div className="fest-verify">
              <p className="fest-verify__claim">
                They paid on their phone and sent {rupees(claim.amount)} · UTR ending <strong className="fest-verify__txn">{tidyUtr(claim.txn).slice(-4)}</strong> · {when(claim.at)}
              </p>
              {status.rejected && (
                <p className="adm-field__error">
                  Marked not found by {status.rejected.by}: {status.rejected.reason}. They may have sent a new UTR: check it again, or collect the fee.
                </p>
              )}
              {localClash.length > 0 && (
                <p className="fest-match is-bad" role="alert">
                  This UTR is also on {localClash.map((item) => `${showId(item.id)} (${item.name})`).join(', ')}. A payment counts once: look at who has it below.
                </p>
              )}
              <VerifyForm registration={registration} busy={busy} onVerify={(body, utr) => void finish(body, 'UTR verified: payment collected.', utr)} />
              <span className="adm-inline adm-inline--wrap">
                <button className="adm-button adm-button--small" type="button" onClick={() => setClash(tidyUtr(claim.txn).toUpperCase())}>
                  Who else has this UTR?
                </button>
                <ChangeUtr id={registration.id} current={claim.txn} label="Change the UTR they sent" onChanged={(next) => setDone(`Their UTR is now ${next}: verify it.`)} />
                <RejectButton busy={busy} onReject={(reason) => void run({ action: 'reject', reason }, 'Marked not found: the student sees it on their page.')} />
              </span>
            </div>
          )}
          {!claim || collecting ? (
            <CollectForm
              registration={registration}
              amount={fee}
              busy={busy}
              onCollect={(draft) => void finish({ action: 'collect', payment: paymentBody(draft) }, `${rupees(fee)} collected ${draft.method === 'CASH' ? 'in cash' : 'by UPI'}.`, draft.method === 'UPI' ? tidyUtr(draft.txn).toUpperCase() : undefined)}
            />
          ) : (
            <button className="adm-button adm-button--small" type="button" onClick={() => setCollecting(true)}>
              They paid at the desk instead (cash or UPI)…
            </button>
          )}
        </>
      )}
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="adm-note" role="status">
          {done}
        </p>
      )}
      {clash && <UtrHolders key={clash} utr={clash} onClose={() => setClash(null)} />}
    </section>
  );
}

/**
 * The desk types the UTR it sees on the payment: it must match the one the student sent (only its
 * last 4 digits are shown), or, ticked, the student typed theirs wrong and this one is right.
 */
function VerifyForm({ registration, busy, onVerify }: { registration: FestRegistration; busy: boolean; onVerify: (body: Record<string, unknown>, utr: string) => void }) {
  const claim = sent(registration)!;
  const [typed, setTyped] = useState('');
  const [seen, setSeen] = useState(false);
  const [correct, setCorrect] = useState(false);
  const wanted = tidyUtr(claim.txn).toUpperCase();
  const utr = tidyUtr(typed).toUpperCase();
  const valid = /^[A-Z0-9]{6,35}$/.test(utr);
  const match = valid && utr === wanted;
  const mismatch = valid && !match && utr.length >= Math.min(wanted.length, 12);
  return (
    <div className="fest-inline-form">
      <label className="adm-field">
        <span>UTR on the payment (the student’s payment screen, or the receiving account)</span>
        <input value={typed} inputMode="numeric" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="12 digits" onChange={(event) => setTyped(event.target.value)} />
      </label>
      {match && (
        <p className="fest-match is-good" role="status">
          ✓ Matches the UTR {showId(registration.id)} sent.
        </p>
      )}
      {mismatch && (
        <>
          <p className="fest-match is-bad" role="status">
            ✗ Not the UTR they sent (theirs ends {wanted.slice(-4)}). Check the digits again.
          </p>
          <label className="adm-check">
            <input type="checkbox" checked={correct} onChange={(event) => setCorrect(event.target.checked)} />
            <span>The student typed theirs wrong: the UTR I typed is the one on the payment (kept in their UTR log).</span>
          </label>
        </>
      )}
      <label className="adm-check">
        <input type="checkbox" checked={seen} onChange={(event) => setSeen(event.target.checked)} />
        <span>I have seen {rupees(claim.amount)} paid with this UTR.</span>
      </label>
      <button
        className="adm-button adm-button--approve"
        type="button"
        disabled={busy || !seen || !(match || (mismatch && correct))}
        onClick={() => onVerify({ action: 'verify', txn: utr, confirmed: true, ...(mismatch && correct && { correct: true }) }, utr)}
      >
        {busy ? 'Saving…' : `Verify ${showId(registration.id)}`}
      </button>
    </div>
  );
}

function CollectForm({ registration, amount, busy, onCollect }: { registration: FestRegistration; amount: number; busy: boolean; onCollect: (draft: PaymentDraft) => void }) {
  const [payment, setPayment] = useState<PaymentDraft>(NO_PAYMENT);
  return (
    <div className="fest-inline-form">
      <PaymentChoice amount={amount} value={payment} onChange={setPayment} name={`collect-${registration.id}`} forId={registration.id} />
      <button className="adm-button adm-button--primary adm-button--big" type="button" disabled={busy || !paymentReady(payment)} onClick={() => onCollect(payment)}>
        {busy ? 'Saving…' : `Collect ${rupees(amount)}${payment.method === 'UPI' ? ' (UPI)' : payment.method === 'CASH' ? ' (cash)' : ''}`}
      </button>
    </div>
  );
}

function RejectButton({ busy, onReject }: { busy: boolean; onReject: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('Not received');
  if (!open) {
    return (
      <button className="adm-button adm-button--small" type="button" onClick={() => setOpen(true)}>
        Payment not found…
      </button>
    );
  }
  return (
    <span className="adm-inline adm-inline--wrap">
      <input className="fest-verify__reason" value={reason} aria-label="What is wrong" onChange={(event) => setReason(event.target.value)} />
      <button
        className="adm-button adm-button--small adm-button--danger-outline"
        type="button"
        disabled={busy || reason.trim().length < 3}
        onClick={() => {
          onReject(reason.trim());
          setOpen(false);
        }}
      >
        Mark not found
      </button>
      <button className="adm-button adm-button--small" type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

/** Corrects one student's UTR (theirs or, in a clash, another student's), with the reason kept. */
function ChangeUtr({ id, current, label = 'Change UTR', onChanged }: { id: string; current: string; label?: string; onChanged?: (next: string) => void }) {
  const { send } = useFest();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const utr = tidyUtr(typed).toUpperCase();
  if (!open) {
    return (
      <button className="adm-button adm-button--small" type="button" onClick={() => setOpen(true)}>
        {label}…
      </button>
    );
  }
  const save = async () => {
    if (!window.confirm(`Change ${showId(id)}’s UTR from ${current} to ${utr}?\n\nThe change, your name and the reason are kept in their UTR log.`)) return;
    setBusy(true);
    setError('');
    try {
      await send(`/api/admin/fest/registrations/${id}`, { action: 'utr', txn: utr, reason: reason.trim() });
      setOpen(false);
      setTyped('');
      setReason('');
      onChanged?.(utr);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : `${messageOf(failure)} Nothing was saved.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fest-inline-form" aria-label={`Change ${showId(id)}’s UTR`}>
      <p className="adm-muted">
        {showId(id)}’s UTR now: <span className="adm-mono">{current}</span>
      </p>
      <label className="adm-field">
        <span>The right UTR</span>
        <input value={typed} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="12 digits" onChange={(event) => setTyped(event.target.value)} />
      </label>
      <label className="adm-field">
        <span>Why (kept in their log)</span>
        <input value={reason} placeholder="e.g. typed wrong; the student showed the payment" onChange={(event) => setReason(event.target.value)} />
      </label>
      <span className="adm-inline">
        <button className="adm-button adm-button--primary" type="button" disabled={busy || !/^[A-Z0-9]{6,35}$/.test(utr) || reason.trim().length < 3} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save the UTR'}
        </button>
        <button className="adm-button" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const HOLDER_STATE: Record<UtrHolder['state'], { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  accepted: { label: 'Paid with it (accepted)', tone: 'good' },
  sent: { label: 'Sent it · not verified yet', tone: 'warn' },
  notFound: { label: 'Sent it · marked not found', tone: 'bad' },
};

/**
 * Everyone with this UTR, in every department, with what to check against the payment (the payer's
 * name and phone in the UPI app). Whoever's UTR is wrong gets it corrected here.
 */
function UtrHolders({ utr, onClose }: { utr: string; onClose: () => void }) {
  const { token } = useFest();
  const [holders, setHolders] = useState<UtrHolder[] | null>(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  useEffect(() => {
    let active = true;
    lookupUtr(token, utr)
      .then((answer) => {
        if (!active) return;
        setHolders(answer.holders);
        setError('');
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof ApiFailure ? failure.message : `${messageOf(failure)} Looking up a UTR needs the connection.`);
      });
    return () => {
      active = false;
    };
  }, [token, utr, round]);
  return (
    <section className="fest-utr" aria-label={`Who has the UTR ${utr}`}>
      <div className="adm-toolbar">
        <h4 className="adm-h3">Who has the UTR {utr}</h4>
        <button className="adm-button adm-button--small" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      {!holders && !error && <p className="adm-muted">Looking…</p>}
      {holders && (
        <>
          <p className="adm-muted">
            {holders.length
              ? 'Check the payment (the payer’s name and phone number in the UPI app), then correct the UTR of whoever has the wrong one.'
              : 'Nobody has this UTR: it is free.'}
          </p>
          <ul className="fest-utr__list">
            {holders.map((item) => (
              <li key={item.id} className="fest-utr__item">
                <span>
                  <strong>{showId(item.id)}</strong> {item.name} · {deptShort(item.dept)} · {item.college} · {item.phone}
                  <br />
                  <Badge tone={HOLDER_STATE[item.state].tone}>{HOLDER_STATE[item.state].label}</Badge>{' '}
                  <span className="adm-muted">
                    {when(item.at)}
                    {item.by ? ` by ${item.by}` : ''}
                  </span>
                </span>
                <ChangeUtr id={item.id} current={utr} onChanged={() => setRound((count) => count + 1)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** "Who has a UTR?": any UTR, from the list (e.g. a payment in the receiving account nobody claimed). */
function UtrLookup() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [utr, setUtr] = useState<string | null>(null);
  if (!open) {
    return (
      <button className="adm-button adm-button--small" type="button" onClick={() => setOpen(true)}>
        Who has a UTR? Look it up
      </button>
    );
  }
  const wanted = tidyUtr(typed).toUpperCase();
  return (
    <div className="fest-inline-form">
      <form
        className="adm-inline adm-inline--wrap"
        onSubmit={(event) => {
          event.preventDefault();
          setUtr(wanted);
        }}
      >
        <label className="adm-field">
          <span>UTR</span>
          <input value={typed} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="12 digits" onChange={(event) => setTyped(event.target.value)} />
        </label>
        <button className="adm-button" type="submit" disabled={!/^[A-Z0-9]{6,35}$/.test(wanted)}>
          Find
        </button>
        <button
          className="adm-button adm-button--small"
          type="button"
          onClick={() => {
            setOpen(false);
            setUtr(null);
          }}
        >
          Close
        </button>
      </form>
      {utr && <UtrHolders key={utr} utr={utr} onClose={() => setUtr(null)} />}
    </div>
  );
}

/** Every change of the student's UTR: who, when, from what, to what, why. */
function UtrLog({ registration }: { registration: FestRegistration }) {
  const log = registration.utrLog ?? [];
  if (!log.length) return null;
  return (
    <section className="adm-card adm-pad" aria-label="UTR changes">
      <h3 className="adm-h3">UTR changes</h3>
      <ul className="fest-log">
        {log.map((change) => (
          <li key={`${change.at}-${change.to}`}>
            <span className="adm-mono">{change.from}</span> → <span className="adm-mono">{change.to}</span> · {change.reason} · {change.by}, {when(change.at)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The events they joined at the venues (each event's coordinator adds them there). */
function StudentEvents({ registration }: { registration: FestRegistration }) {
  const { catalog } = useFest();
  if (!catalog) return null;
  return (
    <section className="adm-card adm-pad" aria-label="Events">
      <h3 className="adm-h3">Events ({registration.events.length})</h3>
      {registration.events.length === 0 && <p className="adm-muted">None yet: they join each {deptShort(registration.dept)} event at its venue.</p>}
      <ul className="fest-log">
        {registration.events.map((item) => {
          const event = eventOf(catalog, item.eventId);
          return (
            <li key={item.eventId}>
              <strong>{event ? eventLabel(event) : item.eventId}</strong>{' '}
              <Badge tone={feePaid(item) ? 'good' : 'plain'}>{feePaid(item) ? `Fee paid ${rupees(item.fee!.amount)}` : event?.fee ? `Fee ${rupees(event.fee)} at the venue` : 'No fee'}</Badge>{' '}
              {item.present && <Badge tone="good">Present</Badge>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ register for them

const submissionId = (username: string) => `${username.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 30)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Only for a student who cannot register on a phone: the desk types their details (online). They get
 * the next ID of the department, as on a phone; the fee is then collected as for anyone.
 */
function RegisterForStudent({ dept, onOpen }: { dept: string; onOpen: (id: string) => void }) {
  const { catalog, registrations, session, send } = useFest();
  const [form, setForm] = useState<FestParticipant>(EMPTY);
  const [college, setCollege] = useState({ choice: '', other: '' });
  const setCollegeTo = (next: typeof college) => {
    setCollege(next);
    setForm((current) => ({ ...current, college: next.choice === OTHER_COLLEGE ? next.other.replace(/\s+/g, ' ').trim() : next.choice }));
  };
  const [course, setCourse] = useState({ stream: '', dept: '', other: '' });
  const setCourseTo = (next: typeof course) => {
    setCourse(next);
    setForm((current) => ({ ...current, branch: courseText(next.stream, next.dept, next.other) }));
  };
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState('');
  // One per form: sending it again (a lost answer) never registers anyone twice.
  const [sid, setSid] = useState(() => submissionId(session.username));
  const participant = readParticipant(form);
  const problems = selfRegistrationProblems(participant);
  const phone = tidyPhone(form.phone);
  const already = phone.length === 10 ? [...registrations.values()].find((item) => item.dept === dept && item.phone === phone && !item.deleted) : undefined;

  if (!catalog) return <p className="adm-muted">Loading…</p>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError('');
    setExisting('');
    if (Object.keys(problems).length || already) return;
    setBusy(true);
    try {
      const registration = await send('/api/admin/fest/registrations', { dept, submissionId: sid, participant: { ...participant }, events: [] });
      setSid(submissionId(session.username));
      onOpen(registration.id);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : `${messageOf(failure)} Nothing was saved: try again when the connection is back.`);
      if (failure instanceof ApiFailure && failure.details.existingId) setExisting(failure.details.existingId);
    } finally {
      setBusy(false);
    }
  };
  const field = (name: keyof FestParticipant) => (tried && problems[name] ? <span className="adm-field__error">{problems[name]}</span> : null);

  return (
    <form className="adm-card adm-pad fest-form" onSubmit={(event) => void submit(event)} noValidate>
      <h2 className="adm-h2">Register a student for them</h2>
      <p className="adm-note">
        Only if they cannot register on their phone (the QR code at the gate). They get the next {deptShort(dept)} ID; then collect the entry fee as for anyone. They join events at each
        event’s venue.
      </p>
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
            Already registered as <strong>{showId(already.id)}</strong> ({already.name}).{' '}
            <button className="adm-button adm-button--small" type="button" onClick={() => onOpen(already.id)}>
              Open {showId(already.id)}
            </button>
          </span>
        )}
      </label>
      <label className="adm-field">
        <span>Email</span>
        <input value={form.email} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" onChange={(event) => setForm({ ...form, email: event.target.value })} />
        {field('email')}
      </label>
      <div className="adm-field">
        <span id="desk-college-label">College</span>
        <SearchSelect
          id="desk-college"
          labelId="desk-college-label"
          options={COLLEGES}
          value={college.choice}
          onChange={(choice) => setCollegeTo({ ...college, choice })}
          placeholder="Choose… (type to find it)"
          searchPlaceholder="College name or initials"
          searchLabel="Search colleges"
          emptyText={(query) => `No college matches “${query}”. Choose ${OTHER_COLLEGE} and type it.`}
          bestFirst
          searchFirst
        />
        {college.choice !== OTHER_COLLEGE && field('college')}
      </div>
      {college.choice === OTHER_COLLEGE && (
        <label className="adm-field">
          <span>Their college</span>
          <input value={college.other} maxLength={120} autoComplete="off" onChange={(event) => setCollegeTo({ ...college, other: event.target.value })} />
          {field('college')}
        </label>
      )}
      <label className="adm-field">
        <span>College code</span>
        <input value={form.collegeCode} maxLength={12} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="e.g. 2639" onChange={(event) => setForm({ ...form, collegeCode: event.target.value })} />
        {field('collegeCode')}
      </label>
      <div className="fest-form__row">
        <div className="adm-field">
          <span id="desk-stream-label">Stream</span>
          <SearchSelect id="desk-stream" labelId="desk-stream-label" options={STREAMS} value={course.stream} onChange={(stream) => setCourseTo({ ...course, stream })} placeholder="B.E., B.Sc.…" searchPlaceholder="Search streams" searchLabel="Search streams" />
        </div>
        <div className="adm-field">
          <span id="desk-course-label">Department / course</span>
          <SearchSelect
            id="desk-course"
            labelId="desk-course-label"
            options={COURSE_DEPARTMENTS}
            value={course.dept}
            onChange={(next) => setCourseTo({ ...course, dept: next })}
            placeholder="CSE, ECE…"
            searchPlaceholder="Search departments"
            searchLabel="Search departments"
            bestFirst
          />
        </div>
      </div>
      {course.dept === OTHER && (
        <label className="adm-field">
          <span>Their department</span>
          <input value={course.other} maxLength={60} autoComplete="off" onChange={(event) => setCourseTo({ ...course, other: event.target.value })} />
        </label>
      )}
      {field('branch')}
      <label className="adm-field">
        <span>Year</span>
        <select value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })}>
          <option value="">Choose</option>
          {YEARS.map((year) => (
            <option key={year}>{year}</option>
          ))}
        </select>
        {field('year')}
      </label>
      {error && (
        <p className="adm-error" role="alert">
          {error}{' '}
          {existing && (
            <button className="adm-button adm-button--small" type="button" onClick={() => onOpen(existing)}>
              Open {showId(existing)}
            </button>
          )}
        </p>
      )}
      <button className="adm-button adm-button--primary adm-button--big" type="submit" disabled={busy}>
        {busy ? 'Registering…' : 'Register, then collect the fee'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------------------------------ totals

/**
 * The cash hand-over at closing: the desk counts its cash and records it; the overall coordinator
 * sees it beside what the system says the desk took. Department admins and the web assist team
 * choose the desk (e.g. collecting a desk's cash).
 */
function HandOverCash({ dept }: { dept: string }) {
  const { session, registrations, token } = useFest();
  const fixed = session.role === 'DESK' ? session.deskNumber : null;
  const [chosen, setChosen] = useState(1);
  const desk = fixed ?? chosen;
  const money = deskMoney(registrations.values(), dept, desk);
  const handOvers = useHandOvers();
  const history = handOvers.list.filter((item) => item.dept === dept && item.desk === desk);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const amount = /^\d{1,7}$/.test(counted.trim()) ? Number(counted.trim()) : null;
  const gap = amount === null ? null : amount - money.cash;
  const save = async () => {
    if (amount === null) return;
    if (gap !== 0 && !window.confirm(`You counted ${rupees(amount)}; the system says desk ${desk} took ${rupees(money.cash)} in cash (${gap! < 0 ? 'short' : 'over'} by ${rupees(Math.abs(gap!))}).\n\nRecord it anyway? Count again first if you can.`)) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      const entry = await handOverCash(token, { dept, desk, counted: amount, note: note.trim() });
      handOvers.added(entry);
      setCounted('');
      setNote('');
      setDone(`Recorded: ${rupees(entry.counted)} handed over (${handOverGap(entry)}).`);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : `${messageOf(failure)} Nothing was saved: try again when the connection is back.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="fest-handover" aria-label="Cash hand-over">
      <h3 className="adm-h3">Cash hand-over · {deptShort(dept)} desk {desk}</h3>
      {!fixed && (
        <div className="fest-chips" role="group" aria-label="Desk">
          {Array.from({ length: DESKS }, (_, index) => index + 1).map((number) => (
            <button key={number} type="button" className={`fest-chip-button${desk === number ? ' is-on' : ''}`} aria-pressed={desk === number} onClick={() => setChosen(number)}>
              Desk {number}
            </button>
          ))}
        </div>
      )}
      <p>
        The system says desk {desk} took <strong>{rupees(money.cash)}</strong> in cash
        {money.upi ? ` (and ${rupees(money.upi)} by UPI, already in the account)` : ''}. Count the cash, type it, and hand it over.
      </p>
      <div className="fest-form__row">
        <label className="adm-field">
          <span>Cash counted (₹)</span>
          <input value={counted} inputMode="numeric" autoComplete="off" placeholder={String(money.cash)} onChange={(event) => setCounted(event.target.value.replace(/[^\d]/g, ''))} />
        </label>
        <label className="adm-field">
          <span>Handed to, or a note (optional)</span>
          <input value={note} maxLength={200} autoComplete="off" onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {gap !== null && <p className={`fest-match ${gap === 0 ? 'is-good' : 'is-bad'}`}>{gap === 0 ? '✓ Matches the system.' : gap < 0 ? `Short by ${rupees(-gap)}.` : `Over by ${rupees(gap)}.`}</p>}
      <button className="adm-button adm-button--primary" type="button" disabled={busy || amount === null} onClick={() => void save()}>
        {busy ? 'Recording…' : 'Record the hand-over'}
      </button>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="adm-note" role="status">
          {done}
        </p>
      )}
      {history.length > 0 && (
        <ul className="adm-list">
          {history.map((item) => (
            <li key={item.at}>
              {when(item.at)}: {rupees(item.counted)} counted, system {rupees(item.system)} · {handOverGap(item)} · by {item.by}
              {item.note ? ` · ${item.note}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeskTotals({ dept }: { dept: string }) {
  const { registrations, session, catalog } = useFest();
  const mine = useMemo(() => [...registrations.values()].filter((item) => item.dept === dept && isActive(item)), [registrations, dept]);
  const me = session.username;
  let cash = 0;
  let upi = 0;
  let made = 0;
  let collected = 0;
  let verified = 0;
  for (const registration of mine) {
    if (registration.created.by === me) made += 1;
    const payment = registration.entry.payment;
    if (payment && payment.by === me && !payment.voided) {
      if (registration.entry.claim && payment.method === 'UPI') verified += 1;
      else collected += 1;
      if (payment.method === 'CASH') cash += payment.amount;
      else if (payment.method === 'UPI') upi += payment.amount;
    }
  }
  const recent = mine.filter((item) => item.entry.payment?.by === me || item.created.by === me).sort((a, b) => (b.entry.payment?.at ?? b.created.at).localeCompare(a.entry.payment?.at ?? a.created.at));
  return (
    <section className="adm-card adm-pad">
      <div className="fest-stats">
        <Stat label="Fees you collected" value={collected} />
        <Stat label="UTRs you verified" value={verified} />
        <Stat label="Registered for them" value={made} />
        <Stat label="Cash collected" value={rupees(cash)} />
        <Stat label="UPI collected" value={rupees(upi)} />
      </div>
      <HandOverCash dept={dept} />
      <h3 className="adm-h3">Yours</h3>
      <ShortList items={recent} empty="None yet." render={(registration) => <RegistrationCard key={registration.id} registration={registration} compact />} />
      {catalog && <p className="adm-muted">Entry fee {rupees(catalog.entryFee)} per student.</p>}
      <Badge tone="plain">{deptShort(dept)}</Badge>
    </section>
  );
}
