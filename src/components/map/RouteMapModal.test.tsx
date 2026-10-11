import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { parseRouteHash } from './RouteMapModal';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the Route map on the home page', () => {
  it('opens from the hero, shows the way once an event is chosen, follows the choice in the address, and closes', async () => {
    render(<App />);
    const hero = document.getElementById('home') as HTMLElement;
    const button = within(hero).getByRole('link', { name: 'Route map' });
    expect(button).toHaveAttribute('href', '#route-map');
    window.location.hash = 'route-map';
    const dialog = await screen.findByRole('dialog', { name: 'Route map' });
    // Nothing chosen yet: the five events to choose from.
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    expect(within(dialog).getByText(/Pick an event above/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: /COGNIX/ }));
    const map = within(dialog).getByRole('region', { name: 'Map to Theta Lab' });
    expect(map).toHaveTextContent('Theta Lab is on the second floor of the main building.');
    expect(within(map).getByRole('list', { name: 'How to get to Theta Lab' })).toHaveTextContent('Start at the main gate');
    expect(window.location.hash).toBe('#route-map=cognix');

    // Another event: its own venue and way.
    fireEvent.click(within(dialog).getByRole('radio', { name: /PAPER PRESENTATION/ }));
    expect(within(dialog).getByRole('region', { name: 'Map to LH-05' })).toHaveTextContent('LH-05 is on the ground floor of the main building.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(window.location.hash).toBe('');
  });

  it('opens straight on the event in a shared link', async () => {
    window.history.replaceState(null, '', '/#route-map=code-flex');
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Route map' });
    expect(within(dialog).getByRole('radio', { name: /CODE FLEX/ })).toBeChecked();
    expect(within(dialog).getByRole('region', { name: 'Map to Delta Lab' })).toHaveTextContent('Delta Lab is on the second floor');
  });

  it('reads only its own links', () => {
    expect(parseRouteHash('#route-map')).toEqual({ eventId: null });
    expect(parseRouteHash('#route-map=viz-craft')).toEqual({ eventId: 'viz-craft' });
    expect(parseRouteHash('#status=abc')).toBeNull();
    expect(parseRouteHash('#route-map=<script>')).toBeNull();
  });
});
