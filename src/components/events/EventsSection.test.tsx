import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { eventAnchor, events, eventsByCategory } from '../../content/events';
import type { EventCategory } from '../../content/types';
import { focusEvent } from '../../lib/eventFocus';
import { SiteModalsProvider } from '../modal/SiteModals';
import { EventsSection } from './EventsSection';

const renderTrack = (category: EventCategory) =>
  render(
    <SiteModalsProvider>
      <EventsSection category={category} title={`${category} events`} lead="Lead" />
    </SiteModalsProvider>,
  );

const panelOf = (container: HTMLElement, eventId: string) => container.querySelector<HTMLElement>(`#event-${eventId}`)!;

describe('EventsSection (accordion gallery)', () => {
  it.each(['technical'] as const)('shows the %s track as five panels with the new artwork', (category) => {
    renderTrack(category);
    const list = eventsByCategory(category);

    const gallery = screen.getByRole('list', { name: `${category} events` });
    const panels = within(gallery).getAllByRole('listitem');
    expect(panels).toHaveLength(5);
    panels.forEach((panel, index) => {
      const event = list[index];
      expect(panel).toHaveAttribute('id', eventAnchor(event));
      expect(panel).toHaveAccessibleName(event.name);
      expect(panel.querySelector('img')).toHaveAttribute('src', event.posterLarge);
      // Every folded strip still says which event it is.
      expect(panel.querySelector('.ag-panel__peek')).toHaveTextContent(event.name);
    });
    // None is open at first: each event waits for the visitor to reach it.
    panels.forEach((panel) => expect(panel).not.toHaveAttribute('aria-current'));
    expect(gallery).toHaveAttribute('data-idle');
  });

  it('folds every panel back when the mouse leaves the row, but not when a finger lifts', () => {
    const { container } = renderTrack('technical');
    const list = eventsByCategory('technical');
    const gallery = screen.getByRole('list', { name: 'technical events' });

    fireEvent.click(panelOf(container, list[1].id));
    expect(panelOf(container, list[1].id)).toHaveAttribute('aria-current', 'true');
    expect(gallery).not.toHaveAttribute('data-idle');

    fireEvent.pointerLeave(gallery, { pointerType: 'touch' });
    expect(panelOf(container, list[1].id)).toHaveAttribute('aria-current', 'true');

    fireEvent.pointerLeave(gallery, { pointerType: 'mouse' });
    expect(gallery).toHaveAttribute('data-idle');
    list.forEach((event) => expect(panelOf(container, event.id)).not.toHaveAttribute('aria-current'));
  });

  it('keeps the buttons of folded panels out of reach, and opens a panel when it is tapped or focused', () => {
    const { container } = renderTrack('technical');
    const [first, second] = eventsByCategory('technical');

    expect(panelOf(container, first.id).querySelector('.ag-panel__label')).toHaveAttribute('inert');

    fireEvent.click(panelOf(container, first.id));
    expect(panelOf(container, first.id)).toHaveAttribute('aria-current', 'true');
    expect(panelOf(container, first.id).querySelector('.ag-panel__label')).not.toHaveAttribute('inert');

    fireEvent.focus(panelOf(container, second.id));
    expect(panelOf(container, second.id)).toHaveAttribute('aria-current', 'true');
    expect(panelOf(container, first.id)).not.toHaveAttribute('aria-current');
  });

  it('moves between panels with the arrow keys', () => {
    const { container } = renderTrack('technical');
    const list = eventsByCategory('technical');
    fireEvent.keyDown(panelOf(container, list[2].id), { key: 'ArrowRight' });
    expect(panelOf(container, list[3].id)).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(panelOf(container, list[3].id), { key: 'ArrowLeft' });
    expect(panelOf(container, list[2].id)).toHaveAttribute('aria-current', 'true');
  });

  it.each(events.map((event) => [event.name, event] as const))(
    '%s: its panel offers See More (the details window) and Register Now (the form, with the event chosen)',
    (_, event) => {
      const { container } = renderTrack(event.category);
      const panel = panelOf(container, event.id);
      fireEvent.click(panel);

      fireEvent.click(within(panel).getByRole('button', { name: `See more about ${event.name}` }));
      const details = screen.getByRole('dialog', { name: event.name });
      expect(details).toHaveAttribute('open');
      fireEvent.click(within(details).getAllByRole('button', { name: 'Close' })[0]);

      fireEvent.click(within(panel).getByRole('button', { name: `Register Now for ${event.name}` }));
      const form = screen.getByRole('dialog', { name: 'PRAGYA 2026 Registration' });
      expect(form).toHaveAttribute('open');
      expect(within(form).getByRole('checkbox', { name: new RegExp(`^${event.name}`) })).toBeChecked();
    },
  );

  it('opens the event chosen elsewhere on the page (the carousel), however often it is chosen', () => {
    const { container } = renderTrack('technical');
    const [vizCraft, paper] = eventsByCategory('technical').slice(1, 3);

    act(() => focusEvent(vizCraft.id));
    expect(panelOf(container, vizCraft.id)).toHaveAttribute('aria-current', 'true');
    expect(window.location.hash).toBe(`#${eventAnchor(vizCraft)}`);

    fireEvent.click(panelOf(container, paper.id));
    act(() => focusEvent(vizCraft.id));
    expect(panelOf(container, vizCraft.id)).toHaveAttribute('aria-current', 'true');
  });

  it('gives a technical event its student coordinators at the top, then time, venue with a route map, prizes, each once', () => {
    const { container } = renderTrack('technical');
    const proPitch = events.find((event) => event.id === 'pro-pitch')!;
    const panel = panelOf(container, proPitch.id);
    fireEvent.click(panel);
    fireEvent.click(within(panel).getByRole('button', { name: `See more about ${proPitch.name}` }));

    const details = screen.getByRole('dialog', { name: proPitch.name });
    expect(details.querySelector('img')).toBeNull();

    // Student coordinators only, straight under the name; no staff.
    const coordinators = within(details).getByLabelText('Event coordinators');
    expect([...coordinators.querySelectorAll('.event-details__chip')].map((chip) => chip.textContent)).toEqual(['Kabil V', 'Vaishnavi R']);
    expect(within(details).queryByText(/Mrs\.|Mr\.|Staff/)).toBeNull();
    const heading = within(details).getByRole('heading', { level: 2, name: proPitch.name });
    expect(heading.compareDocumentPosition(coordinators) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(coordinators.compareDocumentPosition(within(details).getByText('Delta Lab')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(details).getByText('10:30 AM – 12:00 PM')).toBeInTheDocument();
    expect(within(details).getByText('Individual or team')).toBeInTheDocument();
    expect(within(details).getByText('₹1,000')).toBeInTheDocument();
    expect(within(details).getByText('Participation certificate for every participant')).toBeInTheDocument();

    // The route map: the campus map in this window, Delta Lab lit up on its floor, with directions.
    fireEvent.click(within(details).getByRole('button', { name: 'Route map' }));
    const map = within(details).getByRole('region', { name: 'Map to Delta Lab' });
    expect(map).toHaveTextContent('Delta Lab is on the second floor of the main building.');
    expect(within(map).getByRole('tab', { name: /Second floor/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(map).getByRole('list', { name: 'How to get to Delta Lab' })).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: 'Hide map' })).toHaveAttribute('aria-expanded', 'true');

    // The judges' decision and the venue's rules are final.
    expect(within(details).getByText(/The judges' decision is final\. No arguments about the winners will be entertained\./)).toBeInTheDocument();
    expect(within(details).getByText(/the rules on this website are subject to change/)).toBeInTheDocument();

    // Nothing said twice: the old type, rounds-count and per-event instruction lists are gone.
    expect(within(details).queryByText('Event type')).toBeNull();
    expect(within(details).getAllByText(/gate pass ₹100/i)).toHaveLength(1);
    // Help on the day: the help desk (and the overall coordinator), by phone.
    expect(within(details).getByText('Any help on the day? Call the help desk:')).toBeInTheDocument();
    for (const link of within(details).getAllByRole('link', { name: '+91 73582 13736' })) expect(link).toHaveAttribute('href', 'tel:+917358213736');
    expect(within(details).queryByText(/Details are provisional/)).toBeNull();
  });

  it('opens the route map when one is configured for the event', () => {
    const codeFlex = events.find((event) => event.id === 'code-flex')!;
    codeFlex.routeMap = 'https://maps.example.com/delta-lab';
    try {
      const { container } = renderTrack('technical');
      const panel = panelOf(container, codeFlex.id);
      fireEvent.click(panel);
      fireEvent.click(within(panel).getByRole('button', { name: `See more about ${codeFlex.name}` }));
      const details = screen.getByRole('dialog', { name: codeFlex.name });
      const link = within(details).getByRole('link', { name: 'Route map to Delta Lab (opens in a new tab)' });
      expect(link).toHaveAttribute('href', 'https://maps.example.com/delta-lab');
      expect(link).toHaveAttribute('target', '_blank');
      expect(within(details).getByText('Individual')).toBeInTheDocument();
    } finally {
      codeFlex.routeMap = null;
    }
  });

  it('opens the event named in a #event-… link', () => {
    const { container } = renderTrack('technical');
    act(() => {
      window.location.hash = '#event-cognix';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(panelOf(container, 'cognix')).toHaveAttribute('aria-current', 'true');
  });
});
