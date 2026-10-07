import { eventCatalog } from './eventCatalog';
import type { EventCategory, SymposiumEvent } from './types';

/**
 * Posters by file name: src/assets/events/<event id>.webp (3:4) and <event id>-large.webp
 * (the whole artwork, for the event panels), made from the originals in image/.
 */
const posterFiles = import.meta.glob<string>('../assets/events/*.webp', { eager: true, import: 'default' });
const posterFor = (id: string, size: '' | '-large') => posterFiles[`../assets/events/${id}${size}.webp`];

/** The ten PRAGYA 2026 events with their posters. Edit the events in eventCatalog.ts. */
export const events: SymposiumEvent[] = eventCatalog.map((event) => ({
  ...event,
  poster: posterFor(event.id, ''),
  posterLarge: posterFor(event.id, '-large'),
}));

export const categoryLabels: Record<EventCategory, string> = {
  technical: 'Technical',
  'non-technical': 'Non-technical',
};

export function eventsByCategory(category: EventCategory): SymposiumEvent[] {
  return events.filter((event) => event.category === category);
}

export function eventAnchor(event: Pick<SymposiumEvent, 'id'>): string {
  return `event-${event.id}`;
}
