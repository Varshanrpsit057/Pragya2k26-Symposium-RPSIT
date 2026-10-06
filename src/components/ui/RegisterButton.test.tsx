import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('RegisterButton', () => {
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
