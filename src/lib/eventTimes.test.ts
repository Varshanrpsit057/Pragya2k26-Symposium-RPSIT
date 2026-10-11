import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../content/eventCatalog';
import { clashes, currentOrNext, eventSlots, istTime, untilText } from './eventTimes';

const DAY = '2026-10-17';
const at = (time: string) => Date.parse(`${DAY}T${time}:00+05:30`);
const timed = (id: string) => {
  const event = eventCatalog.find((item) => item.id === id)!;
  return { id, name: event.name, slots: eventSlots(event.schedule, DAY) };
};

describe('event times', () => {
  it('reads one slot, or several rounds, in IST on the event day', () => {
    expect(eventSlots('10:30 AM – 12:00 PM', DAY)).toEqual([{ start: at('10:30'), end: at('12:00'), label: '' }]);
    expect(eventSlots('Round 1: 12:15 PM – 1:00 PM · Round 2: 2:00 PM – 2:40 PM', DAY)).toEqual([
      { start: at('12:15'), end: at('13:00'), label: 'Round 1' },
      { start: at('14:00'), end: at('14:40'), label: 'Round 2' },
    ]);
    expect(eventSlots('To be announced', DAY)).toEqual([]);
    expect(eventSlots(undefined, DAY)).toEqual([]);
    // Every event in the catalog has readable times.
    for (const event of eventCatalog) expect(eventSlots(event.schedule, DAY).length, event.id).toBeGreaterThan(0);
  });

  it('finds the events that overlap', () => {
    const names = (pairs: ReturnType<typeof clashes>) => pairs.map(([a, b]) => `${a.name} + ${b.name}`);
    expect(names(clashes([timed('pro-pitch'), timed('viz-craft'), timed('cognix')]))).toEqual(['PRO-PITCH + VIZ CRAFT']);
    // Code Flex round 1 (12:15–1:00) overlaps Cognix (12:00–1:00) and the end of Paper Presentation.
    expect(names(clashes([timed('code-flex'), timed('cognix'), timed('paper-presentation')]))).toEqual([
      'CODE FLEX + COGNIX',
      'CODE FLEX + PAPER PRESENTATION',
      'COGNIX + PAPER PRESENTATION',
    ]);
    // Back to back is not a clash: Viz Craft ends 11:40, Cognix starts 12:00.
    expect(clashes([timed('viz-craft'), timed('cognix')])).toEqual([]);
  });

  it('says what is on now or next, and formats times', () => {
    const { slots } = timed('code-flex');
    expect(currentOrNext(slots, at('11:00'))).toEqual({ slot: slots[0], live: false });
    expect(currentOrNext(slots, at('12:30'))).toEqual({ slot: slots[0], live: true });
    expect(currentOrNext(slots, at('13:30'))).toEqual({ slot: slots[1], live: false });
    expect(currentOrNext(slots, at('15:00'))).toBeNull();
    expect(istTime(at('09:05'))).toBe('9:05 AM');
    expect(istTime(at('12:15'))).toBe('12:15 PM');
    expect(istTime(at('00:30'))).toBe('12:30 AM');
    expect(untilText(25 * 60_000)).toBe('in 25 min');
    expect(untilText(65 * 60_000)).toBe('in 1 h 05 min');
  });
});
