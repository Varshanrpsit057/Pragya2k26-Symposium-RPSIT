import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PillNav } from './PillNav';

const items = [
  { id: 'home', label: 'Home' },
  { id: 'technical', label: 'Technical' },
  { id: 'contact', label: 'Contact' },
];
const cta = { id: 'register', label: 'Register' };

const renderNav = () => {
  const onCrewClick = vi.fn();
  render(
    <PillNav
      items={items}
      sectionIds={items.map((item) => item.id)}
      brandLabel="R P Sarathy Institute of Technology"
      cta={cta}
      onCrewClick={onCrewClick}
    />,
  );
  return onCrewClick;
};

describe('PillNav', () => {
  it('puts the Dev Crew incognito button right after Contact, and opens the crew from it', () => {
    const onCrewClick = renderNav();

    const button = screen.getByRole('button', { name: 'Meet the Dev Crew' });
    const track = button.closest('.pill-nav__track') as HTMLElement;
    expect(within(track).getAllByRole('link').at(-1)).toHaveTextContent('Contact');
    expect(button.previousElementSibling?.tagName).toBe('UL');

    fireEvent.click(button);
    expect(onCrewClick).toHaveBeenCalledTimes(1);
  });

  it('lists the Dev Crew in the phone menu too, closing the menu as it opens the crew', () => {
    const onCrewClick = renderNav();

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(toggle);
    const menu = document.getElementById('mobile-menu') as HTMLElement;
    fireEvent.click(within(menu).getByRole('button', { name: 'Dev Crew' }));

    expect(onCrewClick).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows no Dev Crew button when there is nothing to open', () => {
    render(<PillNav items={items} sectionIds={[]} brandLabel="R P Sarathy" cta={cta} />);

    expect(screen.queryByRole('button', { name: 'Meet the Dev Crew' })).toBeNull();
  });
});
