import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapEditor } from '../../admin/MapEditor';
import { campusMap } from '../../content/campusMap';
import { eventCatalog } from '../../content/eventCatalog';
import { mapProblem, venueOf, type CampusMap as CampusMapData } from '../../lib/campusMap';
import { CampusMap } from './CampusMap';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the campus map content', () => {
  it('has every event venue on a floor, in a room that exists, with directions', () => {
    expect(mapProblem(campusMap)).toBeNull();
    for (const event of eventCatalog) {
      const venue = venueOf(campusMap, event.venue);
      expect(venue, event.venue ?? event.id).toBeDefined();
      const floor = campusMap.floors.find((item) => item.id === venue!.floorId);
      expect(floor?.rooms.some((room) => room.id === venue!.roomId), venue!.name).toBe(true);
      expect(venue!.steps.length).toBeGreaterThan(0);
    }
    // Delta and Theta Lab on the second floor, Paper Presentation (LH-05) on the ground floor.
    expect(venueOf(campusMap, 'Delta Lab')?.floorId).toBe('second');
    expect(venueOf(campusMap, 'Theta Lab')?.floorId).toBe('second');
    expect(venueOf(campusMap, 'LH-05')?.floorId).toBe('ground');
    expect(mapProblem({ version: 2 })).toBe('This is not a campus map layout file.');
  });
});

describe('the campus map for students', () => {
  const withPhoto: CampusMapData = {
    ...campusMap,
    floors: campusMap.floors.map((floor) => (floor.id === 'second' ? { ...floor, photos: [{ id: 'spot-1', x: 300, y: 560, image: 'second-floor-stairs.jpg', caption: 'Top of the front stairs: turn left' }] } : floor)),
  };

  it('opens on the venue’s floor with the venue lit up, the way there, and a note while positions are approximate', () => {
    const { container } = render(<CampusMap map={campusMap} venue="Theta Lab" />);
    expect(screen.getByText(/is on the/).closest('p')).toHaveTextContent('Theta Lab is on the second floor of the main building.');
    expect(screen.getByRole('tab', { name: /Second floor/ })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('.map-room.is-venue')).toHaveTextContent('Theta Lab');
    expect(within(screen.getByRole('list', { name: 'How to get to Theta Lab' })).getAllByRole('listitem').length).toBeGreaterThan(2);
    expect(screen.getByText(/Room positions are approximate/)).toBeInTheDocument();

    // The campus: from the main gate up the main road to the main building.
    fireEvent.click(screen.getByRole('tab', { name: 'Campus' }));
    expect(screen.getByRole('img', { name: /from the main gate up the main road/ })).toHaveTextContent('Main gate: you enter here');
    expect(screen.getByRole('img', { name: /from the main gate/ })).toHaveTextContent('Main auditorium');
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
    fireEvent.click(screen.getByRole('button', { name: 'Room 1-01 (Classroom)' }));
    const panel = screen.getByRole('complementary', { name: 'Edit' });
    fireEvent.change(within(panel).getByLabelText('Name (as students will see it)'), { target: { value: 'AI & DS Lab 1' } });
    fireEvent.change(within(panel).getByLabelText('What is it?'), { target: { value: 'lab' } });
    expect(screen.getByRole('button', { name: 'AI & DS Lab 1 (Lab)' })).toBeInTheDocument();
    // The draft is kept in this browser.
    expect(localStorage.getItem('pragya-campus-map-draft')).toContain('AI & DS Lab 1');

    fireEvent.click(screen.getByRole('button', { name: 'Download layout file' }));
    const layout = JSON.parse(await saved[0].text()) as CampusMapData;
    expect(layout.floors.find((floor) => floor.id === 'first')?.rooms.find((room) => room.id === 'first-back-1')).toMatchObject({ label: 'AI & DS Lab 1', kind: 'lab' });
    expect(screen.getByText(/Downloaded campusMap.json/)).toBeInTheDocument();
  });
});
