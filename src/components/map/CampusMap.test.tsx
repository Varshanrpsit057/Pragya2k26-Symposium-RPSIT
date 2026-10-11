import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapEditor } from '../../admin/MapEditor';
import { campusMap } from '../../content/campusMap';
import { eventCatalog } from '../../content/eventCatalog';
import { mapProblem, venueOf, type CampusMap as CampusMapData } from '../../lib/campusMap';
import { findRoute } from '../../lib/navigation';
import { CampusMap, fitLabel } from './CampusMap';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the campus map content', () => {
  it('has every event venue on a floor, in a room that exists, with a way to it from the main gate', () => {
    expect(mapProblem(campusMap)).toBeNull();
    for (const event of eventCatalog) {
      const venue = venueOf(campusMap, event.venue);
      expect(venue, event.venue ?? event.id).toBeDefined();
      const floor = campusMap.floors.find((item) => item.id === venue!.floorId);
      expect(floor?.rooms.find((room) => room.id === venue!.roomId)?.label, venue!.name).toBe(venue!.name);
      const route = findRoute(campusMap, 'main-gate', `venue:${venue!.name}`);
      expect(route?.destination, venue!.name).toMatchObject({ floorId: venue!.floorId, roomId: venue!.roomId });
      expect(route!.steps.length).toBeGreaterThan(2);
      for (const leg of route!.legs) expect(['campus', ...campusMap.floors.map((item) => item.id)]).toContain(leg.floorId);
    }
    // Delta and Theta Lab on the second floor (in by side entrance 1, up its stairs), LH-05 on the ground floor (main entrance).
    for (const name of ['Delta Lab', 'Theta Lab']) {
      const text = findRoute(campusMap, 'main-gate', `venue:${name}`)!.steps.map((step) => step.text).join(' ');
      expect(text).toContain('Go in by side entrance 1.');
      expect(text).toContain('Take the stairs at side entrance 1 up to the second floor.');
    }
    expect(findRoute(campusMap, 'main-gate', 'venue:LH-05')!.steps.map((step) => step.text)).toContain('Go in by the main entrance.');
    expect(mapProblem({ version: 1, floors: [], venues: [] })).toBe('This is not a campus map layout file (or it is from an older version of the map).');
  });

  it('has the building as described: four floors, every room’s name fitting in its box', () => {
    expect(campusMap.floors.map((floor) => floor.name)).toEqual(['Ground floor', 'First floor', 'Second floor', 'Third floor']);
    const labels = (id: string) => campusMap.floors.find((floor) => floor.id === id)!.rooms.map((room) => room.label);
    expect(labels('ground')).toEqual(expect.arrayContaining(['COE', 'Scholarship cell', 'Chemistry Lab', 'Library', 'Founder', 'CDC', 'Main entrance', 'LH-01', 'LH-05']));
    expect(labels('first')).toEqual(expect.arrayContaining(['M201', 'M204', 'Seminar hall-1', 'University exam cell', 'LH-06', 'LH-12', 'Alpha Lab', 'Beta Lab', 'Gamma Lab']));
    expect(labels('second')).toEqual(expect.arrayContaining(['M304', 'Mu Lab', 'Lambda Lab', 'Iota Lab', 'Mech HOD room', 'Seminar hall-2', 'LH-13', 'LH-19', 'Delta Lab', 'Epsilon Lab', 'Theta Lab']));
    for (const floor of campusMap.floors) {
      for (const room of floor.rooms) {
        const { lines } = fitLabel(room.label, room.w, room.h);
        expect(lines.join(' '), `${floor.name}: ${room.label}`).toBe(room.label);
      }
      // Drinking water at the four corners of every floor; the lift is for staff only.
      expect((floor.marks ?? []).filter((mark) => mark.kind === 'water')).toHaveLength(4);
      expect(floor.rooms.find((room) => room.kind === 'lift')).toBeDefined();
    }
    // The COE corridor is closed by glass doors at both ends; the steps down past LH-05 are blocked.
    expect(campusMap.floors[0].marks?.filter((mark) => mark.kind === 'glass-door')).toHaveLength(2);
    expect(campusMap.floors[0].marks?.find((mark) => mark.kind === 'closed')).toMatchObject({ label: 'Steps down (closed)' });
  });
});

describe('the campus map for students', () => {
  const withPhoto: CampusMapData = {
    ...campusMap,
    floors: campusMap.floors.map((floor) => (floor.id === 'second' ? { ...floor, photos: [{ id: 'spot-1', x: 300, y: 560, image: 'second-floor-stairs.jpg', caption: 'Top of the front stairs: turn left' }] } : floor)),
  };

  it('says the layout is being checked only while it is not confirmed', () => {
    expect(campusMap.confirmed).toBe(true);
    const { unmount } = render(<CampusMap map={campusMap} venue="Theta Lab" />);
    expect(screen.queryByText(/The layout is being checked/)).toBeNull();
    unmount();
    render(<CampusMap map={{ ...campusMap, confirmed: false }} venue="Theta Lab" />);
    expect(screen.getByText(/The layout is being checked/)).toBeInTheDocument();
  });

  it('opens on the venue’s floor with the venue lit up, the way from the main gate drawn and told step by step', () => {
    const { container } = render(<CampusMap map={campusMap} venue="Theta Lab" />);
    expect(screen.getByLabelText('I am at')).toHaveValue('main-gate');
    expect(screen.getByLabelText('Take me to')).toHaveValue('venue:Theta Lab');
    expect(screen.getByText(/is on the/).closest('p')).toHaveTextContent('Theta Lab is on the second floor of the main building. About 5 min walk (303 m).');
    expect(screen.getByRole('tab', { name: /Second floor.*your destination/ })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('.map-room.is-venue')).toHaveTextContent('Theta Lab');
    expect(container.querySelector('.map-route__line')).not.toBeNull();
    const steps = screen.getByRole('list', { name: 'How to get to Theta Lab' });
    expect(within(steps).getAllByRole('listitem')[0]).toHaveTextContent('From the main gate, walk up the road to the roundabout in front of the main building.');
    expect(steps).toHaveTextContent('Theta Lab is on your left.');
    // The campus and the ground floor are on the way (side entrance 1, then its stairs straight up).
    for (const name of [/Campus.*on your way/, /Ground floor.*on your way/]) expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Third floor' }).querySelector('.map__tab-dot')).toBeNull();
    // A step opens its floor: on the ground floor the way ends at the stairs, with where they go.
    fireEvent.click(within(steps).getByRole('button', { name: /Go in by side entrance 1/ }));
    expect(screen.getByRole('tab', { name: /Ground floor/ })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('.map-route__badge')).toHaveTextContent('↑ Second');
    fireEvent.click(screen.getByRole('tab', { name: /Second floor/ }));

    // A room's name when tapped.
    fireEvent.click(screen.getByRole('button', { name: 'Epsilon Lab (Lab)' }));
    expect(container.querySelector('.map__tapped')).toHaveTextContent('Epsilon Lab · Lab');

    // The campus: from the main gate (registration) up the road, round to side entrance 1 by the auditorium's roundabout.
    fireEvent.click(screen.getByRole('tab', { name: /Campus/ }));
    const campus = screen.getByRole('img', { name: /from the main gate/ });
    // (Names in two lines read as joined words in textContent.)
    for (const place of ['Main gate: registration', 'You start here', 'Mess', 'Mainauditorium', 'Roundabout', 'Canteen', 'Mechanical / electrical workshop', 'Sideentrance 1', 'Sideentrance 2', 'Boys hostel']) {
      expect(campus.textContent).toContain(place);
    }
    expect(campus.textContent).not.toMatch(/outer gate|mini football/i);
    expect(container.querySelector('.map-route__line')?.getAttribute('points')).toBe('395,748 395,400 230,400 230,285 298,285');
  });

  it('finds the way from where the student is to a restroom, drinking water, the canteen and back', () => {
    const { container } = render(<CampusMap map={campusMap} venue="Delta Lab" />);
    fireEvent.change(screen.getByLabelText('I am at'), { target: { value: 'venue:Delta Lab' } });
    // The nearest restroom for girls: on the same floor, by the top-left stairs.
    fireEvent.click(screen.getByRole('button', { name: 'Girls restroom' }));
    expect(screen.getByRole('button', { name: 'Girls restroom' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/is on the/).closest('p')).toHaveTextContent('Restroom (ladies) is on the second floor of the main building.');
    expect(screen.getByRole('list', { name: 'How to get to Restroom (ladies)' })).toHaveTextContent('Come out of Delta Lab.');
    expect(container.querySelector('.map-room.is-start')).toHaveTextContent('Delta Lab');
    expect(container.querySelector('.map-room.is-venue')).toHaveTextContent('Restroom (ladies)');

    // Drinking water: the nearest one, a few steps away.
    fireEvent.click(screen.getByRole('button', { name: 'Drinking water' }));
    expect(screen.getByRole('list', { name: 'How to get to Drinking water' })).toHaveTextContent('Drinking water is on your right.');

    // Outside: the canteen, down the stairs and out by side entrance 1; the campus tab ends at a pin.
    fireEvent.click(screen.getByRole('button', { name: 'Canteen' }));
    expect(screen.getByText(/outside the main building/)).toHaveTextContent('Canteen: outside the main building (see Campus).');
    expect(screen.getByRole('tab', { name: /Campus.*your destination/ })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('.map-route__pin')).not.toBeNull();
    expect(screen.getByRole('list', { name: 'How to get to Canteen' })).toHaveTextContent('Go out by side entrance 1.');

    // Swap: back from the canteen to Delta Lab.
    fireEvent.click(screen.getByRole('button', { name: 'Swap: go back the other way' }));
    expect(screen.getByLabelText('I am at')).toHaveValue('canteen');
    expect(screen.getByLabelText('Take me to')).toHaveValue('venue:Delta Lab');
    expect(screen.getByRole('list', { name: 'How to get to Delta Lab' })).toHaveTextContent('Come out of the canteen onto the road.');
  });

  it('says so when there is no way for students (the COE corridor is closed off)', () => {
    render(<CampusMap map={campusMap} venue="LH-05" />);
    fireEvent.change(screen.getByLabelText('Take me to'), { target: { value: 'room:ground:g-coe' } });
    expect(screen.getByText(/There is no way for students/)).toHaveTextContent('There is no way for students to COE: it is closed off. Ask a volunteer.');
    expect(screen.queryByRole('list', { name: /How to get to/ })).toBeNull();
  });

  it('zooms in and out with the buttons, and back to the whole floor or the way', () => {
    const { container } = render(<CampusMap map={campusMap} venue="Theta Lab" />);
    const plan = () => container.querySelector('.map__canvas svg')!.getAttribute('viewBox');
    const whole = plan();
    expect(whole).toBe(`0 0 ${campusMap.plan.width} ${campusMap.plan.height}`);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(plan()).not.toBe(whole);
    expect(container.querySelector('.map-viewport')).toHaveClass('is-zoomed');
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole map' }));
    expect(plan()).toBe(whole);
    fireEvent.click(screen.getByRole('button', { name: 'Show the way' }));
    expect(plan()).not.toBe(whole);
  });

  it('shows the photo taken from a spot when its number is tapped', () => {
    render(<CampusMap map={withPhoto} venue="Delta Lab" />);
    expect(document.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Photo 1: Top of the front stairs: turn left' }));
    const viewer = screen.getByRole('dialog', { name: 'Photo 1' });
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/images/map/second-floor-stairs.jpg');
    expect(viewer).toHaveTextContent('You are here (1). Top of the front stairs: turn left');
    fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the campus map editor', () => {
  it('names a room, makes it a venue, keeps the draft, and downloads the layout file', async () => {
    const saved: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved.push(blob as Blob);
      return 'blob:layout';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<MapEditor />);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Floor' })).getByRole('tab', { name: 'First floor' }));
    fireEvent.click(screen.getByRole('button', { name: 'M201 (Classroom)' }));
    const panel = screen.getByRole('complementary', { name: 'Edit' });
    fireEvent.change(within(panel).getByLabelText('Name (as students will see it)'), { target: { value: 'AI & DS Lab 1' } });
    fireEvent.change(within(panel).getByLabelText('What is it?'), { target: { value: 'lab' } });
    expect(screen.getByRole('button', { name: 'AI & DS Lab 1 (Lab)' })).toBeInTheDocument();
    // Moving a venue to this room drops the way drawn to its old room.
    fireEvent.change(within(panel).getByLabelText('Venue in this room'), { target: { value: 'Delta Lab' } });
    // The draft is kept in this browser.
    expect(localStorage.getItem('pragya-campus-map-draft')).toContain('AI & DS Lab 1');

    fireEvent.click(screen.getByRole('button', { name: 'Download layout file' }));
    const layout = JSON.parse(await saved[0].text()) as CampusMapData;
    expect(layout.floors.find((floor) => floor.id === 'first')?.rooms.find((room) => room.id === 'f-m201')).toMatchObject({ label: 'AI & DS Lab 1', kind: 'lab' });
    expect(layout.venues.find((venue) => venue.name === 'Delta Lab')).toMatchObject({ floorId: 'first', roomId: 'f-m201' });
    expect(layout.venues.find((venue) => venue.name === 'Delta Lab')?.route).toBeUndefined();
    expect(screen.getByText(/Downloaded campusMap.json/)).toBeInTheDocument();
  });
});
