/**
 * Event times for the student page's alerts: the slots in an event's schedule text
 * ('10:30 AM – 12:00 PM', or 'Round 1: 12:15 PM – 1:00 PM · Round 2: 2:00 PM – 2:40 PM') on
 * the event day, which events overlap, and what is next. Every time is IST (UTC+5:30).
 * Free of browser and Node APIs.
 */

export interface TimeSlot {
  /** ms since 1970 */
  start: number;
  end: number;
  /** 'Round 1', or '' when the event has one slot. */
  label: string;
}

const SLOT = /(?:(Round \d+):\s*)?(\d{1,2}):(\d{2})\s*([AP]M)\s*[–-]\s*(\d{1,2}):(\d{2})\s*([AP]M)/gi;

const minutesOf = (hours: string, minutes: string, meridiem: string) => {
  const h = Number(hours) % 12;
  return (meridiem.toUpperCase() === 'PM' ? h + 12 : h) * 60 + Number(minutes);
};

/** The slots of a schedule on `day` ('2026-10-17'); none when it has no readable times. */
export function eventSlots(schedule: string | null | undefined, day: string): TimeSlot[] {
  const midnight = Date.parse(`${day}T00:00:00+05:30`);
  if (!schedule || !Number.isFinite(midnight)) return [];
  return [...schedule.matchAll(SLOT)].map(([, label, h1, m1, p1, h2, m2, p2]) => ({
    start: midnight + minutesOf(h1, m1, p1) * 60_000,
    end: midnight + minutesOf(h2, m2, p2) * 60_000,
    label: label ?? '',
  }));
}

export interface TimedEvent {
  id: string;
  name: string;
  slots: TimeSlot[];
}

/** Pairs of events with slots that overlap (each pair once, in the order given). */
export function clashes(events: readonly TimedEvent[]): [TimedEvent, TimedEvent][] {
  const pairs: [TimedEvent, TimedEvent][] = [];
  events.forEach((a, index) => {
    for (const b of events.slice(index + 1)) {
      if (a.slots.some((x) => b.slots.some((y) => x.start < y.end && y.start < x.end))) pairs.push([a, b]);
    }
  });
  return pairs;
}

/** The slot on now, else the next one to start, else null (all over). */
export function currentOrNext(slots: readonly TimeSlot[], now: number): { slot: TimeSlot; live: boolean } | null {
  const live = slots.find((slot) => slot.start <= now && now < slot.end);
  if (live) return { slot: live, live: true };
  const next = slots.filter((slot) => slot.start > now).sort((a, b) => a.start - b.start)[0];
  return next ? { slot: next, live: false } : null;
}

/** '10:30 AM' in IST. */
export function istTime(ms: number): string {
  const minutes = Math.floor((ms + 5.5 * 3_600_000) / 60_000) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 'in 25 min', 'in 1 h 05 min'. */
export function untilText(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  if (total < 60) return `in ${total} min`;
  return `in ${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
}
