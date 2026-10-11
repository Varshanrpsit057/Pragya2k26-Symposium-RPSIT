/**
 * The student page's timing alerts, worked out in the browser from the participant's events
 * and the event catalog (no extra requests): what is on now, what is next and when to leave,
 * which of their events overlap (and the order to take them in), and which fees are still to pay.
 */
import { eventCatalog } from '../content/eventCatalog';
import { clashes, currentOrNext, eventSlots, istTime, untilText, type TimeSlot } from '../lib/eventTimes';
import { rupees } from '../lib/registration';
import type { StudentEvent, StudentView } from '../lib/student';

export type AlertTone = 'now' | 'soon' | 'next' | 'clash' | 'pay' | 'info' | 'done';

export interface StudentAlert {
  tone: AlertTone;
  text: string;
}

/** Be at the venue this long before the start (as the event pages ask). */
const ARRIVE_EARLY_MS = 30 * 60_000;

export interface TimedStudentEvent extends StudentEvent {
  id: string;
  venue: string | null;
  schedule: string | null;
  routeMap: string | null;
  slots: TimeSlot[];
}

/** The participant's events with their venue, times and route map from the catalog. */
export function timedEvents(view: StudentView, day: string): TimedStudentEvent[] {
  return view.events.map((event) => {
    const info = eventCatalog.find((item) => item.id === event.eventId);
    return {
      ...event,
      id: event.eventId,
      venue: info?.venue ?? null,
      schedule: info?.schedule ?? null,
      routeMap: info?.routeMap ?? null,
      slots: eventSlots(info?.schedule, day),
    };
  });
}

const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const inVenue = (venue: string | null) => (venue ? ` in ${venue}` : '');
const named = (event: TimedStudentEvent, slot: TimeSlot) => `${event.name}${slot.label ? ` (${slot.label})` : ''}`;
const times = (slots: TimeSlot[]) => slots.map((slot) => `${slot.label ? `${slot.label} ` : ''}${istTime(slot.start)}–${istTime(slot.end)}`).join(', ');
const dateOf = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

/** The alerts for an approved participant at `now`, most urgent first. */
export function studentAlerts(view: StudentView, now: number, day: string): StudentAlert[] {
  if (view.status !== 'APPROVED') return [];
  const events = timedEvents(view, day);
  const fee = rupees(view.feePerEvent);
  if (!events.length) {
    return [{ tone: 'info', text: `You have not registered for any event yet. Go to an event's venue and register with its coordinator (${fee} per event).` }];
  }

  const alerts: StudentAlert[] = [];
  const ahead = events.flatMap((event) => {
    const found = currentOrNext(event.slots, now);
    return found ? [{ event, ...found }] : [];
  });
  for (const { event, slot } of ahead.filter((item) => item.live)) {
    alerts.push({ tone: 'now', text: `${named(event, slot)} is on now${inVenue(event.venue)}, until ${istTime(slot.end)}.` });
  }
  const next = ahead.filter((item) => !item.live).sort((a, b) => a.slot.start - b.slot.start)[0];
  if (next) {
    const { event, slot } = next;
    const wait = slot.start - now;
    const leaveBy = `Be there by ${istTime(slot.start - ARRIVE_EARLY_MS)}.`;
    if (wait <= ARRIVE_EARLY_MS) {
      alerts.push({ tone: 'soon', text: `${named(event, slot)} starts at ${istTime(slot.start)}${inVenue(event.venue)} (${untilText(wait)}): head there now.` });
    } else if (wait > 12 * 3_600_000) {
      alerts.push({ tone: 'next', text: `Next: ${named(event, slot)} on ${dateOf(slot.start)} at ${istTime(slot.start)}${inVenue(event.venue)}. ${leaveBy}` });
    } else {
      alerts.push({ tone: 'next', text: `Next: ${named(event, slot)} at ${istTime(slot.start)}${inVenue(event.venue)} (${untilText(wait)}). ${leaveBy}` });
    }
  }
  if (!ahead.length) alerts.push({ tone: 'done', text: 'All your events are over for today. Thank you for taking part!' });

  // Only events still to come can clash in a way that matters.
  const upcoming = events.filter((event) => ahead.some((item) => item.event.id === event.id));
  // The events run for a while: take the one that ends first, then move to the other.
  const endOf = (event: { slots: TimeSlot[] }) => Math.max(...event.slots.map((slot) => slot.end));
  for (const [a, b] of clashes(upcoming)) {
    const [first, second] = endOf(a) <= endOf(b) ? [a, b] : [b, a];
    alerts.push({
      tone: 'clash',
      text: `${a.name} (${times(a.slots)}) and ${b.name} (${times(b.slots)}) overlap. Both run for a while, so attend ${first.name} first, then move to ${second.name} (on until ${istTime(endOf(second))}).`,
    });
  }
  const sent = (event: TimedStudentEvent) => view.proofs.some((proof) => proof.kind === event.id);
  const unpaid = upcoming.filter((event) => !event.feePaid && !sent(event)).map((event) => event.name);
  const checking = upcoming.filter((event) => !event.feePaid && sent(event)).map((event) => event.name);
  if (unpaid.length) alerts.push({ tone: 'pay', text: `Pay ${fee} for ${listOf(unpaid)}: by GPay on this page (below), or in cash to the coordinator at the venue.` });
  if (checking.length) alerts.push({ tone: 'info', text: `Your GPay screenshot for ${listOf(checking)} is sent: the coordinator approves it at the venue.` });
  return alerts;
}
