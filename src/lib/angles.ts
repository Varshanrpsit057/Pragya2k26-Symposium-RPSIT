/** Wraps any angle in degrees into the range [-180, 180). */
export function normalizeAngle(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** Of all rotations equivalent to `target`, returns the one closest to `current`. */
export function nearestEquivalentAngle(target: number, current: number): number {
  return current + normalizeAngle(target - current);
}

/** Modulo that stays positive for negative inputs. */
export function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}
