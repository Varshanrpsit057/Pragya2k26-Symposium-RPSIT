import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import type { SymposiumEvent } from '../../content/types';
import { SiteModalsContext } from '../modal/siteModalsContext';
import { RegisterButton } from './RegisterButton';

const event: SymposiumEvent = {
  id: 'code-flex',
  name: 'CODE FLEX',
  category: 'technical',
  description: 'A coding challenge.',
  icon: 'code',
};

/** The visitor's clock at this IST time (only Date is faked; timers run as usual). */
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(iso));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('RegisterButton', () => {
  beforeEach(() => at('2026-10-12T10:00:00+05:30'));

  it('is a button that opens the shared registration window, never a link', () => {
    const openRegistration = vi.fn();
    render(
      <SiteModalsContext.Provider value={{ openRegistration, openEventDetails: vi.fn(), openDevCrew: vi.fn(), windowOpen: false }}>
        <RegisterButton event={event} />
      </SiteModalsContext.Provider>,
    );

    const button = screen.getByRole('button', { name: 'Register Now for CODE FLEX' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('link')).toBeNull();

    fireEvent.click(button);
    expect(openRegistration).toHaveBeenCalledWith(event);
  });

  it('reads simply "Register Now" when it is not on an event card', () => {
    render(<RegisterButton />);
    expect(screen.getByRole('button', { name: 'Register Now' })).toBeInTheDocument();
  });
});

describe('Register Now or Student login, across the page', () => {
  it('offers Register Now before the event day', async () => {
    at('2026-10-12T10:00:00+05:30');
    render(<App />);
    expect((await screen.findAllByRole('button', { name: 'Register Now' })).length).toBeGreaterThan(0);
    // Before the day Student login is only a text link (for passes of approved students), never in place of Register Now.
    const links = screen.queryAllByRole('link', { name: 'Student login' });
    expect(links).toHaveLength(1);
    expect(links[0].closest('.register__lead')).not.toBeNull();
  });

  it('offers Student login (the student page) instead on the event day, everywhere', async () => {
    at('2026-10-17T09:00:00+05:30');
    render(<App />);
    const links = await screen.findAllByRole('link', { name: 'Student login' });
    // The nav (bar and menu), the hero, every event card and the register section.
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const link of links) expect(link).toHaveAttribute('href', '/landing/student/');
    expect(screen.queryByRole('button', { name: /Register Now/ })).toBeNull();
    expect(screen.getByText(/Already registered\? Use Student login/)).toBeInTheDocument();
  });
});
