import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { parseRouteHash } from './routeHash';

// The page downloads the Route map window when it is first opened; load it once up front, so the
// tests do not depend on how long that takes on a busy machine.
beforeAll(async () => {
  await import('./RouteMapModal');
}, 60_000);

/** The open Route map window (found directly: a role search over the whole page and its map is slow). */
async function routeDialog() {
  const dialog = await waitFor(
    () => {
      const found = document.querySelector<HTMLDialogElement>('dialog.route-modal');
      expect(found?.open).toBe(true);
      return found!;
    },
    { timeout: 10_000 },
  );
  expect(dialog).toHaveAccessibleName('Route map');
  return dialog;
}

/** Each of these renders the whole home page and the map: generous when every test runs at once. */
const SLOW = 30_000;

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
    const dialog = await routeDialog();
    // Nothing chosen yet: the five events to choose from, and the map ready for any place.
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    const campus = within(dialog).getByRole('region', { name: 'Campus map' });
    expect(campus).toHaveTextContent('Choose where you want to go: an event, a restroom, drinking water, the canteen and more.');

    fireEvent.click(within(dialog).getByRole('radio', { name: /COGNIX/ }));
    const map = within(dialog).getByRole('region', { name: 'Map to Theta Lab' });
    expect(map).toHaveTextContent('Theta Lab is on the second floor of the main building.');
    expect(within(map).getByRole('list', { name: 'How to get to Theta Lab' })).toHaveTextContent('From the main gate, walk up the road');
    expect(window.location.hash).toBe('#route-map=cognix');

    // Another event, from where the student said they are (the canteen): its own venue and way.
    fireEvent.change(within(dialog).getByLabelText('I am at'), { target: { value: 'canteen' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /PAPER PRESENTATION/ }));
    const paper = within(dialog).getByRole('region', { name: 'Map to LH-05' });
    expect(paper).toHaveTextContent('LH-05 is on the ground floor of the main building.');
    expect(within(paper).getByLabelText('I am at')).toHaveValue('canteen');
    expect(within(paper).getByRole('list', { name: 'How to get to LH-05' })).toHaveTextContent('Come out of the canteen onto the road.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(window.location.hash).toBe('');
  }, SLOW);

  it('opens straight on the event in a shared link', async () => {
    window.history.replaceState(null, '', '/#route-map=code-flex');
    render(<App />);
    const dialog = await routeDialog();
    expect(within(dialog).getByRole('radio', { name: /CODE FLEX/ })).toBeChecked();
    expect(within(dialog).getByRole('region', { name: 'Map to Delta Lab' })).toHaveTextContent('Delta Lab is on the second floor');
  }, SLOW);

  it('reads only its own links', () => {
    expect(parseRouteHash('#route-map')).toEqual({ eventId: null });
    expect(parseRouteHash('#route-map=viz-craft')).toEqual({ eventId: 'viz-craft' });
    expect(parseRouteHash('#status=abc')).toBeNull();
    expect(parseRouteHash('#route-map=<script>')).toBeNull();
  });
});
