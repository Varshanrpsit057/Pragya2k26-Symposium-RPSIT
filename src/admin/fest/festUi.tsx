/** Pieces every fest screen uses: the live status, the filters, payments and registration cards. */
import { useMemo, useState, type ReactNode } from 'react';
import { awaitingCheck, collegeKey, collegeSummary, deptShort, entryOf, eventLabel, eventOf, feePaid, isActive, rupees, showId, type FestCatalog, type FestEvent, type FestRegistration } from '../../lib/fest';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { Badge, clockTime, when } from '../ui';

const ALL_COLLEGES = 'All colleges';
import { NO_FILTERS, useFest, type FestFilters } from './FestData';

/** Online or not, when the data last arrived, what is waiting to be sent, and what the server refused. */
export function SyncBar() {
  const { online, lastSync, syncing, outbox, refresh, retry, dismiss, error } = useFest();
  const waiting = outbox.filter((op) => !op.failed);
  const failed = outbox.filter((op) => op.failed);
  return (
    <section className={`fest-sync${online ? '' : ' is-offline'}`} aria-label="Connection">
      <span className="fest-sync__state">
        <span className="fest-sync__dot" aria-hidden="true" />
        {online ? 'Live' : 'No connection'}
        {lastSync && <span className="adm-muted"> · updated {clockTime(lastSync)}</span>}
      </span>
      {waiting.length > 0 && <Badge tone="warn">{waiting.length} waiting to send</Badge>}
      {!online && <span className="adm-muted fest-sync__hint">Keep working: everything is saved on this phone and sent when the signal is back.</span>}
      {online && error && <span className="adm-muted">{error}</span>}
      <button className="adm-button adm-button--small" type="button" onClick={refresh} disabled={syncing}>
        {syncing ? 'Updating…' : 'Refresh'}
      </button>
      {failed.length > 0 && (
        <div className="fest-sync__failed" role="alert">
          <strong>Needs your attention ({failed.length})</strong>
          <ul>
            {failed.map((op) => (
              <li key={op.opId}>
                <span>
                  {op.label}: {op.failed}
                </span>
                <span className="adm-inline">
                  <button className="adm-button adm-button--small" type="button" onClick={() => retry(op.opId)}>
                    Try again
                  </button>
                  <button className="adm-button adm-button--small" type="button" onClick={() => dismiss(op.opId)}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export const deptName = (catalog: FestCatalog | null, code: string) => catalog?.departments.find((dept) => dept.code === code)?.name ?? code;

/** What a registration shows in searches: its ID, name, phone and college. */
export const matches = (registration: FestRegistration, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // 'AI&DS-7' finds AIDS-0007, 'S&H-7' SH-0007 (IDs keep the codes AIDS and SH).
  const compact = q.replace(/\s*&\s*/g, '').replace(/[\s-]/g, '');
  const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    registration.id.toLowerCase().replace('-', '').includes(compact) ||
    // As the ID is shown: 'CYBER-0007' for CYS-0007.
    letters(showId(registration.id)).includes(letters(q)) ||
    registration.name.toLowerCase().includes(q) ||
    registration.phone.includes(compact) ||
    registration.college.toLowerCase().includes(q) ||
    (registration.collegeCode ?? '').toLowerCase() === compact ||
    // The desk may search by the transaction ID it sees in the payment.
    (compact.length >= 4 && [registration.entry.claim?.txn, registration.entry.payment?.txn].some((txn) => txn?.toLowerCase().includes(compact)))
  );
};

export function applyFilters(registrations: Iterable<FestRegistration>, filters: FestFilters, catalog: FestCatalog | null): FestRegistration[] {
  const venueEvents = filters.venue && catalog ? new Set(catalog.events.filter((event) => event.venue === filters.venue).map((event) => event.id)) : null;
  const list: FestRegistration[] = [];
  for (const registration of registrations) {
    if (filters.dept && registration.dept !== filters.dept) continue;
    if (filters.college && collegeKey(registration.college) !== filters.college) continue;
    if (filters.eventId && !entryOf(registration, filters.eventId)) continue;
    if (venueEvents && !registration.events.some((entry) => venueEvents.has(entry.eventId))) continue;
    if (filters.source && registration.source !== filters.source) continue;
    if (filters.desk && String(registration.desk ?? registration.entry.payment?.desk ?? '') !== filters.desk) continue;
    // Paid; payment sent, waiting for the desk to check; or not paid yet (nothing sent).
    if (filters.entry === 'WAITING' && !awaitingCheck(registration)) continue;
    if (filters.entry === 'PAID' && registration.entry.status !== 'PAID') continue;
    if (filters.entry === 'DUE' && (registration.entry.status !== 'DUE' || awaitingCheck(registration))) continue;
    if (filters.status === 'active' && !isActive(registration)) continue;
    if (filters.status === 'cancelled' && !(registration.cancelled && !registration.deleted)) continue;
    if (filters.status === 'deleted' && !registration.deleted) continue;
    if (!matches(registration, filters.q)) continue;
    list.push(registration);
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

/** The filters a screen offers: the department (when it sees every department) and only those it needs. */
export type FilterField = 'payment' | 'college' | 'event' | 'search' | 'cancelled';

export function FilterBar({ showDept, fields = [] }: { showDept: boolean; fields?: readonly FilterField[] }) {
  const { catalog, filters, setFilters, registrations } = useFest();
  const colleges = useMemo(() => collegeSummary(registrations.values(), []).sort((a, b) => a.name.localeCompare(b.name)), [registrations]);
  const collegeOptions = useMemo(() => [ALL_COLLEGES, ...colleges.map((college) => `${college.name} (${college.students})`)], [colleges]);
  if (!catalog) return null;
  const set = (change: Partial<FestFilters>) => setFilters({ ...filters, ...change });
  const events = catalog.events.filter((event) => !filters.dept || event.dept === filters.dept);
  const has = (field: FilterField) => fields.includes(field);
  const narrowed = Boolean((showDept && filters.dept) || filters.eventId || filters.entry || filters.college || filters.q || filters.status !== 'active');
  if (!showDept && !fields.length) return null;
  return (
    <div className="fest-filters" role="group" aria-label="Filters">
      {showDept && (
        <label className="adm-field">
          <span>Department</span>
          <select value={filters.dept} onChange={(event) => set({ dept: event.target.value, eventId: '' })}>
            <option value="">All departments</option>
            {catalog.departments.map((dept) => (
              <option key={dept.code} value={dept.code}>
                {deptShort(dept.code)} · {dept.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {has('payment') && (
        <label className="adm-field">
          <span>Payment</span>
          <select value={filters.entry} onChange={(event) => set({ entry: event.target.value as FestFilters['entry'] })}>
            <option value="">Everyone</option>
            <option value="PAID">Paid</option>
            <option value="WAITING">Payment sent · desk to check</option>
            <option value="DUE">Not paid yet</option>
          </select>
        </label>
      )}
      {has('event') && (
        <label className="adm-field">
          <span>Event</span>
          <select value={filters.eventId} onChange={(event) => set({ eventId: event.target.value })}>
            <option value="">All events</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {showDept && !filters.dept ? `${deptShort(event.dept)} · ` : ''}
                {eventLabel(event)}
              </option>
            ))}
          </select>
        </label>
      )}
      {has('college') && (
        /* Searchable: after a big day there are a hundred colleges or more */
        <div className="adm-field fest-filters__college">
          <span id="fest-filter-college">College</span>
          <SearchSelect
            id="fest-filter-college-pick"
            labelId="fest-filter-college"
            options={collegeOptions}
            value={filters.college ? (collegeOptions[colleges.findIndex((college) => college.key === filters.college) + 1] ?? ALL_COLLEGES) : ALL_COLLEGES}
            onChange={(label) => set({ college: label === ALL_COLLEGES ? '' : (colleges[collegeOptions.indexOf(label) - 1]?.key ?? '') })}
            placeholder={ALL_COLLEGES}
            searchPlaceholder="College name or initials"
            searchLabel="Search colleges"
            bestFirst
            searchFirst
          />
        </div>
      )}
      {has('search') && (
        <label className="adm-field fest-filters__search">
          <span>Search</span>
          <input type="search" value={filters.q} placeholder="ID, name, phone or college" onChange={(event) => set({ q: event.target.value })} />
        </label>
      )}
      {has('cancelled') && (
        <label className="adm-check fest-filters__check">
          <input type="checkbox" checked={filters.status !== 'active'} onChange={(event) => set({ status: event.target.checked ? '' : 'active' })} />
          <span>Show cancelled</span>
        </label>
      )}
      {narrowed && (
        <button className="adm-button adm-button--small" type="button" onClick={() => setFilters({ ...NO_FILTERS, dept: showDept ? '' : filters.dept })}>
          Clear filters
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="fest-stat">
      <span className="fest-stat__value">{value}</span>
      <span className="fest-stat__label">{label}</span>
      {sub && <span className="fest-stat__sub">{sub}</span>}
    </div>
  );
}

export interface PaymentDraft {
  method: '' | 'CASH' | 'UPI';
  txn: string;
  confirmed: boolean;
}
export const NO_PAYMENT: PaymentDraft = { method: '', txn: '', confirmed: false };
export const paymentReady = (draft: PaymentDraft) => draft.method !== '' && draft.confirmed && (draft.method === 'CASH' || /^[A-Za-z0-9]{6,35}$/.test(draft.txn.replace(/\s/g, '')));
export const paymentBody = (draft: PaymentDraft) => ({ method: draft.method, confirmed: draft.confirmed, ...(draft.method === 'UPI' && { txn: draft.txn.replace(/\s/g, '') }) });

/** Other registrations with this UPI transaction ID: accepted for them, or sent by them and waiting. */
export function txnHolders(registrations: Map<string, FestRegistration>, txn: string, exceptId: string) {
  const wanted = txn.replace(/[\s-]/g, '').toUpperCase();
  if (wanted.length < 6) return [];
  const same = (value: string | undefined) => (value ?? '').replace(/[\s-]/g, '').toUpperCase() === wanted;
  return [...registrations.values()].filter((item) => item.id !== exceptId && isActive(item) && (same(item.entry.payment?.txn) || (item.entry.status === 'DUE' && same(item.entry.claim?.txn))));
}

/** Cash (ticked as received) or UPI (with the transaction ID from the student's screen, checked against every other registration). */
export function PaymentChoice({ amount, value, onChange, name, forId = '' }: { amount: number; value: PaymentDraft; onChange: (next: PaymentDraft) => void; name: string; forId?: string }) {
  const { registrations } = useFest();
  const holders = value.method === 'UPI' ? txnHolders(registrations, value.txn, forId) : [];
  return (
    <fieldset className="fest-pay">
      <legend>Payment of {rupees(amount)}</legend>
      <div className="adm-inline adm-inline--wrap">
        {(['CASH', 'UPI'] as const).map((method) => (
          <label key={method} className={`fest-choice${value.method === method ? ' is-on' : ''}`}>
            <input type="radio" name={name} checked={value.method === method} onChange={() => onChange({ ...value, method, confirmed: false })} />
            {method === 'CASH' ? 'Cash' : 'UPI / GPay'}
          </label>
        ))}
      </div>
      {value.method === 'UPI' && (
        <label className="adm-field">
          <span>UPI transaction ID (UTR) from the student’s payment screen</span>
          <input value={value.txn} inputMode="text" autoComplete="off" onChange={(event) => onChange({ ...value, txn: event.target.value })} placeholder="e.g. 412345678901" />
        </label>
      )}
      {holders.length > 0 && (
        <p className="fest-match is-bad" role="alert">
          Duplicate: this UTR is already used for {holders.map((item) => showId(item.id)).join(', ')}. A payment counts once.
        </p>
      )}
      {value.method && (
        <label className="adm-check">
          <input type="checkbox" checked={value.confirmed} onChange={(event) => onChange({ ...value, confirmed: event.target.checked })} />
          <span>{value.method === 'CASH' ? `I have received ${rupees(amount)} in cash.` : `I have seen ${rupees(amount)} paid on the student’s phone.`}</span>
        </label>
      )}
    </fieldset>
  );
}

/** One registration, compact: for searches, desks and event windows (works on a phone). */
export function RegistrationCard({ registration, children, showDept = false, eventFocus }: { registration: FestRegistration; children?: ReactNode; showDept?: boolean; eventFocus?: FestEvent }) {
  const { catalog, pending } = useFest();
  const entry = eventFocus ? entryOf(registration, eventFocus.id) : null;
  return (
    <article className={`fest-card${isActive(registration) ? '' : ' is-inactive'}`}>
      <header className="fest-card__head">
        <span className="fest-card__id">{showId(registration.id)}</span>
        <strong className="fest-card__name">{registration.name}</strong>
        {pending.has(registration.id) && <Badge tone="warn">Waiting to send</Badge>}
        {registration.source === 'ONLINE' && <Badge tone={registration.checkedIn ? 'good' : 'plain'}>{registration.checkedIn ? 'Online · arrived' : 'Online · not arrived'}</Badge>}
        {registration.source === 'PAPER' && <Badge tone="plain">Paper slip</Badge>}
        {registration.source !== 'ONLINE' && registration.entry.status === 'PAID' && <Badge tone="good">Paid</Badge>}
        {awaitingCheck(registration) && <Badge tone="warn">Payment to check</Badge>}
        {registration.entry.rejected && registration.entry.status === 'DUE' && <Badge tone="bad">Payment not found</Badge>}
        {registration.entry.status === 'DUE' && !registration.entry.claim && <Badge tone="bad">Entry fee due</Badge>}
        {registration.cancelled && <Badge tone="bad">Cancelled</Badge>}
        {registration.deleted && <Badge tone="bad">Deleted</Badge>}
        {registration.test && <Badge tone="warn">TEST</Badge>}
      </header>
      <p className="fest-card__meta">
        {showDept && <>{deptShort(registration.dept)} · </>}
        {registration.source === 'SELF' && <>{registration.created.by === 'student' ? 'Registered on their phone' : 'Registered at the desk'} · </>}
        {registration.phone} · {registration.college}
        {registration.team && <> · Team {registration.team}</>}
      </p>
      {eventFocus ? (
        <p className="fest-card__events">
          {entry ? (
            <>
              <Badge tone={feePaid(entry) ? 'good' : eventFocus.fee ? 'warn' : 'plain'}>{feePaid(entry) ? `Fee paid · ${entry.fee!.method === 'UPI' ? 'UPI' : entry.fee!.method === 'ONLINE' ? 'online' : 'cash'}` : eventFocus.fee ? `Fee due ${rupees(eventFocus.fee)}` : 'No fee'}</Badge>{' '}
              <Badge tone={entry.present ? 'good' : 'plain'}>{entry.present ? `Present · ${when(entry.present.at)}` : 'Not marked present'}</Badge>
            </>
          ) : (
            <Badge tone="plain">Not registered for {eventFocus.name}</Badge>
          )}
        </p>
      ) : (
        <p className="fest-card__events">
          {registration.events.length === 0 && <span className="adm-muted">No events yet</span>}
          {registration.events.map((item) => {
            const event = catalog ? eventOf(catalog, item.eventId) : null;
            return (
              <span key={item.eventId} className={`fest-chip${item.present ? ' is-present' : feePaid(item) ? ' is-paid' : ''}`} title={item.present ? 'Present' : feePaid(item) ? 'Fee paid' : 'Fee due'}>
                {event ? event.name : item.eventId}
                {item.present ? ' ✓' : ''}
              </span>
            );
          })}
        </p>
      )}
      {children && <div className="fest-card__actions">{children}</div>}
    </article>
  );
}

/** A short list with "Show more", so long lists stay fast on a phone. */
export function ShortList<T>({ items, render, empty, step = 30 }: { items: T[]; render: (item: T) => ReactNode; empty: ReactNode; step?: number }) {
  const [shown, setShown] = useState(step);
  if (!items.length) return <p className="adm-muted adm-empty">{empty}</p>;
  return (
    <>
      <div className="fest-list">{items.slice(0, shown).map(render)}</div>
      {items.length > shown && (
        <button className="adm-button fest-more" type="button" onClick={() => setShown(shown + step)}>
          Show more ({items.length - shown} left)
        </button>
      )}
    </>
  );
}

/** Today's stamp for a change made on this phone (replaced by the server's when it is sent). */
export const stampNow = (username: string) => ({ at: new Date().toISOString(), by: username });
