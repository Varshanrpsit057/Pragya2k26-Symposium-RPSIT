import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** False while the browser tab is hidden. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    () => true,
  );
}
