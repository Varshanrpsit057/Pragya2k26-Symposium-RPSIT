/**
 * The campus map: the main building's floors (rooms around the courtyard, drawn with the main
 * entrance at the bottom), photo spots that show a picture of exactly where the student stands,
 * and the way to each venue, drawn on each floor. The layout lives in
 * src/content/campusMap.json, edited in the dashboard (Campus map) and replaced as a whole;
 * photos go in public/images/map/.
 */

export const ROOM_KINDS = {
  room: 'Classroom',
  lab: 'Lab',
  hall: 'Hall',
  office: 'Office',
  stairs: 'Stairs',
  lift: 'Lift (staff only)',
  washroom: 'Restroom',
  entrance: 'Entrance',
  empty: 'Not used',
} as const;

export type RoomKind = keyof typeof ROOM_KINDS;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room extends Box {
  id: string;
  label: string;
  kind: RoomKind;
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

export type Side = 'left' | 'right' | 'up' | 'down';

/**
 * Something drawn on a floor besides rooms: drinking water, a glass door that closes a
 * corridor (from x,y to x2,y2), a way in (an arrow pointing `dir`, its tip on the wall), a way
 * out to somewhere outside (an arrow along `points`), a way out that is closed (a stub with a
 * cross, pointing `dir`), or a building outside the main one.
 */
export type Mark =
  | { id: string; kind: 'water'; x: number; y: number; label: string }
  | { id: string; kind: 'glass-door'; x: number; y: number; x2: number; y2: number; label: string }
  | { id: string; kind: 'entrance'; x: number; y: number; dir: Side; label: string }
  | { id: string; kind: 'exit'; points: [number, number][]; label: string }
  | { id: string; kind: 'closed'; x: number; y: number; dir: Side; label: string }
  | { id: string; kind: 'outside'; x: number; y: number; w: number; h: number; label: string };

export interface Floor {
  id: string;
  name: string;
  rooms: Room[];
  photos: PhotoSpot[];
  marks?: Mark[];
}

/** The way to a venue on one floor: a line through `points`, labelled where it starts and ends. */
export interface RouteLeg {
  floorId: string;
  points: [number, number][];
  from?: string;
  to?: string;
  /** Where the start and end labels go (they start there), when beside the line would cover rooms. */
  fromAt?: [number, number];
  toAt?: [number, number];
}

/** An event venue (its name as in the event catalog) and its room; the way there is worked out from the walking network. */
export interface Venue {
  name: string;
  floorId: string;
  roomId: string;
  /** Older layout files: written directions and a drawn way (no longer used). */
  steps?: string[];
  route?: RouteLeg[];
}

/** A point of the walking network: on a floor (plan coordinates) or on the campus drawing. */
export interface NavNode {
  id: string;
  floorId: string;
  x: number;
  y: number;
  kind: 'corridor' | 'hallway' | 'door' | 'stairs' | 'entrance' | 'outside' | 'water' | 'campus';
  /** A ring corner of the corridor ('At the corner, turn …'), or which stairs. */
  corner?: boolean | string;
  roomId?: string;
  label?: string;
  /** For the stairs and the entrances: how the directions name them. */
  name?: string;
  /** What it is, for 'the nearest …': restroom-ladies, restroom-gents, water, canteen, mess, auditorium. */
  tag?: string;
}

/** A path between two points, `w` metres long; `say` is what the directions say walking it (a→b, b→a). */
export interface NavEdge {
  a: string;
  b: string;
  w: number;
  say?: [string, string];
}

/** A place to choose in the route finder: a point, or the nearest point with a tag. */
export interface Place {
  id: string;
  label: string;
  group: 'campus' | 'facility';
  node?: string;
  nearest?: string;
}

/** The building every floor shares: its walls, the courtyard, the amphitheatre and fountain. */
export interface BuildingPlan {
  width: number;
  height: number;
  outline: Box;
  court: Box;
  /** The amphitheatre in the courtyard, with steps up to it on the given sides. */
  amphitheatre: { x: number; y: number; r: number; steps: ('left' | 'right' | 'top' | 'bottom')[] };
  fountain: { x: number; y: number; r: number };
}

export interface CampusMap {
  version: 2;
  /** False while the layout is not yet checked on site: the map says it may be approximate. */
  confirmed: boolean;
  note?: string;
  plan: BuildingPlan;
  floors: Floor[];
  venues: Venue[];
  /** The walking network the routes are found in. */
  nav: { nodes: NavNode[]; edges: NavEdge[]; places: Place[] };
  /** Photo spots on the campus overview (gates, road, main entrance). */
  campusPhotos: PhotoSpot[];
}

/** The campus overview's drawing size (its photo spots use these coordinates). */
export const CAMPUS = { width: 700, height: 840 } as const;
export const MAP_PHOTOS = '/images/map/';

/** The URL of a photo spot's picture (a file name, or a full path if one is given). */
export const photoUrl = (image: string) => (image.startsWith('/') || /^https?:/.test(image) ? image : `${MAP_PHOTOS}${image}`);

export const venueOf = (map: CampusMap, name: string | null | undefined) => (name ? map.venues.find((venue) => venue.name.toLowerCase() === name.toLowerCase()) : undefined);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBox = (value: unknown) => isObject(value) && [value.x, value.y, value.w, value.h].every(isNumber);

/** Checks a layout file (from the editor); the problem, or null when it can be used. */
export function mapProblem(value: unknown): string | null {
  if (!isObject(value) || value.version !== 2 || !Array.isArray(value.floors) || !Array.isArray(value.venues)) return 'This is not a campus map layout file (or it is from an older version of the map).';
  const plan = value.plan;
  if (!isObject(plan) || !isNumber(plan.width) || !isNumber(plan.height) || !isBox(plan.outline) || !isBox(plan.court)) return 'The building outline in the file is incomplete.';
  for (const floor of value.floors as unknown[]) {
    if (!isObject(floor) || typeof floor.id !== 'string' || typeof floor.name !== 'string' || !Array.isArray(floor.rooms) || !Array.isArray(floor.photos)) return 'A floor in the file is incomplete.';
    for (const room of floor.rooms as unknown[]) {
      if (!isObject(room) || typeof room.id !== 'string' || typeof room.label !== 'string' || !(String(room.kind) in ROOM_KINDS) || !isBox(room)) {
        return `A room on the ${floor.name} is incomplete.`;
      }
    }
    for (const photo of floor.photos as unknown[]) {
      if (!isObject(photo) || typeof photo.image !== 'string' || ![photo.x, photo.y].every(isNumber)) return `A photo spot on the ${floor.name} is incomplete.`;
    }
  }
  const nav = value.nav;
  if (!isObject(nav) || !Array.isArray(nav.nodes) || !Array.isArray(nav.edges) || !Array.isArray(nav.places)) return 'The walking network in the file is missing.';
  for (const venue of value.venues as unknown[]) {
    if (!isObject(venue) || typeof venue.name !== 'string' || typeof venue.roomId !== 'string') return 'A venue in the file is incomplete.';
    const legs = venue.route ?? [];
    const isPoint = (point: unknown) => Array.isArray(point) && point.length === 2 && point.every(isNumber);
    if (!Array.isArray(legs) || !legs.every((leg: unknown) => isObject(leg) && typeof leg.floorId === 'string' && Array.isArray(leg.points) && leg.points.every(isPoint))) {
      return `The way to ${venue.name} in the file is incomplete.`;
    }
  }
  return null;
}
