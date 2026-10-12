/**
 * The fest's live data in the dashboard, built for weak mobile data:
 *
 * - a copy of the department's data (or every department's) kept on the phone, shown at once
 *   and searchable even with no signal;
 * - every 15 seconds the phone asks only for what changed since it last asked;
 * - changes (registering, fees, attendance…) go into an outbox kept on the phone and are sent
 *   in order as soon as there is signal; a retry never registers anyone twice;
 * - a desk phone holds a block of 50 IDs and takes the next block by itself when 15 are left.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_CATALOG,
  ID_TOP_UP_AT,
  formatFestId,
  type FestCatalog,
  type FestRegistration,
  type FestResult,
  type FestSource,
} from '../../lib/fest';
import type { SessionInfo } from '../../lib/staff';
import { ApiFailure, SignedOut } from '../adminApi';
import { festCatalog, festSync, festWrite, takeIds } from './festApi';

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
  entry: '' | 'PAID' | 'DUE';
  status: '' | 'active' | 'cancelled' | 'deleted';
  q: string;
}

export const NO_FILTERS: FestFilters = { dept: '', eventId: '', venue: '', source: '', desk: '', entry: '', status: 'active', q: '' };

interface Cache {
  catalog: FestCatalog | null;
  registrations: FestRegistration[];
  results: FestResult[];
  cursor: string;
  savedAt: number;
}

interface IdBlock {
  first: number;
  last: number;
  next: number;
}

export interface FestContextValue {
  session: SessionInfo;
  catalog: FestCatalog | null;
  registrations: Map<string, FestRegistration>;
  results: Map<string, FestResult>;
  lastSync: number | null;
  online: boolean;
  syncing: boolean;
  error: string | null;
  outbox: FestOp[];
  /** Registrations with a change still waiting to be sent. */
  pending: Set<string>;
  filters: FestFilters;
  setFilters: (next: FestFilters) => void;
  refresh: () => void;
  /** IDs this phone still holds for the department. */
  idsLeft: (dept: string) => number;
  /** Registers at the desk (or from a paper slip, with its ID): shown at once, sent when there is signal. */
  register: (input: { dept: string; participant: Record<string, string>; events: string[]; payment: Record<string, unknown>; source?: FestSource; id?: string }) => FestRegistration;
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
    () => ({ cache: `fest-cache:v1:${session.username}`, outbox: `fest-outbox:v1:${session.username}`, ids: (dept: string) => `fest-ids:v1:${session.username}:${dept}` }),
    [session.username],
  );
  const initial = useMemo(() => read<Cache | null>(keys.cache, null), [keys.cache]);
  const [catalog, setCatalog] = useState<FestCatalog | null>(initial?.catalog ?? null);
  const [registrations, setRegistrations] = useState(() => new Map((initial?.registrations ?? []).map((item) => [item.id, item])));
  const [results, setResults] = useState(() => new Map((initial?.results ?? []).map((item) => [item.eventId, item])));
  const [outbox, setOutbox] = useState<FestOp[]>(() => read<FestOp[]>(keys.outbox, []));
  const [lastSync, setLastSync] = useState<number | null>(initial?.savedAt ?? null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FestFilters>(() => ({ ...NO_FILTERS, dept: session.department ?? pageDept ?? '' }));

  // The latest values, for the timers and the outbox (which run outside renders).
  const state = useRef({ cursor: initial?.cursor ?? '', catalog, registrations, results, outbox, flushing: false, syncing: false, retry: 0 });
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
    const { catalog: currentCatalog, registrations: regs, results: res, cursor } = state.current;
    write(keys.cache, { catalog: currentCatalog, registrations: [...regs.values()], results: [...res.values()], cursor, savedAt: Date.now() } satisfies Cache);
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
      const answer = await festSync(token, state.current.cursor);
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

  // ---------------------------------------------------------------------------- ID blocks
  const blocks = useCallback((dept: string) => read<IdBlock[]>(keys.ids(dept), []), [keys]);
  const idsLeft = useCallback((dept: string) => blocks(dept).reduce((sum, block) => sum + Math.max(0, block.last - block.next + 1), 0), [blocks]);
  const topping = useRef(new Set<string>());
  const topUp = useCallback(
    async (dept: string) => {
      if (topping.current.has(dept) || idsLeft(dept) >= ID_TOP_UP_AT) return;
      topping.current.add(dept);
      try {
        const block = await takeIds(token, { dept });
        write(keys.ids(dept), [...blocks(dept).filter((item) => item.next <= item.last), { first: block.first, last: block.last, next: block.first }]);
      } catch (failure) {
        if (failure instanceof SignedOut) onSignedOut();
      } finally {
        topping.current.delete(dept);
      }
    },
    [token, keys, blocks, idsLeft, onSignedOut],
  );
  const nextId = useCallback(
    (dept: string) => {
      const list = blocks(dept);
      const block = list.find((item) => item.next <= item.last);
      if (!block) return null;
      const id = formatFestId(dept, block.next);
      block.next += 1;
      write(keys.ids(dept), list);
      void topUp(dept);
      return id;
    },
    [blocks, keys, topUp],
  );

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
          if (failure instanceof ApiFailure && failure.code === 'ID_TAKEN' && op.path === '/api/admin/fest/registrations') {
            // Two phones held the same IDs: take the next one and send again.
            const dept = String(op.body.dept);
            const id = nextId(dept);
            if (id) {
              const placeholder = state.current.registrations.get(op.target);
              if (placeholder) putRegistration({ ...placeholder, id }, op.target);
              saveOutbox(state.current.outbox.map((item) => (item.opId === op.opId ? { ...item, target: id, body: { ...item.body, id }, label: item.label.replace(op.target, id) } : item)));
              continue;
            }
          }
          if (refused(failure)) {
            const existingId = failure instanceof ApiFailure ? failure.details.existingId : undefined;
            saveOutbox(state.current.outbox.map((item) => (item.opId === op.opId ? { ...item, failed: (failure as Error).message, ...(existingId && { existingId }) } : item)));
            // Undo what the phone showed for it: the next sync brings the server's copy.
            if (op.path === '/api/admin/fest/registrations') {
              setRegistrations((current) => {
                const next = new Map(current);
                next.delete(op.target);
                state.current.registrations = next;
                return next;
              });
            }
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
  }, [token, onSignedOut, putRegistration, putResult, saveOutbox, saveCache, nextId]);
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

  const register: FestContextValue['register'] = useCallback(
    (input) => {
      const source = input.source ?? 'DESK';
      const id = input.id ?? nextId(input.dept);
      if (!id) throw new Error('No registration IDs left on this phone. Connect to the internet for a few seconds to get more, or use a paper slip.');
      const now = new Date().toISOString();
      const stamp = { at: now, by: session.username };
      const submissionId = `${session.username.replace(/[^A-Za-z0-9-]/g, '-')}-${opId()}`;
      const amount = state.current.catalog?.entryFee ?? 0;
      const local: FestRegistration = {
        id,
        dept: input.dept,
        source,
        name: input.participant.name ?? '',
        phone: input.participant.phone ?? '',
        email: input.participant.email ?? '',
        college: input.participant.college ?? '',
        branch: input.participant.branch ?? '',
        year: input.participant.year ?? '',
        team: input.participant.team ?? '',
        entry: { status: 'PAID', payment: { method: input.payment.method === 'UPI' ? 'UPI' : 'CASH', amount, ...stamp, ...(session.deskNumber && { desk: session.deskNumber }) } },
        events: input.events.map((eventId) => ({ eventId, added: stamp })),
        ...(session.deskNumber && { desk: session.deskNumber }),
        created: stamp,
        v: 0,
        u: '',
      };
      putRegistration(local);
      enqueue({
        path: '/api/admin/fest/registrations',
        body: { dept: input.dept, submissionId, id, participant: input.participant, events: input.events, payment: input.payment, source },
        target: id,
        label: `Register ${id} · ${local.name}`,
      });
      return local;
    },
    [nextId, putRegistration, enqueue, session.username, session.deskNumber],
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
    if (session.department) void topUp(session.department);
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
  }, [sync, topUp, session.department]);

  const pending = useMemo(() => new Set(outbox.filter((op) => !op.failed).map((op) => op.target)), [outbox]);

  const value: FestContextValue = {
    session,
    catalog,
    registrations,
    results,
    lastSync,
    online,
    syncing,
    error,
    outbox,
    pending,
    filters,
    setFilters,
    refresh: () => {
      void sync();
      void flushRef.current();
    },
    idsLeft,
    register,
    change,
    dismiss,
    retry,
  };
  return <FestContext.Provider value={value}>{children}</FestContext.Provider>;
}
