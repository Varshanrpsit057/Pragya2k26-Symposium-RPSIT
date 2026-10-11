/**
 * The registration desk (four laptops on the event day), built for coordinators trained in a
 * day: search first, then one big New registration button that opens the whole form in a
 * full-screen window (student, individual or team, events, ₹100 gate pass), saved as a draft
 * on every change, ending on a big Registration ID and "Register the next student". Paid by
 * GPay, the student pays from Student login on their own phone and uploads the screenshot,
 * which appears on the desk's screen to approve with the transaction ID. A student's record
 * opens in a pop-up too, where GPay payments are verified. Each event's ₹50 is paid at its
 * venue. The web assistant team sees the same list (without registering) as "Registrations".
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { GroupedId } from '../components/ui/GroupedId';
import { COLLEGES, OTHER_COLLEGE } from '../content/colleges';
import { events as allEvents } from '../content/events';
import type { AdminRegistration } from '../lib/admin';
import { formatIst, parseEventStart } from '../lib/countdown';
import { DEPARTMENTS, OTHER_DEPARTMENT, YEARS_OF_STUDY, idParts, newSubmissionId, normalisePhone, normaliseRegistrationId, rupees } from '../lib/registration';
import { hasPermission, type SessionInfo } from '../lib/staff';
import { STUDENT_PAGE } from '../lib/student';
import { ApiFailure, SignedOut, getRegistration, listRegistrations, registerOnsite } from './adminApi';
import { Dialog } from './Dialog';
import { PaymentCheck, RegistrationDialog, gatePassProof } from './RegistrationDialog';
import { ErrorNote, LiveStatus, StatusBadge, clockTime, existingRegistrationOf, messageOf, useLiveData } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

const MAX_SHOWN = 100;

type Filter = 'all' | 'verify' | 'desk' | 'mine';

/** The money this coordinator recorded: desk gate passes and event fees, cash and GPay. */
export function collectionsOf(registrations: readonly AdminRegistration[], username: string) {
  const totals = { cash: 0, upi: 0, count: 0 };
  const add = (method: string | null, amount: number) => {
    if (method === 'CASH') totals.cash += amount;
    else totals.upi += amount;
    totals.count += 1;
  };
  for (const item of registrations) {
    if (item.status === 'CANCELLED') continue;
    if (item.gatePass.status === 'VERIFIED' && item.gatePass.method !== 'ONLINE_UPI' && item.gatePass.verifiedBy === username) add(item.gatePass.method, item.gatePass.amount);
    for (const event of item.events) if (event.fee.status === 'PAID' && event.fee.verifiedBy === username) add(event.fee.method, event.fee.amount);
  }
  return totals;
}

export function DeskPanel({ token, session, onSignedOut }: PanelProps) {
  const load = useCallback(() => listRegistrations(token), [token]);
  const live = useLiveData(load, onSignedOut);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canRegister = hasPermission(session.role, 'registrations.onsite');
  const list = useMemo(() => live.data ?? [], [live.data]);

  const counts = useMemo(
    () => ({
      all: list.length,
      verify: list.filter((item) => item.status === 'PENDING').length,
      desk: list.filter((item) => item.source === 'ONSITE').length,
      mine: list.filter((item) => item.createdBy === session.username).length,
    }),
    [list, session.username],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // A Registration ID typed in parts (26 2 005) still finds it.
    const id = normaliseRegistrationId(query).toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return list
      .filter((item) => (filter === 'verify' ? item.status === 'PENDING' : filter === 'desk' ? item.source === 'ONSITE' : filter === 'mine' ? item.createdBy === session.username : true))
      .filter(
        (item) =>
          !needle ||
          [item.registrationId, item.participant.name, item.participant.email, item.participant.college].some((value) => value.toLowerCase().includes(needle)) ||
          item.registrationId.toLowerCase().includes(id) ||
          (digits.length >= 4 && item.participant.phone.includes(digits)),
      )
      .slice(0, MAX_SHOWN);
  }, [list, query, filter, session.username]);

  const mine = useMemo(() => collectionsOf(list, session.username), [list, session.username]);
  const selected = list.find((item) => item.registrationId === openId) ?? null;
  const replace = (updated: AdminRegistration) =>
    live.setData((current) => {
      const items = current ?? [];
      return items.some((item) => item.registrationId === updated.registrationId)
        ? items.map((item) => (item.registrationId === updated.registrationId ? updated : item))
        : [updated, ...items];
    });
  const removed = (registrationId: string) => {
    setOpenId(null);
    live.setData((current) => current?.filter((item) => item.registrationId !== registrationId) ?? null);
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'verify', label: 'GPay to verify' },
    { value: 'desk', label: 'Registered at the desk' },
    ...(canRegister ? [{ value: 'mine' as const, label: 'Registered by me' }] : []),
  ];

  return (
    <main className="adm-page">
      {canRegister && <DeskGuide />}
      <section className="adm-card adm-pad" aria-label="Find a registration">
        <div className="adm-desk-top">
          {canRegister && (
            <button className="adm-button adm-button--primary adm-button--huge" type="button" onClick={() => setCreating(true)}>
              + New registration
            </button>
          )}
          <input
            className="adm-search adm-search--big"
            type="search"
            placeholder="Search first: name, phone, ID, college"
            aria-label="Search registrations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        {canRegister && (
          <p className="adm-collections" aria-label="Money you have recorded">
            You have recorded <strong>{rupees(mine.cash)} cash</strong> and <strong>{rupees(mine.upi)} GPay</strong> ({mine.count} payment{mine.count === 1 ? '' : 's'}). Hand it over
            with this figure at the end of your shift.
          </p>
        )}
        <div className="adm-tabs" role="tablist" aria-label="Show">
          {FILTERS.map(({ value, label }) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} className="adm-tab" onClick={() => setFilter(value)}>
              {label} <span className="adm-tab__count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <ErrorNote error={live.error} />
        {live.data === null ? (
          <p className="adm-muted adm-empty">{live.loading ? 'Loading registrations…' : 'Registrations could not be loaded.'}</p>
        ) : shown.length === 0 ? (
          <p className="adm-muted adm-empty">{query ? 'No registration matches. If the student is new, press New registration.' : 'Nothing here yet.'}</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Registration ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Phone</th>
                  <th scope="col">College</th>
                  <th scope="col">Desk</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="adm-visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.registrationId} onClick={() => setOpenId(item.registrationId)}>
                    <td>
                      <button type="button" className="adm-link" onClick={() => setOpenId(item.registrationId)}>
                        {item.registrationId}
                      </button>
                    </td>
                    <td>{item.participant.name}</td>
                    <td className="adm-mono">{item.participant.phone}</td>
                    <td>{item.participant.college}</td>
                    <td>{item.deskNumber ? `Desk ${item.deskNumber}` : item.source === 'ONSITE' ? 'Desk' : <span className="adm-muted">Online</span>}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`adm-button adm-button--small${item.status === 'PENDING' && hasPermission(session.role, 'registrations.approve') ? ' adm-button--primary' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenId(item.registrationId);
                        }}
                      >
                        {item.status === 'PENDING' && hasPermission(session.role, 'registrations.approve') ? 'Verify GPay' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > shown.length && !query && filter === 'all' && <p className="adm-muted">Showing the latest {MAX_SHOWN}. Search to find others.</p>}
          </div>
        )}
      </section>

      {creating && (
        <NewRegistration
          token={token}
          session={session}
          registrations={list}
          onCreated={replace}
          onOpen={(registrationId) => {
            setCreating(false);
            setOpenId(registrationId);
          }}
          onClose={() => setCreating(false)}
          onSignedOut={onSignedOut}
        />
      )}
      {selected && (
        <RegistrationDialog
          key={selected.registrationId}
          registration={selected}
          token={token}
          session={session}
          onChange={replace}
          onDeleted={removed}
          onClose={() => setOpenId(null)}
          onSignedOut={onSignedOut}
        />
      )}
    </main>
  );
}

/** Five steps, always one click away, for coordinators trained in a day. */
function DeskGuide() {
  return (
    <details className="adm-card adm-guide">
      <summary>How to register a student (read this first)</summary>
      <ol>
        <li>
          <strong>Search first</strong> with the student's name or phone. If they registered online, open them instead of registering again (a{' '}
          <em>GPay to verify</em> student needs their payment checked: press <em>Verify GPay</em>).
        </li>
        <li>
          Press <strong>+ New registration</strong> and fill in the student. For a team, choose <em>Team</em> and type the team name: every member registers
          separately and pays for their own gate pass.
        </li>
        <li>
          <strong>Tick the events</strong> they want. Event fees (₹50 each) are paid at each venue, not here.
        </li>
        <li>
          <strong>₹100 gate pass.</strong> Cash: count it, tick the box and press <strong>Register and record ₹100</strong>. GPay: press{' '}
          <strong>Register student (GPay next)</strong>; the student signs in to <em>Student login</em> on their phone, checks their details, pays and uploads the
          screenshot. It appears on your screen: type the transaction ID from it and press <strong>Approve payment</strong>.
        </li>
        <li>
          Tell the student their <strong>Registration ID</strong> (big on the screen). They download their own pass on their phone with <em>Student login</em> (ID and phone). Then press <strong>Register the next student</strong>.
        </li>
      </ol>
      <p className="adm-muted">
        The form saves itself as you type: a reload or a closed window loses nothing. Something wrong? Press Contact admin at the top of the page.
      </p>
    </details>
  );
}

const EMPTY_FORM = { name: '', department: '', departmentOther: '', year: '', college: '', phone: '', email: '' };

type GatePassMethod = 'CASH' | 'UPI' | '';

/**
 * The form being filled in, kept in this browser on every change, so a reload, a closed window
 * or a crash loses nothing. Gone once the student is registered or the form is cleared. The
 * cash tick is never kept: it is ticked again with the money in hand.
 */
interface Draft {
  values: typeof EMPTY_FORM;
  participation: 'INDIVIDUAL' | 'TEAM';
  teamName: string;
  chosen: string[];
  method: GatePassMethod;
  /** Sending the same draft twice returns the first registration (never a second one). */
  submissionId: string;
  savedAt: number;
}

const draftKey = (username: string) => `pragya-desk-draft:${username}`;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function readDraft(username: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(username));
    const draft = raw ? (JSON.parse(raw) as Partial<Record<keyof Draft, unknown>>) : null;
    if (!draft || typeof draft.submissionId !== 'string' || typeof draft.values !== 'object' || draft.values === null) return null;
    const values = draft.values as Record<string, unknown>;
    return {
      values: Object.fromEntries(Object.keys(EMPTY_FORM).map((field) => [field, text(values[field])])) as typeof EMPTY_FORM,
      participation: draft.participation === 'TEAM' ? 'TEAM' : 'INDIVIDUAL',
      teamName: text(draft.teamName),
      chosen: Array.isArray(draft.chosen) ? draft.chosen.filter((id): id is string => typeof id === 'string') : [],
      method: draft.method === 'CASH' || draft.method === 'UPI' ? draft.method : '',
      submissionId: draft.submissionId,
      savedAt: typeof draft.savedAt === 'number' ? draft.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeDraft(username: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(username), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(username));
  } catch {
    // Storage blocked: the form still works, only without the draft.
  }
}

/** How the student enters an event: a team event takes the gate team, an individual one never does. */
const teamNote = (teams: { maxSize: number | null } | undefined, participation: 'INDIVIDUAL' | 'TEAM') =>
  !teams ? 'individual event' : participation === 'TEAM' ? `with the team${teams.maxSize ? ` (up to ${teams.maxSize})` : ''}` : 'individual';

/** The student page's address, to read out or show to the student. */
const studentLoginUrl = () => `${window.location.origin}${STUDENT_PAGE}`;

interface NewRegistrationProps {
  token: string;
  session: SessionInfo;
  /** Everyone registered so far (this laptop's live list), to spot a phone or email already used. */
  registrations: readonly AdminRegistration[];
  onCreated: (registration: AdminRegistration) => void;
  onOpen: (registrationId: string) => void;
  onClose: () => void;
  onSignedOut: () => void;
}

/** The whole registration in one full-screen window, ending on the new Registration ID. */
/**
 * The registration that already uses this phone number or email, if any: checked as the desk
 * types, against the live list (the server checks again when registering). Rejected and
 * cancelled registrations free theirs.
 */
export function holderOf(registrations: readonly AdminRegistration[], phone: string, email: string) {
  const active = registrations.filter((item) => item.status === 'PENDING' || item.status === 'APPROVED');
  const phoneKey = normalisePhone(phone);
  const emailKey = email.trim().toLowerCase();
  return {
    phone: /^\d{10}$/.test(phoneKey) ? (active.find((item) => item.participant.phone === phoneKey) ?? null) : null,
    email: emailKey.includes('@') ? (active.find((item) => item.participant.email.toLowerCase() === emailKey) ?? null) : null,
  };
}

/** "Already registered", under the field, with the way to that registration. */
function Taken({ holder, what, onOpen }: { holder: AdminRegistration; what: string; onOpen: (registrationId: string) => void }) {
  return (
    <small className="adm-field__error adm-taken" role="alert">
      This {what} is already registered: <strong>{holder.registrationId}</strong> · {holder.participant.name}.{' '}
      <button type="button" className="adm-link" onClick={() => onOpen(holder.registrationId)}>
        Open {holder.registrationId}
      </button>
    </small>
  );
}

function NewRegistration({ token, session, registrations, onCreated, onOpen, onClose, onSignedOut }: NewRegistrationProps) {
  const [restored] = useState(() => readDraft(session.username));
  const [values, setValues] = useState(restored?.values ?? EMPTY_FORM);
  const [participation, setParticipation] = useState<'INDIVIDUAL' | 'TEAM'>(restored?.participation ?? 'INDIVIDUAL');
  const [teamName, setTeamName] = useState(restored?.teamName ?? '');
  const [chosen, setChosen] = useState<string[]>(restored?.chosen ?? []);
  const [method, setMethod] = useState<GatePassMethod>(restored?.method ?? '');
  const [cashReceived, setCashReceived] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => restored?.submissionId ?? newSubmissionId());
  const [showRestored, setShowRestored] = useState(restored !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<AdminRegistration | null>(null);
  const fees = session.fees;
  const enabled = session.phase === 'onsite';
  const dirty = !done && (Object.values(values).some((value) => value.trim()) || chosen.length > 0 || method !== '' || teamName.trim() !== '');

  // Every change is saved as a draft at once.
  useEffect(() => {
    if (done) return;
    writeDraft(session.username, dirty ? { values, participation, teamName, chosen, method, submissionId, savedAt: Date.now() } : null);
  }, [session.username, done, dirty, values, participation, teamName, chosen, method, submissionId]);

  const set = (field: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const reset = () => {
    setValues(EMPTY_FORM);
    setParticipation('INDIVIDUAL');
    setTeamName('');
    setChosen([]);
    setMethod('');
    setCashReceived(false);
    setSubmissionId(newSubmissionId());
    setShowRestored(false);
    setError(null);
    setDone(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { registration } = await registerOnsite(token, {
        submissionId,
        participant: {
          name: values.name,
          department: values.department === OTHER_DEPARTMENT ? values.departmentOther : values.department,
          college: values.college,
          year: values.year,
          phone: values.phone,
          email: values.email,
        },
        participation,
        ...(participation === 'TEAM' && { teamName }),
        events: allEvents.filter((item) => chosen.includes(item.id)).map((item) => item.id),
        payment: method === 'UPI' ? { method: 'UPI', studentPays: true } : { method: 'CASH', confirmedReceived: cashReceived },
      });
      writeDraft(session.username, null);
      onCreated(registration);
      setDone(registration);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const existing = existingRegistrationOf(error);
  const fieldErrors = error instanceof ApiFailure ? error.fieldErrors : {};
  const opens = session.schedule.onsiteOpensAt ? parseEventStart(session.schedule.onsiteOpensAt) : null;
  const paid = method === 'UPI' || (method === 'CASH' && cashReceived);
  const taken = holderOf(registrations, values.phone, values.email);
  const ready = enabled && !busy && (participation === 'INDIVIDUAL' || teamName.trim().length >= 2) && paid && !taken.phone && !taken.email;

  if (done) {
    const changed = (latest: AdminRegistration) => {
      onCreated(latest);
      setDone(latest);
    };
    return (
      <Dialog title={done.status === 'PENDING' ? 'Registered: GPay payment next' : done.status === 'APPROVED' ? 'Registered' : 'Not registered'} onClose={onClose} size="full">
        {done.status === 'APPROVED' ? (
          <Success registration={done} passByEmail={session.passByEmail} onNext={reset} onClose={onClose} />
        ) : (
          <AwaitingPayment registration={done} token={token} onChange={changed} onNext={reset} onClose={onClose} onSignedOut={onSignedOut} />
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="New registration"
      subtitle={`The student gets an ID (20…) and a pass${session.passByEmail ? ' by email' : ' to download from the website (Student login)'}. Events chosen here show up in each coordinator's list; each event's ${rupees(fees.perEvent)} is paid at its venue.`}
      onClose={onClose}
      size="full"
      footer={
        <div className="adm-new__foot">
          <p className="adm-new__summary">
            Gate pass <strong>{rupees(fees.gatePass)}</strong> {method === 'CASH' ? '(cash)' : method === 'UPI' ? '(GPay by the student, from Student login)' : ''}
            {chosen.length > 0 && (
              <>
                {' '}
                · {chosen.length} event{chosen.length === 1 ? '' : 's'}: {rupees(chosen.length * fees.perEvent)} to pay at the venues
              </>
            )}
            {dirty && <span className="adm-muted adm-new__saved"> · Draft saved</span>}
            {(taken.phone ?? taken.email) && <span className="adm-field__error"> · Already registered as {(taken.phone ?? taken.email)!.registrationId}</span>}
          </p>
          <button className="adm-button" type="button" onClick={reset} disabled={busy}>
            Clear
          </button>
          <button className="adm-button adm-button--approve adm-button--huge" type="submit" form="desk-new" disabled={!ready}>
            {busy ? 'Registering…' : method === 'UPI' ? 'Register student (GPay next)' : `Register and record ${rupees(fees.gatePass)}`}
          </button>
        </div>
      }
    >
      {!enabled && (
        <p className="adm-note">
          {session.phase === 'closed' ? 'Registration has closed for the day.' : `The desk opens ${opens ? `on ${formatIst(opens)}` : 'on the event day'}.`}
        </p>
      )}
      {showRestored && restored && (
        <p className="adm-note adm-draft" role="status">
          Restored the form you were filling in (saved {clockTime(restored.savedAt)}).{' '}
          <button type="button" className="adm-link" onClick={reset}>
            Start a new one instead
          </button>
        </p>
      )}
      <form id="desk-new" className="adm-new" onSubmit={submit} aria-label="New on-site registration">
        <fieldset className="adm-new__card" disabled={!enabled || busy}>
          <legend className="adm-new__step">
            <span>1</span> Student
          </legend>
          <div className="adm-form">
            <label className="adm-field adm-form__wide">
              <span>Name with initial</span>
              <input value={values.name} onChange={set('name')} required autoComplete="off" autoFocus />
              {fieldErrors.name && <small className="adm-field__error">{fieldErrors.name}</small>}
            </label>
            <label className="adm-field">
              <span>Department</span>
              <select value={values.department} onChange={set('department')} required>
                <option value="" disabled>
                  Choose
                </option>
                {DEPARTMENTS.map((department) => (
                  <option key={department}>{department}</option>
                ))}
              </select>
              {fieldErrors.department && <small className="adm-field__error">{fieldErrors.department}</small>}
            </label>
            {values.department === OTHER_DEPARTMENT && (
              <label className="adm-field">
                <span>Department (typed)</span>
                <input value={values.departmentOther} onChange={set('departmentOther')} required />
              </label>
            )}
            <label className="adm-field">
              <span>Year</span>
              <select value={values.year} onChange={set('year')} required>
                <option value="" disabled>
                  Choose
                </option>
                {YEARS_OF_STUDY.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </label>
            <label className="adm-field adm-form__wide">
              <span>College (type the first letters, then pick)</span>
              <input value={values.college} onChange={set('college')} required list="desk-colleges" autoComplete="off" placeholder="e.g. Sona, KSR, Kongu" />
              <datalist id="desk-colleges">
                {COLLEGES.filter((college) => college !== OTHER_COLLEGE).map((college) => (
                  <option key={college} value={college} />
                ))}
              </datalist>
              {fieldErrors.college && <small className="adm-field__error">{fieldErrors.college}</small>}
            </label>
            <label className="adm-field">
              <span>Phone (the student signs in with it)</span>
              <input value={values.phone} onChange={set('phone')} required inputMode="tel" autoComplete="off" aria-invalid={taken.phone !== null} />
              {taken.phone ? (
                <Taken holder={taken.phone} what="phone number" onOpen={onOpen} />
              ) : (
                fieldErrors.phone && <small className="adm-field__error">{fieldErrors.phone}</small>
              )}
            </label>
            <label className="adm-field">
              <span>Email</span>
              <input value={values.email} onChange={set('email')} required type="email" autoComplete="off" aria-invalid={taken.email !== null} />
              {taken.email ? (
                <Taken holder={taken.email} what="email" onOpen={onOpen} />
              ) : (
                fieldErrors.email && <small className="adm-field__error">{fieldErrors.email}</small>
              )}
            </label>
          </div>
        </fieldset>

        <div className="adm-new__side">
          <fieldset className="adm-new__card" disabled={!enabled || busy}>
            <legend className="adm-new__step">
              <span>2</span> Individual or team
            </legend>
            <div className="adm-events">
              {(['INDIVIDUAL', 'TEAM'] as const).map((mode) => (
                <label key={mode} className="adm-radio adm-radio--big">
                  <input type="radio" name="desk-participation" checked={participation === mode} onChange={() => setParticipation(mode)} />
                  <span>{mode === 'TEAM' ? 'Team' : 'Individual'}</span>
                </label>
              ))}
              {participation === 'TEAM' && (
                <label className="adm-field adm-events__team">
                  <span>Team name</span>
                  <input value={teamName} onChange={(event) => setTeamName(event.target.value)} required maxLength={40} autoComplete="off" />
                </label>
              )}
              <small className="adm-muted adm-events__note">
                Each team member registers here and pays {rupees(fees.gatePass)} for their own gate pass, and {rupees(fees.perEvent)} per event at the venue.
              </small>
            </div>
          </fieldset>

          <fieldset className="adm-new__card" disabled={!enabled || busy}>
            <legend className="adm-new__step">
              <span>3</span> Events
            </legend>
            <div className="adm-events adm-events--list">
              {allEvents.map((item) => (
                <label key={item.id} className="adm-check adm-check--big">
                  <input
                    type="checkbox"
                    checked={chosen.includes(item.id)}
                    onChange={() => setChosen((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small className="adm-muted">
                      {' '}
                      · {[item.schedule, item.venue].filter(Boolean).join(' · ')} · {teamNote(item.teams, participation)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="adm-new__card" disabled={!enabled || busy}>
            <legend className="adm-new__step">
              <span>4</span> Gate pass {rupees(fees.gatePass)}
            </legend>
            <div className="adm-events">
              {(['CASH', 'UPI'] as const).map((choice) => (
                <label key={choice} className="adm-radio adm-radio--big">
                  <input
                    type="radio"
                    name="gate-pass-method"
                    checked={method === choice}
                    onChange={() => {
                      setMethod(choice);
                      setCashReceived(false);
                    }}
                  />
                  <span>{choice === 'CASH' ? 'Cash' : 'GPay / UPI'}</span>
                </label>
              ))}
            </div>
            {method === 'CASH' && (
              <label className="adm-check adm-check--big adm-pay__confirm">
                <input type="checkbox" checked={cashReceived} onChange={(event) => setCashReceived(event.target.checked)} />
                <span>I have received {rupees(fees.gatePass)} in cash.</span>
              </label>
            )}
            {method === 'UPI' && (
              <ol className="adm-gpay-steps" aria-label="How a GPay payment works">
                <li>
                  Press <strong>Register student (GPay next)</strong>.
                </li>
                <li>
                  The student opens <strong>Student login</strong> on their phone (<span className="adm-mono">{studentLoginUrl()}</span>) and signs in with their Registration ID and
                  this phone number.
                </li>
                <li>They check their details, pay {rupees(fees.gatePass)} by GPay (the QR is on their screen) and upload the screenshot.</li>
                <li>
                  The screenshot appears on your screen: type the transaction ID from it and press <strong>Approve payment</strong>.
                </li>
              </ol>
            )}
            {fieldErrors.transactionId && <small className="adm-field__error">{fieldErrors.transactionId}</small>}
          </fieldset>
        </div>
      </form>

      {error !== null && (
        <div className="adm-error adm-new__error" role="alert">
          <p>{messageOf(error)}</p>
          {existing && (
            <button type="button" className="adm-button" onClick={() => onOpen(existing)}>
              Open {existing}
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** How often the waiting screen asks whether the student's screenshot has arrived. */
const AWAIT_POLL_MS = 5_000;

interface AwaitingPaymentProps {
  /** The registration as last seen (kept by the form, which shows the success screen once approved). */
  registration: AdminRegistration;
  token: string;
  /** The record changed: screenshot in, approved (here or on another laptop), rejected. */
  onChange: (registration: AdminRegistration) => void;
  onNext: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}

/**
 * After registering a student who pays by GPay: their Registration ID and how to pay from
 * Student login, then their screenshot as soon as it arrives (checked every few seconds),
 * big, to approve right here with the transaction ID. The form then shows the usual success screen.
 */
function AwaitingPayment({ registration: current, token, onChange, onNext, onClose, onSignedOut }: AwaitingPaymentProps) {
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const id = current.registrationId;
  const waiting = current.status === 'PENDING';
  const proofs = current.proofs.length;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      getRegistration(token, id).then(
        (latest) => {
          setCheckedAt(Date.now());
          if (latest.status !== 'PENDING' || latest.proofs.length !== proofs) onChange(latest);
        },
        (failure: unknown) => {
          if (failure instanceof SignedOut) onSignedOut();
        },
      );
    }, AWAIT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, token, id, proofs, onChange, onSignedOut]);

  if (current.status !== 'PENDING') {
    return (
      <div className="adm-success" role="status">
        <p className="adm-error">
          {id} was {current.status === 'REJECTED' ? `rejected${current.rejectionReason ? `: ${current.rejectionReason}` : ''}` : 'cancelled'}. Register the student again if they pay now.
        </p>
        <div className="adm-actions__row adm-success__actions">
          <button className="adm-button adm-button--approve adm-button--huge" type="button" onClick={onNext} autoFocus>
            Register the next student
          </button>
          <button className="adm-button adm-button--big" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const proof = gatePassProof(current);
  return (
    <div className="adm-await">
      <div className="adm-await__top">
        <div className="adm-await__id">
          <p className="adm-muted">Tell the student their Registration ID:</p>
          <p className="adm-success__id">
            <GroupedId id={id} />
          </p>
          {idParts(id).meaning && <p className="adm-muted">{idParts(id).meaning}</p>}
          <p className="adm-success__name">
            {current.participant.name} · {current.participant.college}
          </p>
        </div>
        <ol className="adm-gpay-steps adm-await__steps" aria-label="What the student does">
          <li>
            On their phone, open <strong className="adm-mono">{studentLoginUrl()}</strong> (Student login on the website).
          </li>
          <li>
            Sign in with Registration ID <strong>{id}</strong> and phone <strong>{current.participant.phone}</strong>.
          </li>
          <li>Check the details, pay {rupees(current.payment.amount)} by GPay and upload the screenshot.</li>
        </ol>
      </div>
      <p className="adm-muted adm-await__checked" aria-live="polite">
        {proof ? 'Screenshot received: check it and approve.' : `Checked ${clockTime(checkedAt)}; checks again every few seconds.`}
      </p>
      <PaymentCheck
        key={proof?.id ?? 'none'}
        registrationId={id}
        amount={current.payment.amount}
        transactionId={null}
        hasScreenshot={false}
        desk={{ proofId: proof?.id ?? null, studentTransactionId: proof?.transactionId ?? null }}
        token={token}
        onDone={onChange}
        onSignedOut={onSignedOut}
      />
      <div className="adm-actions__row adm-success__actions">
        <button className="adm-button adm-button--big" type="button" onClick={onNext}>
          Register the next student (approve this one later)
        </button>
        <button className="adm-button adm-button--big" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="adm-muted">Not paid yet? It stays in the list under GPay to verify: open it there when the screenshot comes.</p>
    </div>
  );
}

/**
 * The new Registration ID, big enough to read out, and the next step. The pass is the
 * student's: they download it themselves with Student login, never from the dashboard.
 */
interface SuccessProps {
  registration: AdminRegistration;
  passByEmail: boolean;
  onNext: () => void;
  onClose: () => void;
}

function Success({ registration, passByEmail, onNext, onClose }: SuccessProps) {
  return (
    <div className="adm-success" role="status">
      <p className="adm-success__tick" aria-hidden="true">
        ✓
      </p>
      <p className="adm-muted">Tell the student their Registration ID:</p>
      <p className="adm-success__id">
        <GroupedId id={registration.registrationId} />
      </p>
      {idParts(registration.registrationId).meaning && <p className="adm-muted">{idParts(registration.registrationId).meaning}</p>}
      <p className="adm-success__name">
        {registration.participant.name} · {registration.participant.college}
        {registration.teamName && ` · Team ${registration.teamName}`}
      </p>
      <p>
        {registration.technicalEvents.length
          ? `Events: ${registration.technicalEvents.join(', ')} (${rupees(registration.payableAtVenue)} to pay at the venues).`
          : 'No events yet: they register at each venue.'}
      </p>
      <p className="adm-muted">
        {passByEmail
          ? registration.emailStatus === 'SENT'
            ? `The pass was emailed to ${registration.participant.email}.`
            : 'The pass and email are on their way.'
          : 'The student downloads their pass on their own phone: Student login on the website, with the Registration ID and phone number.'}
      </p>
      <div className="adm-actions__row adm-success__actions">
        <button className="adm-button adm-button--approve adm-button--huge" type="button" onClick={onNext} autoFocus>
          Register the next student
        </button>
        <button className="adm-button adm-button--big" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
