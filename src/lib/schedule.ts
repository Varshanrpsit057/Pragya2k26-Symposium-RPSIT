/**
 * When PRAGYA 2026 takes registrations, shared by the website and the registration API:
 *
 *   online    until 16 October 2026, 11:59 PM IST: the public form (gate pass paid by UPI)
 *   between   the last minute of 16 October: nothing (on-site opens at midnight)
 *   onsite    17 October 2026, the event day (IST): the registration desk only
 *   closed    from midnight after the event day: no registrations at all
 *
 * Every time is India Standard Time (Asia/Kolkata, UTC+5:30, no daylight saving), written
 * without a zone ('2026-10-17T00:00:00') or with an explicit offset. The phase is worked out
 * from the clock on every request, so the switch needs no deployment; the API enforces it,
 * and the website only mirrors it for display. Free of browser and Node APIs: both import it.
 */
import { parseEventStart } from './countdown';

export type RegistrationPhase = 'online' | 'between' | 'onsite' | 'closed';

export interface RegistrationSchedule {
  /** Online registration closes at this moment. Null: it never closes. */
  onlineClosesAt: string | null;
  /** The desk opens at this moment (the start of the event day). Null: there is no desk. */
  onsiteOpensAt: string | null;
  /** The desk closes, and every registration with it (the end of the event day). */
  onsiteClosesAt: string | null;
}

const at = (value: string | null) => (value ? parseEventStart(value) : null);

/** Which kind of registration is open at `now` (ms since 1970). */
export function registrationPhase(schedule: RegistrationSchedule, now: number): RegistrationPhase {
  const onlineCloses = at(schedule.onlineClosesAt);
  const onsiteOpens = at(schedule.onsiteOpensAt);
  const onsiteCloses = at(schedule.onsiteClosesAt);
  if (onlineCloses === null || now < onlineCloses) return 'online';
  if (onsiteCloses !== null && now >= onsiteCloses) return 'closed';
  if (onsiteOpens === null) return 'closed';
  return now >= onsiteOpens ? 'onsite' : 'between';
}

/**
 * True once the event day has begun: coordinators may take event fees, mark attendance and
 * enter winners from then on (and after it, to finish their results).
 */
export function eventDayStarted(schedule: RegistrationSchedule, now: number): boolean {
  const onsiteOpens = at(schedule.onsiteOpensAt);
  return onsiteOpens === null || now >= onsiteOpens;
}

/** Checks a schedule: every time readable, and in order. Returns what is wrong, or null. */
export function scheduleProblem(schedule: RegistrationSchedule): string | null {
  const entries = Object.entries(schedule) as [keyof RegistrationSchedule, string | null][];
  for (const [name, value] of entries) {
    if (value !== null && parseEventStart(value) === null) return `${name} is not a readable time`;
  }
  const [online, opens, closes] = [at(schedule.onlineClosesAt), at(schedule.onsiteOpensAt), at(schedule.onsiteClosesAt)];
  if (online !== null && opens !== null && opens < online) return 'on-site registration opens before online registration closes';
  if (opens !== null && closes !== null && closes <= opens) return 'on-site registration closes before it opens';
  return null;
}

/** The schedule as the site's settings give it (src/content/site.ts). */
export function scheduleOf(registration: { closesAt: string | null; onsite: { opensAt: string | null; closesAt: string | null } }): RegistrationSchedule {
  return {
    onlineClosesAt: registration.closesAt,
    onsiteOpensAt: registration.onsite.opensAt,
    onsiteClosesAt: registration.onsite.closesAt,
  };
}
