import { describe, expect, it } from 'vitest';
import { formatIst, parseEventStart, remainingUntil } from './countdown';

describe('parseEventStart', () => {
  it('reads a time without a zone as IST, the same instant for every visitor', () => {
    expect(parseEventStart('2026-10-30T09:00:00')).toBe(Date.parse('2026-10-30T03:30:00Z'));
  });

  it('respects an explicit offset', () => {
    expect(parseEventStart('2026-10-30T09:00:00+05:30')).toBe(Date.parse('2026-10-30T03:30:00Z'));
    expect(parseEventStart('2026-10-30T03:30:00Z')).toBe(Date.parse('2026-10-30T03:30:00Z'));
  });

  it('returns null for something that is not a date', () => {
    expect(parseEventStart('soon')).toBeNull();
  });
});

describe('remainingUntil', () => {
  const target = Date.parse('2026-10-30T03:30:00Z');

  it('splits the time left into days, hours, minutes and seconds', () => {
    const now = target - ((25 * 24 + 14) * 3600 + 32 * 60 + 8) * 1000;
    expect(remainingUntil(target, now)).toEqual({ days: 25, hours: 14, minutes: 32, seconds: 8, done: false });
  });

  it('shows one second until the exact start time, then exactly zero', () => {
    expect(remainingUntil(target, target - 1)).toMatchObject({ seconds: 1, done: false });
    expect(remainingUntil(target, target)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
  });

  it('never goes negative after the start', () => {
    expect(remainingUntil(target, target + 90_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true });
  });
});

describe('formatIst', () => {
  it('writes the start time in IST', () => {
    expect(formatIst(Date.parse('2026-10-30T03:30:00Z'))).toBe('30 October 2026 · 9:00 AM IST');
    expect(formatIst(Date.parse('2026-10-30T09:15:00Z'))).toBe('30 October 2026 · 2:45 PM IST');
  });
});
