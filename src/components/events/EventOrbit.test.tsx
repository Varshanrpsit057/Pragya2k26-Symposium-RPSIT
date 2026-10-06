import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { events } from '../../content/events';
import { EventOrbit, SHOWCASE_EVENTS } from './EventOrbit';

afterEach(() => {
  window.location.hash = '';
});

describe('EventOrbit', () => {
  it('puts every event poster on the ring', () => {
    render(<EventOrbit />);

    expect(SHOWCASE_EVENTS).toHaveLength(events.length);
    SHOWCASE_EVENTS.forEach((event, index) => {
      const slide = screen.getByRole('group', { name: `${event.name}, ${index + 1} of 10` });
      const image = slide.querySelector('img');
      expect(image).toHaveAttribute('src', event.poster);
      expect(image).toHaveAttribute('loading', 'lazy');
    });
  });

  it('links the details button to the front event', () => {
    render(<EventOrbit />);

    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      '#event-pro-pitch',
    );
  });

  it('opens the front event when Enter is pressed on the carousel', () => {
    render(<EventOrbit />);

    fireEvent.keyDown(screen.getByRole('region', { name: 'PRAGYA 2026 event posters' }), {
      key: 'Enter',
    });
    expect(window.location.hash).toBe('#event-pro-pitch');
  });

  it('turns continuously, without stopping at each poster', () => {
    render(<EventOrbit />);

    expect(screen.getByRole('region', { name: 'PRAGYA 2026 event posters' })).toHaveAttribute('data-autoplay', 'drift');
  });

  it('offers previous and next buttons', () => {
    render(<EventOrbit />);

    expect(screen.getByRole('button', { name: 'Previous event' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next event' })).toBeInTheDocument();
  });
});
