import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens with the department, the PRAGYA 2K26 emblem and the symposium name', () => {
    render(<App />);

    const heading = screen.getByRole('heading', { level: 1, name: 'PRAGYA 2026' });
    // The name and edition are type, not a picture: drawn in the site's own colours.
    expect(heading.querySelector('.hero__wordmark')).toHaveTextContent('PRAGYA');
    expect(heading.querySelector('.hero__edition')).toHaveTextContent('2K26');
    expect(heading.querySelector('img')).toBeNull();
    const hero = document.getElementById('home') as HTMLElement;
    expect(within(hero).getByText('Artificial Intelligence and Data Science')).toBeInTheDocument();
  });

  it('draws the emblem as a decorative background layer that starts in the hero', () => {
    const { container } = render(<App />);

    const slot = document.getElementById('hero-emblem') as HTMLElement;
    expect(slot.closest('#home')).not.toBeNull();
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    const layer = container.querySelector('.brand-emblem') as HTMLElement;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.closest('#home')).toBeNull();
    expect(layer.querySelector('svg')).not.toBeNull();
  });

  it('takes "Explore the events" straight to the technical events', () => {
    render(<App />);
    const hero = document.getElementById('home') as HTMLElement;

    expect(within(hero).getByRole('link', { name: 'Explore the events' })).toHaveAttribute('href', '#technical');
    expect(document.getElementById('technical')).not.toBeNull();
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

  it('shows every event as a panel in its track, two galleries of five', () => {
    render(<App />);
    for (const title of ['Technical events', 'Non-technical events']) {
      expect(within(screen.getByRole('list', { name: title })).getAllByRole('listitem')).toHaveLength(5);
    }
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
