import { describe, expect, it } from 'vitest';
import { eventInfo } from './eventInfo';
import { eventAnchor, events, eventsByCategory } from './events';

describe('events content', () => {
  it('lists exactly the ten PRAGYA 2026 events', () => {
    expect(events).toHaveLength(10);
  });

  it('keeps the technical events in the official order', () => {
    expect(eventsByCategory('technical').map((event) => event.name)).toEqual([
      'PRO-PITCH',
      'VIZ CRAFT',
      'PAPER PRESENTATION',
      'CODE FLEX',
      'COGNIX',
    ]);
  });

  it('keeps the non-technical events in the official order', () => {
    expect(eventsByCategory('non-technical').map((event) => event.name)).toEqual([
      'VISUAL LOGO DESIGN',
      'SHORT FILM',
      'EAGLE EYE CHALLENGE',
      'BRAND IT',
      'E-SPORTS',
    ]);
  });

  it('gives every event a unique, URL-safe id', () => {
    const ids = events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
  });

  it('gives every event a description', () => {
    events.forEach((event) => expect(event.description.trim()).not.toBe(''));
  });

  it('gives every event its poster, and the large artwork for its panel', () => {
    events.forEach((event) => {
      expect(event.poster, event.name).toMatch(new RegExp(`/${event.id}\\.webp`));
      expect(event.posterLarge, event.name).toMatch(new RegExp(`/${event.id}-large\\.webp`));
    });
  });

  it('has See More details for every event', () => {
    events.forEach((event) => {
      const info = eventInfo[event.id];
      expect(info, event.name).toBeDefined();
      expect(info.rounds.length, event.name).toBeGreaterThan(0);
      for (const list of [info.procedure, info.rules, info.judging, info.instructions]) {
        expect(list.length, event.name).toBeGreaterThan(0);
      }
    });
  });

  it('builds anchors from ids', () => {
    expect(eventAnchor({ id: 'code-flex' })).toBe('event-code-flex');
  });
});
