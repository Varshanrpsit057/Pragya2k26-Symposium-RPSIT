import type { PointerEvent } from 'react';

/** Writes the pointer position into --mx / --my so CSS can draw cursor-following glows. */
export function trackPointer(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType === 'touch') return;
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  el.style.setProperty('--my', `${event.clientY - rect.top}px`);
}
