/**
 * The fest's live data in the dashboard, built for weak mobile data:
 *
 * - a copy of the department's data (or every department's) kept on the phone, shown at once
 *   and searchable even with no signal;
 * - every 15 seconds the phone asks only for what changed since it last asked;
 * - small changes (fees, attendance, events…) go into an outbox kept on the phone and are sent
 *   in order as soon as there is signal;
 * - registering a student and the entry fee are sent at once (`send`), so the desk sees the
 *   server's answer before the student leaves (a UTR used elsewhere, a duplicate…).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_CATALOG, type FestCatalog, type FestRegistration, type FestResult, type FestSource } from '../../lib/fest';
import type { SessionInfo } from '../../lib/staff';
import { ApiFailure, SignedOut } from '../adminApi';
import { ALL_ON, festCatalog, festSync, festWrite, type DashboardSwitches } from './festApi';

const SYNC_MS = 15_000;
const RETRY_MS = [3_000, 6_000, 12_000, 30_000, 60_000];

export interface FestOp {
  opId: string;
  path: `/api/admin/fest/${string}`;
  body: Record<string, unknown>;
  /** The registration ID (or 'results:<event>') it changes. */
  target: string;
  label: string;
  createdAt: number;
  /** Set when the server refused it: the reason, for the person to see and decide. */
  failed?: string;
  existingId?: string;
}

export interface FestFilters {
  dept: string;
  eventId: string;
  venue: string;
  source: '' | FestSource;
  desk: string;
  /** WAITING: registered themselves, the transaction ID not checked by a desk yet. */
  entry: '' | 'PAID' | 'DUE' | 'WAITING';
  status: '' | 'active' | 'cancelled' | 'deleted';
  /** A college (its collegeKey). */
  college: string;
  q: string;
}

export const NO_FILTERS: FestFilters = { dept: '', eventId: '', venue: '', source: '', desk: '', entry: '', status: 'active', college: '', q: '' };

interface Cache {
  catalog: FestCatalog | null;
  registrations: FestRegistration[];
  results: FestResult[];
  cursor: string;
  /** The server's "test data deleted at" when this copy was loaded. */
  resetAt?: string | null;
  switches?: DashboardSwitches;
  /** The departments this copy holds ('CSE' or 'CSE,AIDS,…'). */
  scope?: string | null;
  savedAt: number;
}

export interface FestContextValue {
  /** The sign-in, for the few calls made straight to the API (e.g. looking up a UTR). */
  token: string;
  session: SessionInfo;
  catalog: FestCatalog | null;
  registrations: Map<string, FestRegistration>;
  results: Map<string, FestResult>;
  lastSync: number | null;
  online: boolean;
  syncing: boolean;
  error: string | null;
  /** What Website controls has switched off (hidden here; the server refuses it anyway). */
  switches: DashboardSwitches;
  outbox: FestOp[];
  /** Registrations with a change still waiting to be sent. */
  pending: Set<string>;
  filters: FestFilters;
  setFilters: (next: FestFilters) => void;
  refresh: () => void;
  /**
   * Sends a change now and waits for the server (registering for a student, the entry fee, a UTR):
   * the registration as saved, shown here at once. Throws the server's refusal, or a lost connection.
   */
  send: (path: FestOp['path'], body: Record<string, unknown>) => Promise<FestRegistration>;
  /** Any other change: applied on the phone at once (if `local` is given) and sent in order. */
  change: (target: string, path: FestOp['path'], body: Record<string, unknown>, label: string, local?: (registration: FestRegistration) => FestRegistration) => void;
  dismiss: (opId: string) => void;
  retry: (opId: string) => void;
}

const FestContext = createContext<FestContextValue | null>(null);

/** The catalog where there may be no live data (falls back to the starting catalog). */
export function useFestCatalog(): FestCatalog {
  return useContext(FestContext)?.catalog ?? DEFAULT_CATALOG;
}

export function useFest(): FestContextValue {
  const value = useContext(FestContext);
  if (!value) throw new Error('useFest outside FestProvider');
  return value;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the data stays in memory for this visit.
  }
};
const opId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
/** The server refused for a reason a person must look at (not a dropped connection or a busy server). */
const refused = (error: unknown) => error instanceof ApiFailure && error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 408;

export function FestProvider({ token, session, pageDept = null, onSignedOut, children }: { token: string; session: SessionInfo; pageDept?: string | null; onSignedOut: () => void; children: ReactNode }) {
  const keys = useMemo(
    () => ({ cache: `fest-cache:v1:${session.username}`, outbox: `fest-outbox:v1:${session.username}` }),
    [session.username],
  );
  const initial = useMemo(() => read<Cache | null>(keys.cache, null), [keys.cache]);
  const [catalog, setCatalog] = useState<FestCatalog | null>(initial?.catalog ?? null);
  const [registrations, setRegistrations] = useState(() => new Map((initial?.registrations ?? []).map((item) => [item.id, item])));
  const [results, setResults] = useState(() => new Map((initial?.results ?? []).map((item) => [item.eventId, item])));
  const [outbox, setOutbox] = useState<FestOp[]>(() => read<FestOp[]>(keys.outbox, []));
  const [lastSync, setLastSync] = useState<number | null>(initial?.savedAt ?? null);
  const [online, setOnline] = useState(true);
  const [switches, setSwitches] = useState<DashboardSwitches>(initial?.switches ?? ALL_ON);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FestFilters>(() => ({ ...NO_FILTERS, dept: session.department ?? pageDept ?? '' }));

  // The latest values, for the timers and the outbox (which run outside renders).
  const state = useRef({ cursor: initial?.cursor ?? '', resetAt: initial?.resetAt ?? null, scope: initial?.scope ?? (null as string | null), switches: initial?.switches ?? ALL_ON, catalog, registrations, results, outbox, flushing: false, syncing: false, retry: 0 });
  useEffect(() => {
    state.current.catalog = catalog;
    state.current.registrations = registrations;
    state.current.results = results;
    state.current.outbox = outbox;
  });

  const saveOutbox = useCallback(
    (next: FestOp[]) => {
      state.current.outbox = next;
      setOutbox(next);
      write(keys.outbox, next);
    },
    [keys.outbox],
  );

  const saveCache = useCallback(() => {
    const { catalog: currentCatalog, registrations: regs, results: res, cursor, resetAt, switches: lastSwitches, scope } = state.current;
    write(keys.cache, { catalog: currentCatalog, registrations: [...regs.values()], results: [...res.values()], cursor, resetAt, switches: lastSwitches, scope, savedAt: Date.now() } satisfies Cache);
  }, [keys.cache]);

  const putRegistration = useCallback((registration: FestRegistration, replaces?: string) => {
    setRegistrations((current) => {
      const next = new Map(current);
      if (replaces && replaces !== registration.id) next.delete(replaces);
      next.set(registration.id, registration);
      state.current.registrations = next;
      return next;
    });
  }, []);

  const putResult = useCallback((result: FestResult) => {
    setResults((current) => {
      const next = new Map(current);
      next.set(result.eventId, result);
      state.current.results = next;
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------- live updates
  const sync = useCallback(async () => {
    if (state.current.syncing) return;
    state.current.syncing = true;
    setSyncing(true);
    try {
      let answer = await festSync(token, state.current.cursor);
      // Test data was deleted since this copy was loaded: records that are gone never come as
      // changes, so load everything afresh (what waits to be sent stays).
      if (!answer.full && (answer.resetAt ?? null) !== state.current.resetAt) answer = await festSync(token, '');
      // The departments this account sees changed (e.g. events opened to every department, or not
      // any more): load afresh, so nothing from a department no longer shown stays on the phone.
      const scope = (answer.departments ?? []).join(',');
      if (!answer.full && state.current.scope !== null && scope !== state.current.scope) answer = await festSync(token, '');
      state.current.scope = (answer.departments ?? []).join(',');
      state.current.resetAt = answer.resetAt ?? null;
      const waiting = new Set(state.current.outbox.filter((op) => !op.failed).map((op) => op.target));
      setRegistrations((current) => {
        const next = answer.full ? new Map<string, FestRegistration>() : new Map(current);
        if (answer.full) for (const [id, item] of current) if (waiting.has(id)) next.set(id, item);
        for (const item of answer.registrations ?? []) {
          if (waiting.has(item.id)) continue;
          const existing = next.get(item.id);
          if (!existing || item.v >= existing.v) next.set(item.id, item);
        }
        state.current.registrations = next;
        return next;
      });
      setResults((current) => {
        const next = answer.full ? new Map<string, FestResult>() : new Map(current);
        for (const item of answer.results ?? []) {
          const existing = next.get(item.eventId);
          if (!existing || item.v >= existing.v) next.set(item.eventId, item);
        }
        state.current.results = next;
        return next;
      });
      state.current.cursor = answer.cursor ?? '';
      if (answer.switches) {
        state.current.switches = answer.switches;
        setSwitches(answer.switches);
      }
      if (!state.current.catalog || state.current.catalog.revision !== answer.catalogRevision) {
        const fresh = await festCatalog(token);
        if (fresh?.departments) {
          state.current.catalog = fresh;
          setCatalog(fresh);
        }
      }
      setLastSync(Date.now());
      setOnline(true);
      setError(null);
      saveCache();
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else {
        setOnline(false);
        setError(failure instanceof Error ? failure.message : 'Could not reach the server.');
      }
    } finally {
      state.current.syncing = false;
      setSyncing(false);
    }
  }, [token, onSignedOut, saveCache]);

  // ---------------------------------------------------------------------------- the outbox
  const flush = useCallback(async () => {
    if (state.current.flushing) return;
    state.current.flushing = true;
    try {
      for (;;) {
        const op = state.current.outbox.find((item) => !item.failed);
        if (!op) break;
        try {
          const answer = await festWrite(token, op.path, op.body);
          if (answer.registration) putRegistration(answer.registration, op.target);
          if (answer.result) putResult(answer.result);
          saveOutbox(state.current.outbox.filter((item) => item.opId !== op.opId));
          state.current.retry = 0;
          setOnline(true);
        } catch (failure) {
          if (failure instanceof SignedOut) {
            onSignedOut();
            return;
          }
          if (refused(failure)) {
            const existingId = failure instanceof ApiFailure ? failure.details.existingId : undefined;
            saveOutbox(state.current.outbox.map((item) => (item.opId === op.opId ? { ...item, failed: (failure as Error).message, ...(existingId && { existingId }) } : item)));
            // The next sync brings the server's copy back in place of what the phone showed.
            state.current.cursor = '';
            continue;
          }
          // No signal or a busy server: try again a little later.
          setOnline(false);
          const wait = RETRY_MS[Math.min(state.current.retry, RETRY_MS.length - 1)];
          state.current.retry += 1;
          window.setTimeout(() => void flushRef.current(), wait);
          break;
        }
      }
    } finally {
      state.current.flushing = false;
      saveCache();
    }
  }, [token, onSignedOut, putRegistration, putResult, saveOutbox, saveCache]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  const enqueue = useCallback(
    (op: Omit<FestOp, 'opId' | 'createdAt'>) => {
      saveOutbox([...state.current.outbox, { ...op, opId: opId(), createdAt: Date.now() }]);
      void flushRef.current();
    },
    [saveOutbox],
  );

  const send: FestContextValue['send'] = useCallback(
    async (path, body) => {
      try {
        const answer = await festWrite(token, path, body);
        if (!answer.registration) throw new Error('The server did not send the registration back. Refresh and look again.');
        putRegistration(answer.registration);
        saveCache();
        setOnline(true);
        return answer.registration;
      } catch (failure) {
        if (failure instanceof SignedOut) onSignedOut();
        else if (!(failure instanceof ApiFailure)) setOnline(false);
        throw failure;
      }
    },
    [token, onSignedOut, putRegistration, saveCache],
  );

  const change: FestContextValue['change'] = useCallback(
    (target, path, body, label, local) => {
      const current = state.current.registrations.get(target);
      if (current && local) putRegistration(local(current));
      enqueue({ path, body, target, label });
    },
    [enqueue, putRegistration],
  );

  const dismiss = useCallback((id: string) => saveOutbox(state.current.outbox.filter((op) => op.opId !== id)), [saveOutbox]);
  const retry = useCallback(
    (id: string) => {
      saveOutbox(state.current.outbox.map((op) => (op.opId === id ? { ...op, failed: undefined } : op)));
      void flushRef.current();
    },
    [saveOutbox],
  );

  // ---------------------------------------------------------------------------- timers
  useEffect(() => {
    void sync();
    void flushRef.current();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void sync();
      void flushRef.current();
    }, SYNC_MS);
    const wake = () => {
      if (document.visibilityState === 'visible') {
        void sync();
        void flushRef.current();
      }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [sync]);

  // Closing or reloading the tab while changes wait: the browser asks first. They are saved on
  // the phone either way and sent the next time this account signs in here.
  useEffect(() => {
    if (!outbox.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [outbox.length]);

  const pending = useMemo(() => new Set(outbox.filter((op) => !op.failed).map((op) => op.target)), [outbox]);

  const value: FestContextValue = {
    token,
    session,
    catalog,
    registrations,
    results,
    lastSync,
    online,
    syncing,
    error,
    switches,
    outbox,
    pending,
    filters,
    setFilters,
    refresh: () => {
      void sync();
      void flushRef.current();
    },
    send,
    change,
    dismiss,
    retry,
  };
  return <FestContext.Provider value={value}>{children}</FestContext.Provider>;
}
