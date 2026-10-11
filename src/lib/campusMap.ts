/**
 * The campus map: the main building's floors (rooms on a 1000 × 720 plan around the
 * courtyard), photo spots that show a picture of exactly where the student stands, and the
 * directions to each venue. The layout lives in src/content/campusMap.json, edited in the
 * dashboard (Campus map) and replaced as a whole; photos go in public/images/map/.
 */

export const ROOM_KINDS = {
  room: 'Classroom',
  lab: 'Lab',
  hall: 'Hall',
  office: 'Office',
  stairs: 'Stairs / lift',
  washroom: 'Washroom',
  entrance: 'Entrance',
  empty: 'Not used',
} as const;

export type RoomKind = keyof typeof ROOM_KINDS;

export interface Room {
  id: string;
  label: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A dot on the plan; clicked, it shows the photo taken from that spot. */
export interface PhotoSpot {
  id: string;
  x: number;
  y: number;
  /** A file in public/images/map/, e.g. 'second-floor-stairs.jpg'. */
  image: string;
  caption: string;
}

export interface Floor {
  id: string;
  name: string;
  rooms: Room[];
  photos: PhotoSpot[];
}

/** An event venue (its name as in the event catalog), where it is, and how to get there. */
export interface Venue {
  name: string;
  floorId: string;
  roomId: string;
  steps: string[];
}

export interface CampusMap {
  version: 1;
  /** False while the room positions are a starting guess: the map says they are approximate. */
  confirmed: boolean;
  note?: string;
  floors: Floor[];
  venues: Venue[];
  /** Photo spots on the campus overview (gate, road, main entrance). */
  campusPhotos: PhotoSpot[];
}

export const PLAN = { width: 1000, height: 720 } as const;
export const MAP_PHOTOS = '/images/map/';

/** The URL of a photo spot's picture (a file name, or a full path if one is given). */
export const photoUrl = (image: string) => (image.startsWith('/') || /^https?:/.test(image) ? image : `${MAP_PHOTOS}${image}`);

export const venueOf = (map: CampusMap, name: string | null | undefined) => (name ? map.venues.find((venue) => venue.name.toLowerCase() === name.toLowerCase()) : undefined);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Checks a layout file (from the editor); the problem, or null when it can be used. */
export function mapProblem(value: unknown): string | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.floors) || !Array.isArray(value.venues)) return 'This is not a campus map layout file.';
  for (const floor of value.floors as unknown[]) {
    if (!isObject(floor) || typeof floor.id !== 'string' || typeof floor.name !== 'string' || !Array.isArray(floor.rooms) || !Array.isArray(floor.photos)) return 'A floor in the file is incomplete.';
    for (const room of floor.rooms as unknown[]) {
      if (!isObject(room) || typeof room.id !== 'string' || typeof room.label !== 'string' || !(String(room.kind) in ROOM_KINDS) || ![room.x, room.y, room.w, room.h].every(isNumber)) {
        return `A room on the ${floor.name} is incomplete.`;
      }
    }
    for (const photo of floor.photos as unknown[]) {
      if (!isObject(photo) || typeof photo.image !== 'string' || ![photo.x, photo.y].every(isNumber)) return `A photo spot on the ${floor.name} is incomplete.`;
    }
  }
  for (const venue of value.venues as unknown[]) {
    if (!isObject(venue) || typeof venue.name !== 'string' || !Array.isArray(venue.steps)) return 'A venue in the file is incomplete.';
  }
  return null;
}
