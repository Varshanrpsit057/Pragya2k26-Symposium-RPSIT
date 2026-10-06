import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { events } from '../../content/events';
import type { SymposiumEvent } from '../../content/types';
import { SiteModalsProvider } from '../modal/SiteModals';
import { EventCard } from './EventCard';

const baseEvent: SymposiumEvent = {
  id: 'code-flex',
  name: 'CODE FLEX',
  subtitle: 'Multi-language Coding Challenge',
  category: 'technical',
  description: 'A coding challenge across multiple programming languages.',
  icon: 'code',
};

describe('EventCard', () => {
  it('shows the name, subtitle, category and description', () => {
    render(<EventCard event={baseEvent} />);

    expect(screen.getByRole('heading', { name: 'CODE FLEX' })).toBeInTheDocument();
    expect(screen.getByText('Multi-language Coding Challenge')).toBeInTheDocument();
    expect(screen.getByText('Technical')).toBeInTheDocument();
    expect(screen.getByText(baseEvent.description)).toBeInTheDocument();
  });

  it('is addressable by its anchor', () => {
    const { container } = render(<EventCard event={baseEvent} />);
    expect(container.querySelector('#event-code-flex')).not.toBeNull();
  });

  it('shows the poster artwork as a banner when the event has a poster', () => {
    const { container } = render(<EventCard event={{ ...baseEvent, poster: '/posters/code-flex.webp' }} />);
    expect(container.querySelector('.event-card__media img')).toHaveAttribute(
      'src',
      '/posters/code-flex.webp',
    );
  });

  it('has no banner without a poster', () => {
    const { container } = render(<EventCard event={baseEvent} />);
    expect(container.querySelector('.event-card__media')).toBeNull();
  });

  it('shows no details block while no optional details are set', () => {
    const { container } = render(<EventCard event={baseEvent} />);
    expect(container.querySelector('.event-card__details')).toBeNull();
  });

  it('has exactly two buttons, See More and Register Now, and no links away', () => {
    render(<EventCard event={baseEvent} />);

    const card = screen.getByRole('article');
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['See More', 'Register Now']);
    expect(within(card).queryAllByRole('link')).toHaveLength(0);
  });

  it.each(events.map((event) => [event.name, event] as const))(
    '%s: See More opens its details, and Register Now there opens the registration form',
    (_, event) => {
      render(
        <SiteModalsProvider>
          <EventCard event={event} />
        </SiteModalsProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: `See more about ${event.name}` }));
      const details = screen.getByRole('dialog', { name: event.name });
      expect(details).toHaveAttribute('open');
      for (const heading of ['Rounds', 'Event procedure', 'Rules', 'Judging criteria', 'Important instructions']) {
        expect(within(details).getByRole('heading', { name: heading })).toBeInTheDocument();
      }
      expect(within(details).queryByText('Eligibility')).toBeNull();

      fireEvent.click(within(details).getByRole('button', { name: 'Register Now' }));
      expect(details).not.toHaveAttribute('open');
      expect(screen.getByRole('dialog', { name: 'PRAGYA 2026 Registration' })).toHaveAttribute('open');
    },
  );

  it('closes the details window with either Close button (corner or footer)', () => {
    render(
      <SiteModalsProvider>
        <EventCard event={events[0]} />
      </SiteModalsProvider>,
    );
    const openDetails = () => {
      fireEvent.click(screen.getByRole('button', { name: `See more about ${events[0].name}` }));
      return screen.getByRole('dialog', { name: events[0].name });
    };

    for (const which of [0, 1]) {
      const details = openDetails();
      fireEvent.click(within(details).getAllByRole('button', { name: 'Close' })[which]);
      expect(details).not.toHaveAttribute('open');
    }
  });

  it('shows optional details once they are added', () => {
    render(
      <EventCard
        event={{
          ...baseEvent,
          teamSize: '2 members',
          venue: 'Lab 3',
          rules: ['Bring your own laptop'],
          coordinators: [{ name: 'A. Student', phone: '+91 00000 00000' }],
        }}
      />,
    );

    expect(screen.getByText('Team size')).toBeInTheDocument();
    expect(screen.getByText('2 members')).toBeInTheDocument();
    expect(screen.getByText('Lab 3')).toBeInTheDocument();
    expect(screen.getByText('Rules')).toBeInTheDocument();
    expect(screen.getByText('Bring your own laptop')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+91 00000 00000' })).toHaveAttribute(
      'href',
      'tel:+910000000000',
    );
  });
});
