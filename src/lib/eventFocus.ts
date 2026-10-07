/**
 * "Show this event": the circular carousel, the map of events and links such as
 * #event-code-flex all open that event's panel in its section and bring it into view.
 *
 * A tiny store, read with useSyncExternalStore: each request gets a new number, so asking
 * for the same event twice (e.g. after hovering elsewhere) opens it again.
 */
export interface FocusRequest {
  /** Event id, e.g. 'code-flex'. */
  id: string | null;
  /** Increases with every request. */
  n: number;
}

const PREFIX = '#event-';
const NONE: FocusRequest = { id: null, n: 0 };

let current: FocusRequest = NONE;
let readHash = false;
const listeners = new Set<() => void>();

const idFromHash = (hash: string) => (hash.startsWith(PREFIX) && hash.length > PREFIX.length ? decodeURIComponent(hash.slice(PREFIX.length)) : null);

function request(id: string) {
  current = { id, n: current.n + 1 };
  listeners.forEach((listener) => listener());
}

const onHashChange = () => {
  const id = idFromHash(window.location.hash);
  if (id) request(id);
};

export function subscribeEventFocus(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('hashchange', onHashChange);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('hashchange', onHashChange);
  };
}

/** The latest request; on the first read, a #event-… address the page was opened with. */
export function getEventFocus(): FocusRequest {
  if (!readHash) {
    readHash = true;
    const id = idFromHash(window.location.hash);
    if (id) current = { id, n: current.n + 1 };
  }
  return current;
}

/** Nothing is asked for while the page is prerendered. */
export const getServerEventFocus = (): FocusRequest => NONE;

/** Opens the event's panel and scrolls its gallery into view; the address shows the event. */
export function focusEvent(id: string) {
  const anchor = `${PREFIX}${id}`;
  if (window.location.hash !== anchor) window.history.replaceState(null, '', anchor);
  request(id);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // After React has opened the panel.
  requestAnimationFrame(() => {
    const panel = document.getElementById(anchor.slice(1));
    const gallery = panel?.closest<HTMLElement>('.accordion-gallery') ?? panel;
    gallery?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  });
}
