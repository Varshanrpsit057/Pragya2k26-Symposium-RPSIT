/**
 * The event coordinators' screen (admins see every event): participants, the ₹50 event fee,
 * attendance, winners and the results submitted for certificates.
 *
 * At the venue: the coordinator types the Registration ID from the participant's gate pass,
 * chooses individual or team (team events), and records the ₹50 fee in the same step. A fee
 * the student paid by GPay from Student login comes with its screenshot: the coordinator
 * checks it, types the transaction ID and approves it, marking them present in the same press.
 */
import { useCallback, useState, type FormEvent } from 'react';
import { events as allEvents } from '../content/events';
import { PLACES, PLACE_LABELS, type EventParticipant, type EventResultView, type Place, type Winners } from '../lib/admin';
import { normaliseRegistrationId, rupees } from '../lib/registration';
import { XLSX_TYPE } from '../lib/xlsx';
import { hasPermission, type SessionInfo } from '../lib/staff';
import {
  SignedOut,
  enroll,
  eventRoster,
  listEvents,
  lookupParticipant,
  markAttendance,
  recordFee,
  reopenResults,
  saveWinners,
  submitResults,
  voidFee,
  type ParticipantLookup,
} from './adminApi';
import { Dialog } from './Dialog';
import { FeeScreenshotCheck } from './FeeScreenshotCheck';
import { PaymentRecord } from './PaymentRecord';
import { eventWorkbook } from './workbooks';
import { PaymentCheck } from './RegistrationDialog';
import { Badge, EMPTY_PAYMENT, ErrorNote, FeeBadge, LiveStatus, PaymentFields, paymentReady, saveFile, toReceivedPayment, useLiveData, when, type PaymentDraft } from './ui';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

export function EventsPanel({ token, session, onSignedOut }: PanelProps) {
  const loadEvents = useCallback(() => listEvents(token), [token]);
  const events = useLiveData(loadEvents, onSignedOut, 60_000);
  const [chosen, setChosen] = useState<string | null>(null);
  const eventId = chosen ?? events.data?.[0]?.eventId ?? null;

  if (!events.data) return <main className="adm-page">{events.error ? <ErrorNote error={events.error} /> : <p className="adm-loading">Loading events…</p>}</main>;
  if (!events.data.length) return <main className="adm-page"><p className="adm-note">No events are assigned to your account. Ask an admin.</p></main>;

  return (
    <main className="adm-page">
      <div className="adm-tabs" role="tablist" aria-label="Events">
        {events.data.map((event) => (
          <button key={event.eventId} type="button" role="tab" className="adm-tab" aria-selected={event.eventId === eventId} onClick={() => setChosen(event.eventId)}>
            {event.name} <span className="adm-tab__count">{event.present}/{event.enrolled}</span>
          </button>
        ))}
      </div>
      {eventId && <EventWorkspace key={eventId} eventId={eventId} token={token} session={session} onSignedOut={onSignedOut} onChanged={events.refresh} />}
    </main>
  );
}

function EventWorkspace({ eventId, token, session, onSignedOut, onChanged }: PanelProps & { eventId: string; onChanged: () => void }) {
  const load = useCallback(() => eventRoster(token, eventId), [token, eventId]);
  const live = useLiveData(load, onSignedOut);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const roster = live.data;
  const isAdmin = hasPermission(session.role, 'events.correct');

  /** Runs an action, then shows its result in the list at once. */
  const run = async (name: string, task: () => Promise<EventParticipant | EventResultView | void>) => {
    setBusy(name);
    setError(null);
    try {
      const result = await task();
      if (result && 'registrationId' in result) {
        live.setData((current) => {
          if (!current) return current;
          const exists = current.participants.some((item) => item.registrationId === result.registrationId);
          return {
            ...current,
            participants: exists ? current.participants.map((item) => (item.registrationId === result.registrationId ? result : item)) : [...current.participants, result],
          };
        });
      } else if (result) {
        live.setData((current) => (current ? { ...current, result, canOperate: current.canOperate && result.status !== 'SUBMITTED' } : current));
      }
      live.refresh();
      // The event tabs' present/registered counts.
      onChanged();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };

  if (!roster) return live.error ? <ErrorNote error={live.error} /> : <p className="adm-loading">Loading participants…</p>;
  const { result, participants, canOperate } = roster;
  const present = participants.filter((item) => item.attendance?.present);
  const teamEvent = Boolean(allEvents.find((event) => event.id === eventId)?.teams);
  const toCheck = participants.filter((item) => item.feeProof).length;
  // GPay screenshots to check first; team members next to each other, then individuals, each by Registration ID.
  const ordered = [...participants].sort(
    (a, b) =>
      Number(Boolean(b.feeProof)) - Number(Boolean(a.feeProof)) ||
      (teamEvent ? (a.team ?? '\uffff').localeCompare(b.team ?? '\uffff') : 0) ||
      a.registrationId.localeCompare(b.registrationId),
  );

  return (
    <div className="adm-workspace">
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">{roster.event.name}</h2>
          <ResultBadge result={result} />
          <button
            className="adm-button"
            type="button"
            onClick={() => {
              const file = eventWorkbook(roster, session.displayName, Date.now());
              saveFile(file.name, file.bytes, XLSX_TYPE);
            }}
          >
            Download (Excel)
          </button>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        {!session.eventDayStarted && <p className="adm-note">Event fees, attendance and winners open on the event day.</p>}
        {result.status === 'SUBMITTED' && (
          <p className="adm-note">
            Submitted for certificates {when(result.submission?.submittedAt)} by {result.submission?.submittedBy}. The event is locked
            {isAdmin ? '.' : '; ask an admin to authorise any correction.'}
          </p>
        )}
        {result.reopened && (
          <p className="adm-note">
            Reopened for correction by {result.reopened.by} {when(result.reopened.at)}: {result.reopened.reason}. Submit again when done.
          </p>
        )}
        <ErrorNote error={error} />
        {canOperate && (
          <Lookup eventId={eventId} eventName={roster.event.name} token={token} busy={busy} run={run} participants={participants} onSignedOut={onSignedOut} />
        )}
      </section>

      <section className="adm-card adm-pad">
        <h3 className="adm-h3">
          Participants ({participants.length}) · fee paid {participants.filter((item) => item.fee.status === 'PAID').length} · present {present.length}
          {toCheck > 0 && (
            <>
              {' '}
              · <span className="adm-warn-text">{toCheck} GPay screenshot{toCheck === 1 ? '' : 's'} to check</span>
            </>
          )}
        </h3>
        {participants.length === 0 ? (
          <p className="adm-muted">No one is registered for this event yet.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--static">
              <thead>
                <tr>
                  <th scope="col">Registration ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">College</th>
                  {teamEvent && <th scope="col">Team</th>}
                  <th scope="col">Gate pass</th>
                  <th scope="col">Event fee</th>
                  <th scope="col">Attendance</th>
                  {canOperate && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {ordered.map((item) => (
                  <ParticipantRow
                    key={item.registrationId}
                    item={item}
                    eventId={eventId}
                    eventName={roster.event.name}
                    token={token}
                    onSignedOut={onSignedOut}
                    teamEvent={teamEvent}
                    canOperate={canOperate}
                    isAdmin={isAdmin}
                    busy={busy}
                    run={run}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <WinnersEditor eventId={eventId} token={token} result={result} present={present} canOperate={canOperate} isAdmin={isAdmin} busy={busy} run={run} />
    </div>
  );
}

function ResultBadge({ result }: { result: EventResultView }) {
  if (result.status === 'SUBMITTED') return <Badge tone="good">Results submitted</Badge>;
  if (result.status === 'REOPENED') return <Badge tone="warn">Reopened for correction</Badge>;
  return <Badge tone="plain">Results not submitted</Badge>;
}

type Run = (name: string, task: () => Promise<EventParticipant | EventResultView | void>) => Promise<void>;

interface RowProps {
  item: EventParticipant;
  eventId: string;
  eventName: string;
  token: string;
  onSignedOut: () => void;
  teamEvent: boolean;
  canOperate: boolean;
  isAdmin: boolean;
  busy: string | null;
  run: Run;
}

function ParticipantRow({ item, eventId, eventName, token, onSignedOut, teamEvent, canOperate, isAdmin, busy, run }: RowProps) {
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState(false);
  const feeRecord = item.feePayment;
  const [payment, setPayment] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const id = item.registrationId;
  const present = item.attendance?.present === true;

  return (
    <>
      <tr>
        <td className="adm-mono">{id}</td>
        <td>
          {item.name}
          {item.phone && <div className="adm-muted adm-mono">{item.phone}</div>}
        </td>
        <td>{item.college}</td>
        {teamEvent && <td>{item.team ?? <span className="adm-muted">Individual</span>}</td>}
        <td>{item.gatePassVerified ? <Badge tone="good">Verified</Badge> : <Badge tone="bad">Not verified</Badge>}</td>
        <td>
          <FeeBadge fee={item.fee} />
          {item.feeProof && (
            <div>
              <Badge tone="warn">GPay screenshot to check</Badge>
            </div>
          )}
          {item.fee.verifiedBy && <div className="adm-muted">{item.fee.verifiedBy} · {when(item.fee.verifiedAt)}</div>}
          {feeRecord?.approvedTransactionId && <div className="adm-muted adm-mono">Txn {feeRecord.approvedTransactionId}</div>}
          {feeRecord && (feeRecord.screenshot || feeRecord.approvedTransactionId) && (
            <button type="button" className="adm-link" onClick={() => setDetails(true)}>
              Payment details
            </button>
          )}
        </td>
        <td>
          {present ? <Badge tone="good">Present</Badge> : <Badge tone="plain">—</Badge>}
          {item.attendance && <div className="adm-muted">{item.attendance.markedBy} · {when(item.attendance.markedAt)}</div>}
        </td>
        {canOperate && (
          <td>
            <div className="adm-inline adm-inline--wrap">
              {!item.gatePassVerified ? (
                <span className="adm-muted">Send to the desk</span>
              ) : item.fee.status !== 'PAID' ? (
                <>
                  {item.feeProof && (
                    <button className="adm-button adm-button--small adm-button--primary" type="button" disabled={busy !== null} onClick={() => setChecking(true)}>
                      Check GPay screenshot
                    </button>
                  )}
                  <button className={`adm-button adm-button--small${item.feeProof ? '' : ' adm-button--primary'}`} type="button" disabled={busy !== null} onClick={() => setPaying(!paying)}>
                    {paying ? 'Cancel' : item.feeProof ? 'Record cash instead' : 'Record fee'}
                  </button>
                </>
              ) : present ? (
                <button className="adm-button adm-button--small" type="button" disabled={busy !== null} onClick={() => void run(`absent-${id}`, () => markAttendance(token, eventId, id, false))}>
                  Undo present
                </button>
              ) : (
                <>
                  <button className="adm-button adm-button--small adm-button--approve" type="button" disabled={busy !== null} onClick={() => void run(`present-${id}`, () => markAttendance(token, eventId, id, true))}>
                    {busy === `present-${id}` ? 'Marking…' : 'Mark present'}
                  </button>
                  {isAdmin && (
                    <button
                      className="adm-button adm-button--small adm-button--danger-outline"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        const reason = window.prompt(`Void the ${rupees(item.fee.amount)} fee of ${id}? Give the reason:`);
                        if (reason?.trim()) void run(`void-${id}`, () => voidFee(token, eventId, id, reason.trim()));
                      }}
                    >
                      Void fee
                    </button>
                  )}
                </>
              )}
            </div>
          </td>
        )}
      </tr>
      {details && feeRecord && (
        <Dialog title={`${eventName} fee · ${id} · ${item.name}`} subtitle="The screenshot and transaction ID from the student, and what was entered when approving." onClose={() => setDetails(false)}>
          <PaymentRecord record={feeRecord} registrationId={id} token={token} onSignedOut={onSignedOut} showScreenshot />
        </Dialog>
      )}
      {checking && item.feeProof && (
        <FeeScreenshotCheck
          eventId={eventId}
          eventName={eventName}
          registrationId={id}
          name={item.name}
          amount={item.fee.amount}
          proof={item.feeProof}
          token={token}
          onDone={(participant) => {
            setChecking(false);
            void run(`shot-${id}`, async () => participant);
          }}
          onClose={() => setChecking(false)}
          onSignedOut={onSignedOut}
        />
      )}
      {paying && canOperate && item.fee.status !== 'PAID' && (
        <tr className="adm-table__expand">
          <td colSpan={teamEvent ? 8 : 7}>
            <form
              className="adm-inline adm-inline--wrap"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void run(`fee-${id}`, async () => {
                  const updated = await recordFee(token, eventId, id, toReceivedPayment(payment));
                  setPaying(false);
                  setPayment(EMPTY_PAYMENT);
                  return updated;
                });
              }}
            >
              <PaymentFields amount={item.fee.amount} value={payment} onChange={setPayment} name={`fee-${id}`} />
              <button className="adm-button adm-button--approve" type="submit" disabled={busy !== null || !paymentReady(payment)}>
                {busy === `fee-${id}` ? 'Saving…' : `Record ${rupees(item.fee.amount)} for ${id}`}
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * At the venue: find the participant by the Registration ID on their gate pass, then enter
 * them in this event (individual or team) and take the ₹50 fee in the same step.
 */
interface LookupProps {
  eventId: string;
  eventName: string;
  token: string;
  busy: string | null;
  run: Run;
  participants: EventParticipant[];
  onSignedOut: () => void;
}

function Lookup({ eventId, eventName, token, busy, run, participants, onSignedOut }: LookupProps) {
  const event = allEvents.find((item) => item.id === eventId);
  const maxTeam = event?.teams?.maxSize ?? null;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ParticipantLookup | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'INDIVIDUAL' | 'TEAM'>('INDIVIDUAL');
  const [team, setTeam] = useState('');
  const [payment, setPayment] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [checking, setChecking] = useState(false);

  const clear = () => {
    setFound(null);
    setQuery('');
    setMode('INDIVIDUAL');
    setTeam('');
    setPayment(EMPTY_PAYMENT);
  };

  const search = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    await find(normaliseRegistrationId(query));
  };

  const find = async (registrationId: string) => {
    setError(null);
    setFound(null);
    setPayment(EMPTY_PAYMENT);
    try {
      const result = await lookupParticipant(token, registrationId);
      const here = result.events.find((item) => item.eventId === eventId);
      // The team they already entered with here, or the one they gave at the gate.
      const known = here?.team ?? (event?.teams ? result.teamName : null);
      setMode(known ? 'TEAM' : 'INDIVIDUAL');
      setTeam(known ?? '');
      setFound(result);
    } catch (failure) {
      setError(failure);
    }
  };

  const here = found?.events.find((item) => item.eventId === eventId);
  const enrolled = Boolean(here?.enrolled || (found && participants.some((item) => item.registrationId === found.registrationId)));
  const paid = here?.fee.status === 'PAID';
  const fee = here?.fee.amount ?? 0;
  const teamValue = event?.teams ? (mode === 'TEAM' ? team.trim() : null) : undefined;
  const teamReady = mode === 'INDIVIDUAL' || team.trim().length >= 2;
  const teamChanged = event?.teams && (here?.team ?? null) !== (teamValue ?? null);

  const enter = (withPayment: boolean) =>
    run('enroll', async () => {
      const participant = await enroll(token, eventId, found!.registrationId, {
        ...(teamValue !== undefined && { team: teamValue }),
        ...(withPayment && { payment: toReceivedPayment(payment) }),
      });
      clear();
      return participant;
    });

  return (
    <div className="adm-lookup">
      <form className="adm-inline" onSubmit={search}>
        <input
          className="adm-search"
          placeholder="Registration ID from the gate pass, e.g. 262007"
          inputMode="numeric"
          aria-label="Find by Registration ID"
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
        />
        <button className="adm-button" type="submit" disabled={!query.trim()}>
          Find
        </button>
      </form>
      <ErrorNote error={error} />
      {found && (
        <div className="adm-lookup__card">
          <p>
            <strong>{found.registrationId}</strong> · {found.name} · {found.college} ·{' '}
            {found.gatePassVerified ? <Badge tone="good">Gate pass verified</Badge> : <Badge tone="bad">Gate pass {found.status === 'REJECTED' ? 'rejected' : found.status === 'CANCELLED' ? 'cancelled' : 'not verified'}</Badge>}
            {found.teamName && <> · <Badge tone="plain">Gate team · {found.teamName}</Badge></>}
          </p>

          {found.status === 'REJECTED' || found.status === 'CANCELLED' ? (
            <p className="adm-muted">{found.status === 'REJECTED' ? 'Rejected' : 'Cancelled'} registrations cannot take part. Send them to the registration desk.</p>
          ) : !found.gatePassVerified ? (
            found.status === 'PENDING' && (found.payment.hasScreenshot || found.payment.proofId) ? (
              <>
                <p className="adm-note">
                  {found.source === 'ONSITE'
                    ? `They registered at the desk and paid the ₹100 gate pass by GPay from Student login, but nobody has checked it yet. Check their screenshot, type the transaction ID and approve it here, then enter them in ${eventName}.`
                    : `They paid the ₹100 gate pass online by GPay, but nobody has checked it yet. Check their screenshot and approve it here, then enter them in ${eventName}.`}
                </p>
                <PaymentCheck
                  key={found.payment.proofId ?? 'online'}
                  registrationId={found.registrationId}
                  amount={found.payment.amount}
                  transactionId={found.payment.transactionId}
                  hasScreenshot={found.payment.hasScreenshot}
                  desk={found.source === 'ONSITE' ? { proofId: found.payment.proofId, studentTransactionId: null } : undefined}
                  token={token}
                  onDone={() => void find(found.registrationId)}
                  onSignedOut={onSignedOut}
                />
              </>
            ) : (
              <p className="adm-muted">Their ₹100 gate pass is not verified yet. Send them to the registration desk first.</p>
            )
          ) : (
            <>
              {event?.teams && (
                <fieldset className="adm-events">
                  <legend>Participating in {eventName} as</legend>
                  {(['INDIVIDUAL', 'TEAM'] as const).map((option) => (
                    <label key={option} className="adm-radio">
                      <input type="radio" name="venue-participation" checked={mode === option} onChange={() => setMode(option)} />
                      <span>{option === 'TEAM' ? 'Team' : 'Individual'}</span>
                    </label>
                  ))}
                  {mode === 'TEAM' && (
                    <label className="adm-field adm-events__team">
                      <span>Team name{maxTeam ? ` (up to ${maxTeam} members)` : ''}</span>
                      <input value={team} onChange={(changeEvent) => setTeam(changeEvent.target.value)} maxLength={40} autoComplete="off" />
                    </label>
                  )}
                  <small className="adm-muted adm-events__note">Each team member pays {rupees(fee)} separately: find each one by their own ID.</small>
                </fieldset>
              )}

              {paid ? (
                <div className="adm-actions__row">
                  <p className="adm-muted">
                    Registered for {eventName} and paid ({here!.fee.verifiedBy}, {when(here!.fee.verifiedAt)}). Mark them present in the list below.
                  </p>
                  {teamChanged && teamReady && (
                    <button className="adm-button adm-button--primary" type="button" disabled={busy !== null} onClick={() => void enter(false)}>
                      Save team
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {here?.feeProof && (
                    <div className="adm-note adm-actions__row">
                      <span>They paid the {rupees(fee)} by GPay from Student login and uploaded the screenshot.</span>
                      <button className="adm-button adm-button--primary" type="button" disabled={busy !== null} onClick={() => setChecking(true)}>
                        Check GPay screenshot
                      </button>
                    </div>
                  )}
                  {checking && here?.feeProof && (
                    <FeeScreenshotCheck
                      eventId={eventId}
                      eventName={eventName}
                      registrationId={found.registrationId}
                      name={found.name}
                      amount={fee}
                      proof={here.feeProof}
                      token={token}
                      onDone={(participant) => {
                        setChecking(false);
                        clear();
                        void run('shot', async () => participant);
                      }}
                      onClose={() => setChecking(false)}
                      onSignedOut={onSignedOut}
                    />
                  )}
                  <PaymentFields amount={fee} value={payment} onChange={setPayment} name="venue-fee" />
                  <div className="adm-actions__row">
                    <button
                      className="adm-button adm-button--approve"
                      type="button"
                      disabled={busy !== null || !teamReady || !paymentReady(payment)}
                      onClick={() => void enter(true)}
                    >
                      {busy === 'enroll' ? 'Saving…' : enrolled ? `Record ${rupees(fee)} for ${found.registrationId}` : `Add to ${eventName} and record ${rupees(fee)}`}
                    </button>
                    {!enrolled && (
                      <button className="adm-button" type="button" disabled={busy !== null || !teamReady} onClick={() => void enter(false)}>
                        Add without payment (pays later)
                      </button>
                    )}
                    {enrolled && teamChanged && teamReady && (
                      <button className="adm-button" type="button" disabled={busy !== null} onClick={() => void enter(false)}>
                        Save team only
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Teams among these participants: name and member IDs, by team name. */
function teamsOf(participants: EventParticipant[]): [string, string[]][] {
  const teams = new Map<string, string[]>();
  for (const item of participants) {
    if (item.team) teams.set(item.team, [...(teams.get(item.team) ?? []), item.registrationId]);
  }
  return [...teams.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function WinnersEditor({ eventId, token, result, present, canOperate, isAdmin, busy, run }: { eventId: string; token: string; result: EventResultView; present: EventParticipant[]; canOperate: boolean; isAdmin: boolean; busy: string | null; run: Run }) {
  const [draft, setDraft] = useState<Winners>(result.winners);
  const [dirty, setDirty] = useState(false);
  const [seenRevision, setSeenRevision] = useState(result.revision);
  // Someone else saved meanwhile (or this screen did): show the stored winners unless editing.
  if (result.revision !== seenRevision) {
    setSeenRevision(result.revision);
    if (!dirty) setDraft(result.winners);
  }
  const chosen = new Set(PLACES.flatMap((place) => draft[place]));
  const nameOf = (id: string) => present.find((item) => item.registrationId === id)?.name ?? id;
  const edit = (next: Winners) => {
    setDraft(next);
    setDirty(true);
  };

  return (
    <section className="adm-card adm-pad">
      <h3 className="adm-h3">Winners</h3>
      {canOperate ? (
        <p className="adm-muted">Choose from participants marked present; a team can be added as a whole. Save, then submit for certificates.</p>
      ) : (
        <p className="adm-muted">{result.status === 'SUBMITTED' ? 'Submitted winners:' : 'Winners can be entered on the event day.'}</p>
      )}
      <div className="adm-places">
        {PLACES.map((place: Place) => (
          <div key={place} className="adm-place">
            <h4>{PLACE_LABELS[place]}</h4>
            <ul className="adm-chips">
              {draft[place].map((id) => (
                <li key={id} className="adm-chip">
                  {id} · {nameOf(id)}
                  {canOperate && (
                    <button type="button" aria-label={`Remove ${id}`} onClick={() => edit({ ...draft, [place]: draft[place].filter((item) => item !== id) })}>
                      ×
                    </button>
                  )}
                </li>
              ))}
              {!draft[place].length && <li className="adm-muted">—</li>}
            </ul>
            {canOperate && (
              <select
                aria-label={`Add to ${PLACE_LABELS[place]}`}
                value=""
                onChange={(event) => event.target.value && edit({ ...draft, [place]: [...draft[place], ...event.target.value.split(',')] })}
              >
                <option value="">Add a participant or team…</option>
                {teamsOf(present.filter((item) => !chosen.has(item.registrationId))).map(([name, members]) => (
                  <option key={`team:${name}`} value={members.join(',')}>
                    Team {name} ({members.length} present)
                  </option>
                ))}
                {present
                  .filter((item) => !chosen.has(item.registrationId))
                  .map((item) => (
                    <option key={item.registrationId} value={item.registrationId}>
                      {item.registrationId} · {item.name}
                      {item.team ? ` · ${item.team}` : ''}
                    </option>
                  ))}
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="adm-actions__row">
        {canOperate && (
          <>
            <button
              className="adm-button adm-button--primary"
              type="button"
              disabled={busy !== null || !dirty}
              onClick={() =>
                void run('winners', async () => {
                  const saved = await saveWinners(token, eventId, draft);
                  setDirty(false);
                  return saved;
                })
              }
            >
              {busy === 'winners' ? 'Saving…' : 'Save winners'}
            </button>
            <button
              className="adm-button adm-button--approve"
              type="button"
              disabled={busy !== null || dirty || !result.winners.first.length}
              onClick={() => {
                const ok = window.confirm(
                  'Submit the participant list, the attendance list and the winners for certificate preparation?\n\nThe event is then locked: fees, attendance and winners can only be corrected after an admin authorises it.',
                );
                if (ok) void run('submit', () => submitResults(token, eventId));
              }}
            >
              {busy === 'submit' ? 'Submitting…' : 'Submit for certificates'}
            </button>
            {dirty && <span className="adm-muted">Save the winners before submitting.</span>}
          </>
        )}
        {isAdmin && result.status === 'SUBMITTED' && (
          <button
            className="adm-button adm-button--danger-outline"
            type="button"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt('Authorise a correction of these results. Give the reason:');
              if (reason?.trim()) void run('reopen', () => reopenResults(token, eventId, reason.trim()));
            }}
          >
            Authorise correction
          </button>
        )}
      </div>
      {result.savedBy && <p className="adm-muted">Last saved by {result.savedBy} {when(result.savedAt)}.</p>}
      {result.previousSubmissions.length > 0 && (
        <p className="adm-muted">Earlier submissions: {result.previousSubmissions.map((item) => `#${item.number} by ${item.submittedBy} ${when(item.submittedAt)}`).join('; ')}.</p>
      )}
    </section>
  );
}
