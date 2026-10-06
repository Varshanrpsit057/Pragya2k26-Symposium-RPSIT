/** The hero countdown's arithmetic, kept free of React so it is easy to test. */

/** India Standard Time: a start time written without a zone is taken as IST. */
export const IST_OFFSET = '+05:30';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * '2026-10-30T09:00:00' (taken as IST) or a full ISO time with its own offset
 * → milliseconds since 1970, the same instant for every visitor. Null if unreadable.
 */
export function parseEventStart(value: string): number | null {
  const text = value.trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const ms = Date.parse(hasZone ? text : `${text}${IST_OFFSET}`);
  return Number.isNaN(ms) ? null : ms;
}

export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** The start time has arrived. */
  done: boolean;
}

/**
 * Time left until `target`, never negative. Partial seconds round up, so the display
 * reads 00:00:00:01 until the exact start time and only then switches to "live".
 */
export function remainingUntil(target: number, now: number): Remaining {
  const total = Math.max(0, Math.ceil((target - now) / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    done: total === 0,
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * '30 October 2026 · 9:00 AM IST'. Built by hand rather than with Intl so the
 * prerendered page and the browser always produce exactly the same text.
 */
export function formatIst(target: number): string {
  const ist = new Date(target + IST_OFFSET_MS);
  const hours = ist.getUTCHours();
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
  const hour12 = hours % 12 || 12;
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()} · ${hour12}:${minutes} ${hours < 12 ? 'AM' : 'PM'} IST`;
}
