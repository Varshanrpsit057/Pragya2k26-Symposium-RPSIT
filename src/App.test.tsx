import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens with the department, the PRAGYA 2K26 emblem and the symposium name', () => {
    render(<App />);

    const heading = screen.getByRole('heading', { level: 1, name: /PRAGYA 2026/ });
    // The emblem is decorative: the heading text is what is read out.
    expect(heading.querySelector('img.hero__logo')).toHaveAttribute('alt', '');
    const hero = document.getElementById('home') as HTMLElement;
    expect(within(hero).getByText('Artificial Intelligence and Data Science')).toBeInTheDocument();
  });

  it('shows the symposium date large, right under the PRAGYA 2026 heading, and only once', () => {
    render(<App />);
    const hero = document.getElementById('home') as HTMLElement;

    const date = within(hero).getByText('17 October 2026');
    expect(date).toHaveClass('hero__date');
    // Part of the heading lockup (department, emblem, date), not the small facts below.
    expect(date.closest('.hero__lockup')).not.toBeNull();
    expect(within(hero).queryByText('When')).toBeNull();
  });

  it('renders one detailed card per event', () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll('.event-card')).toHaveLength(10);
  });

  it('has every section the navigation points to', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    within(nav)
      .getAllByRole('link')
      .forEach((link) => {
        const target = link.getAttribute('href')!.slice(1);
        expect(document.getElementById(target), `#${target}`).not.toBeNull();
      });
  });
});
