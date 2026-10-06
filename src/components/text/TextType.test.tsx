import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TextType from './TextType';

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TextType', () => {
  it('shows the static text instead of animating when reduced motion is preferred', () => {
    mockReducedMotion(true);
    render(<TextType text={['First', 'Second']} staticText="Ten events" />);

    expect(screen.getByText('Ten events')).toBeInTheDocument();
  });

  it('starts empty and waits to type when motion is allowed', () => {
    mockReducedMotion(false);
    const { container } = render(<TextType text={['First']} />);

    expect(container.querySelector('.text-type__content')).toHaveTextContent('');
  });
});
