import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { eventAnchor, events } from '../../content/events';
import { NeuralMap } from './NeuralMap';

describe('NeuralMap', () => {
  it('shows every event as a linked node with its icon', () => {
    const { container } = render(<NeuralMap />);

    events.forEach((event) => {
      const link = screen.getByRole('link', { name: new RegExp(`^${event.name},`) });
      expect(link).toHaveAttribute('href', `#${eventAnchor(event)}`);
      expect(link.querySelector('.neural-map__icon path, .neural-map__icon circle')).not.toBeNull();
    });
    expect(container.querySelectorAll('.neural-map__tile')).toHaveLength(events.length);
  });

  it('colours each tile by its track', () => {
    const { container } = render(<NeuralMap />);
    const fills = Array.from(container.querySelectorAll('.neural-map__tile')).map((tile) =>
      tile.getAttribute('fill'),
    );

    expect(fills.filter((fill) => fill === 'url(#neural-map-technical)')).toHaveLength(5);
    expect(fills.filter((fill) => fill === 'url(#neural-map-non-technical)')).toHaveLength(5);
  });
});
