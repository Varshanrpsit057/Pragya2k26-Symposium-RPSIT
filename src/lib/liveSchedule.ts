/**
 * The schedule the website follows: the real one (src/content/site.ts) until the API says
 * otherwise. An admin can set a test timeline (Testing in the dashboard) for rehearsals; the
 * page asks the API once on load and every two minutes while open, and switches by itself.
 * If the API cannot be reached, the real schedule stays (the API enforces its own anyway).
 */
import { useSyncExternalStore } from 'react';
import { site } from '../content/site';
import { API_BASE, apiUrl } from './api';
import { scheduleOf, scheduleProblem, type RegistrationSchedule } from './schedule';

const REFRESH_MS = 120_000;
/** The real schedule, read from the site's settings (the same object while they are unchanged). */
let standardCache: RegistrationSchedule = scheduleOf(site.registration);
function standard(): RegistrationSchedule {
  const fresh = scheduleOf(site.registration);
  if (JSON.stringify(fresh) !== JSON.stringify(standardCache)) standardCache = fresh;
  return standardCache;
}
/** What the API gave, when it differs from the real schedule; null: the real schedule. */
let fromApi: RegistrationSchedule | null = null;
const current = () => fromApi ?? standard();
let started = false;
// Unit tests use the real schedule unless a test turns this on.
let enabled = import.meta.env.MODE !== 'test';
const listeners = new Set<() => void>();

const isTime = (value: unknown) => value === null || typeof value === 'string';
const isSchedule = (value: unknown): value is RegistrationSchedule =>
  typeof value === 'object' && value !== null && ['onlineClosesAt', 'onsiteOpensAt', 'onsiteClosesAt'].every((key) => isTime((value as Record<string, unknown>)[key]));

/** Asks the API for the schedule; a change reaches every component that uses it. */
export async function refreshSchedule(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const response = await fetchImpl(apiUrl(API_BASE, '/api/schedule'), { cache: 'no-store' });
    if (!response.ok) return;
    const data: unknown = await response.json();
    const next = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).schedule : null;
    if (!isSchedule(next) || scheduleProblem(next)) return;
    if (JSON.stringify(next) === JSON.stringify(current())) return;
    fromApi = JSON.stringify(next) === JSON.stringify(standard()) ? null : { onlineClosesAt: next.onlineClosesAt, onsiteOpensAt: next.onsiteOpensAt, onsiteClosesAt: next.onsiteClosesAt };
    listeners.forEach((listener) => listener());
  } catch {
    // Offline or the API is down: keep the schedule we have.
  }
}

function start() {
  if (started || !enabled || typeof window === 'undefined') return;
  started = true;
  void refreshSchedule();
  // Tabs in the background wait: hundreds of open pages should not keep asking.
  window.setInterval(() => {
    if (document.visibilityState !== 'hidden') void refreshSchedule();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshSchedule();
  });
}

/** The schedule now (for code that runs at a moment, e.g. opening the form). */
export function currentSchedule(): RegistrationSchedule {
  start();
  return current();
}

/** The schedule, kept up to date (the real one while prerendering and hydrating). */
export function useSchedule(): RegistrationSchedule {
  return useSyncExternalStore(
    (onChange) => {
      start();
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    current,
    standard,
  );
}

/** For tests: follow the API (or not), and start from the real schedule again. */
export function liveScheduleForTests(on: boolean) {
  enabled = on;
  started = false;
  fromApi = null;
}
