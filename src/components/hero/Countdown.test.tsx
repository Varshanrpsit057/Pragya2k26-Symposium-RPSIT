import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './Countdown';

const START = '2026-10-16T17:00:00'; // IST
const START_MS = Date.parse('2026-10-16T11:30:00Z');

const renderCountdown = () =>
  render(<Countdown target={START} label="Registration closes in" endedLabel="Registration closed" />);

const values = () => screen.getAllByRole('listitem').map((item) => item.firstElementChild?.textContent);

/** The clock wakes a few ms after each whole second; step just past it. */
const advanceSeconds = (seconds: number) => act(() => vi.advanceTimersByTime(seconds * 1000 + 10));

describe('Countdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows days, hours, minutes and seconds and updates every second', () => {
    vi.setSystemTime(START_MS - ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000);
    renderCountdown();

    expect(screen.getByRole('timer', { name: 'Registration closes in' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent)).toEqual([
      'days',
      'hours',
      'minutes',
      'seconds',
    ]);
    expect(values()).toEqual(['02', '03', '04', '05']);

    advanceSeconds(1);
    expect(values()).toEqual(['02', '03', '04', '04']);

    advanceSeconds(5);
    expect(values()).toEqual(['02', '03', '03', '59']);
    expect(screen.getByText('16 October 2026 · 5:00 PM IST')).toBeInTheDocument();
  });

  it('reaches exactly zero at 5 PM on 16 October and then says registration is closed', () => {
    vi.setSystemTime(START_MS - 3000);
    renderCountdown();
    expect(values()).toEqual(['00', '00', '00', '03']);

    advanceSeconds(2);
    expect(values()).toEqual(['00', '00', '00', '01']);

    advanceSeconds(1);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Registration closed');
  });

  it('keeps saying registration is closed afterwards, with no negative numbers', () => {
    vi.setSystemTime(START_MS + 60_000);
    renderCountdown();
    expect(screen.getByRole('status')).toHaveTextContent('Registration closed');
  });
});
