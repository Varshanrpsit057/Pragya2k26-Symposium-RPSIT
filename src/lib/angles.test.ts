import { describe, expect, it } from 'vitest';
import { nearestEquivalentAngle, normalizeAngle, wrapIndex } from './angles';

describe('normalizeAngle', () => {
  it.each([
    [0, 0],
    [190, -170],
    [-190, 170],
    [360, 0],
    [725, 5],
    [180, -180],
  ])('wraps %d to %d', (input, expected) => {
    expect(normalizeAngle(input)).toBe(expected);
  });
});

describe('nearestEquivalentAngle', () => {
  it('takes the short way round', () => {
    expect(nearestEquivalentAngle(324, 0)).toBe(-36);
    expect(nearestEquivalentAngle(36, 350)).toBe(396);
  });
});

describe('wrapIndex', () => {
  it('keeps indexes inside the list, including negatives', () => {
    expect(wrapIndex(-1, 10)).toBe(9);
    expect(wrapIndex(10, 10)).toBe(0);
    expect(wrapIndex(23, 10)).toBe(3);
  });
});
