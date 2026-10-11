import { describe, expect, it } from 'vitest';
import { campusMap } from '../content/campusMap';
import { choicesOf, findRoute, venueChoice } from './navigation';

const steps = (from: string, to: string) => findRoute(campusMap, from, to)!.steps.map((step) => step.text);

describe('finding the way', () => {
  it('offers where you can start and where you can go, grouped, events with their venues', () => {
    const { from, to } = choicesOf(campusMap, { 'Delta Lab': 'Delta Lab: PRO-PITCH, CODE FLEX' });
    expect(from[0]).toEqual({ id: 'main-gate', label: 'Main gate (registration)', group: 'On the campus' });
    expect(to.find((choice) => choice.id === 'venue:Delta Lab')).toEqual({ id: 'venue:Delta Lab', label: 'Delta Lab: PRO-PITCH, CODE FLEX', group: 'Event venues' });
    for (const id of ['restroom-ladies', 'restroom-gents', 'water', 'canteen', 'mess', 'auditorium']) expect(to.find((choice) => choice.id === id)?.group).toBe('Facilities');
    // "The nearest restroom" is a place to go to, not a place to start from.
    expect(from.some((choice) => choice.id === 'water' || choice.id.startsWith('restroom'))).toBe(false);
    expect(from.some((choice) => choice.id === 'canteen')).toBe(true);
    expect(to.some((choice) => choice.group === 'Second floor' && choice.label === 'Epsilon Lab')).toBe(true);
    expect(venueChoice(campusMap, 'delta lab')).toBe('venue:Delta Lab');
    expect(venueChoice(campusMap, 'Nowhere')).toBeNull();
  });

  it('takes the student from the main gate to each venue, with the walk and the time', () => {
    const theta = findRoute(campusMap, 'main-gate', 'venue:Theta Lab')!;
    expect(theta).toMatchObject({ metres: 303, minutes: 5, destination: { floorId: 'second', roomId: 's-theta', label: 'Theta Lab' } });
    expect(theta.legs.map((leg) => leg.floorId)).toEqual(['campus', 'ground', 'second']);
    expect(theta.steps.at(-1)).toEqual({ text: 'Theta Lab is on your left.', floorId: 'second' });
    expect(steps('main-gate', 'venue:LH-05')).toEqual([
      'From the main gate, walk up the road to the roundabout in front of the main building.',
      'The main entrance is straight ahead: go up the steps.',
      'Go in by the main entrance.',
      'Inside, walk out to the corridor, then turn right along it, with the courtyard on your left.',
      'At the corner, turn left along the corridor, with the courtyard on your left.',
      'LH-05 is on your right.',
    ]);
  });

  it('turns left or right by the way the student is walking, not by a fixed text', () => {
    // To the canteen: walking up from the front of the building, it is straight on; out of side entrance 1, a right turn;
    // from the main auditorium, a left turn.
    expect(steps('main-gate', 'canteen')).toContain('Walk on up the road beside the building.');
    expect(steps('side-1', 'canteen')).toEqual(['Come out of side entrance 1 onto the road.', 'Turn right and walk up the road beside the building.', 'The canteen is on your right.']);
    expect(steps('auditorium', 'canteen')).toContain('Turn left and walk up the road beside the building.');
    // Coming down the main entrance steps, the side road is to the right.
    expect(steps('main-entrance', 'canteen')[1]).toBe('Turn right and walk along the front of the building to its corner.');
    expect(steps('canteen', 'auditorium')).toEqual([
      'Come out of the canteen onto the road.',
      'Turn right and walk to the small roundabout and on past it, towards the main auditorium.',
      'The main auditorium is straight ahead.',
    ]);
    expect(steps('main-gate', 'mess').at(-1)).toBe('The mess is on your left.');
  });

  it('finds the nearest restroom and drinking water from where the student is', () => {
    const ladies = findRoute(campusMap, 'room:ground:g-lh-03', 'restroom-ladies')!;
    expect(ladies.destination).toMatchObject({ floorId: 'ground', label: 'Restroom (ladies)' });
    expect(ladies.steps[0].text).toBe('Come out of LH-03.');
    expect(findRoute(campusMap, 'venue:Theta Lab', 'restroom-gents')!.destination).toMatchObject({ floorId: 'second', label: 'Restroom (gents)' });
    const water = findRoute(campusMap, 'venue:Delta Lab', 'water')!;
    expect(water).toMatchObject({ metres: 21, minutes: 1, destination: { floorId: 'second', label: 'Drinking water' } });
  });

  it('has no way through closed-off places, and nothing to walk when already there', () => {
    expect(findRoute(campusMap, 'main-gate', 'room:ground:g-coe')).toBeNull();
    expect(findRoute(campusMap, 'main-gate', 'nowhere')).toBeNull();
    expect(steps('canteen', 'canteen')).toEqual(['You are already there.']);
  });
});
