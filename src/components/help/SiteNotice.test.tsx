import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { liveScheduleForTests, refreshSchedule } from '../../lib/liveSchedule';
import { SiteNotice } from './SiteNotice';

const answer = (notice: unknown) =>
  (async () =>
    new Response(JSON.stringify({ success: true, schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-17T11:59:00' }, notice }), {
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

afterEach(() => {
  liveScheduleForTests(false);
  localStorage.clear();
});

describe('the organisers’ notice', () => {
  it('shows the notice the API gives, can be hidden, and shows again when a new one is posted', async () => {
    liveScheduleForTests(false);
    render(<SiteNotice />);
    expect(screen.queryByRole('status')).toBeNull();

    await act(() => refreshSchedule(answer({ text: 'COGNIX has moved to LH-05.', setAt: '2026-10-17T05:00:00.000Z' })));
    expect(screen.getByRole('status', { name: 'Notice from the organisers' })).toHaveTextContent('NoticeCOGNIX has moved to LH-05.');

    fireEvent.click(screen.getByRole('button', { name: 'Hide this notice' }));
    expect(screen.queryByRole('status')).toBeNull();

    await act(() => refreshSchedule(answer({ text: 'Lunch in the mess from 1 PM.', setAt: '2026-10-17T06:00:00.000Z' })));
    expect(screen.getByRole('status')).toHaveTextContent('Lunch in the mess from 1 PM.');

    // Taken down.
    await act(() => refreshSchedule(answer(null)));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
