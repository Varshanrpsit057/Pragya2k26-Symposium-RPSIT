import { describe, expect, it } from 'vitest';
import { isCarouselPaused, type PauseInputs } from './carousel';

const idle: PauseInputs = {
  pauseOnHover: true,
  hover: false,
  touchHold: false,
  keyboardFocus: false,
  drag: false,
  holdUntil: 0,
};

describe('isCarouselPaused', () => {
  it('runs when nothing is holding it', () => {
    expect(isCarouselPaused(idle, 1000)).toBe(false);
  });

  it.each<[string, Partial<PauseInputs>]>([
    ['the mouse is over it', { hover: true }],
    ['a finger is on it', { touchHold: true }],
    ['it has keyboard focus', { keyboardFocus: true }],
    ['it is being dragged', { drag: true }],
  ])('pauses while %s', (_, change) => {
    expect(isCarouselPaused({ ...idle, ...change }, 1000)).toBe(true);
  });

  it('stays paused until a hold expires, then resumes', () => {
    const held = { ...idle, holdUntil: 5000 };
    expect(isCarouselPaused(held, 4999)).toBe(true);
    expect(isCarouselPaused(held, 5000)).toBe(false);
  });

  it('ignores hover and touch when pause-on-hover is off', () => {
    expect(isCarouselPaused({ ...idle, pauseOnHover: false, hover: true, touchHold: true }, 0)).toBe(
      false,
    );
  });
});
