import { describe, expect, it } from 'vitest';
import { eventInfo } from './eventInfo';
import { eventAnchor, events, eventsByCategory } from './events';

describe('events content', () => {
  it('lists exactly the five PRAGYA 2026 events, all technical', () => {
    expect(events).toHaveLength(5);
    events.forEach((event) => expect(event.category).toBe('technical'));
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

  it('has no non-technical events left anywhere', () => {
    const discontinued = ['visual-logo-design', 'short-film', 'eagle-eye-challenge', 'brand-it', 'e-sports'];
    expect(events.map((event) => event.id).filter((id) => discontinued.includes(id))).toEqual([]);
    expect(Object.keys(eventInfo).sort()).toEqual(events.map((event) => event.id).sort());
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
      for (const list of [info.procedure, info.rules, info.judging]) {
        expect(list.length, event.name).toBeGreaterThan(0);
      }
    });
  });

  it('builds anchors from ids', () => {
    expect(eventAnchor({ id: 'code-flex' })).toBe('event-code-flex');
  });
});
