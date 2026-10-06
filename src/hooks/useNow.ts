import { useSyncExternalStore } from 'react';

/*
 * One shared clock that ticks on each whole second while anything is listening.
 * During server rendering and hydration it reports null, so the prerendered page and
 * the first browser render match; the live time takes over straight after.
 */

let now = 0;
let timer = 0;
const listeners = new Set<() => void>();

function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
  // Wake just after the next whole second, so the display changes on the second.
  timer = window.setTimeout(tick, 1000 - (now % 1000) + 5);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = window.setTimeout(tick, 1000 - (now % 1000) + 5);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.clearTimeout(timer);
  };
}

// Cached between ticks: React requires the same value until the store changes.
const getSnapshot = () => {
  if (!now) now = Date.now();
  return now;
};
const getServerSnapshot = () => null;

/** The current time in ms, updated every second; null while hydrating. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
