import brandItPoster from '../assets/events/brand-it.webp';
import codeFlexPoster from '../assets/events/code-flex.webp';
import cognixPoster from '../assets/events/cognix.webp';
import eSportsPoster from '../assets/events/e-sports.webp';
import eagleEyePoster from '../assets/events/eagle-eye-challenge.webp';
import paperPresentationPoster from '../assets/events/paper-presentation.webp';
import proPitchPoster from '../assets/events/pro-pitch.webp';
import shortFilmPoster from '../assets/events/short-film.webp';
import visualLogoPoster from '../assets/events/visual-logo-design.webp';
import vizCraftPoster from '../assets/events/viz-craft.webp';
import { eventCatalog } from './eventCatalog';
import type { EventCategory, SymposiumEvent } from './types';

/** Posters by event id. Generated from image/ by `npm run images`. */
const posters: Record<string, string> = {
  'pro-pitch': proPitchPoster,
  'viz-craft': vizCraftPoster,
  'paper-presentation': paperPresentationPoster,
  'code-flex': codeFlexPoster,
  cognix: cognixPoster,
  'visual-logo-design': visualLogoPoster,
  'short-film': shortFilmPoster,
  'eagle-eye-challenge': eagleEyePoster,
  'brand-it': brandItPoster,
  'e-sports': eSportsPoster,
};

/** The ten PRAGYA 2026 events with their posters. Edit the events in eventCatalog.ts. */
export const events: SymposiumEvent[] = eventCatalog.map((event) => ({ ...event, poster: posters[event.id] }));

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
